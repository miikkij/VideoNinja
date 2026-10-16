/* global document, window */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

// Real renderer, IPC, queue, OS encryption and disk persistence. Only external
// media executables and native dialogs use deterministic fixtures here.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const packaged = process.argv.includes('--packaged');
let executablePath = require('electron');
if (packaged) {
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
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'videoninja-features-'));
const profile = path.join(temporary, 'profile');
const downloads = path.join(temporary, 'downloads');
await Promise.all(
  [profile, downloads, path.join(root, 'test-results')].map((dir) =>
    fs.mkdir(dir, { recursive: true }),
  ),
);
await fs.writeFile(
  path.join(profile, 'config.json'),
  JSON.stringify({
    settings: {
      downloadPath: downloads,
      language: 'en',
      checkUpdatesOnStartup: false,
    },
  }),
);
const env = { ...process.env, VIDEONINJA_USER_DATA: profile, VIDEONINJA_HEADLESS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let application;
const errors = [];
async function launch() {
  application = await electron.launch({
    executablePath,
    args: packaged ? [] : [root],
    env,
    timeout: 45000,
  });
  const page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1088, 900);
    BrowserWindow.getAllWindows()[0].showInactive();
  });
  await page.waitForFunction(() => document.querySelector('#loading')?.hidden === true);
  return page;
}
async function state(page) {
  const result = await page.evaluate(() => window.videoNinja.getInitialState());
  assert.equal(result.ok, true);
  return result.data;
}
async function waitHistory(page, count) {
  await page.waitForFunction(
    async (expected) =>
      (await window.videoNinja.getInitialState()).data.queue.history.length === expected,
    count,
  );
}
try {
  let page = await launch();
  await application.evaluate(({ app, dialog }, folder) => {
    const tools = process.mainModule.require(app.getAppPath() + '/src/main/ytdlp.js');
    const fileSystem = process.mainModule.require('node:fs');
    const nodePath = process.mainModule.require('node:path');
    globalThis.featureCalls = [];
    globalThis.holdFeatureJobs = false;
    dialog.showMessageBox = async () => ({ response: 1 });
    tools.checkYtDlpAvailability = async () => ({
      available: true,
      version: 'fixture',
      path: 'fixture',
      jsRuntimes: [],
    });
    tools.checkFfmpegAvailability = async () => ({
      available: true,
      version: 'fixture',
      path: 'fixture',
    });
    tools.getDiskSpace = async () => ({
      available: true,
      free: 100 * 1024 ** 3,
      total: 200 * 1024 ** 3,
    });
    tools.fetchMetadata = async (url) => ({
      id: url.split('/').at(-1),
      extractor: 'FeatureFixture',
      title: 'A sample film',
      duration: 42,
      filesize: 4096,
      formats: [
        {
          formatId: '18',
          ext: 'mp4',
          height: 720,
          width: 1280,
          fps: 30,
          vcodec: 'h264',
          acodec: 'aac',
          hasVideo: true,
          hasAudio: true,
          filesize: 4096,
        },
        {
          formatId: '137',
          ext: 'mp4',
          height: 1080,
          width: 1920,
          fps: 30,
          vcodec: 'h264',
          acodec: 'none',
          hasVideo: true,
          hasAudio: false,
          filesize: 8192,
        },
        {
          formatId: '140',
          ext: 'm4a',
          vcodec: 'none',
          acodec: 'aac',
          hasVideo: false,
          hasAudio: true,
          filesize: 1024,
        },
      ],
    });
    tools.fetchPlaylist = async (_url, _options, { start = 1, pageSize = 500 } = {}) => ({
      title: 'A series with 503 entries',
      start,
      pageSize,
      hasMore: start === 1,
      entries: Array.from({ length: start === 1 ? 500 : 3 }, (_, offset) => ({
        id: 'entry-' + (start + offset),
        index: start + offset,
        title: 'Episode ' + (start + offset),
        url: 'https://example.invalid/episode-' + (start + offset),
        available: true,
      })),
    });
    tools.downloadVideo = async (url, _folder, options, progress, { signal }) => {
      globalThis.featureCalls.push({ url, options });
      if (globalThis.holdFeatureJobs)
        return new Promise((resolve) => {
          progress({ percent: 20, status: 'downloading' });
          const stop = () => resolve({ success: false, error: 'Cancelled fixture' });
          signal.addEventListener('abort', stop, { once: true });
          if (signal.aborted) stop();
        });
      const filepath = nodePath.join(folder, url.split('/').at(-1) + '.mp4');
      fileSystem.writeFileSync(filepath, Buffer.alloc(4096));
      return {
        success: true,
        filepath,
        metadata: { title: 'A sample film' },
        integrity: {
          status: 'verified',
          size: 4096,
          duration: 42,
          streams: [{ type: 'video', codec: 'h264' }],
        },
      };
    };
  }, downloads);
  await page.locator('#settings-toggle').click();
  await page.locator('#recheck-tools').click();
  await page.locator('#theme').selectOption('dark');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.waitForFunction(
    async () => (await window.videoNinja.getInitialState()).data.settings.theme === 'dark',
  );
  await page.locator('#settings-toggle').click();
  await page.locator('.download-advanced > summary').click();
  await page.locator('#download-rate').fill('256');
  await page.locator('#subtitles').check();
  await page.locator('#subtitle-lang').fill('en,fi');
  await page.locator('#subtitle-auto').check();
  await page.locator('.profile-panel > summary').click();
  await page.locator('#profile-name').fill('Bilingual videos');
  await page.locator('#profile-save').click();
  await page.waitForFunction(
    () => document.querySelectorAll('#profile-select option').length === 2,
  );
  const savedProfile = (await state(page)).settings.profiles[0];
  assert.equal(savedProfile.options.subtitleLang, 'en,fi');
  assert.equal(savedProfile.options.rateLimitKbps, 256);
  await page.locator('#download-rate').fill('0');
  await page.locator('#subtitles').uncheck();
  await page.locator('#profile-apply').click();
  await page.waitForFunction(() => document.querySelector('#download-rate').value === '256');
  assert.equal(await page.locator('#subtitles').isChecked(), true);
  await page.locator('#video-urls').fill('https://example.invalid/film');
  await page.locator('#preview-button').click();
  await page.waitForFunction(() => document.querySelectorAll('#format-select option').length === 4);
  await page.locator('#format-select').selectOption('137');
  await page.locator('#format-audio').selectOption('140');
  assert.match(await page.locator('#format-select option:checked').textContent(), /h264/);
  assert.match(await page.locator('#format-details').textContent(), /9 KiB/);
  await page.locator('#add-downloads').click();
  await waitHistory(page, 1);
  const completed = (await state(page)).queue.history[0];
  assert.equal(completed.options.formatId, '137+140');
  assert.equal(completed.options.subtitleLang, 'en,fi');
  const duplicate = await page.evaluate(
    (item) => window.videoNinja.addDownloads({ urls: [item.url], options: item.options }),
    completed,
  );
  assert.equal(duplicate.ok, true);
  await waitHistory(page, 2);
  assert.ok((await state(page)).queue.history.some((item) => item.status === 'skipped'));
  assert.equal(await application.evaluate(() => globalThis.featureCalls.length), 1);

  // Search and selection use absolute indexes on the page beyond the first500.
  await page.locator('#video-urls').fill('https://example.invalid/playlist');
  await page.locator('#playlist-preview-button').click();
  await page.waitForFunction(
    () => document.querySelectorAll('#playlist-list input').length === 500,
  );
  await page.locator('#playlist-next').click();
  await page.waitForFunction(() => document.querySelectorAll('#playlist-list input').length === 3);
  await page.locator('#playlist-search').fill('502');
  assert.equal(await page.locator('#playlist-list > li:visible').count(), 1);
  await page.locator('#playlist-range').fill('502-503');
  await page.locator('#playlist-apply-range').click();
  assert.equal(await page.locator('#playlist-list input:checked').count(), 2);
  await page.locator('#playlist-add-selected').click();
  await waitHistory(page, 4);
  const calls = await application.evaluate(() => globalThis.featureCalls.map((call) => call.url));
  assert.ok(calls.includes('https://example.invalid/episode-502'));
  assert.ok(calls.includes('https://example.invalid/episode-503'));

  // Bulk pause/resume/cancel retains actual child lifecycle semantics.
  await application.evaluate(() => {
    globalThis.holdFeatureJobs = true;
  });
  await page
    .locator('#video-urls')
    .fill('https://example.invalid/hold-a\nhttps://example.invalid/hold-b');
  await page.locator('#add-downloads').click();
  await page.waitForFunction(() => document.querySelectorAll('#queue-list > li').length === 2);
  await page.locator('#queue-select-all').click();
  await page.locator('[data-queue-action="pause"]').click();
  await page.waitForFunction(async () =>
    (await window.videoNinja.getInitialState()).data.queue.queue.every(
      (item) => item.status === 'paused',
    ),
  );
  await page.locator('#queue-select-all').click();
  await page.locator('[data-queue-action="resume"]').click();
  await page.waitForFunction(
    async () => (await window.videoNinja.getInitialState()).data.queue.isProcessing,
  );
  await page.locator('#queue-select-all').click();
  await page.locator('[data-queue-action="cancel"]').click();
  await waitHistory(page, 6);
  await page.waitForFunction(
    async () => !(await window.videoNinja.getInitialState()).data.queue.isProcessing,
  );

  await page.locator('#history-search').fill('hold-a');
  await page.locator('#history-select-visible').click();
  await page.locator('#history-delete-selected').click();
  await waitHistory(page, 5);
  assert.equal(
    (await fs.stat(path.join(downloads, 'film.mp4'))).size,
    4096,
    'History deletion leaves media untouched.',
  );
  await page.locator('#history-search').fill('');
  await application.evaluate(() => {
    globalThis.holdFeatureJobs = false;
  });
  await page.locator('#settings-toggle').click();
  await page.locator('#workflow-settings > summary').click();
  await page.locator('#global-rate').fill('512');
  await page.locator('#global-rate').blur();
  await page.locator('#privacy-settings > summary').click();
  await page.locator('#history-retention').fill('30');
  await page.locator('#history-retention').blur();
  await page.locator('#private-mode').check();
  await page.waitForFunction(async () => {
    const settings = (await window.videoNinja.getInitialState()).data.settings;
    return (
      settings.privateMode &&
      settings.historyRetentionDays === 30 &&
      settings.globalRateKbps === 512
    );
  });
  const privateResult = await page.evaluate(() =>
    window.videoNinja.addDownloads({ urls: ['https://example.invalid/private-film'], options: {} }),
  );
  assert.equal(privateResult.ok, true);
  await page.waitForFunction(async () => {
    const current = (await window.videoNinja.getInitialState()).data.queue;
    return !current.queue.length && !current.isProcessing;
  });
  assert.equal((await state(page)).queue.history.length, 5);
  assert.equal(
    (await fs.readFile(path.join(profile, 'config.json'), 'utf8')).includes('private-film'),
    false,
  );
  const encryption = (await state(page)).privacy.encryptionAvailable;
  if (encryption) {
    await page.locator('#encrypted-storage').check();
    await page.waitForFunction(
      async () => (await window.videoNinja.getInitialState()).data.privacy.encrypted,
    );
    const disk = JSON.parse(await fs.readFile(path.join(profile, 'config.json'), 'utf8'));
    assert.ok(disk.protectedState);
    assert.equal(disk.settings, undefined);
    assert.equal(JSON.stringify(disk).includes('example.invalid'), false);
  }
  await page.locator('#language').selectOption('fi');
  await page.waitForFunction(
    async () => (await window.videoNinja.getInitialState()).data.settings.language === 'fi',
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    true,
  );
  const png = await application.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'),
  );
  await fs.writeFile(
    path.join(root, 'test-results/features-dark-fi.png'),
    Buffer.from(png, 'base64'),
  );
  await application.close();
  application = undefined;
  page = await launch();
  const restored = await state(page);
  assert.equal(restored.settings.theme, 'dark');
  assert.equal(restored.settings.language, 'fi');
  assert.equal(restored.settings.profiles[0].options.subtitleLang, 'en,fi');
  assert.equal(restored.settings.globalRateKbps, 512);
  assert.equal(restored.queue.history.length, 5);
  assert.equal(restored.privacy.encrypted, encryption);
  assert.deepEqual(
    restored.queue.history.find((item) => item.status === 'completed').integrity.streams,
    [{ type: 'video', codec: 'h264' }],
  );
  assert.deepEqual(errors, []);
  console.log(
    `Feature smoke passed: profiles, exact formats, subtitles, archive, playlist paging/search/ranges, bulk actions, selective history, private session, theme and persisted restart. OS encryption: ${encryption ? 'round-trip verified' : 'unavailable (correctly disabled)'}.`,
  );
} finally {
  if (application) await application.close();
  // Only this script's freshly created temporary tree is removed.
  await fs.rm(temporary, { recursive: true, force: true });
}
