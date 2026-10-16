import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// NSIS installs have shared registry/shortcut effects. This check is deliberately
// unavailable on developer machines and self-hosted runners, even with CI=true.
if (
  !['1', 'true'].includes(String(process.env.CI).toLowerCase()) ||
  process.env.GITHUB_ACTIONS !== 'true' ||
  process.env.RUNNER_ENVIRONMENT !== 'github-hosted'
) {
  throw new Error('Installer smoke runs only on disposable GitHub-hosted CI runners.');
}
if (!['win32', 'darwin', 'linux'].includes(process.platform))
  throw new Error('Unsupported CI platform.');
if (process.argv.length !== 2)
  throw new Error('Installer smoke does not accept custom artifact or installation paths.');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const dist = await fs.realpath(path.join(root, 'dist'));
const execFileAsync = promisify(execFile);
const taskkill = path.win32.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'taskkill.exe',
);
const temporaryParent = await fs.realpath(os.tmpdir());
const temporary = await fs.mkdtemp(path.join(temporaryParent, 'videoninja-installer-smoke-'));
const installDirectory = path.join(temporary, 'installed');
const mountpoint = path.join(temporary, 'mounted');
let mountAttempted = false;
let installAttempted = false;

function within(directory, filename) {
  const relative = path.relative(directory, filename);
  return Boolean(
    relative &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative),
  );
}

async function ownedFile(filename, directory = temporary) {
  const resolved = await fs.realpath(filename);
  assert(
    within(await fs.realpath(directory), resolved),
    'Refusing a file outside the owned fixture directory.',
  );
  assert(
    (await fs.stat(resolved)).isFile(),
    'The expected artifact executable is not a regular file.',
  );
  return resolved;
}

async function exists(filename) {
  try {
    await fs.access(filename);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

/** No shell expansion, visible helper windows or unlimited child lifetimes. */
function run(
  executable,
  args,
  { timeout = 180000, allowCodes = [0], nsisDirectoryArgument = false } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      env: process.env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      // NSIS /D must be the final, unquoted argument, including paths with spaces.
      ...(nsisDirectoryArgument
        ? { windowsVerbatimArguments: true, argv0: `"${executable}"` }
        : {}),
    });
    let stdout = '',
      stderr = '',
      processError,
      timedOut = false,
      termination = Promise.resolve();
    child.stdout.on('data', (chunk) => {
      stdout = (stdout + chunk).slice(-1024 * 1024);
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-1024 * 1024);
    });
    child.once('error', (error) => {
      processError = error;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      if (!Number.isSafeInteger(child.pid) || child.pid <= 0) return;
      if (process.platform === 'win32') {
        termination = execFileAsync(taskkill, ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          shell: false,
          timeout: 10000,
        }).catch(() => {
          child.kill();
        });
      } else {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* Already exited. */
        }
      }
    }, timeout);
    child.once('close', async (code) => {
      clearTimeout(timer);
      await termination;
      if (processError) reject(processError);
      else if (timedOut) reject(new Error(`${path.basename(executable)} exceeded the CI timeout.`));
      else if (!allowCodes.includes(code))
        reject(
          new Error(
            `${path.basename(executable)} exited with ${code}: ${(stderr || stdout).slice(-4000)}`,
          ),
        );
      else resolve({ code, stdout, stderr });
    });
  });
}

