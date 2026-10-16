/* global document, window, requestAnimationFrame */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
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

  // Header interactions remain keyboard operable and cannot dismiss an error.
  await page.locator('#hide-window').click();
  await page.waitForFunction(() =>
    document.querySelector('#notice')?.classList.contains('is-error'),
  );
  const importantNotice = await page.locator('#notice-message').textContent();
  const ninja = page.locator('#ninja-icon');
  await ninja.press('Enter');
  await page.locator('.personality-toast[data-kind="ninja"]').waitFor();
  assert.equal(await page.locator('.personality-toast[data-kind="ninja"]').count(), 1);
  assert.equal(await ninja.evaluate((button) => button === document.activeElement), true);
  await ninja.press('Space');
  assert.equal(await page.locator('.personality-toast[data-kind="ninja"]').count(), 2);
  assert.equal(
    await page.evaluate(() =>
      window.VideoNinjaQuotes.en.ninja.includes(
        document.querySelector('.personality-toast[data-kind="ninja"] .personality-message')
          .textContent,
      ),
    ),
    true,
  );
  assert.equal(
    await page.locator('#camera-icon').evaluate((button) => {
      button.click();
      return button.classList.contains('camera-flash');
    }),
    true,
  );
  await page.waitForFunction(
    () => !document.querySelector('#camera-icon').classList.contains('camera-flash'),
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(
    await page.locator('#camera-icon').evaluate((button) => {
      button.click();
      return button.classList.contains('camera-flash');
    }),
    false,
  );
  assert.equal(await page.locator('.personality-toast').count(), 3);
  assert.equal(await page.locator('.personality-toast[data-kind="camera"]').count(), 2);
  assert.equal(await page.locator('#notice-message').textContent(), importantNotice);
  assert.equal(await page.locator('#notice').isVisible(), true);
  await page.locator('#dismiss-notice').click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
  const second = spawn(executablePath, packaged || installedExecutable ? [] : [root], {
    env: environment,
    shell: false,
    windowsHide: true,
    stdio: 'ignore',
  });
  const secondTimeout = setTimeout(() => second.kill(), 15000);
  try {
    const [exitCode] = await once(second, 'close');
    assert.equal(exitCode, 0, 'The second instance exits without creating another app.');
  } finally {
    clearTimeout(secondTimeout);
  }
  assert.equal(
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
    true,
    'The second launch reopens the existing window.',
  );

  // The native dialog boundary is replaced only inside this isolated test process.
  await application.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, downloads);
  await page.locator('#choose-folder').click();
  await page.waitForFunction(
    (folder) => document.querySelector('#download-path').value === folder,
    downloads,
  );
  await page.locator('#max-concurrent').selectOption('3');
  await page.waitForFunction(
    async () => (await window.videoNinja.getInitialState()).data.settings.maxConcurrent === 3,
  );
  // Stub only the external tool boundary for this GUI flow; test:media exercises
  // the actual executables separately. Native IPC, queue and persistence stay real.
  await application.evaluate(({ app }, folder) => {
    const adapter = process.mainModule.require(app.getAppPath() + '/src/main/ytdlp.js');
    globalThis.smokeDownloadCount = 0;
    adapter.checkYtDlpAvailability = async () => ({
      available: true,
      version: 'test fixture',
      path: 'fixture',
      jsRuntimes: [],
    });
    adapter.checkFfmpegAvailability = async () => ({
      available: true,
      version: 'test fixture',
      path: 'fixture',
    });
    adapter.fetchMetadata = async (url) => ({
      id: url.split('/').at(-1),
      extractor: 'smoke',
      title: 'Smoke video',
      filesize: 1024,
      formats: [
        {
          formatId: '18',
          ext: 'mp4',
          width: 1920,
          height: 1080,
          fps: 30,
          vcodec: 'avc1',
          acodec: 'aac',
          hasAudio: true,
          hasVideo: true,
          filesize: 1024,
        },
      ],
    });
    adapter.fetchPlaylist = async () => ({
      title: 'Smoke playlist',
      entries: [
        {
          id: 'a',
          index: 1,
          title: '<img src=x onerror="window.injected=true">',
          url: 'https://example.invalid/a',
          available: true,
        },
        { id: 'b', index: 2, title: 'Unavailable video', url: null, available: false },
        {
          id: 'c',
          index: 3,
          title: 'Second video',
          url: 'https://example.invalid/c',
          available: true,
        },
      ],
    });
    adapter.downloadVideo = async (url) => {
      globalThis.smokeDownloadCount++;
      return {
        success: true,
        filepath: folder + '/fixture.mp4',
        metadata: { title: url.endsWith('/a') ? 'First selected video' : 'Second selected video' },
      };
    };
  }, downloads);
  await page.locator('#recheck-tools').click();
  await page.locator('#video-urls').fill('https://example.invalid/list');
  await page.locator('#playlist-preview-button').click();
  await page.waitForFunction(() => document.querySelectorAll('#playlist-list input').length === 3);
  assert.equal(await application.evaluate(() => globalThis.smokeDownloadCount), 0);
  assert.equal(await page.locator('#playlist-list img').count(), 0);
  assert.equal(await page.locator('#playlist-list input[data-index="2"]').isDisabled(), true);
  await page.locator('#playlist-list input[data-index="1"]').check();
  await page.locator('#playlist-list input[data-index="3"]').check();
  await screenshot(`${mode}-playlist.png`, page);
  await page.locator('#playlist-add-selected').click();
  await page.waitForFunction(() => document.querySelectorAll('#history-list > li').length === 2);
  assert.equal(await application.evaluate(() => globalThis.smokeDownloadCount), 2);
  await page.locator('#language').selectOption('fi');
  await page.waitForFunction(() => document.documentElement.lang === 'fi');
  await page.waitForFunction(
    async () => (await window.videoNinja.getInitialState()).data.settings.language === 'fi',
  );

  // Native checks can outlive queue transitions. The eventual initial snapshot
  // must include jobs completed while it was waiting for tool availability.
  await application.evaluate(({ app }) => {
    const adapter = process.mainModule.require(app.getAppPath() + '/src/main/ytdlp.js');
    globalThis.smokeCheckReleases = [];
    const delayed = () =>
      new Promise((resolve) => {
        globalThis.smokeCheckReleases.push(() =>
          resolve({
            available: true,
            path: 'fixture',
            version: 'delayed fixture',
            jsRuntimes: [],
          }),
        );
      });
    adapter.checkYtDlpAvailability = delayed;
    adapter.checkFfmpegAvailability = delayed;
  });
  const checking = page.evaluate(() => window.videoNinja.recheckTools());
  await application.evaluate(async () => {
    const deadline = Date.now() + 5000;
    while (globalThis.smokeCheckReleases.length < 2 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    if (globalThis.smokeCheckReleases.length !== 2) throw new Error('Tool checks did not start.');
  });
  const initialDuringCheck = page.evaluate(() => window.videoNinja.getInitialState());
  const freshJob = await page.evaluate(() =>
    window.videoNinja.addDownloads({
      urls: ['https://example.invalid/initial-snapshot'],
      options: {},
    }),
  );
  assert.equal(freshJob.ok, true);
  await page.waitForFunction(() => document.querySelectorAll('#history-list > li').length === 3);
  await application.evaluate(() => globalThis.smokeCheckReleases.forEach((release) => release()));
  assert.equal((await checking).ok, true);
  const freshState = await initialDuringCheck;
  assert.equal(freshState.ok, true);
  assert.equal(
    freshState.data.queue.history.some(
      (job) => job.id === freshJob.data[0] && job.status === 'completed',
    ),
    true,
    'Initial state reflects queue changes that completed during delayed tool checks.',
  );

  // Both tool probes and an active queue job reject/settle only after delayed
  // cancellation cleanup. Quit must wait for all three before its checkpoint.
  await application.evaluate(({ app }, fixtureRoot) => {
    const adapter = process.mainModule.require(app.getAppPath() + '/src/main/ytdlp.js');
    const filesystem = process.mainModule.require('node:fs/promises');
    const paths = process.mainModule.require('node:path');
    globalThis.smokeAbortProbeCount = 0;
    globalThis.smokeShutdownDownloadStarted = false;
    const probe =
      (name, delay) =>
      ({ signal } = {}) =>
        new Promise((resolve, reject) => {
          globalThis.smokeAbortProbeCount++;
          if (!signal) {
            reject(new Error('Tool probes require a shutdown signal.'));
            return;
          }
          const abort = () =>
            setTimeout(() => {
              filesystem.writeFile(paths.join(fixtureRoot, name), 'settled').then(() => {
                reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
              }, reject);
            }, delay);
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
        });
    adapter.checkYtDlpAvailability = probe('ytdlp-probe-settled', 30);
    adapter.checkFfmpegAvailability = probe('ffmpeg-probe-settled', 150);
    adapter.downloadVideo = (_url, _folder, _options, _progress, { signal }) =>
      new Promise((resolve, reject) => {
        globalThis.smokeShutdownDownloadStarted = true;
        const abort = () =>
          setTimeout(() => {
            filesystem
              .writeFile(paths.join(fixtureRoot, 'download-settled'), 'settled')
              .then(() => {
                resolve({ success: false, filepath: null, error: 'cancelled' });
              }, reject);
          }, 75);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
  }, temporary);
  const shutdownJob = await page.evaluate(() =>
    window.videoNinja.addDownloads({
      urls: ['https://example.invalid/shutdown-pending'],
      options: {},
    }),
  );
  assert.equal(shutdownJob.ok, true);
  await page.evaluate(() => {
    void window.videoNinja.recheckTools();
  });
  await application.evaluate(async () => {
    const deadline = Date.now() + 5000;
    while (
      (!globalThis.smokeShutdownDownloadStarted || globalThis.smokeAbortProbeCount < 2) &&
      Date.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    if (!globalThis.smokeShutdownDownloadStarted || globalThis.smokeAbortProbeCount !== 2)
      throw new Error('Shutdown fixtures did not start.');
  });
  await close();
  for (const marker of ['ytdlp-probe-settled', 'ffmpeg-probe-settled', 'download-settled'])
    assert.equal(await fs.readFile(path.join(temporary, marker), 'utf8'), 'settled');

  const configFile = path.join(profile, 'config.json');
  const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
  assert.equal(config.settings.downloadPath, downloads);
  assert.equal(config.settings.language, 'fi');
  assert.equal(config.settings.maxConcurrent, 3);
  assert.equal(
    config.queueState.queue.find((job) => job.id === shutdownJob.data[0])?.status,
    'pending',
    'Quitting during rejected tool checks still checkpoints active work for restart.',
  );
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
  await page.locator('#ninja-icon').press('Enter');
  await page.locator('.personality-toast[data-kind="ninja"]').waitFor();
  assert.equal(
    await page.evaluate(() =>
      window.VideoNinjaQuotes.fi.ninja.includes(
        document.querySelector('.personality-toast[data-kind="ninja"] .personality-message')
          .textContent,
      ),
    ),
    true,
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    true,
    'Personality messages fit at 200% zoom.',
  );
  await screenshot(mode === 'source' ? 'personality.png' : `${mode}-personality.png`, page);
  await close();
  const saved = JSON.parse(await fs.readFile(configFile, 'utf8'));
  assert.equal(saved.queueState.queue.length, 500);
  assert.equal(saved.queueState.queue[0].id, 'paused-1');
  assert.equal(
    saved.queueState.queue.every((item) => item.status === 'paused'),
    true,
  );
  await fs.writeFile(configFile, '{broken-json');
  page = await launch();
  assert.equal(await page.locator('#settings-panel').isVisible(), true);
  assert.equal(await page.locator('#warnings').isVisible(), true);
  const backups = (await fs.readdir(profile)).filter((name) =>
    name.startsWith('config.json.corrupt-'),
  );
  assert.equal(backups.length, 1, 'Corrupt configuration is preserved instead of discarded.');
  assert.equal(await fs.readFile(path.join(profile, backups[0]), 'utf8'), '{broken-json');
  await close();
  assert.deepEqual(errors, [], 'Renderer has no uncaught errors.');
  console.log(
    `${mode} Electron smoke passed: sandbox, setup, IPC, languages, 500 queued jobs, 100 history entries, fresh initial snapshots, awaited tool/download shutdown, focus, reload, persistence, keyboard personality interactions, reduced motion and 200% layout.`,
  );
} finally {
  await close();
  // Only this script's freshly created OS temporary fixture is removed.
  await fs.rm(temporary, { recursive: true, force: true });
}
