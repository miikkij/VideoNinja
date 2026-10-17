const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { inflateRawSync } = require('node:zlib');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const { runProcess, abortError } = require('./processRunner');
const { createToolService, SAFE_YTDLP_FLAGS, settleProbes } = require('./tools');

const MAX_DOWNLOAD = 300 * 1024 * 1024;
const MAX_EXECUTABLE = 250 * 1024 * 1024;
const WINDOWS_RENAME_DELAYS = [100, 200, 400, 800, 1000, 1000, 1000];
const TRANSIENT_RENAME_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY']);
const HOSTS = new Set([
  'api.github.com',
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
  'raw.githubusercontent.com',
]);
const REPOSITORIES = Object.freeze({
  'yt-dlp': 'yt-dlp/yt-dlp',
  runtime: 'denoland/deno',
  ffmpeg: 'yt-dlp/FFmpeg-Builds',
});

function trustedUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !HOSTS.has(url.hostname)
  )
    throw new Error('The tool download redirected to an untrusted host.');
  return url.href;
}

function checksumFor(text, filename) {
  // Deno's Windows release workflow publishes PowerShell Get-FileHash output.
  const windowsHash = text.match(/^Hash\s*:\s*([a-f0-9]{64})\s*$/imu);
  const windowsPath = text.match(/^Path\s*:\s*(.+?)\s*$/mu);
  if (
    /^Algorithm\s*:\s*SHA256\s*$/mu.test(text) &&
    windowsHash &&
    windowsPath &&
    path.win32.basename(windowsPath[1]) === filename
  )
    return windowsHash[1].toLowerCase();
  const matches = text
    .split(/\r?\n/u)
    .map((line) => /^([a-f0-9]{64})\s+\*?(.+?)\s*$/iu.exec(line))
    .filter((match) => match && match[2] === filename);
  if (matches.length !== 1)
    throw new Error('The official checksum manifest does not identify this download exactly once.');
  return matches[0][1].toLowerCase();
}

function safeArchivePath(name) {
  return (
    name &&
    !name.includes('\\') &&
    !name.startsWith('/') &&
    !name.includes(':') &&
    !name.split('/').includes('..') &&
    ![...name].some((char) => char.charCodeAt(0) < 32)
  );
}

// Read only explicitly requested regular files. No archive path is ever used as
// an output path, and symlinks/encryption/ZIP64/unsupported compression fail closed.
function readZipExecutables(buffer, names) {
  let end = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset--)
    if (
      buffer.readUInt32LE(offset) === 0x06054b50 &&
      offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length
    ) {
      end = offset;
      break;
    }
  if (end < 0 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6))
    throw new Error('Unsupported tool archive.');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  if (count > 20000 || offset === 0xffffffff)
    throw new Error('Tool archive exceeds its entry limit.');
  const found = new Map();
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50)
      throw new Error('Invalid tool archive directory.');
    const flags = buffer.readUInt16LE(offset + 8),
      method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20),
      size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28),
      extraLength = buffer.readUInt16LE(offset + 30),
      commentLength = buffer.readUInt16LE(offset + 32);
    const mode = buffer.readUInt32LE(offset + 38) >>> 16,
      local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (!safeArchivePath(name) || (mode & 0xf000) === 0xa000)
      throw new Error('Unsafe path or link in tool archive.');
    const basename = path.posix.basename(name);
    if (names.includes(basename)) {
      if (
        found.has(basename) ||
        flags & 1 ||
        ![0, 8].includes(method) ||
        !size ||
        size > MAX_EXECUTABLE ||
        local + 30 > offset ||
        buffer.readUInt32LE(local) !== 0x04034b50
      )
        throw new Error('Unsupported or duplicated executable in tool archive.');
      const begin = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      if (begin + compressed > offset) throw new Error('Truncated tool archive.');
      const bytes = buffer.subarray(begin, begin + compressed);
      const output =
        method === 0
          ? Buffer.from(bytes)
          : inflateRawSync(bytes, { maxOutputLength: MAX_EXECUTABLE });
      if (output.length !== size) throw new Error('Invalid extracted executable size.');
      found.set(basename, output);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (names.some((name) => !found.has(name)))
    throw new Error('The tool archive is missing a required executable.');
  return found;
}

