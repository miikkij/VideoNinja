import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(script), '..');
let yaml;
const platforms = {
  win32: { suffixes: ['.exe'], unpacked: /^win(?:-(?:x64|ia32|arm64))?-unpacked$/ },
  darwin: { suffixes: ['.dmg', '.zip'], unpacked: /^mac(?:-(?:x64|arm64|universal))?$/ },
  linux: {
    suffixes: ['.AppImage', '.deb'],
    unpacked: /^linux(?:-(?:x64|ia32|arm64|armv7l))?-unpacked$/,
  },
};

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function regularFile(filename) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.size <= 0)
    throw new Error(`Expected a nonempty regular file: ${filename}`);
  return stat;
}

function readDocument(filename, json = false) {
  if (regularFile(filename).size > 1024 * 1024)
    throw new Error(`Metadata is too large: ${filename}`);
  const text = fs.readFileSync(filename, 'utf8');
  const result = json ? JSON.parse(text) : yaml.load(text, { schema: yaml.JSON_SCHEMA });
  if (!record(result)) throw new Error(`Expected a metadata object: ${filename}`);
  return result;
}

function versionPattern(version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // A complete version token excludes stale versions and prerelease lookalikes.
  return new RegExp(
    `(?:^|[-_ ])${escaped}(?=$|[ _]|\\.(?=[A-Za-z])|-(?:x64|arm64|armv7l|ia32|universal|mac|win|linux)(?=[_.-]|$))`,
  );
}

function manifestName(platform, arch) {
  if (platform === 'win32') return 'latest.yml';
  if (platform === 'darwin') return 'latest-mac.yml';
  return `latest-linux${arch === 'x64' ? '' : arch === 'armv7l' ? '-arm' : `-${arch}`}.yml`;
}

function artifactName(value) {
  if (typeof value !== 'string' || !value) throw new Error('Missing update artifact URL.');
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch (error) {
    throw new Error('Invalid encoded update artifact name.', { cause: error });
  }
  if (!/^[0-9A-Za-z._ -]+$/.test(decoded) || decoded === '.' || decoded === '..') {
    throw new Error(`Update artifact must be a local filename: ${value}`);
  }
  return decoded;
}

function resolveArtifact(value, files) {
  const name = artifactName(value);
  // Match electron-builder's GitHub name normalization, never a prefix guess.
  const matches = files.filter((file) => file === name || file.replaceAll(' ', '-') === name);
  if (matches.length !== 1) throw new Error(`Missing or ambiguous update artifact: ${name}`);
  return matches[0];
}

async function sha512(filename) {
  const hash = createHash('sha512');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest('base64');
}

async function verifyManifest(filename, { directory, files, version, platform }) {
  const manifest = readDocument(filename);
  if (manifest.version !== version)
    throw new Error(`Update manifest version must be ${version}: ${filename}`);
  if (!Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 100) {
    throw new Error(`Update manifest has no valid artifact list: ${filename}`);
  }
  const seen = new Set();
  for (const entry of manifest.files) {
    if (!record(entry)) throw new Error(`Invalid update file entry: ${filename}`);
    const name = resolveArtifact(entry.url, files);
    if (seen.has(name)) throw new Error(`Duplicate update artifact: ${name}`);
    seen.add(name);
    const artifact = path.join(directory, name);
    const stat = regularFile(artifact);
    if (!Number.isSafeInteger(entry.size) || entry.size <= 0 || entry.size !== stat.size) {
      throw new Error(`Update artifact size mismatch: ${name}`);
    }
    if (
      typeof entry.sha512 !== 'string' ||
      !/^[A-Za-z0-9+/]{86}==$/.test(entry.sha512) ||
      entry.sha512 !== (await sha512(artifact))
    ) {
      throw new Error(`Update artifact SHA512 mismatch: ${name}`);
    }
  }
  const requiredUpdate =
    platform === 'win32' ? /Setup.*\.exe$/i : platform === 'darwin' ? /\.zip$/ : /\.AppImage$/;
  if (![...seen].some((name) => requiredUpdate.test(name)))
    throw new Error(`Missing installable update artifact in ${filename}`);
  const legacyName = resolveArtifact(manifest.path, files);
  const legacyEntry = manifest.files.find(
    (entry) => resolveArtifact(entry.url, files) === legacyName,
  );
  if (!legacyEntry || legacyEntry.sha512 !== manifest.sha512)
    throw new Error(`Legacy update path or SHA512 disagrees with the file list: ${filename}`);
}

function githubProject(pkg) {
  const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(
    repository || '',
  );
  if (!match) throw new Error('The source package must declare its GitHub repository.');
  return { owner: match[1], repo: match[2] };
}