async function selectArtifact() {
  const escapedVersion = pkg.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const version = new RegExp(`(?:^|[-_ ])${escapedVersion}(?=$|[-_ .])`);
  const suffix =
    process.platform === 'win32'
      ? /Setup.*\.exe$/iu
      : process.platform === 'darwin'
        ? /\.dmg$/iu
        : /\.deb$/iu;
  let matches = (await fs.readdir(dist, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && version.test(entry.name) && suffix.test(entry.name))
    .map((entry) => entry.name);
  if (matches.length > 1) {
    const architecture =
      process.platform === 'linux' && process.arch === 'x64' ? 'amd64' : process.arch;
    matches = matches.filter((name) => name.includes(architecture));
  }
  assert.equal(
    matches.length,
    1,
    `Expected exactly one ${process.platform} installer for ${pkg.version}; clean dist before building.`,
  );
  return ownedFile(path.join(dist, matches[0]), dist);
}

async function smoke(executable) {
  const command = [path.join(root, 'scripts', 'smoke-test.mjs'), '--executable', executable];
  const result =
    process.platform === 'linux' && !process.env.DISPLAY
      ? await run('/usr/bin/xvfb-run', ['-a', process.execPath, ...command], { timeout: 300000 })
      : await run(process.execPath, command, { timeout: 300000 });
  if (result.stdout.trim()) console.log(result.stdout.trim());
  if (result.stderr.trim()) console.error(result.stderr.trim());
}

async function ensureNoWindowsInstallation() {
  const registry = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
  for (const key of [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ]) {
    const result = await run(registry, ['query', key, '/s', '/f', 'VideoNinja', '/d'], {
      allowCodes: [0, 1],
      timeout: 30000,
    });
    assert(
      !/REG_\w+\s+[^\r\n]*VideoNinja/iu.test(result.stdout),
      'An existing VideoNinja registration was found; refusing to replace it.',
    );
    if (/access.*denied/iu.test(result.stderr))
      throw new Error('Cannot verify that the CI runner has no existing installation.');
  }
  for (const base of [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'),
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
  ].filter(Boolean)) {
    assert.equal(
      await exists(path.join(base, 'VideoNinja', 'VideoNinja.exe')),
      false,
      'An existing VideoNinja installation was found.',
    );
  }
}

async function uninstallWindows() {
  if (!installAttempted) return;
  if (!(await exists(installDirectory))) return;
  const names = await fs.readdir(installDirectory);
  const uninstallers = names.filter((name) => /^Uninstall.*\.exe$/iu.test(name));
  if (uninstallers.length !== 1) {
    assert.equal(
      await exists(path.join(installDirectory, 'VideoNinja.exe')),
      false,
      'Installation has no usable uninstaller.',
    );
    return;
  }
  const uninstaller = await ownedFile(path.join(installDirectory, uninstallers[0]));
  await run(uninstaller, ['/S']);
  // NSIS can copy itself to a second process before its launcher exits.
  const deadline = Date.now() + 60000;
  while (
    Date.now() < deadline &&
    ((await exists(path.join(installDirectory, 'VideoNinja.exe'))) || (await exists(uninstaller)))
  ) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.equal(
    await exists(path.join(installDirectory, 'VideoNinja.exe')),
    false,
    'Silent uninstall left the application executable behind.',
  );
  assert.equal(
    await exists(uninstaller),
    false,
    'Silent uninstall did not remove its installed uninstaller.',
  );
  assert.equal(
    await exists(path.join(installDirectory, 'resources', 'app.asar')),
    false,
    'Silent uninstall left the application archive behind.',
  );
}

async function cleanup() {
  if (process.platform === 'win32') await uninstallWindows();
  if (mountAttempted) {
    try {
      await run('/usr/bin/hdiutil', ['detach', mountpoint], { timeout: 30000 });
    } catch {
      await run('/usr/bin/hdiutil', ['detach', '-force', mountpoint], { timeout: 30000 });
    }
    // If detaching fails, never recursively remove a still-mounted volume.
    mountAttempted = false;
  }
  const resolved = await fs.realpath(temporary);
  assert.equal(path.dirname(resolved), temporaryParent, 'Unexpected cleanup parent.');
  assert(
    path.basename(resolved).startsWith('videoninja-installer-smoke-'),
    'Unexpected cleanup target.',
  );
  await fs.rm(resolved, { recursive: true, force: true });
}

let failure;
try {
  const artifact = await selectArtifact();
  if (process.platform === 'win32') {
    await ensureNoWindowsInstallation();
    await fs.mkdir(installDirectory);
    installAttempted = true;
    await run(artifact, ['/S', `/D=${installDirectory}`], { nsisDirectoryArgument: true });
    await smoke(await ownedFile(path.join(installDirectory, 'VideoNinja.exe')));
  } else if (process.platform === 'darwin') {
    await run('/usr/bin/hdiutil', ['verify', artifact]);
    await fs.mkdir(mountpoint);
    mountAttempted = true;
    await run('/usr/bin/hdiutil', [
      'attach',
      '-readonly',
      '-nobrowse',
      '-noautoopen',
      '-mountpoint',
      mountpoint,
      artifact,
    ]);
    await smoke(
      await ownedFile(path.join(mountpoint, 'VideoNinja.app', 'Contents', 'MacOS', 'VideoNinja')),
    );
  } else {
    await fs.mkdir(installDirectory);
    await run('/usr/bin/dpkg-deb', ['--extract', artifact, installDirectory]);
    const executable = await ownedFile(
      path.join(installDirectory, 'opt', 'VideoNinja', 'video-ninja'),
    );
    const sandboxPath = path.join(path.dirname(executable), 'chrome-sandbox');
    assert(
      !(await fs.lstat(sandboxPath)).isSymbolicLink(),
      'The extracted sandbox must not be a symlink.',
    );
    const sandbox = await ownedFile(sandboxPath);
    await run('/usr/bin/sudo', ['-n', 'chown', 'root:root', '--', sandbox]);
    await run('/usr/bin/sudo', ['-n', 'chmod', '4755', '--', sandbox]);
    await smoke(executable);
  }
} catch (error) {
  failure = error;
}
try {
  await cleanup();
} catch (error) {
  failure = failure
    ? new AggregateError([failure, error], 'Installer smoke and cleanup failed.')
    : error;
}
if (failure) throw failure;
console.log(
  `Native ${process.platform} artifact smoke passed for ${pkg.version}, including cleanup.`,
);
