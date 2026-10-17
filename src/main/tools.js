const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { abortError, runProcess } = require('./processRunner');

const execFileAsync = promisify(execFile);
const SAFE_YTDLP_FLAGS = Object.freeze([
  '--ignore-config',
  '--no-plugin-dirs',
  '--no-remote-components',
]);

function versionFreshness(version, now) {
  const unknown = { stale: false, ageDays: null, releaseDate: null };
  const match = /^(\d{4})\.(\d{2})\.(\d{2})(?:$|[.\w-])/u.exec(version || '');
  if (!match || !Number.isFinite(Number(now))) return unknown;
  const [, year, month, day] = match;
  const releaseDate = `${year}-${month}-${day}`;
  const released = Date.parse(`${releaseDate}T00:00:00.000Z`);
  if (!Number.isFinite(released) || new Date(released).toISOString().slice(0, 10) !== releaseDate)
    return unknown;
  // Compare UTC calendar days: a date-only release is not stale partway through day 90.
  const dayMs = 24 * 60 * 60 * 1000;
  const ageDays = Math.max(0, Math.floor(Number(now) / dayMs) - Math.floor(released / dayMs));
  return { stale: ageDays > 90, ageDays, releaseDate };
}

async function settleProbes(probes) {
  const results = await Promise.allSettled(probes);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
  return results.map((result) => result.value);
}

