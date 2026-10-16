/* global document, window, requestAnimationFrame */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const packaged = process.argv.includes('--packaged');
const executableIndex = process.argv.indexOf('--executable');
const installedExecutable = executableIndex >= 0 ? process.argv[executableIndex + 1] : null;
const mode = installedExecutable ? 'installed' : packaged ? 'packaged' : 'source';
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'videoninja-smoke-'));
const profile = path.join(temporary, 'profile');
const downloads = path.join(temporary, 'Videos ää test');
const results = path.join(root, 'test-results');
await Promise.all(
  [profile, downloads, results].map((folder) => fs.mkdir(folder, { recursive: true })),
);
const environment = { ...process.env, VIDEONINJA_USER_DATA: profile, VIDEONINJA_HEADLESS: '1' };
delete environment.ELECTRON_RUN_AS_NODE;
let executablePath = require('electron');
if (installedExecutable) executablePath = path.resolve(installedExecutable);
else if (packaged) {
  if (process.platform === 'win32')
    executablePath = path.join(root, 'dist/win-unpacked/VideoNinja.exe');
  else if (process.platform === 'linux')
    executablePath = path.join(root, 'dist/linux-unpacked/video-ninja');
  else {
    const folders = await fs.readdir(path.join(root, 'dist'));
    const folder =
      folders.find((name) => name === 'mac-' + process.arch) ||
      folders.find((name) => name === 'mac');
    assert.ok(folder, 'A native macOS package is required.');
    executablePath = path.join(root, 'dist', folder, 'VideoNinja.app/Contents/MacOS/VideoNinja');
  }
}
const errors = [];
let application;
async function launch() {
  application = await electron.launch({
    executablePath,
    args: packaged || installedExecutable ? [] : [root],
    env: environment,
    timeout: 45000,
  });
  const page = await application.firstWindow({ timeout: 45000 });
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].showInactive(),
  );
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => document.querySelector('#loading')?.hidden === true, {
    timeout: 45000,
  });
  return page;
}
async function close() {
  if (application) await application.close();
  application = undefined;
}

async function screenshot(name, page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const png = await application.evaluate(async ({ BrowserWindow }) => {
    const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage();
    return image.toPNG().toString('base64');
  });
  await fs.writeFile(path.join(results, name), Buffer.from(png, 'base64'));
}

