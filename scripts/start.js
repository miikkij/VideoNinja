const { spawn } = require('node:child_process');
const path = require('node:path');

// Some terminal hosts set this for their own Electron process.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [path.join(__dirname, '..'), ...process.argv.slice(2)], {
  env,
  stdio: 'inherit',
  shell: false,
});
child.on('error', () => {
  console.error(
    'Unable to start Electron. Reinstall dependencies with pnpm install --frozen-lockfile.',
  );
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
