import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const tag =
  process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : process.env.RELEASE_TAG;
if (tag && tag !== `v${pkg.version}`)
  throw new Error(`Release tag must be v${pkg.version}, received ${tag}.`);
if (process.argv.includes('--artifacts')) {
  const directory = path.join(root, 'dist');
  const escapedVersion = pkg.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match a whole version token, allowing only normal packaging suffixes after it.
  const versionPattern = new RegExp(
    `(?:^|[-_ ])${escapedVersion}(?=$|[ _]|\\.(?=[A-Za-z])|-(?:x64|arm64|armv7l|ia32|universal|mac|win|linux)(?=[_.-]|$))`,
  );
  const files = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        versionPattern.test(entry.name) &&
        fs.statSync(path.join(directory, entry.name)).size > 0,
    )
    .map((entry) => entry.name);
  const has = (suffix) => files.some((name) => name.endsWith(suffix));
  const expected =
    process.platform === 'win32'
      ? ['.exe']
      : process.platform === 'darwin'
        ? ['.dmg', '.zip']
        : ['.AppImage', '.deb'];
  for (const suffix of expected)
    if (!has(suffix)) throw new Error(`Missing ${suffix} artifact for ${pkg.version}.`);
  if (process.platform === 'win32') {
    if (!files.some((name) => /Setup.*\.exe$/i.test(name)))
      throw new Error('Missing Windows NSIS installer.');
    if (!files.some((name) => /\.exe$/i.test(name) && !/Setup/i.test(name)))
      throw new Error('Missing Windows portable executable.');
  }
}
console.log(
  `Release metadata${process.argv.includes('--artifacts') ? ' and artifacts' : ''} verified for ${pkg.version}.`,
);