try {
  let page = await launch();
  assert.equal(await page.locator('#settings-panel').isVisible(), true, 'First run exposes setup.');
  assert.equal(await page.locator('#app-version').textContent(), 'v' + pkg.version);
  assert.deepEqual(
    await page.evaluate(() => [typeof require, typeof process, typeof window.videoNinja.invoke]),
    ['undefined', 'undefined', 'undefined'],
  );
  const preferences = await application.evaluate(({ BrowserWindow }) => {
    const value = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return {
      sandbox: value.sandbox,
      nodeIntegration: value.nodeIntegration,
      contextIsolation: value.contextIsolation,
    };
  });
  assert.deepEqual(preferences, { sandbox: true, nodeIntegration: false, contextIsolation: true });
  assert.equal(
    await application.evaluate(
      async ({ net }) => (await net.fetch('videoninja://app/../main/index.js')).status,
    ),
    404,
  );
  const invalid = await page.evaluate(() =>
    window.videoNinja.addDownloads({ urls: ['file:///private'], options: {} }),
  );
  assert.equal(invalid.ok, false);
  const arbitraryFolder = await page.evaluate(() =>
    window.videoNinja.saveSettings({ downloadPath: '/arbitrary-unselected-folder' }),
  );
  assert.equal(arbitraryFolder.ok, false);

  // The native dialog boundary is replaced only inside this isolated test process.
  await application.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, downloads);
  await page.locator('#choose-folder').click();
  await page.waitForFunction(
    (folder) => document.querySelector('#download-path').value === folder,
    downloads,
  );
  await page.locator('#language').selectOption('fi');
  await page.waitForFunction(() => document.documentElement.lang === 'fi');
  await page.waitForFunction(
    async () => (await window.videoNinja.getInitialState()).data.settings.language === 'fi',
  );
  await close();

  const configFile = path.join(profile, 'config.json');
  const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
  assert.equal(config.settings.downloadPath, downloads);
  assert.equal(config.settings.language, 'fi');
  const hostile = '<img src=x onerror="window.injected=true">';
  const job = (id, status) => ({
    id,
    status,
    url: 'https://example.invalid/video/' + id,
    outputPath: downloads,
    options: { quality: '720' },
    title: id,
    addedAt: new Date().toISOString(),
    progress: 0,
  });
  config.queueState = {
    schemaVersion: 1,
    queue: Array.from({ length: 500 }, (_, i) => job('paused-' + i, 'paused')),
    history: Array.from({ length: 100 }, (_, i) => ({
      ...job('failed-' + i, 'failed'),
      title: i === 0 ? hostile : 'Test video ' + i,
      error: hostile,
    })),
  };
  await fs.writeFile(configFile, JSON.stringify(config));
  page = await launch();
  assert.equal(await page.locator('html').getAttribute('lang'), 'fi');
  assert.equal(await page.locator('#queue-list > li').count(), 500);
  assert.equal(await page.locator('#history-list > li').count(), 100);
  assert.equal(await page.locator('#history-list img').count(), 0);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.equal(
    await page.locator('#history-list [data-id="failed-0"] .download-title').textContent(),
    hostile,
  );
  const pausedButton = page.locator('[data-id="paused-0"] button[data-action="resume"]');
  await pausedButton.focus();
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send('video-ninja:progress', {
      id: 'paused-0',
      percent: 42,
      progress: 42,
      phase: 'downloading',
    }),
  );
  assert.equal(await pausedButton.evaluate((button) => button === document.activeElement), true);
  await page.locator('#history-search').fill('Test video 99');
  assert.equal(await page.locator('#history-list > li:visible').count(), 1);
  await page.locator('#history-search').fill('');
  const retry = page.locator('[data-id="failed-0"] button[data-action="retryOptions"]');
  await retry.click();
  assert.equal(await page.locator('#retry-dialog').evaluate((dialog) => dialog.open), true);
  await page.keyboard.press('Escape');
  assert.equal(await retry.evaluate((button) => button === document.activeElement), true);
  await page.locator('[data-id="paused-0"] button[data-action="moveDown"]').click();
  await page.waitForFunction(
    () => document.querySelector('#queue-list > li').dataset.id === 'paused-1',
  );
  await page.locator('#language').selectOption('en');
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#loading')?.hidden === true);
  assert.equal(await page.locator('#queue-list > li').count(), 500);
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  await page.locator('#settings-toggle').click();
  await screenshot(`${mode}-en.png`, page);
  await page.locator('#language').selectOption('fi');
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setSize(900, 800);
    window.webContents.setZoomFactor(2);
  });
  await page.waitForFunction(() => window.innerWidth <= 450);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    true,
    'No horizontal scrolling at 200% zoom.',
  );
  await screenshot(`${mode}-fi-200.png`, page);
  await close();
  const saved = JSON.parse(await fs.readFile(configFile, 'utf8'));
  assert.equal(saved.queueState.queue.length, 500);
  assert.equal(saved.queueState.queue[0].id, 'paused-1');
  assert.equal(
    saved.queueState.queue.every((item) => item.status === 'paused'),
    true,
  );
  assert.deepEqual(errors, [], 'Renderer has no uncaught errors.');
  console.log(
    `${mode} Electron smoke passed: sandbox, setup, IPC, languages, 500 queued jobs, 100 history entries, focus, reload, persistence and 200% layout.`,
  );
} finally {
  await close();
  // Only this script's freshly created OS temporary fixture is removed.
  await fs.rm(temporary, { recursive: true, force: true });
}