function createToolManager(deps = {}) {
  const platform = deps.platform || process.platform,
    arch = deps.arch || process.arch;
  const fileSystem = deps.fs || fs,
    request = deps.fetch || globalThis.fetch;
  const execute = deps.runProcess || runProcess,
    executeFile = deps.execFile || promisify(execFile);
  const waitForRename =
    deps.waitForRename || ((milliseconds, signal) => delay(milliseconds, undefined, { signal }));
  const managedDir = deps.managedDir;
  if (typeof managedDir !== 'string' || !path.isAbsolute(managedDir))
    throw new Error('An absolute managed tools directory is required.');
  const service = deps.tools || createToolService({ managedDir, platform });
  let installing = false;

  async function renameWithRetry(from, to, signal) {
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw abortError();
      try {
        await fileSystem.rename(from, to);
        return;
      } catch (error) {
        if (signal?.aborted) throw abortError();
        if (
          platform !== 'win32' ||
          !TRANSIENT_RENAME_ERRORS.has(error.code) ||
          attempt >= WINDOWS_RENAME_DELAYS.length
        )
          throw error;
        // Probed executables can remain briefly locked by Windows/antivirus.
        await waitForRename(WINDOWS_RENAME_DELAYS[attempt], signal);
      }
    }
  }

  async function cleanupTemporary(temporary, tool) {
    const realRoot = await fileSystem.realpath(managedDir);
    if (
      path.dirname(temporary) !== realRoot ||
      !path.basename(temporary).startsWith(`.${tool}-install-`)
    )
      throw new Error('Refusing unsafe tool installation cleanup.');
    await fileSystem.rm(temporary, { recursive: true, force: true });
  }

  async function read(url, limit, signal) {
    let location = trustedUrl(url);
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (signal?.aborted) throw abortError();
      const response = await request(location, {
        redirect: 'manual',
        signal,
        headers: {
          Accept: 'application/octet-stream, application/json',
          'User-Agent': 'VideoNinja-tool-manager',
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = response.headers.get('location');
        await response.body?.cancel();
        if (!next) throw new Error('Invalid tool download redirect.');
        location = trustedUrl(new URL(next, location).href);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`The official tool server returned HTTP ${response.status}.`);
      }
      const advertised = Number(response.headers.get('content-length'));
      if (advertised > limit) {
        await response.body?.cancel();
        throw new Error('Tool download exceeds its size limit.');
      }
      const chunks = [];
      let size = 0;
      if (!response.body) throw new Error('The tool server returned an empty response.');
      for await (const chunk of response.body) {
        if (signal?.aborted) throw abortError();
        size += chunk.length;
        if (size > limit) throw new Error('Tool download exceeds its size limit.');
        chunks.push(Buffer.from(chunk));
      }
      if (!size) throw new Error('The tool server returned an empty download.');
      return Buffer.concat(chunks, size);
    }
    throw new Error('Too many tool download redirects.');
  }

  function getSetupPlan() {
    const supported =
      ['x64', 'arm64'].includes(arch) && ['win32', 'darwin', 'linux'].includes(platform);
    const runtimeUrl = 'https://docs.deno.com/runtime/getting_started/installation/';
    return {
      platform,
      arch,
      tools: [
        {
          tool: 'yt-dlp',
          managed: supported,
          url: 'https://github.com/yt-dlp/yt-dlp#installation',
          license: 'GPL-3.0-or-later (standalone distribution)',
        },
        { tool: 'runtime', name: 'Deno', managed: supported, url: runtimeUrl, license: 'MIT' },
        {
          tool: 'ffmpeg',
          managed: supported && platform !== 'darwin',
          url: 'https://ffmpeg.org/download.html',
          command:
            platform === 'darwin'
              ? 'brew install ffmpeg'
              : platform === 'linux'
                ? 'Install ffmpeg and ffprobe using your distribution package manager.'
                : '',
          license: 'GPL-3.0-or-later (selected build)',
        },
      ],
      message:
        'Managed tools are installed only in VideoNinja’s profile. Existing global tools are not changed. macOS ffmpeg uses guided setup.',
    };
  }

  async function readTarExecutables(archive, names, signal) {
    const tar = '/usr/bin/tar';
    const listing = await executeFile(tar, ['-tf', archive], {
      shell: false,
      windowsHide: true,
      signal,
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024,
      encoding: 'utf8',
    });
    const entries = listing.stdout.trim().split(/\r?\n/u);
    if (entries.length > 20000 || entries.some((name) => !safeArchivePath(name)))
      throw new Error('Unsafe tool archive paths.');
    const found = new Map();
    for (const name of names) {
      const matches = entries.filter((entry) => path.posix.basename(entry) === name);
      if (matches.length !== 1) throw new Error('Missing or duplicated tool archive executable.');
      const result = await executeFile(tar, ['-xOf', archive, '--', matches[0]], {
        shell: false,
        windowsHide: true,
        signal,
        timeout: 60000,
        maxBuffer: MAX_EXECUTABLE,
        encoding: 'buffer',
      });
      if (!result.stdout.length) throw new Error('The extracted tool executable is empty.');
      found.set(name, Buffer.from(result.stdout));
    }
    return found;
  }

  async function managedInstallation(tool) {
    try {
      const directory = path.join(managedDir, tool);
      const stat = await fileSystem.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
      const manifestPath = path.join(directory, 'managed.json');
      const manifestStat = await fileSystem.lstat(manifestPath);
      if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > 65536)
        return null;
      const manifest = JSON.parse(await fileSystem.readFile(manifestPath, 'utf8'));
      const repositories = [REPOSITORIES[tool]];
      if (tool === 'yt-dlp') repositories.push('yt-dlp/yt-dlp-nightly-builds');
      if (
        manifest.tool !== tool ||
        typeof manifest.version !== 'string' ||
        !/^[\w.-]{1,80}$/u.test(manifest.version) ||
        !/^[a-f0-9]{64}$/iu.test(manifest.sha256) ||
        !repositories.some((repository) =>
          manifest.source?.startsWith(
            `https://github.com/${repository}/releases/download/${manifest.version}/`,
          ),
        )
      )
        return null;
      const names =
        tool === 'runtime' ? ['deno'] : tool === 'ffmpeg' ? ['ffmpeg', 'ffprobe'] : ['yt-dlp'];
      for (const name of names) {
        const binary = await fileSystem.lstat(
          path.join(directory, `${name}${platform === 'win32' ? '.exe' : ''}`),
        );
        if (!binary.isFile() || binary.isSymbolicLink() || !binary.size) return null;
      }
      return manifest;
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  function updateStatus(tool, installed, release, checksum) {
    if (!installed) return 'unmanaged';
    if (installed.version === release.tag_name && installed.sha256.toLowerCase() === checksum)
      return 'current';
    // FFmpeg uses a moving "latest" tag; its official checksum identifies the build.
    if (tool === 'ffmpeg') return 'update-available';
    const pattern =
      tool === 'runtime'
        ? /^v?(\d+)\.(\d+)\.(\d+)$/u
        : /^(\d{4})\.(\d{2})\.(\d{2})(?:\.(\d{6}))?$/u;
    const previous = pattern.exec(installed.version);
    const candidate = pattern.exec(release.tag_name);
    if (!previous || !candidate) return 'needs-review';
    for (let index = 1; index < Math.max(previous.length, candidate.length); index++) {
      const difference = Number(candidate[index] || 0) - Number(previous[index] || 0);
      if (difference) return difference > 0 ? 'update-available' : 'needs-review';
    }
    // Replaced bytes under an identical fixed version need an explicit manual update.
    return 'needs-review';
  }

  async function resolveRelease(tool, channel, signal) {
    const repository =
      tool === 'yt-dlp' && channel === 'nightly'
        ? 'yt-dlp/yt-dlp-nightly-builds'
        : REPOSITORIES[tool];
    const release = JSON.parse(
      (
        await read(
          `https://api.github.com/repos/${repository}/releases/latest`,
          2 * 1024 * 1024,
          signal,
        )
      ).toString('utf8'),
    );
    if (
      !release ||
      typeof release.tag_name !== 'string' ||
      !/^[\w.-]{1,80}$/u.test(release.tag_name) ||
      !Array.isArray(release.assets)
    )
      throw new Error('Invalid official tool release metadata.');
    let assetName, checksumName, executableNames;
    const extension = platform === 'win32' ? '.exe' : '';
    if (tool === 'yt-dlp') {
      assetName =
        platform === 'win32'
          ? arch === 'arm64'
            ? 'yt-dlp_arm64.exe'
            : 'yt-dlp.exe'
          : platform === 'darwin'
            ? 'yt-dlp_macos'
            : arch === 'arm64'
              ? 'yt-dlp_linux_aarch64'
              : 'yt-dlp_linux';
      checksumName = 'SHA2-256SUMS';
      executableNames = [`yt-dlp${extension}`];
    } else if (tool === 'runtime') {
      const target = {
        win32: 'pc-windows-msvc',
        darwin: 'apple-darwin',
        linux: 'unknown-linux-gnu',
      }[platform];
      assetName = `deno-${arch === 'arm64' ? 'aarch64' : 'x86_64'}-${target}.zip`;
      checksumName = `${assetName}.sha256sum`;
      executableNames = [`deno${extension}`];
    } else {
      const target =
        platform === 'win32'
          ? arch === 'arm64'
            ? 'winarm64'
            : 'win64'
          : arch === 'arm64'
            ? 'linuxarm64'
            : 'linux64';
      assetName = `ffmpeg-master-latest-${target}-gpl.${platform === 'win32' ? 'zip' : 'tar.xz'}`;
      checksumName = 'checksums.sha256';
      executableNames = [`ffmpeg${extension}`, `ffprobe${extension}`];
    }
    const assetUrl = (name) => {
      const matches = release.assets.filter((asset) => asset.name === name);
      const expected = `https://github.com/${repository}/releases/download/${release.tag_name}/${name}`;
      if (matches.length !== 1 || matches[0].browser_download_url !== expected)
        throw new Error('The official release is missing the expected platform asset.');
      return expected;
    };
    const checksum = checksumFor(
      (await read(assetUrl(checksumName), 1024 * 1024, signal)).toString('utf8'),
      assetName,
    );
    return { release, assetName, executableNames, assetUrl, checksum };
  }

  async function checkUpdates({ channel = 'stable', signal } = {}) {
    if (!['stable', 'nightly'].includes(channel))
      throw new Error('Unsupported yt-dlp release channel.');
    if (installing) throw new Error('Another tool installation is in progress.');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, 60000);
    try {
      const tools = [];
      for (const plan of getSetupPlan().tools) {
        if (controller.signal.aborted) throw abortError();
        try {
          const installed = plan.managed ? await managedInstallation(plan.tool) : null;
          if (!installed) {
            tools.push({ tool: plan.tool, status: 'unmanaged' });
            continue;
          }
          const { release, checksum } = await resolveRelease(plan.tool, channel, controller.signal);
          tools.push({
            tool: plan.tool,
            status: updateStatus(plan.tool, installed, release, checksum),
            installedVersion: installed.version,
            availableVersion: release.tag_name,
            ...(plan.tool === 'yt-dlp' ? { channel } : {}),
          });
        } catch (error) {
          if (controller.signal.aborted || error.name === 'AbortError') throw abortError();
          tools.push({
            tool: plan.tool,
            status: 'error',
            reason: 'The managed tool update could not be checked.',
          });
        }
      }
      return { tools };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  async function install(tool, { signal, channel = 'stable', updateOnly = false } = {}) {
    if (!Object.hasOwn(REPOSITORIES, tool)) throw new Error('Unsupported managed tool.');
    if (!['stable', 'nightly'].includes(channel))
      throw new Error('Unsupported yt-dlp release channel.');
    if (installing) throw new Error('Another tool installation is in progress.');
    const plan = getSetupPlan().tools.find((entry) => entry.tool === tool);
    if (!plan.managed)
      return {
        status: 'guided',
        ...plan,
        message: 'Use the official setup instructions, then check the tools again.',
      };
    installing = true;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, 10 * 60 * 1000);
    let temporary,
      backup,
      destination,
      switched = false;
    try {
      const activeSignal = controller.signal;
      const installed = updateOnly ? await managedInstallation(tool) : null;
      if (updateOnly && !installed) return { status: 'unmanaged', tool };
      const { release, assetName, executableNames, assetUrl, checksum } = await resolveRelease(
        tool,
        channel,
        activeSignal,
      );
      if (updateOnly) {
        const status = updateStatus(tool, installed, release, checksum);
        if (status !== 'update-available')
          return { status, tool, version: installed.version, availableVersion: release.tag_name };
      }
      const bytes = await read(assetUrl(assetName), MAX_DOWNLOAD, activeSignal);
      if (createHash('sha256').update(bytes).digest('hex') !== checksum)
        throw new Error(
          'Tool checksum verification failed. The previous installation was preserved.',
        );
      await fileSystem.mkdir(managedDir, { recursive: true });
      const realRoot = await fileSystem.realpath(managedDir);
      temporary = await fileSystem.mkdtemp(path.join(realRoot, `.${tool}-install-`));
      destination = path.join(realRoot, tool);
      backup = path.join(temporary, 'previous');
      const staged = path.join(temporary, 'ready');
      await fileSystem.mkdir(staged);
      let executables;
      if (tool === 'yt-dlp') executables = new Map([[executableNames[0], bytes]]);
      else if (assetName.endsWith('.zip')) executables = readZipExecutables(bytes, executableNames);
      else {
        const archive = path.join(temporary, 'archive.tar.xz');
        await fileSystem.writeFile(archive, bytes, { flag: 'wx' });
        executables = await readTarExecutables(archive, executableNames, activeSignal);
      }
      for (const [name, contents] of executables) {
        if (activeSignal.aborted) throw abortError();
        const target = path.join(staged, name);
        await fileSystem.writeFile(target, contents, { flag: 'wx', mode: 0o755 });
        if (platform !== 'win32') await fileSystem.chmod(target, 0o755);
        const args =
          tool === 'yt-dlp'
            ? [...SAFE_YTDLP_FLAGS, '--version']
            : tool === 'runtime'
              ? ['--version']
              : ['-version'];
        const result = await execute(target, args, {
          signal: activeSignal,
          timeoutMs: 15000,
          maxOutputBytes: 128 * 1024,
        });
        if (result.code !== 0)
          throw new Error(
            'The verified tool did not run on this system. The previous installation was preserved.',
          );
      }
      await fileSystem.writeFile(
        path.join(staged, 'managed.json'),
        JSON.stringify({
          tool,
          version: release.tag_name,
          ...(tool === 'yt-dlp' ? { channel } : {}),
          source: assetUrl(assetName),
          sha256: checksum,
          license: plan.license,
        }),
      );
      if (activeSignal.aborted) throw abortError();
      try {
        const existing = await fileSystem.lstat(destination);
        if (!existing.isDirectory() || existing.isSymbolicLink())
          throw new Error('The managed tool destination is not a regular directory.');
        await renameWithRetry(destination, backup, activeSignal);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      try {
        await renameWithRetry(staged, destination, activeSignal);
        switched = true;
      } catch (error) {
        try {
          // Restoring the previous version must finish even after installation aborts.
          await renameWithRetry(backup, destination);
        } catch (rollbackError) {
          if (rollbackError.code !== 'ENOENT') {
            temporary = null;
            throw new Error(
              'Tool update failed; the previous installation is retained in the installation backup.',
              { cause: rollbackError },
            );
          }
        }
        throw error;
      }
      return {
        status: 'installed',
        tool,
        version: release.tag_name,
        path: path.join(destination, executableNames[0]),
        sha256: checksum,
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      installing = false;
      // Only this invocation's newly allocated direct child is removed. A failed
      // rollback deliberately retains that tree rather than deleting the backup.
      if (temporary) {
        await cleanupTemporary(temporary, tool);
      }
      if (controller.signal.aborted && !switched) {
        /* The previous managed tool remains selected. */
      }
    }
  }

  async function diagnose({ signal } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, 45000);
    try {
      const [ytdlp, ffmpeg, ffprobe, ejs] = await settleProbes([
        service.checkYtDlpAvailability({ signal: controller.signal }),
        service.checkFfmpegAvailability({ signal: controller.signal }),
        service.checkFfprobeAvailability({ signal: controller.signal }),
        service.diagnoseEjs({ signal: controller.signal }),
      ]);
      if (ejs.version && ejs.revision) {
        try {
          const source = (
            await read(
              `https://raw.githubusercontent.com/yt-dlp/yt-dlp/${ejs.revision}/yt_dlp/extractor/youtube/jsc/_builtin/vendor/_info.py`,
              128 * 1024,
              controller.signal,
            )
          ).toString('utf8');
          const expectedVersion = source.match(/\bVERSION\s*=\s*['"](\d+\.\d+\.\d+)['"]/u)?.[1];
          if (expectedVersion) {
            ejs.expectedVersion = expectedVersion;
            ejs.compatible =
              ejs.version.split('.').slice(0, 2).join('.') ===
              expectedVersion.split('.').slice(0, 2).join('.');
            ejs.status = !ejs.compatible
              ? 'version-mismatch'
              : ejs.runtime
                ? 'compatible'
                : 'runtime-missing';
          }
        } catch (error) {
          if (controller.signal.aborted || error.name === 'AbortError') throw abortError();
        }
      }
      return {
        ytdlp,
        ffmpeg,
        ffprobe,
        ejs: { ...ejs, liveChallengeTested: false },
        setup: getSetupPlan(),
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  return {
    install,
    installYtDlp: (options) => install('yt-dlp', options),
    checkUpdates,
    diagnose,
    getSetupPlan,
  };
}

module.exports = { createToolManager, checksumFor, readZipExecutables };
