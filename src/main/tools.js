const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { abortError } = require('./processRunner');

const execFileAsync = promisify(execFile);
const SAFE_YTDLP_FLAGS = Object.freeze([
  '--ignore-config',
  '--no-plugin-dirs',
  '--no-remote-components',
]);

function createToolService(deps = {}) {
  const platform = deps.platform || process.platform;
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const env = deps.env || process.env;
  const fileSystem = deps.fs || fs;
  const execute = deps.execFile || execFileAsync;
  const execPath = deps.execPath || process.execPath;

  function candidates(name) {
    const pathValue = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] || '';
    const directories = [
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
          output = await execute(resolved, args, {
            shell: false,
            windowsHide: true,
            timeout: 5000,
            maxBuffer: 65536,
            cwd: paths.dirname(resolved),
            signal,
          });
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
    const checks = await Promise.all(
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
    const [tool, runtimeChecks] = await Promise.all([
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
  return { candidates, discover, checkJsRuntimes, checkYtDlpAvailability, checkFfmpegAvailability };
}

module.exports = { createToolService, SAFE_YTDLP_FLAGS, ...createToolService() };