function createToolService(deps = {}) {
  const platform = deps.platform || process.platform;
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const env = deps.env || process.env;
  const fileSystem = deps.fs || fs;
  const execute = deps.execFile || execFileAsync;
  const run = deps.runProcess || runProcess;
  const execPath = deps.execPath || process.execPath;
  const now = deps.now || Date.now;

  function candidates(name) {
    const pathValue = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] || '';
    const directories = [
      deps.managedDir || env.VIDEONINJA_TOOLS_DIR,
      ...(deps.managedDir || env.VIDEONINJA_TOOLS_DIR
        ? ['yt-dlp', 'runtime', 'ffmpeg'].map((tool) =>
            paths.join(deps.managedDir || env.VIDEONINJA_TOOLS_DIR, tool),
          )
        : []),
      paths.dirname(execPath),
      env.PORTABLE_EXECUTABLE_DIR,
      ...pathValue.split(platform === 'win32' ? ';' : ':'),
    ];
    if (platform === 'win32') {
      if (env.LOCALAPPDATA) directories.push(paths.join(env.LOCALAPPDATA, 'Programs', name));
      directories.push(`C:\\Program Files\\${name}`, `C:\\Program Files\\${name}\\bin`);
    } else
      directories.push(
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
        paths.join(deps.homeDir || os.homedir(), '.local', 'bin'),
        paths.join(deps.homeDir || os.homedir(), '.deno', 'bin'),
      );
    const names = platform === 'win32' ? [`${name}.exe`] : [name];
    if (name === 'yt-dlp' && platform !== 'win32')
      names.push(platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp_linux');
    return [
      ...new Set(
        directories
          .filter((directory) => typeof directory === 'string' && paths.isAbsolute(directory))
          .flatMap((directory) => names.map((filename) => paths.join(directory, filename))),
      ),
    ];
  }

  async function discover(
    name,
    args,
    parseVersion = (text) => text.trim().split(/\r?\n/u)[0],
    supported = () => true,
    { signal, acceptedExitCodes = [] } = {},
  ) {
    const rejected = [];
    for (const candidate of candidates(name)) {
      if (signal?.aborted) throw abortError();
      try {
        const resolved = await fileSystem.realpath(candidate);
        if (!(await fileSystem.stat(resolved)).isFile()) continue;
        if (platform !== 'win32') await fileSystem.access(resolved, 1);
        let output;
        try {
          const probe = execute(resolved, args, {
            shell: false,
            windowsHide: true,
            timeout: 5000,
            maxBuffer: 65536,
            cwd: paths.dirname(resolved),
            signal,
          });
          // execFile reports abort before its child necessarily closes. Keep the
          // owning queue/preview alive until the actual subprocess has settled.
          const closed = probe.child
            ? new Promise((resolve) => probe.child.once('close', resolve))
            : Promise.resolve();
          try {
            output = await probe;
          } finally {
            await closed;
          }
        } catch (error) {
          // Bellard QuickJS prints its version through --help and deliberately exits 1.
          // Only that normal exit is accepted; timeouts, aborts and signals still fail.
          if (
            signal?.aborted ||
            error.killed ||
            error.signal ||
            !acceptedExitCodes.includes(error.code)
          )
            throw error;
          output = error;
        }
        const { stdout = '', stderr = '' } = output;
        const version = parseVersion(`${stdout}\n${stderr}`);
        if (!version || !supported(version)) {
          rejected.push({ path: resolved, version });
          continue;
        }
        return { available: true, path: resolved, version, error: null };
      } catch {
        if (signal?.aborted) throw abortError(); /* Try later installations. */
      }
    }
    return {
      available: false,
      path: null,
      version: null,
      error: rejected.length
        ? `${name} is installed but its version is unsupported.`
        : `${name} was not found in the application directory or PATH.`,
    };
  }

  async function checkJsRuntimes({ signal } = {}) {
    const definitions = [
      [
        'deno',
        'deno',
        ['--version'],
        (text) => text.match(/deno\s+(\d+\.\d+\.\d+)/u)?.[1],
        (version) => {
          const [major, minor] = version.split('.').map(Number);
          return major > 2 || (major === 2 && minor >= 3);
        },
      ],
      [
        'node',
        'node',
        ['--version'],
        (text) => text.match(/v?(\d+\.\d+\.\d+)/u)?.[1],
        (version) => Number(version.split('.')[0]) >= 22,
      ],
      [
        'quickjs',
        'qjs',
        ['--help'],
        (text) => text.match(/QuickJS(?:-ng)?(?:\s+version)?\s+([\d.-]+)/iu)?.[1],
        (version) =>
          /^\d{4}-/u.test(version)
            ? version
                .split('-')
                .map((part) => part.padStart(2, '0'))
                .join('') >= '20231209'
            : /^\d+\.\d+/u.test(version),
      ],
    ];
    const checks = await settleProbes(
      definitions.map(async ([name, executable, args, parse, supported]) => ({
        name,
        ...(await discover(executable, args, parse, supported, {
          signal,
          acceptedExitCodes: name === 'quickjs' ? [1] : [],
        })),
      })),
    );
    return checks;
  }

  async function checkYtDlpAvailability({ signal } = {}) {
    const [tool, runtimeChecks] = await settleProbes([
      discover(
        'yt-dlp',
        [...SAFE_YTDLP_FLAGS, '--version'],
        (text) => text.match(/\b\d{4}\.\d{2}\.\d{2}(?:[.\w-]*)?/u)?.[0],
        () => true,
        { signal },
      ),
      checkJsRuntimes({ signal }),
    ]);
    return {
      ...tool,
      ...versionFreshness(tool.version, now()),
      jsRuntimes: runtimeChecks.filter((runtime) => runtime.available),
      runtimeChecks,
      ejs: 'not-checked',
    };
  }

  const checkFfmpegAvailability = ({ signal } = {}) =>
    discover(
      'ffmpeg',
      ['-version'],
      (text) => text.match(/ffmpeg version\s+(\S+)/u)?.[1],
      () => true,
      { signal },
    );
  const checkFfprobeAvailability = ({ signal } = {}) =>
    discover(
      'ffprobe',
      ['-version'],
      (text) => text.match(/ffprobe version\s+(\S+)/u)?.[1],
      () => true,
      { signal },
    );

  async function diagnoseEjs({ signal } = {}) {
    const tool = await checkYtDlpAvailability({ signal });
    if (!tool.available)
      return { status: 'tool-missing', version: null, runtime: null, revision: null };
    const runtime = tool.jsRuntimes[0];
    const args = [
      ...SAFE_YTDLP_FLAGS,
      '--no-js-runtimes',
      '--verbose',
      '--simulate',
      '--skip-download',
    ];
    if (runtime) args.push('--js-runtimes', `${runtime.name}:${runtime.path}`);
    args.push('--');
    let version = null,
      revision = null,
      runtimeDetected = false;
    const readLine = (line) => {
      if (line.includes('Optional libraries:'))
        version = line.match(/\byt_dlp_ejs[- ](\d+\.\d+\.\d+)\b/u)?.[1] || null;
      if (line.includes('yt-dlp version'))
        revision = line.match(/\[([a-f0-9]{7,40})\]/u)?.[1] || null;
      if (line.includes('JS runtimes:') && !/unsupported|none|unknown/u.test(line))
        runtimeDetected = true;
    };
    // No URL is supplied: yt-dlp initializes dependencies and reports diagnostics,
    // then deliberately exits 2. No source site or media is contacted.
    const result = await run(tool.path, args, {
      signal,
      timeoutMs: 30000,
      maxOutputBytes: 128 * 1024,
      onStdoutLine: readLine,
      onStderrLine: readLine,
    });
    if (![0, 2].includes(result.code))
      return { status: 'unknown', version: null, runtime: null, revision: null };
    return {
      status: !version ? 'missing' : !runtimeDetected ? 'runtime-missing' : 'present-unverified',
      version,
      runtime: runtimeDetected ? runtime?.name || null : null,
      revision,
    };
  }
  return {
    candidates,
    discover,
    checkJsRuntimes,
    checkYtDlpAvailability,
    checkFfmpegAvailability,
    checkFfprobeAvailability,
    diagnoseEjs,
  };
}

module.exports = { createToolService, SAFE_YTDLP_FLAGS, settleProbes, ...createToolService() };
