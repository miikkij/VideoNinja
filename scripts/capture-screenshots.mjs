/* global document, window, requestAnimationFrame */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'videoninja-screenshots-'));
const profile = path.join(temporary, 'profile');
const demoApp = path.join(temporary, 'app');
const output = path.join(root, 'docs/screenshots');
const folder =
  process.platform === 'win32' ? 'C:\\Videos\\VideoNinja' : '/home/demo/Videos/VideoNinja';
const toolFolder = process.platform === 'win32' ? 'C:\\Tools' : '/usr/local/bin';
const toolPath = (name) =>
  path.join(toolFolder, name + (process.platform === 'win32' ? '.exe' : ''));
const timestamp = '2026-10-16T09:30:00.000Z';
const job = (id, title, status, quality = '1080') => ({
  id,
  title,
  url: `https://example.com/videos/${id}`,
  outputPath: folder,
  filepath: status === 'completed' ? path.join(folder, title + '.mp4') : null,
  options: { quality },
  status,
  progress: status === 'completed' ? 100 : 0,
  addedAt: timestamp,
  completedAt: status === 'completed' ? timestamp : null,
});
const queue = [
  job('lighting', 'A practical guide to natural light', 'paused'),
  job('sound', 'Recording clear sound outdoors', 'paused', 'audio'),
  job('editing', 'Editing your first short film', 'paused'),
];
const history = [
  job('composition', 'Composition: telling a story in one frame', 'completed'),
  job('travel', 'A weekend on the Finnish coast', 'completed', '2160'),
];
await Promise.all(
  [profile, demoApp, output].map((directory) => fs.mkdir(directory, { recursive: true })),
);
await fs.writeFile(
  path.join(profile, 'config.json'),
  JSON.stringify({
    schemaVersion: 1,
    settings: {
      schemaVersion: 1,
      downloadPath: folder,
      language: 'en',
      quality: '1080',
      maxConcurrent: 3,
    },
    queueState: { schemaVersion: 1, queue, history },
  }),
);
await fs.writeFile(
  path.join(demoApp, 'package.json'),
  JSON.stringify({
    name: pkg.name,
    productName: pkg.build.productName,
    version: pkg.version,
    main: 'bootstrap.cjs',
  }),
);
// The real application renders a separate sample profile. Only external tool
// results are fixtures; personal settings/media and the installed app are untouched.
await fs.writeFile(
  path.join(demoApp, 'bootstrap.cjs'),
  `
const tools = require(${JSON.stringify(path.join(root, 'src/main/ytdlp.js'))});
tools.checkYtDlpAvailability = async () => ({
  available: true, version: '2026.10.10.233141', path: ${JSON.stringify(toolPath('yt-dlp'))},
  jsRuntimes: [{ name: 'node', available: true, version: '24.22.0' }],
});
tools.checkFfmpegAvailability = async () => ({
  available: true, version: '8.0.1', path: ${JSON.stringify(toolPath('ffmpeg'))},
});
tools.getDiskSpace = async () => ({ available: true, total: 512 * 1024 ** 3, free: 186 * 1024 ** 3 });
tools.fetchMetadata = async (url) => ({ id: url.split('/').at(-1), extractor: 'demo', filesize: 64 * 1024 ** 2 });
tools.fetchPlaylist = async () => ({
  title: 'Make better videos: a practical series',
  entries: [
    ['planning', 'Plan your story before you press record', 518],
    ['lighting', 'A practical guide to natural light', 742],
    ['sound', 'Recording clear sound outdoors', 386],
    ['editing', 'Editing your first short film', 1095],
    ['bonus', 'Bonus workshop', null],
  ].map(([id, title, duration], i) => ({
    id, index: i + 1, title, duration, url: id === 'bonus' ? null : 'https://example.com/videos/' + id,
    available: id !== 'bonus',
  })),
});
tools.downloadVideo = (url, folder, options, progress, { signal }) => new Promise((resolve) => {
  const lighting = url.endsWith('/lighting');
  const timer = setInterval(() => progress({
    percent: lighting ? 68 : 34, status: 'downloading', speed: lighting ? 7864320 : 3145728,
    eta: lighting ? 42 : 85,
  }), 100);
  const stop = () => { clearInterval(timer); resolve({ success: false, error: 'Demo stopped' }); };
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop();
});
require(${JSON.stringify(path.join(root, 'src/main/index.js'))});
`,
);
const env = { ...process.env, VIDEONINJA_USER_DATA: profile, VIDEONINJA_HEADLESS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let application;
try {
  application = await electron.launch({
    executablePath: require('electron'),
    args: [demoApp],
    env,
  });
  const page = await application.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setContentSize(1088, 1100);
    window.showInactive();
  });
  await page.waitForFunction(() => document.querySelector('#loading')?.hidden === true);
  assert.equal(await page.locator('#app-version').textContent(), 'v' + pkg.version);
  assert.equal(await page.locator('#settings-panel').isVisible(), false);
  await page.locator('#video-urls').fill('https://example.com/series/make-better-videos');
  await page.locator('[data-id="lighting"] button[data-action="resume"]').click();
  await page.locator('[data-id="sound"] button[data-action="resume"]').click();
  await page.waitForFunction(
    () => document.querySelector('[data-id="lighting"] progress')?.value === 68,
  );
  await page.waitForFunction(
    () => document.querySelector('[data-id="sound"] progress')?.value === 34,
  );

  async function fitPanel(selector) {
    const height = await page
      .locator(selector)
      .evaluate((panel) => Math.ceil(panel.getBoundingClientRect().bottom + 10));
    await application.evaluate(
      ({ BrowserWindow }, contentHeight) =>
        BrowserWindow.getAllWindows()[0].setContentSize(1088, contentHeight),
      height,
    );
  }

  async function capture(name) {
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      true,
    );
    const png = await application.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'),
    );
    await fs.writeFile(path.join(output, name), Buffer.from(png, 'base64'));
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await fitPanel('.download-panel');
  await capture('overview-en.png');
  await page.locator('.section-nav a[href="#queue-heading"]').click();
  await fitPanel('section[aria-labelledby="queue-heading"]');
  await page.evaluate(() => document.activeElement.blur());
  await capture('queue-en.png');
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1088, 900),
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('#playlist-preview-button').click();
  await page.waitForFunction(() => document.querySelectorAll('#playlist-list input').length === 5);
  await page.locator('#playlist-list input[data-index="1"]').check();
  await page.locator('#playlist-list input[data-index="2"]').check();
  await page.locator('#playlist-list input[data-index="4"]').check();
  await capture('playlist-en.png');
  await page.locator('#playlist-close').click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('#language').selectOption('fi');
  await page.locator('#settings-toggle').click();
  await page.waitForFunction(() => document.documentElement.lang === 'fi');
  await page.locator('#video-urls').blur();
  await page.evaluate(() => window.scrollTo(0, 0));
  await fitPanel('#settings-panel');
  await capture('settings-fi.png');
  await page.locator('#theme').selectOption('dark');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.locator('#settings-toggle').click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await fitPanel('.download-panel');
  await capture('overview-dark-fi.png');
  assert.deepEqual(errors, []);
  console.log('Captured five actual Electron views with isolated sample data in docs/screenshots.');
} finally {
  if (application) await application.close();
  // This temporary tree was created exclusively by this script.
  await fs.rm(temporary, { recursive: true, force: true });
}
