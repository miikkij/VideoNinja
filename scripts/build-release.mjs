import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const platform = process.argv[2];
if (!['--win', '--mac', '--linux'].includes(platform))
  throw new Error('Choose a native release platform.');
let signingDirectory;
const env = { ...process.env };
try {
  if (platform === '--mac' && env.CSC_LINK && env.APPLE_API_KEY_BASE64) {
    signingDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'videoninja-signing-'));
    const keyFile = path.join(signingDirectory, 'AuthKey.p8');
    await fs.writeFile(keyFile, Buffer.from(env.APPLE_API_KEY_BASE64, 'base64'), { mode: 0o600 });
    env.APPLE_API_KEY = keyFile;
  }
  delete env.APPLE_API_KEY_BASE64;
  const child = spawn(
    process.execPath,
    [
      require.resolve('electron-builder/cli.js'),
      '--config',
      'scripts/build-config.cjs',
      platform,
      '--publish',
      'never',
    ],
    { env, stdio: 'inherit', shell: false, windowsHide: true },
  );
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (code !== 0) throw new Error('Native release build failed.');
} finally {
  if (signingDirectory) await fs.rm(signingDirectory, { recursive: true, force: true });
}