function verifyPackagedUpdates(directory, pkg, platform) {
  const expected = githubProject(pkg);
  const packages = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && platforms[platform].unpacked.test(entry.name));
  if (!packages.length)
    throw new Error('Missing unpacked application for update-policy verification.');
  const productName = pkg.build?.productName || pkg.productName || pkg.name;
  for (const entry of packages) {
    const resources =
      platform === 'darwin'
        ? path.join(directory, entry.name, `${productName}.app`, 'Contents', 'Resources')
        : path.join(directory, entry.name, 'resources');
    const publish = readDocument(path.join(resources, 'app-update.yml'));
    const policy = readDocument(path.join(resources, 'update-policy.json'), true);
    if (
      publish.provider !== 'github' ||
      publish.owner !== expected.owner ||
      publish.repo !== expected.repo ||
      (publish.host && publish.host !== 'github.com')
    ) {
      throw new Error(
        `Packaged update provider does not match the source repository: ${entry.name}`,
      );
    }
    if (
      typeof policy.signed !== 'boolean' ||
      typeof policy.automatic !== 'boolean' ||
      !Object.hasOwn(policy, 'publisherName')
    ) {
      throw new Error(`Invalid packaged update policy: ${entry.name}`);
    }
    if (platform !== 'linux' && policy.automatic && !policy.signed) {
      throw new Error(`Unsigned ${platform} builds must use manual updates: ${entry.name}`);
    }
    if (platform === 'win32' && policy.signed) {
      const publisher = policy.publisherName;
      const names = Array.isArray(publish.publisherName)
        ? publish.publisherName
        : [publish.publisherName];
      if (
        typeof publisher !== 'string' ||
        !publisher.trim() ||
        !names.length ||
        names.some((name) => name !== publisher) ||
        publish.verifyUpdateCodeSignature === false
      ) {
        throw new Error(
          `Windows updater publisher verification does not match the signing policy: ${entry.name}`,
        );
      }
    } else if (policy.publisherName !== null || (platform === 'linux' && policy.signed)) {
      throw new Error(`Unexpected signing identity in update policy: ${entry.name}`);
    }
  }
}

/** Validate owned build output without depending on the host OS in regression tests. */
export async function verifyRelease({
  root = projectRoot,
  platform = process.platform,
  arch = process.arch,
  artifacts = false,
  env = process.env,
} = {}) {
  const pkg = readDocument(path.join(root, 'package.json'), true);
  if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(pkg.version))
    throw new Error('A stable source package version is required.');
  const tag = env.GITHUB_REF_TYPE === 'tag' ? env.GITHUB_REF_NAME : env.RELEASE_TAG;
  if (tag && tag !== `v${pkg.version}`)
    throw new Error(`Release tag must be v${pkg.version}, received ${tag}.`);
  if (!artifacts) return pkg.version;
  // The workflow checks the source version before installing dependencies.
  yaml ||= (await import('js-yaml')).default;
  if (!platforms[platform]) throw new Error('Unsupported release platform.');
  const directory = path.join(root, 'dist');
  const version = versionPattern(pkg.version);
  const files = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        version.test(entry.name) &&
        fs.statSync(path.join(directory, entry.name)).size > 0,
    )
    .map((entry) => entry.name);
  for (const suffix of platforms[platform].suffixes)
    if (!files.some((name) => name.endsWith(suffix)))
      throw new Error(`Missing ${suffix} artifact for ${pkg.version}.`);
  if (platform === 'win32') {
    if (!files.some((name) => /Setup.*\.exe$/i.test(name)))
      throw new Error('Missing Windows NSIS installer.');
    if (!files.some((name) => /\.exe$/i.test(name) && !/Setup/i.test(name)))
      throw new Error('Missing Windows portable executable.');
  }
  const manifests = [manifestName(platform, arch)];
  if (platform === 'linux') {
    for (const entry of fs.readdirSync(directory))
      if (/^latest-linux(?:-(?:arm64|arm|ia32))?\.yml$/.test(entry) && !manifests.includes(entry))
        manifests.push(entry);
  }
  for (const manifest of manifests)
    await verifyManifest(path.join(directory, manifest), {
      directory,
      files,
      version: pkg.version,
      platform,
    });
  verifyPackagedUpdates(directory, pkg, platform);
  return pkg.version;
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  const artifacts = process.argv.includes('--artifacts');
  const version = await verifyRelease({ artifacts });
  console.log(
    `Release metadata${artifacts ? ', artifact hashes and packaged update policy' : ''} verified for ${version}.`,
  );
}
