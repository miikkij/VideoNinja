// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const html = readFileSync(resolve('src/renderer/index.html'), 'utf8');
const translations = readFileSync(resolve('src/renderer/i18n.js'), 'utf8');
const personalityQuotes = readFileSync(resolve('src/renderer/personality-quotes.js'), 'utf8');
const application = readFileSync(resolve('src/renderer/app.js'), 'utf8');
const $ = (id) => document.getElementById(id);
const ok = (data) => ({ ok: true, data });
const goodTools = {
  ytdlp: {
    available: true,
    path: '/usr/bin/yt-dlp',
    version: 'test',
    jsRuntimes: [{ name: 'deno', version: '2.3.0' }],
  },
  ffmpeg: { available: true, path: '/usr/bin/ffmpeg', version: 'test' },
};
const job = (id, status = 'pending', more = {}) => ({
  id,
  status,
  url: `https://example.com/${id}`,
  outputPath: '/downloads',
  options: { quality: '1080' },
  progress: 0,
  ...more,
});

async function boot(overrides = {}) {
  document.documentElement.innerHTML = html
    .replace(/<!doctype[^>]*>/i, '')
    .replace(/<html[^>]*>|<\/html>/gi, '');
  const state = {
    version: '2.0.0',
    settings: { downloadPath: '/downloads', language: 'en', quality: 'best', jsRuntime: 'auto' },
    queue: { queue: [], history: [] },
    tools: structuredClone(goodTools),
    diskSpace: { available: true, free: 10 * 1024 ** 3, total: 100 * 1024 ** 3 },
    startupEnabled: false,
    warnings: [],
    ...overrides,
  };
  const events = {};
  const api = {};
  for (const method of [
    'recheckTools',
    'chooseDownloadDirectory',
    'chooseCookieFile',
    'addDownloads',
    'cancelDownload',
    'pauseDownload',
    'resumeDownload',
    'moveDownload',
    'retryDownload',
    'openFile',
    'showInFolder',
    'setStartup',
    'hideWindow',
    'clearHistory',
    'exportHistory',
    'previewDownload',
    'previewPlaylist',
    'cancelPlaylistPreview',
    'addPlaylistSelection',
    'openExternal',
    'toolAction',
    'appUpdate',
    'saveProfile',
    'deleteProfile',
    'queueAction',
    'deleteHistory',
    'openSource',
    'toolMaintenance',
    'getSiteCompatibility',
    'clearSiteCompatibility',
  ])
    api[method] = vi.fn(async () => ok(null));
  api.getInitialState = vi.fn(async () => ok(state));
  api.saveSettings = vi.fn(async (input) => ok(input));
  for (const name of [
    'onState',
    'onProgress',
    'onDiskSpace',
    'onTools',
    'onWarnings',
    'onAppUpdate',
    'onDownloadEvent',
  ]) {
    api[name] = vi.fn((callback) => {
      events[name] = callback;
      return vi.fn();
    });
  }
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(async () => {}) },
  });
  window.videoNinja = api;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: false })),
  });
  // jsdom has no top layer; native Electron dialog behavior is checked by the app smoke suite.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  window.eval(translations);
  window.eval(personalityQuotes);
  window.eval(application);
  await vi.waitFor(() => expect($('loading').hidden).toBe(true));
  return { api, events, state };
}

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('production renderer', () => {
  it('restores ninja quotes in the selected language without replacing important notices', async () => {
    const { api } = await boot();
    const english = window.VideoNinjaQuotes.en.ninja;
    const finnish = window.VideoNinjaQuotes.fi.ninja;
    const quoteIndex = english.findIndex((quote, index) => quote !== finnish[index]);
    vi.spyOn(Math, 'random').mockReturnValue((quoteIndex + 0.1) / english.length);
    api.hideWindow.mockResolvedValue({ ok: false, error: { code: 'TRAY_UNAVAILABLE' } });
    $('hide-window').click();
    await vi.waitFor(() => expect($('notice').hidden).toBe(false));
    const importantNotice = $('notice-message').textContent;
    const ninja = $('ninja-icon');
    expect(ninja.tagName).toBe('BUTTON');
    expect(ninja.type).toBe('button');
    ninja.focus();
    ninja.click();
    let toast = document.querySelector('.personality-toast[data-kind="ninja"]');
    expect(toast.querySelector('.personality-message').textContent).toBe(english[quoteIndex]);
    expect(toast.querySelector('strong').textContent.trim()).not.toBe('');
    expect(document.activeElement).toBe(ninja);
    $('language').value = 'fi';
    $('language').dispatchEvent(new Event('change'));
    expect(toast.querySelector('.personality-message').textContent).toBe(finnish[quoteIndex]);
    ninja.click();
    toast = document.querySelectorAll('.personality-toast[data-kind="ninja"]').item(1);
    expect(finnish).toContain(toast.querySelector('.personality-message').textContent);
    expect($('notice-message').textContent).toBe(importantNotice);
    expect($('notice').hidden).toBe(false);
    expect($('personality-toasts').querySelector('img,script')).toBeNull();
  });

  it('bounds transient personality messages, expires them and disposes their timers on pagehide', async () => {
    await boot();
    vi.useFakeTimers();
    for (let index = 0; index < 5; index++) $('ninja-icon').click();
    expect($('personality-toasts').children).toHaveLength(3);
    vi.advanceTimersByTime(3000);
    expect($('personality-toasts').children).toHaveLength(0);
    $('ninja-icon').click();
    $('camera-icon').click();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    window.dispatchEvent(new Event('pagehide'));
    expect(vi.getTimerCount()).toBe(0);
    expect($('personality-toasts').children).toHaveLength(0);
    expect($('camera-icon').classList.contains('camera-flash')).toBe(false);
    $('ninja-icon').click();
    expect($('personality-toasts').children).toHaveLength(0);
  });

  it('flashes the camera briefly and respects reduced motion while retaining its message', async () => {
    await boot();
    vi.useFakeTimers();
    const camera = $('camera-icon');
    expect(camera.tagName).toBe('BUTTON');
    camera.click();
    expect(camera.classList.contains('camera-flash')).toBe(true);
    expect(document.querySelectorAll('.personality-toast[data-kind="camera"]')).toHaveLength(1);
    vi.advanceTimersByTime(100);
    expect(camera.classList.contains('camera-flash')).toBe(false);
    window.matchMedia.mockReturnValue({ matches: true });
    camera.click();
    expect(camera.classList.contains('camera-flash')).toBe(false);
    expect(document.querySelectorAll('.personality-toast[data-kind="camera"]')).toHaveLength(2);
  });

  it('shows lifecycle quotes only for explicit download events, never state or progress replay', async () => {
    const { events } = await boot({
      queue: {
        queue: [job('active', 'downloading'), job('waiting')],
        history: [job('done', 'completed'), job('old-failure', 'failed')],
      },
    });
    expect($('personality-toasts').children).toHaveLength(0);
    for (const type of ['started', 'completed', 'failed']) {
      events.onDownloadEvent({ type });
      const toast = document.querySelector(`.personality-toast[data-kind="${type}"]`);
      expect(window.VideoNinjaQuotes.en[type]).toContain(
        toast.querySelector('.personality-message').textContent,
      );
    }
    const displayed = [...$('personality-toasts').children];
    events.onState({
      queue: [job('active', 'paused')],
      history: [job('waiting', 'completed'), job('failed', 'failed'), job('skipped', 'skipped')],
    });
    events.onProgress({ id: 'active', progress: 42, phase: 'downloading' });
    for (const type of ['paused', 'cancelled', 'skipped', '<img src=x>'])
      events.onDownloadEvent({ type });
    expect([...$('personality-toasts').children]).toEqual(displayed);
  });

  it('shows first-run settings and enables adding only after a selected folder is saved', async () => {
    const { api } = await boot({ settings: { language: 'en' } });
    expect($('settings-panel').hidden).toBe(false);
    expect($('settings-toggle').getAttribute('aria-expanded')).toBe('true');
    expect($('add-downloads').disabled).toBe(true);
    api.chooseDownloadDirectory.mockResolvedValue(ok('/new folder'));
    $('choose-folder').click();
    await vi.waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ downloadPath: '/new folder' }),
      ),
    );
    await vi.waitFor(() => expect($('add-downloads').disabled).toBe(false));
    expect($('download-path').value).toBe('/new folder');
  });

  it('rechecks missing tools through the API without reloading or losing the form', async () => {
    const { api } = await boot({
      tools: { ytdlp: { available: false }, ffmpeg: { available: false } },
    });
    $('video-urls').value = 'https://example.com/keep';
    api.recheckTools.mockResolvedValue(ok(goodTools));
    expect($('add-downloads').disabled).toBe(true);
    $('recheck-tools').click();
    await vi.waitFor(() => expect($('add-downloads').disabled).toBe(false));
    expect(api.recheckTools).toHaveBeenCalledOnce();
    expect($('video-urls').value).toBe('https://example.com/keep');
  });

  it('submits a batch with Enter, preserves text until acceptance and does not submit Shift+Enter', async () => {
    const { api } = await boot();
    let resolve;
    api.addDownloads.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const text = 'https://example.com/one\nhttps://example.com/two';
    $('video-urls').value = text;
    $('quality').value = '2160';
    $('video-urls').dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(api.addDownloads).not.toHaveBeenCalled();
    $('video-urls').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() =>
      expect(api.addDownloads).toHaveBeenCalledWith({
        urls: text.split('\n'),
        options: { quality: '2160' },
      }),
    );
    expect($('video-urls').value).toBe(text);
    expect($('notice').hidden).toBe(true);
    expect(document.querySelectorAll('.personality-toast[data-kind="queued"]')).toHaveLength(0);
    resolve(ok(['one', 'two']));
    await vi.waitFor(() => expect($('video-urls').value).toBe(''));
    expect($('notice-message').textContent).toContain('2');
    expect(document.querySelectorAll('.personality-toast[data-kind="queued"]')).toHaveLength(1);
  });

  it('rejects malformed protocols and retains failed submissions with a persistent accessible error', async () => {
    const { api } = await boot();
    $('video-urls').value = 'javascript:alert(1)';
    $('download-form').requestSubmit();
    expect(api.addDownloads).not.toHaveBeenCalled();
    expect($('video-urls').getAttribute('aria-invalid')).toBe('true');
    expect($('urls-error').hidden).toBe(false);
    $('video-urls').value = 'https://example.com/video';
    api.addDownloads.mockResolvedValue({
      ok: false,
      error: { code: 'FOLDER_UNAVAILABLE', message: 'folder failed' },
    });
    $('download-form').requestSubmit();
    await vi.waitFor(() => expect($('urls-error').textContent).toContain('not writable'));
    expect($('video-urls').value).toBe('https://example.com/video');
    expect($('notice').hidden).toBe(true);
    expect(document.querySelectorAll('.personality-toast')).toHaveLength(0);
  });

  it('renders hostile titles, URLs, metadata and errors as plain text', async () => {
    const hostile = '<img src=x onerror="window.attacked=true">';
    await boot({
      queue: {
        queue: [],
        history: [job('unsafe', 'failed', { title: hostile, url: hostile, error: hostile })],
      },
    });
    const item = document.querySelector('[data-id="unsafe"]');
    expect(item.querySelector('.download-title').textContent).toBe(hostile);
    expect(item.querySelector('.error-detail').textContent).toBe(hostile);
    expect(item.querySelector('img')).toBeNull();
    expect(window.attacked).toBeUndefined();
    item.querySelector('[data-action="copyError"]').click();
    await vi.waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(hostile));
  });

  it('keeps the focused row/button through progress and durable state updates', async () => {
    const active = job('active', 'downloading');
    const next = job('next');
    const { events } = await boot({ queue: { queue: [active, next], history: [] } });
    const row = document.querySelector('[data-id="active"]');
    const cancel = row.querySelector('[data-action="cancel"]');
    cancel.focus();
    events.onProgress({
      id: 'active',
      progress: 47,
      phase: 'merging',
      status: 'merging',
      title: 'Real title',
      speed: 2048,
      eta: 7,
    });
    expect(row.querySelector('progress').value).toBe(47);
    expect(row.querySelector('.download-state').textContent).toContain('Combining');
    expect(document.activeElement).toBe(cancel);
    events.onState({
      queue: [{ ...active, title: 'Real title', progress: 47 }, next],
      history: [],
    });
    expect(document.querySelector('[data-id="active"]')).toBe(row);
    expect(document.activeElement).toBe(cancel);
  });

  it('invokes active pause/cancel, paused resume, and queued move with job IDs', async () => {
    const { api } = await boot({
      queue: { queue: [job('a', 'downloading'), job('b', 'paused'), job('c')], history: [] },
    });
    document.querySelector('[data-id="a"] [data-action="pause"]').click();
    document.querySelector('[data-id="a"] [data-action="cancel"]').click();
    document.querySelector('[data-id="b"] [data-action="resume"]').click();
    document.querySelector('[data-id="c"] [data-action="moveUp"]').click();
    expect(api.pauseDownload).toHaveBeenCalledWith('a');
    expect(api.cancelDownload).toHaveBeenCalledWith('a');
    expect(api.resumeDownload).toHaveBeenCalledWith('b');
    expect(api.moveDownload).toHaveBeenCalledWith({ id: 'c', direction: 'up' });
    expect(document.querySelector('[data-id="b"] [data-action="moveUp"]').disabled).toBe(true);
  });

  it('uses IDs for file opening and supports history search, export and clear', async () => {
    const { api, events } = await boot({
      queue: {
        queue: [],
        history: [job('done', 'completed', { title: 'Summer walk' }), job('failed', 'failed')],
      },
    });
    document.querySelector('[data-id="done"] [data-action="openFile"]').click();
    expect(api.openFile).toHaveBeenCalledWith('done');
    $('history-search').value = 'summer';
    $('history-search').dispatchEvent(new Event('input'));
    expect(document.querySelector('[data-id="done"]').hidden).toBe(false);
    expect(document.querySelector('[data-id="failed"]').hidden).toBe(true);
    api.exportHistory.mockResolvedValue(ok({ exported: true }));
    $('export-history').click();
    await vi.waitFor(() => expect($('notice-message').textContent).toBe('History exported.'));
    api.clearHistory.mockImplementation(async () => {
      events.onState({ queue: [], history: [] });
      return ok({ cleared: true });
    });
    $('clear-history').click();
    await vi.waitFor(() =>
      expect($('notice-message').textContent).toContain('Downloaded files were kept'),
    );
    expect($('clear-history').disabled).toBe(true);
  });

  it('switches language and persists it while retaining the form and queue focus', async () => {
    const { api } = await boot({ queue: { queue: [job('a', 'paused')], history: [] } });
    $('video-urls').value = 'https://example.com/unfinished';
    $('language').value = 'fi';
    $('language').dispatchEvent(new Event('change'));
    expect(document.documentElement.lang).toBe('fi');
    expect($('add-downloads').textContent).toBe('Lisää jonoon');
    expect(document.querySelector('[data-action="resume"]').textContent).toBe('Jatka');
    expect($('video-urls').value).toBe('https://example.com/unfinished');
    await vi.waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ language: 'fi' })),
    );
  });

  it('opens a labelled retry dialog, traps Tab, restores focus, and submits revised options', async () => {
    const { api } = await boot({
      queue: { queue: [], history: [job('failed', 'failed', { error: 'Network unavailable' })] },
    });
    const opener = document.querySelector('[data-action="retryOptions"]');
    opener.click();
    expect($('retry-dialog').open).toBe(true);
    expect(document.activeElement).toBe($('retry-quality'));
    $('submit-retry').focus();
    $('submit-retry').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe($('close-retry'));
    $('close-retry').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe($('submit-retry'));
    $('retry-quality').value = '720';
    $('retry-ipv4').checked = true;
    $('retry-form').requestSubmit();
    await vi.waitFor(() =>
      expect(api.retryDownload).toHaveBeenCalledWith({
        id: 'failed',
        options: { quality: '720', forceIpv4: true, subtitles: false },
      }),
    );
    await vi.waitFor(() => expect($('retry-dialog').open).toBe(false));
    expect(document.activeElement).toBe(opener);
  });

  it('previews only the first URL and does not enqueue or inject returned markup', async () => {
    const { api } = await boot();
    $('video-urls').value = 'https://example.com/one\nhttps://example.com/two';
    api.previewDownload.mockResolvedValue(
      ok({ title: '<script>bad()</script>', uploader: '<b>Person</b>', duration: 125 }),
    );
    $('preview-button').click();
    await vi.waitFor(() => expect($('preview-panel').hidden).toBe(false));
    expect(api.previewDownload).toHaveBeenCalledWith({
      url: 'https://example.com/one',
      options: { quality: 'best' },
    });
    expect($('preview-title').textContent).toBe('<script>bad()</script>');
    expect($('preview-panel').querySelector('script')).toBeNull();
    expect(api.addDownloads).not.toHaveBeenCalled();
  });

  it('renders unknown disk space honestly and reverts a failed startup toggle', async () => {
    const { api, events } = await boot();
    events.onDiskSpace({ available: false, error: 'unavailable' });
    expect($('disk-space').textContent).toContain('unavailable');
    expect($('disk-space').textContent).not.toContain('50 GiB');
    api.setStartup.mockResolvedValue({ ok: false, error: { code: 'STARTUP_FAILED' } });
    $('startup').checked = true;
    $('startup').dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect($('startup').checked).toBe(false));
    expect($('notice-message').textContent).toContain('could not be changed');
  });

  it('loads saved Finnish labels, localizes known errors and unsubscribes on teardown', async () => {
    const { api } = await boot({ settings: { language: 'fi', downloadPath: '/downloads' } });
    expect(document.documentElement.lang).toBe('fi');
    expect($('settings-toggle').textContent).toBe('Asetukset');
    api.addDownloads.mockResolvedValue({
      ok: false,
      error: { code: 'FOLDER_UNAVAILABLE', message: 'English detail' },
    });
    $('video-urls').value = 'https://example.com/one';
    $('download-form').requestSubmit();
    await vi.waitFor(() => expect($('urls-error').textContent).toContain('Latauskansiota'));
    window.dispatchEvent(new Event('pagehide'));
    for (const name of ['onState', 'onProgress', 'onDiskSpace', 'onTools', 'onWarnings'])
      expect(api[name].mock.results[0].value).toHaveBeenCalledOnce();
  });

  it('keeps localized persistence warnings separate from success notices until cleared', async () => {
    const { api, events } = await boot({
      settings: { language: 'fi', downloadPath: '/downloads' },
      warnings: ['QUEUE_SAVE_FAILED'],
    });
    expect($('warnings').hidden).toBe(false);
    expect($('warnings-message').textContent).toContain('Jonoa ei voitu tallentaa');
    api.addDownloads.mockResolvedValue(ok(['new']));
    $('video-urls').value = 'https://example.com/one';
    $('download-form').requestSubmit();
    await vi.waitFor(() => expect($('notice-message').textContent).toContain('Jonoon lisättiin'));
    expect($('warnings-message').textContent).toContain('Jonoa ei voitu tallentaa');
    events.onWarnings([]);
    expect($('warnings').hidden).toBe(true);
    events.onDiskSpace({ available: true, free: 512, total: 1024 ** 3 });
    expect($('disk-alert').hidden).toBe(false);
    expect($('disk-alert-message').textContent).toContain('Levytila hyvin vähissä');
  });

  it('shows and submits an explicit audio format without mixing it into video requests', async () => {
    const { api } = await boot();
    $('quality').value = 'audio';
    $('quality').dispatchEvent(new Event('change'));
    expect($('audio-format-field').hidden).toBe(false);
    $('audio-format').value = 'mp3';
    $('video-urls').value = 'https://example.com/audio';
    $('download-form').requestSubmit();
    await vi.waitFor(() =>
      expect(api.addDownloads).toHaveBeenCalledWith({
        urls: ['https://example.com/audio'],
        options: { quality: 'audio', audioFormat: 'mp3' },
      }),
    );
    await vi.waitFor(() => expect($('add-downloads').disabled).toBe(false));
    $('quality').value = '1080';
    $('quality').dispatchEvent(new Event('change'));
    expect($('audio-format-field').hidden).toBe(true);
    $('video-urls').value = 'https://example.com/video';
    $('download-form').requestSubmit();
    await vi.waitFor(() =>
      expect(api.addDownloads).toHaveBeenLastCalledWith({
        urls: ['https://example.com/video'],
        options: { quality: '1080' },
      }),
    );
  });

  it('keeps unsaved settings visible and can retry saving without re-entering the folder', async () => {
    const { api } = await boot();
    api.chooseDownloadDirectory.mockResolvedValue(ok('/changed'));
    api.saveSettings.mockResolvedValueOnce({ ok: false, error: { code: 'OPERATION_FAILED' } });
    $('choose-folder').click();
    await vi.waitFor(() => expect($('retry-save').hidden).toBe(false));
    expect($('settings-panel').hidden).toBe(false);
    expect($('add-downloads').disabled).toBe(true);
    expect($('readiness').textContent).toContain('could not be saved');
    expect($('download-path').value).toBe('/changed');
    $('retry-save').click();
    await vi.waitFor(() => expect($('retry-save').hidden).toBe(true));
    expect($('add-downloads').disabled).toBe(false);
    expect(api.saveSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ downloadPath: '/changed' }),
    );
    expect(document.activeElement).toBe($('video-urls'));
  });

  it('allows clearing previous authentication and network overrides in retry options', async () => {
    const { api } = await boot({
      queue: {
        queue: [],
        history: [
          job('failed', 'failed', {
            options: {
              quality: '720',
              cookiesFromBrowser: 'chrome',
              jsRuntime: 'node',
              forceIpv4: true,
              userAgent: 'Custom agent',
              referer: 'https://example.com/',
              extractorArgs: 'youtube:player_client=web',
              extraArgs: ['--retries', '2'],
            },
          }),
        ],
      },
    });
    document.querySelector('[data-action="retryOptions"]').click();
    $('retry-cookie-source').value = '';
    $('retry-runtime').value = 'auto';
    $('retry-ipv4').checked = false;
    for (const id of ['retry-user-agent', 'retry-referer', 'retry-extractor', 'retry-extra'])
      $(id).value = '';
    $('retry-form').requestSubmit();
    await vi.waitFor(() =>
      expect(api.retryDownload).toHaveBeenCalledWith({
        id: 'failed',
        options: { quality: '720', subtitles: false },
      }),
    );
  });

  it('uses in-page navigation without changing the trusted renderer URL', async () => {
    await boot();
    const original = window.location.href;
    document.querySelector('a[href="#history-heading"]').click();
    expect(document.activeElement).toBe($('history-heading'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.location.href).toBe(original);
    document.querySelector('.skip-link').click();
    expect(document.activeElement).toBe($('download-heading'));
    expect(window.location.href).toBe(original);
  });

  it('translates recovery warnings and keeps unexpected diagnostic markup as text', async () => {
    const { events } = await boot({
      settings: { language: 'fi', downloadPath: '/downloads' },
      warnings: [
        'Damaged configuration was preserved in a separate file. Settings have been reset.',
        '3 invalid, duplicate or excess saved jobs were ignored.',
        '2 legacy jobs received new IDs.',
      ],
    });
    expect($('warnings-message').textContent).toContain('Vioittuneet asetukset');
    expect($('warnings-message').textContent).toContain('3 virheellistä');
    expect($('warnings-message').textContent).toContain('2 vanhempaa latausta');
    events.onWarnings(['<img src=x onerror=bad()>']);
    expect($('warnings-message').textContent).toBe('<img src=x onerror=bad()>');
    expect($('warnings').querySelector('img')).toBeNull();
  });

  it('loads and persists a user-selected concurrency limit', async () => {
    const { api } = await boot({
      settings: { downloadPath: '/downloads', language: 'fi', maxConcurrent: 3 },
    });
    expect($('max-concurrent').value).toBe('3');
    expect(document.querySelector('label[for="max-concurrent"]').textContent).toContain(
      'Samanaikaisten',
    );
    $('max-concurrent').value = '5';
    $('max-concurrent').dispatchEvent(new Event('change'));
    await vi.waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ maxConcurrent: 5 })),
    );
  });

  it('previews a playlist without downloading and enqueues only explicitly selected available entries', async () => {
    const { api } = await boot();
    $('video-urls').value = 'https://example.com/playlist\nnot-a-url';
    api.previewPlaylist.mockResolvedValue(
      ok({
        previewId: 'preview-1',
        title: '<img src=x>',
        maxEntries: 500,
        hasMore: false,
        entries: [
          {
            index: 1,
            title: 'First',
            url: 'https://example.com/one',
            duration: 42,
            available: true,
          },
          { index: 2, title: 'Private', url: null, duration: null, available: false },
          {
            index: 3,
            title: '<script>bad()</script>',
            url: 'https://example.com/three',
            duration: 90,
            available: true,
          },
        ],
      }),
    );
    $('playlist-preview-button').click();
    await vi.waitFor(() => expect($('playlist-list').children.length).toBe(3));
    expect(api.previewPlaylist).toHaveBeenCalledWith({
      url: 'https://example.com/playlist',
      options: { quality: 'best' },
      start: 1,
      pageSize: 500,
    });
    expect(api.addDownloads).not.toHaveBeenCalled();
    expect(api.addPlaylistSelection).not.toHaveBeenCalled();
    expect(document.querySelectorAll('.personality-toast[data-kind="queued"]')).toHaveLength(0);
    expect($('playlist-add-selected').disabled).toBe(true);
    expect($('playlist-dialog').querySelector('img, script')).toBeNull();
    expect(document.querySelector('#playlist-list input[data-index="2"]').disabled).toBe(true);
    $('playlist-select-all').click();
    expect($('playlist-status').textContent).toContain('2 of 2');
    $('playlist-clear-selection').click();
    expect($('playlist-add-selected').disabled).toBe(true);
    const selected = document.querySelector('#playlist-list input[data-index="3"]');
    selected.checked = true;
    selected.dispatchEvent(new Event('change', { bubbles: true }));
    api.addPlaylistSelection.mockResolvedValue(ok(['new-job']));
    $('playlist-add-selected').click();
    await vi.waitFor(() =>
      expect(api.addPlaylistSelection).toHaveBeenCalledWith({
        previewId: 'preview-1',
        indices: [3],
        options: { quality: 'best' },
      }),
    );
    await vi.waitFor(() => expect($('playlist-dialog').open).toBe(false));
    expect(api.cancelPlaylistPreview).not.toHaveBeenCalled();
    expect($('notice-message').textContent).toContain('1');
    expect(document.querySelectorAll('.personality-toast[data-kind="queued"]')).toHaveLength(1);
    expect(document.activeElement).toBe($('playlist-preview-button'));
  });

  it('cancels playlist inspection and discards a late response without downloading', async () => {
    const { api } = await boot();
    let resolvePreview;
    api.previewPlaylist.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve;
        }),
    );
    $('video-urls').value = 'https://example.com/playlist';
    $('playlist-preview-button').click();
    expect($('playlist-dialog').open).toBe(true);
    expect($('playlist-status').textContent).toContain('Reading');
    $('playlist-close').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect($('playlist-dialog').open).toBe(false);
    expect(api.cancelPlaylistPreview).toHaveBeenCalledOnce();
    resolvePreview(
      ok({
        previewId: 'late',
        entries: [
          { index: 1, title: 'Late result', url: 'https://example.com/one', available: true },
        ],
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect($('playlist-list').children.length).toBe(0);
    expect($('playlist-dialog').open).toBe(false);
    expect(api.addPlaylistSelection).not.toHaveBeenCalled();
  });

  it('bounds playlist rendering and keeps rejected selections visible with a localized error', async () => {
    const { api } = await boot({ settings: { downloadPath: '/downloads', language: 'fi' } });
    api.previewPlaylist.mockResolvedValue(
      ok({
        previewId: 'large',
        maxEntries: 500,
        hasMore: true,
        entries: Array.from({ length: 501 }, (_, index) => ({
          index: index + 1,
          title: `Video ${index + 1}`,
          url: `https://example.com/${index}`,
          available: true,
        })),
      }),
    );
    $('video-urls').value = 'https://example.com/playlist';
    $('playlist-preview-button').click();
    await vi.waitFor(() => expect($('playlist-list').children.length).toBe(500));
    expect($('playlist-limit').hidden).toBe(false);
    expect($('playlist-page').textContent).toContain('500');
    $('playlist-select-all').click();
    api.addPlaylistSelection.mockResolvedValue({ ok: false, error: { code: 'QUEUE_FULL' } });
    $('playlist-add-selected').click();
    await vi.waitFor(() =>
      expect($('playlist-error').textContent).toContain('Latausjono on täynnä'),
    );
    expect($('playlist-dialog').open).toBe(true);
    expect($('playlist-list').querySelectorAll('input:checked').length).toBe(500);
    expect($('playlist-add-selected').disabled).toBe(false);
  });

  it('loads advanced preferences, applies the theme, and saves validated settings without overwriting profiles', async () => {
    const { api } = await boot({
      settings: {
        downloadPath: '/downloads',
        language: 'fi',
        theme: 'dark',
        globalRateKbps: 512,
        scheduleEnabled: true,
        scheduleStart: '22:00',
        scheduleEnd: '07:00',
        profiles: [
          { id: 'p', name: 'Audio', options: { quality: 'audio' }, downloadPath: '/downloads' },
        ],
      },
      privacy: { encryptionAvailable: true },
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect($('global-rate').value).toBe('512');
    expect($('schedule-fields').hidden).toBe(false);
    expect($('queue-policy-status').textContent).toContain('22:00–07:00');
    expect($('encrypted-storage').disabled).toBe(false);
    $('theme').value = 'auto';
    $('theme').dispatchEvent(new Event('change'));
    $('global-rate').value = '1024';
    $('global-rate').dispatchEvent(new Event('change'));
    await vi.waitFor(() =>
      expect(api.saveSettings).toHaveBeenLastCalledWith(
        expect.objectContaining({ theme: 'auto', globalRateKbps: 1024 }),
      ),
    );
    expect(api.saveSettings.mock.lastCall[0]).not.toHaveProperty('profiles');
    expect(document.documentElement.dataset.theme).toBe('auto');
  });

  it('rejects invalid numeric preferences locally and retains recoverable settings', async () => {
    const { api } = await boot();
    $('retry-attempts').value = '6';
    $('retry-attempts').dispatchEvent(new Event('change'));
    expect(api.saveSettings).not.toHaveBeenCalled();
    expect($('retry-attempts').getAttribute('aria-invalid')).toBe('true');
    expect($('notice-message').textContent).toContain('between 0 and 5');
    $('retry-attempts').value = '3';
    $('retry-attempts').dispatchEvent(new Event('change'));
    await vi.waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ retryAttempts: 3 })),
    );
    expect($('retry-attempts').hasAttribute('aria-invalid')).toBe(false);
  });

  it('shows privacy capability honestly and waits for a private session setting to be saved', async () => {
    const { api } = await boot({ privacy: { encryptionAvailable: false } });
    expect($('encrypted-storage').disabled).toBe(true);
    expect($('encryption-status').textContent).toContain('unavailable');
    expect($('history-retention').value).toBe('0');
    let accept;
    api.saveSettings.mockImplementation(
      (settings) =>
        new Promise((resolve) => {
          accept = () => resolve(ok(settings));
        }),
    );
    $('private-mode').checked = true;
    $('private-mode').dispatchEvent(new Event('change'));
    expect($('private-banner').hidden).toBe(true);
    await vi.waitFor(() => expect(accept).toBeTypeOf('function'));
    accept();
    await vi.waitFor(() => expect($('private-banner').hidden).toBe(false));
    expect($('private-banner').textContent).toContain('not kept');
  });

  it('applies bulk actions only to eligible selected jobs and preserves selection across progress', async () => {
    const { api, events } = await boot({
      queue: {
        queue: [job('active', 'downloading'), job('waiting'), job('paused', 'paused')],
        history: [],
      },
    });
    $('queue-select-all').click();
    const box = document.querySelector('[data-select-job="active"]');
    box.focus();
    events.onProgress({ id: 'active', progress: 40, phase: 'downloading' });
    expect(box.checked).toBe(true);
    expect(document.activeElement).toBe(box);
    document.querySelector('[data-queue-action="pause"]').click();
    await vi.waitFor(() =>
      expect(api.queueAction).toHaveBeenCalledWith({ action: 'pause', ids: ['active', 'waiting'] }),
    );
    await vi.waitFor(() =>
      expect(document.querySelector('[data-queue-action="move"]').disabled).toBe(false),
    );
    $('queue-select-all').click();
    document.querySelector('[data-queue-action="move"]').click();
    await vi.waitFor(() =>
      expect(api.queueAction).toHaveBeenLastCalledWith({
        action: 'move',
        ids: ['waiting', 'paused'],
        targetIndex: 0,
      }),
    );
  });

  it('keeps bulk selections after a rejected action', async () => {
    const { api } = await boot({ queue: { queue: [job('one'), job('two')], history: [] } });
    api.queueAction.mockResolvedValue({ ok: false, error: { code: 'INVALID_STATE' } });
    $('queue-select-all').click();
    document.querySelector('[data-queue-action="cancel"]').click();
    await vi.waitFor(() =>
      expect($('notice-message').textContent).toContain('download has changed'),
    );
    expect(document.querySelectorAll('#queue-list input:checked')).toHaveLength(2);
    expect(document.querySelector('[data-queue-action="cancel"]').disabled).toBe(false);
  });

  it('selects only visible history and keeps it selected when native deletion is cancelled', async () => {
    const { api } = await boot({
      queue: {
        queue: [],
        history: [
          job('a', 'completed', { title: 'Keep video' }),
          job('b', 'failed', { title: 'Remove video' }),
        ],
      },
    });
    $('history-search').value = 'Remove';
    $('history-search').dispatchEvent(new Event('input'));
    $('history-select-visible').click();
    expect(document.querySelectorAll('#history-list input:checked')).toHaveLength(1);
    api.deleteHistory.mockResolvedValue(ok({ deleted: 0 }));
    $('history-delete-selected').click();
    await vi.waitFor(() => expect(api.deleteHistory).toHaveBeenCalledWith({ ids: ['b'] }));
    await vi.waitFor(() => expect($('history-delete-selected').disabled).toBe(false));
    expect(document.querySelector('[data-select-job="b"]').checked).toBe(true);
    api.deleteHistory.mockResolvedValue(ok({ deleted: 1 }));
    $('history-delete-selected').click();
    await vi.waitFor(() =>
      expect($('notice-message').textContent).toContain('Media files were kept'),
    );
  });

  it('applies a named profile to folder, audio, subtitles and rate without copying authentication into it', async () => {
    const profile = {
      id: 'p1',
      name: '<img src=x>',
      downloadPath: '/music',
      options: {
        quality: 'audio',
        audioFormat: 'mp3',
        subtitles: true,
        subtitleLang: 'fi',
        subtitleAuto: true,
        rateLimitKbps: 128,
      },
    };
    const { api } = await boot({
      settings: {
        language: 'en',
        downloadPath: '/downloads',
        cookieSource: 'firefox',
        profiles: [profile],
      },
    });
    expect($('profile-select').querySelector('img')).toBeNull();
    $('profile-select').value = 'p1';
    $('profile-select').dispatchEvent(new Event('change'));
    $('profile-apply').click();
    await vi.waitFor(() => expect($('audio-format').value).toBe('mp3'));
    expect($('download-path').value).toBe('/music');
    expect($('subtitle-lang').value).toBe('fi');
    expect($('download-rate').value).toBe('128');
    expect($('cookie-source').value).toBe('firefox');
    $('profile-name').value = 'Podcast';
    api.saveProfile.mockResolvedValue(
      ok({ profiles: [profile, { ...profile, id: 'p2', name: 'Podcast' }] }),
    );
    $('profile-save').click();
    await vi.waitFor(() =>
      expect(api.saveProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Podcast',
          downloadPath: '/music',
          options: expect.objectContaining({
            quality: 'audio',
            audioFormat: 'mp3',
            subtitles: true,
            subtitleLang: 'fi',
            rateLimitKbps: 128,
          }),
        }),
      ),
    );
    await vi.waitFor(() => expect($('profile-select').value).toBe('p2'));
  });

  it('deletes a profile without leaving unusable action buttons enabled', async () => {
    const { api } = await boot({
      settings: {
        downloadPath: '/downloads',
        profiles: [
          { id: 'p1', name: 'One', downloadPath: '/downloads', options: { quality: 'best' } },
        ],
      },
    });
    $('profile-select').value = 'p1';
    $('profile-select').dispatchEvent(new Event('change'));
    api.deleteProfile.mockResolvedValue(ok({ profiles: [] }));
    $('profile-delete').click();
    await vi.waitFor(() => expect($('profile-status').textContent).toContain('deleted'));
    expect($('profile-delete').disabled).toBe(true);
    expect($('profile-apply').disabled).toBe(true);
  });

  it('combines an explicit video format with audio, shows size and resets formats when the URL changes', async () => {
    const { api } = await boot();
    $('video-urls').value = 'https://example.com/video';
    api.previewDownload.mockResolvedValue(
      ok({
        title: '<script>bad()</script>',
        formats: [
          {
            formatId: '137',
            ext: 'mp4',
            height: 1080,
            vcodec: 'avc1',
            acodec: 'none',
            hasVideo: true,
            hasAudio: false,
            filesize: 1048576,
          },
          {
            formatId: '140',
            ext: 'm4a',
            vcodec: 'none',
            acodec: 'mp4a',
            hasVideo: false,
            hasAudio: true,
            filesize: 1048576,
          },
        ],
      }),
    );
    $('preview-button').click();
    await vi.waitFor(() => expect($('format-select').options.length).toBe(3));
    $('format-select').value = '137';
    $('format-select').dispatchEvent(new Event('change'));
    expect($('format-audio-field').hidden).toBe(false);
    expect($('format-audio').value).toBe('140');
    expect($('format-details').textContent).toContain('2 MiB');
    $('download-form').requestSubmit();
    await vi.waitFor(() =>
      expect(api.addDownloads).toHaveBeenCalledWith({
        urls: ['https://example.com/video'],
        options: { quality: 'best', formatId: '137+140' },
      }),
    );
    $('video-urls').value = 'https://example.com/other';
    $('video-urls').dispatchEvent(new Event('input'));
    expect($('format-controls').hidden).toBe(true);
    expect($('format-select').options).toHaveLength(0);
  });

  it('keeps source-specific formats out of a batch and describes disk reserve limits', async () => {
    const { api } = await boot({
      diskSpace: { available: true, free: 1100 * 1024 ** 2, total: 10 * 1024 ** 3 },
    });
    $('video-urls').value = 'https://example.com/video';
    api.previewDownload.mockResolvedValue(
      ok({
        formats: [
          { formatId: '18', hasAudio: true, hasVideo: true, filesizeApprox: 100 * 1024 ** 2 },
        ],
      }),
    );
    $('preview-button').click();
    await vi.waitFor(() => expect($('format-select').options.length).toBe(2));
    $('format-select').value = '18';
    $('format-select').dispatchEvent(new Event('change'));
    expect($('format-details').textContent).toContain('configured reserve');
    $('video-urls').value += '\nhttps://example.com/two';
    $('download-form').requestSubmit();
    expect(api.addDownloads).not.toHaveBeenCalled();
    expect($('urls-error').textContent).toContain('one video link');
  });

  it('validates subtitles and includes caption and per-download bandwidth choices', async () => {
    const { api } = await boot();
    $('video-urls').value = 'https://example.com/video';
    $('subtitles').checked = true;
    $('subtitles').dispatchEvent(new Event('change'));
    $('subtitle-lang').value = 'fi,en';
    $('subtitle-auto').checked = true;
    $('download-rate').value = '256';
    $('download-form').requestSubmit();
    await vi.waitFor(() =>
      expect(api.addDownloads).toHaveBeenCalledWith({
        urls: ['https://example.com/video'],
        options: {
          quality: 'best',
          subtitles: true,
          subtitleLang: 'fi,en',
          subtitleAuto: true,
          rateLimitKbps: 256,
        },
      }),
    );
    await vi.waitFor(() => expect($('add-downloads').disabled).toBe(false));
    $('video-urls').value = 'https://example.com/other';
    $('subtitle-lang').value = 'en; bad';
    $('download-form').requestSubmit();
    expect(api.addDownloads).toHaveBeenCalledTimes(1);
    expect($('subtitle-lang').getAttribute('aria-invalid')).toBe('true');
  });

  it('clears original retry format, captions and rate when the user removes them', async () => {
    const { api } = await boot({
      queue: {
        queue: [],
        history: [
          job('failed', 'failed', {
            options: {
              quality: '720',
              formatId: '137+140',
              subtitles: true,
              subtitleAuto: true,
              subtitleLang: 'fi',
              rateLimitKbps: 64,
            },
          }),
        ],
      },
    });
    document.querySelector('[data-action="retryOptions"]').click();
    expect($('retry-format').value).toBe('137+140');
    expect($('retry-subtitles').checked).toBe(true);
    $('retry-format').value = '';
    $('retry-subtitles').checked = false;
    $('retry-rate').value = '0';
    $('retry-form').requestSubmit();
    await vi.waitFor(() =>
      expect(api.retryDownload).toHaveBeenCalledWith({
        id: 'failed',
        options: { quality: '720', subtitles: false },
      }),
    );
  });

  it('searches and selects playlist ranges, then retrieves the next page using absolute indexes', async () => {
    const { api } = await boot();
    $('video-urls').value = 'https://example.com/list';
    const page = (start) => ({
      previewId: `page-${start}`,
      start,
      pageSize: 500,
      hasMore: start === 1,
      title: 'List',
      entries: [
        { index: start, title: 'Alpha', url: 'https://example.com/a', available: true },
        { index: start + 1, title: 'Private', url: null, available: false },
        { index: start + 2, title: 'Beta', url: 'https://example.com/b', available: true },
      ],
    });
    api.previewPlaylist.mockImplementation(async ({ start }) => ok(page(start)));
    $('playlist-preview-button').click();
    await vi.waitFor(() => expect($('playlist-list').children.length).toBe(3));
    $('playlist-search').value = 'Beta';
    $('playlist-search').dispatchEvent(new Event('input'));
    $('playlist-select-all').click();
    expect($('playlist-list').querySelectorAll('input:checked')).toHaveLength(1);
    expect($('playlist-next').disabled).toBe(true);
    $('playlist-clear-selection').click();
    $('playlist-next').click();
    await vi.waitFor(() =>
      expect(api.previewPlaylist).toHaveBeenLastCalledWith(
        expect.objectContaining({ start: 501, pageSize: 500 }),
      ),
    );
    await vi.waitFor(() => expect($('playlist-page').textContent).toContain('501–503'));
    $('playlist-range').value = '501-503';
    $('playlist-apply-range').click();
    expect($('playlist-list').querySelectorAll('input:checked')).toHaveLength(2);
    $('playlist-add-selected').click();
    await vi.waitFor(() =>
      expect(api.addPlaylistSelection).toHaveBeenCalledWith({
        previewId: 'page-501',
        indices: [501, 503],
        options: { quality: 'best' },
      }),
    );
  });

  it('rejects out-of-page ranges and keeps selections while filtering a playlist', async () => {
    const { api } = await boot();
    $('video-urls').value = 'https://example.com/list';
    api.previewPlaylist.mockResolvedValue(
      ok({
        previewId: 'p',
        entries: [{ index: 1, title: 'Alpha', available: true, url: 'https://example.com/a' }],
        hasMore: true,
      }),
    );
    $('playlist-preview-button').click();
    await vi.waitFor(() => expect($('playlist-list').children.length).toBe(1));
    $('playlist-range').value = '1-9999999';
    $('playlist-apply-range').click();
    expect($('playlist-error').textContent).toContain('valid entry');
    expect($('playlist-add-selected').disabled).toBe(true);
    $('playlist-range').value = '1';
    $('playlist-apply-range').click();
    $('playlist-search').value = 'missing';
    $('playlist-search').dispatchEvent(new Event('input'));
    expect($('playlist-no-match').hidden).toBe(false);
    expect($('playlist-add-selected').disabled).toBe(false);
    expect($('playlist-next').disabled).toBe(true);
    expect($('playlist-list').querySelector('input').checked).toBe(true);
  });

  it('offers guided setup when managed installation is unavailable and copies the exact safe text', async () => {
    const { api } = await boot({
      tools: { ...goodTools, setup: { tools: [{ tool: 'ffmpeg', managed: false }] } },
    });
    const button = document.querySelector('[data-tool="ffmpeg"][data-tool-action="install"]');
    expect(button.textContent).toBe('Setup instructions');
    api.toolAction.mockResolvedValue(
      ok({
        tools: goodTools,
        result: {
          status: 'guided',
          command: 'brew install ffmpeg',
          url: 'https://ffmpeg.org/download.html',
        },
      }),
    );
    button.click();
    await vi.waitFor(() => expect($('tool-setup').hidden).toBe(false));
    expect(api.toolAction).toHaveBeenCalledWith({ tool: 'ffmpeg', action: 'install' });
    $('tool-setup').querySelector('[data-copy-command]').click();
    await vi.waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('brew install ffmpeg'),
    );
    $('tool-setup').querySelector('[data-setup-url]').click();
    await vi.waitFor(() =>
      expect(api.openExternal).toHaveBeenCalledWith('https://ffmpeg.org/download.html'),
    );
  });

  it('explains component compatibility in Finnish without claiming a live YouTube test', async () => {
    const { api } = await boot({ settings: { downloadPath: '/downloads', language: 'fi' } });
    api.toolAction.mockResolvedValue(
      ok({
        tools: goodTools,
        result: {
          ejs: {
            status: 'compatible',
            version: '1.2.3',
            runtime: 'deno',
            liveChallengeTested: false,
          },
          ffprobe: { available: false },
        },
      }),
    );
    $('diagnose-tools').click();
    await vi.waitFor(() => expect($('ejs-status').textContent).toContain('yhteensopivia'));
    expect($('tool-setup').textContent).toContain('Varsinaista YouTube-latausta ei ole testattu');
    expect($('tool-setup').textContent).toContain('ffprobe');
  });

  it('renders manual app updates and release notes safely without offering unsupported installation', async () => {
    const { api } = await boot();
    api.appUpdate.mockResolvedValue(
      ok({
        status: 'manual',
        version: '2.1.0',
        canInstall: false,
        releaseUrl: 'https://github.com/miikkij/VideoNinja/releases',
        releaseNotes: '<img src=x onerror=bad()>',
      }),
    );
    $('app-update-check').click();
    await vi.waitFor(() => expect($('app-update-status').textContent).toContain('release page'));
    expect($('app-update-download').hidden).toBe(true);
    expect($('app-update-install').hidden).toBe(true);
    expect($('release-notes-text').querySelector('img')).toBeNull();
    expect($('release-notes-text').textContent).toContain('<img');
    $('app-update-release').click();
    await vi.waitFor(() =>
      expect(api.openExternal).toHaveBeenCalledWith(
        'https://github.com/miikkij/VideoNinja/releases',
      ),
    );
  });

  it('uses real update progress and blocks restart until active downloads are paused', async () => {
    const { api, events } = await boot({
      queue: { queue: [job('active', 'downloading')], history: [] },
    });
    events.onAppUpdate({ status: 'downloading', progress: 37 });
    expect($('app-update-progress').value).toBe(37);
    expect($('app-update-progress').hidden).toBe(false);
    events.onAppUpdate({ status: 'downloading' });
    expect($('app-update-progress').hasAttribute('value')).toBe(false);
    events.onAppUpdate({ status: 'downloaded', canInstall: true });
    expect($('app-update-install').disabled).toBe(true);
    events.onState({ queue: [job('active', 'paused')], history: [] });
    expect($('app-update-install').disabled).toBe(false);
    api.appUpdate.mockResolvedValue(ok({ status: 'downloaded', canInstall: true }));
    $('app-update-install').click();
    await vi.waitFor(() => expect(api.appUpdate).toHaveBeenCalledWith({ action: 'install' }));
  });

  it.each([
    ['en', 'Installing the update. VideoNinja will restart.'],
    ['fi', 'Päivitystä asennetaan. VideoNinja käynnistyy uudelleen.'],
  ])(
    'keeps update controls busy during native installation in %s and recovers after failure',
    async (language, message) => {
      const { api, events } = await boot({
        settings: { language, downloadPath: '/downloads' },
        appUpdate: { status: 'downloaded', canInstall: true },
      });
      api.appUpdate.mockResolvedValue(ok({ status: 'installing', canInstall: true }));
      $('app-update-install').click();
      await vi.waitFor(() => expect($('app-update-status').textContent).toBe(message));
      for (const id of ['app-update-check', 'app-update-download', 'app-update-install']) {
        expect($(id).disabled).toBe(true);
        $(id).click();
      }
      expect(api.appUpdate).toHaveBeenCalledTimes(1);
      expect($('app-update-progress').hidden).toBe(true);
      events.onAppUpdate({ status: 'error', message: 'Installer failed', canInstall: false });
      expect($('app-update-check').disabled).toBe(false);
      expect($('app-update-install').hidden).toBe(true);
      events.onAppUpdate({ status: 'downloaded', canInstall: true });
      expect($('app-update-install').disabled).toBe(false);
      expect($('app-update-install').hidden).toBe(false);
    },
  );

  it('offers a focused authentication remedy without automatically using account cookies', async () => {
    const { api } = await boot({
      settings: { language: 'fi', downloadPath: '/downloads' },
      queue: {
        queue: [],
        history: [job('auth', 'failed', { errorCode: 'auth', error: 'Login required' })],
      },
    });
    const row = document.querySelector('[data-id="auth"]');
    expect(row.querySelector('.error-area').textContent).toContain('evästelähde');
    row.querySelector('.error-area button').click();
    expect($('retry-dialog').open).toBe(true);
    expect(document.activeElement).toBe($('retry-cookie-source'));
    expect(api.retryDownload).not.toHaveBeenCalled();
    expect(api.saveSettings).not.toHaveBeenCalled();
  });

  it.each(['en', 'fi'])(
    'distinguishes ambiguous access from rate limiting and guides an explicit retry in %s',
    async (language) => {
      const { api } = await boot({
        settings: { language, downloadPath: '/downloads' },
        queue: {
          queue: [],
          history: [
            job('access', 'failed', {
              errorCode: 'access',
              error: 'Requested content is not available, rate-limit reached or login required',
            }),
            job('limited', 'failed', { errorCode: 'rate-limit', error: 'HTTP Error 429' }),
          ],
        },
      });
      const t = window.VideoNinjaI18n.t;
      const access = document.querySelector('[data-id="access"] .error-area');
      const limited = document.querySelector('[data-id="limited"] .error-area');
      expect(access.querySelector('.hint').textContent).toBe(t('remedy_ACCESS'));
      expect(limited.querySelector('.hint').textContent).toBe(t('remedy_RATE_LIMIT'));
      access.querySelector('button').click();
      expect($('retry-guidance').hidden).toBe(false);
      expect($('retry-guidance').textContent).toContain(t('accessBrowserHelp'));
      expect($('retry-cookie-source').value).toBe('');
      expect(document.activeElement).toBe($('retry-cookie-source'));
      expect(api.retryDownload).not.toHaveBeenCalled();
      expect(api.saveSettings).not.toHaveBeenCalled();
      $('retry-copy-source').click();
      await vi.waitFor(() =>
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.com/access'),
      );
      $('retry-update-tools').click();
      expect($('retry-dialog').open).toBe(false);
      expect($('settings-panel').hidden).toBe(false);
      expect(document.activeElement).toBe($('ytdlp-channel'));
      expect(api.toolAction).not.toHaveBeenCalled();
    },
  );

  it('explains cookie locks and encryption without silently clearing authentication', async () => {
    const { api } = await boot({
      queue: {
        queue: [],
        history: [
          job('cookies', 'failed', {
            errorCode: 'cookie-access',
            error: 'Failed to decrypt with DPAPI',
            options: { quality: '720', cookiesFromBrowser: 'chrome' },
          }),
        ],
      },
    });
    document.querySelector('[data-id="cookies"] .error-area button').click();
    expect($('retry-cookie-source').value).toBe('chrome');
    expect($('retry-guidance').textContent).toContain(window.VideoNinjaI18n.t('cookieDecryptHelp'));
    expect($('retry-cookie-help').textContent).toContain('Windows encryption');
    expect(api.retryDownload).not.toHaveBeenCalled();
    $('retry-cookie-source').value = 'file';
    $('retry-cookie-source').dispatchEvent(new Event('change'));
    expect($('retry-cookie-help').textContent).toContain('Mozilla/Netscape');
    api.chooseCookieFile.mockResolvedValue(ok('/session-cookies.txt'));
    $('retry-choose-cookie').click();
    await vi.waitFor(() => expect($('retry-cookie-file').value).toBe('/session-cookies.txt'));
    $('retry-form').requestSubmit();
    await vi.waitFor(() =>
      expect(api.retryDownload).toHaveBeenCalledWith({
        id: 'cookies',
        options: { quality: '720', cookieFile: '/session-cookies.txt', subtitles: false },
      }),
    );
    expect(api.saveSettings).not.toHaveBeenCalled();
  });

  it('opens extractor updates and sends the chosen channel only after an explicit update', async () => {
    const { api } = await boot({
      settings: { language: 'en', downloadPath: '/downloads', ytdlpChannel: 'stable' },
      tools: { ...goodTools, ytdlp: { ...goodTools.ytdlp, stale: true, ageDays: 145 } },
      queue: {
        queue: [],
        history: [
          job('extractor', 'failed', {
            errorCode: 'extractor',
            error: 'Unable to extract response',
          }),
        ],
      },
    });
    document.querySelector('[data-id="extractor"] .error-area button').click();
    expect($('settings-panel').hidden).toBe(false);
    expect($('ytdlp-age-warning').textContent).toContain('145');
    expect(document.activeElement).toBe($('ytdlp-channel'));
    expect($('ytdlp-channel').value).toBe('stable');
    expect(api.toolAction).not.toHaveBeenCalled();
    api.toolAction.mockResolvedValue(
      ok({ tools: goodTools, result: { status: 'installed', tool: 'yt-dlp', version: 'new' } }),
    );
    const update = document.querySelector('[data-tool="yt-dlp"][data-tool-action="update"]');
    update.click();
    await vi.waitFor(() =>
      expect(api.toolAction).toHaveBeenCalledWith({
        tool: 'yt-dlp',
        action: 'update',
        channel: 'stable',
      }),
    );
    await vi.waitFor(() => expect(update.disabled).toBe(false));
    expect($('ytdlp-age-warning').hidden).toBe(true);
    $('ytdlp-channel').value = 'nightly';
    $('ytdlp-channel').dispatchEvent(new Event('change'));
    expect(api.toolAction).toHaveBeenCalledTimes(1);
    update.click();
    await vi.waitFor(() =>
      expect(api.toolAction).toHaveBeenLastCalledWith({
        tool: 'yt-dlp',
        action: 'update',
        channel: 'nightly',
      }),
    );
    expect(api.retryDownload).not.toHaveBeenCalled();
  });

  it('keeps cookie source guidance consistent in settings and per-download overrides', async () => {
    await boot();
    $('cookie-source').value = 'chrome';
    $('cookie-source').dispatchEvent(new Event('change'));
    expect($('cookie-help').textContent).toContain('Windows encryption');
    expect($('download-cookie-help').textContent).toBe($('cookie-help').textContent);
    $('download-cookie-source').value = 'file';
    $('download-cookie-source').dispatchEvent(new Event('change'));
    expect($('download-cookie-help').textContent).toContain('Mozilla/Netscape');
    expect($('cookie-source').value).toBe('chrome');
  });

  it('keeps migrated jobs visible but requires option review before resuming or retrying them', async () => {
    const { api } = await boot({
      settings: { language: 'fi', downloadPath: '/downloads', cookieSource: 'chrome' },
      queue: {
        queue: [
          job('review', 'paused', { optionsNeedReview: true, errorCode: 'options-review' }),
          job('normal', 'paused'),
        ],
        history: [
          job('done-review', 'completed', { optionsNeedReview: true }),
          job('failed-review', 'failed', { optionsNeedReview: true }),
        ],
      },
    });
    const row = document.querySelector('[data-id="review"]');
    expect(row.querySelector('[data-action="resume"]')).toBeNull();
    expect(row.querySelector('[data-action="quickRetry"]')).toBeNull();
    expect(row.querySelector('.error-area').hidden).toBe(false);
    const completed = document.querySelector('[data-id="done-review"]');
    expect(completed.querySelector('[data-action="openFile"]')).not.toBeNull();
    expect(completed.querySelector('[data-action="retryOptions"]')).toBeNull();
    expect(completed.textContent).toContain(window.VideoNinjaI18n.t('savedCompletedOptionsHelp'));
    expect(
      document.querySelector('[data-id="failed-review"] [data-action="quickRetry"]'),
    ).toBeNull();
    $('queue-select-all').click();
    document.querySelector('[data-queue-action="resume"]').click();
    await vi.waitFor(() =>
      expect(api.queueAction).toHaveBeenCalledWith({ action: 'resume', ids: ['normal'] }),
    );
    row.querySelector('[data-action="retryOptions"]').click();
    expect($('retry-description').textContent).toBe(
      window.VideoNinjaI18n.t('retryReviewDescription'),
    );
    expect($('retry-guidance').textContent).toContain(
      window.VideoNinjaI18n.t('savedOptionsReviewHelp'),
    );
    expect($('retry-cookie-source').value).toBe('');
    expect(api.retryDownload).not.toHaveBeenCalled();
    $('retry-form').requestSubmit();
    await vi.waitFor(() =>
      expect(api.retryDownload).toHaveBeenCalledWith({
        id: 'review',
        options: { quality: '1080', subtitles: false },
      }),
    );
  });

  it('distinguishes scheduled pauses and duplicate skips from failures with usable actions', async () => {
    const { api } = await boot({
      queue: {
        queue: [job('scheduled', 'paused', { phase: 'waiting-schedule' })],
        history: [job('duplicate', 'skipped')],
      },
    });
    expect(document.querySelector('[data-id="scheduled"] .download-state').textContent).toContain(
      'scheduled',
    );
    const duplicate = document.querySelector('[data-id="duplicate"]');
    expect(duplicate.textContent).toContain('Already downloaded');
    expect(duplicate.querySelector('[data-action="quickRetry"]')).toBeNull();
    duplicate.querySelector('[data-action="reviewDuplicates"]').click();
    expect(document.activeElement).toBe($('skip-duplicates'));
    expect(api.retryDownload).not.toHaveBeenCalled();
  });

  it.each(['off', 'compatible'])(
    'sends the explicit %s browser mode without changing authentication',
    async (mode) => {
      const { api } = await boot({
        settings: { language: 'en', downloadPath: '/downloads', cookieSource: 'firefox' },
      });
      expect($('browser-mode').value).toBe('auto');
      $('video-urls').value = 'https://example.com/browser-check';
      $('browser-mode').value = mode;
      $('download-form').requestSubmit();
      await vi.waitFor(() =>
        expect(api.addDownloads).toHaveBeenCalledWith({
          urls: ['https://example.com/browser-check'],
          options: { quality: 'best', cookiesFromBrowser: 'firefox', browserMode: mode },
        }),
      );
      expect(api.saveSettings).not.toHaveBeenCalled();
      expect(api.openSource).not.toHaveBeenCalled();
    },
  );

  it.each(['en', 'fi'])(
    'separates browser checks from login and offers an explicit source action in %s',
    async (language) => {
      const { api } = await boot({
        settings: { language, downloadPath: '/downloads', cookieSource: 'chrome' },
        queue: {
          queue: [],
          history: [
            job('challenge', 'failed', {
              errorCode: 'browser-challenge',
              error: '<img src=x onerror=alert(1)> challenge',
              options: { quality: '720', browserMode: 'off' },
            }),
          ],
        },
      });
      const t = window.VideoNinjaI18n.t;
      const row = document.querySelector('[data-id="challenge"]');
      expect(row.querySelector('.hint').textContent).toBe(t('remedy_BROWSER_CHALLENGE'));
      expect(row.querySelector('.error-details').open).toBe(false);
      expect(row.querySelector('img')).toBeNull();
      expect(api.openSource).not.toHaveBeenCalled();
      row.querySelector('[data-action="openSource"]').click();
      await vi.waitFor(() => expect(api.openSource).toHaveBeenCalledWith('challenge'));
      expect(api.openExternal).not.toHaveBeenCalled();
      row.querySelector('.error-area > button').click();
      expect($('retry-dialog').open).toBe(true);
      expect(document.activeElement).toBe($('retry-browser-mode'));
      expect($('retry-browser-mode').value).toBe('off');
      expect($('retry-cookie-source').value).toBe('');
      expect($('retry-error-details').open).toBe(false);
      expect($('retry-guidance').textContent).toContain(t('browserChallengeHelp'));
      $('retry-open-source').click();
      await vi.waitFor(() => expect(api.openSource).toHaveBeenCalledTimes(2));
      expect(api.openSource).toHaveBeenLastCalledWith('challenge');
      expect(api.retryDownload).not.toHaveBeenCalled();
      $('retry-browser-mode').value = 'auto';
      $('retry-form').requestSubmit();
      await vi.waitFor(() =>
        expect(api.retryDownload).toHaveBeenCalledWith({
          id: 'challenge',
          options: { quality: '720', subtitles: false },
        }),
      );
      expect(api.saveSettings).not.toHaveBeenCalled();
    },
  );

  it('keeps technical details closed initially and preserves their open state through queue updates', async () => {
    const failed = job('challenge', 'failed', {
      errorCode: 'browser-challenge',
      error: 'Raw tool error',
    });
    const { events } = await boot({ queue: { queue: [], history: [failed] } });
    const details = document.querySelector('[data-id="challenge"] .error-details');
    expect(details.open).toBe(false);
    details.open = true;
    const summary = details.querySelector('summary');
    summary.tabIndex = 0;
    summary.focus();
    events.onState({ queue: [], history: [{ ...failed, error: 'New raw tool error' }] });
    expect(document.querySelector('[data-id="challenge"] .error-details')).toBe(details);
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(summary);
    expect(details.querySelector('pre').textContent).toBe('New raw tool error');
    document.querySelector('[data-id="challenge"] [data-action="retryOptions"]').click();
    $('retry-error-details').open = true;
    $('close-retry').click();
    document.querySelector('[data-id="challenge"] [data-action="retryOptions"]').click();
    expect($('retry-error-details').open).toBe(false);
  });

  it('offers tool repair for missing browser support and sends a selected retry mode', async () => {
    const { api } = await boot({
      queue: {
        queue: [],
        history: [
          job('support', 'failed', {
            errorCode: 'browser-support',
            error: 'Impersonate target unavailable',
          }),
        ],
      },
    });
    const row = document.querySelector('[data-id="support"]');
    expect(row.querySelector('.hint').textContent).toBe(
      window.VideoNinjaI18n.t('remedy_BROWSER_SUPPORT'),
    );
    expect(row.querySelector('[data-action="openSource"]').hidden).toBe(true);
    api.toolAction.mockResolvedValue(ok({ tools: goodTools, result: {} }));
    row.querySelector('.error-area > button').click();
    await vi.waitFor(() =>
      expect(api.toolAction).toHaveBeenCalledWith({ tool: 'yt-dlp', action: 'diagnose' }),
    );
    row.querySelector('[data-action="retryOptions"]').click();
    expect($('retry-guidance').textContent).toContain(
      window.VideoNinjaI18n.t('browserSupportHelp'),
    );
    $('retry-browser-mode').value = 'compatible';
    $('retry-form').requestSubmit();
    await vi.waitFor(() =>
      expect(api.retryDownload).toHaveBeenCalledWith({
        id: 'support',
        options: { quality: '1080', subtitles: false, browserMode: 'compatible' },
      }),
    );
  });

  it('shows real browser recovery and site cooldown without replaying personality events', async () => {
    const { events } = await boot({
      queue: { queue: [job('active', 'downloading')], history: [] },
    });
    const t = window.VideoNinjaI18n.t;
    const row = document.querySelector('[data-id="active"]');
    events.onProgress({ id: 'active', phase: 'preparing', recovery: { type: 'browser-retry' } });
    expect(row.querySelector('.download-state').textContent).toContain(t('browserRecoveryRetry'));
    events.onState({
      queue: [
        job('active', 'pending', {
          phase: 'waiting-site',
          retryAt: '2026-10-17T12:34:56Z',
          recovery: { type: 'browser-reused' },
        }),
      ],
      history: [],
    });
    const status = row.querySelector('.download-state').textContent;
    expect(status).toContain(t('waiting-site'));
    expect(status).toContain(t('browserRecoveryReused'));
    expect(status).toContain(new Date('2026-10-17T12:34:56Z').toLocaleTimeString('en-GB'));
    expect(document.querySelectorAll('.personality-toast')).toHaveLength(0);
    events.onProgress({ id: 'active', recovery: { type: '<img src=x>' } });
    expect(row.querySelector('.download-state').textContent).not.toContain('<img');
  });

  it('persists tool maintenance opt-in and channel before an explicit check', async () => {
    const { api, events } = await boot();
    expect($('auto-tool-updates').checked).toBe(false);
    expect($('check-tool-maintenance').disabled).toBe(true);
    expect($('ytdlp-channel').value).toBe('nightly');
    expect(api.toolMaintenance).not.toHaveBeenCalled();
    $('auto-tool-updates').checked = true;
    $('auto-tool-updates').dispatchEvent(new Event('change'));
    expect($('check-tool-maintenance').disabled).toBe(false);
    $('ytdlp-channel').value = 'stable';
    $('ytdlp-channel').dispatchEvent(new Event('change'));
    let finish;
    api.toolMaintenance.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    $('check-tool-maintenance').click();
    await vi.waitFor(() => expect(api.toolMaintenance).toHaveBeenCalledWith({ action: 'check' }));
    expect(api.saveSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ autoToolUpdates: true, ytdlpChannel: 'stable' }),
    );
    expect($('check-tool-maintenance').disabled).toBe(true);
    finish(
      ok({
        maintenance: {
          status: 'deferred',
          tools: [
            {
              tool: 'yt-dlp',
              status: 'update-available',
              installedVersion: 'old',
              availableVersion: 'new',
            },
          ],
        },
      }),
    );
    await vi.waitFor(() =>
      expect($('tool-maintenance-status').textContent).toContain(
        window.VideoNinjaI18n.t('maintenance_deferred'),
      ),
    );
    expect($('tool-maintenance-list').textContent).toContain('old');
    expect($('tool-maintenance-list').textContent).toContain('new');
    events.onTools({
      ...goodTools,
      maintenance: { status: 'updating', tools: [{ tool: 'yt-dlp', status: 'updating' }] },
    });
    expect($('check-tool-maintenance').disabled).toBe(true);
    expect($('add-downloads').disabled).toBe(true);
    events.onTools({
      ...goodTools,
      maintenance: { status: 'updated', tools: [{ tool: 'yt-dlp', status: 'updated' }] },
    });
    expect($('check-tool-maintenance').disabled).toBe(false);
    expect($('add-downloads').disabled).toBe(false);
    $('language').value = 'fi';
    $('language').dispatchEvent(new Event('change'));
    expect($('tool-maintenance-status').textContent).toBe(
      window.VideoNinjaI18n.t('maintenance_updated'),
    );
    expect($('ytdlp-channel').value).toBe('stable');
  });

  it('renders maintenance failures as safe expandable details and blocks requests after a failed settings save', async () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const { api } = await boot({
      settings: { language: 'en', downloadPath: '/downloads', autoToolUpdates: true },
      tools: {
        ...goodTools,
        maintenance: {
          status: 'error',
          error: hostile,
          lastCheckedAt: '2026-10-17T10:00:00Z',
          tools: [{ tool: 'yt-dlp', status: 'needs-review', installedVersion: hostile }],
        },
      },
    });
    expect($('tool-maintenance-error').hidden).toBe(false);
    expect($('tool-maintenance-error').open).toBe(false);
    expect($('tool-maintenance-error-text').textContent).toBe(hostile);
    expect($('tool-maintenance-settings').querySelector('img')).toBeNull();
    api.saveSettings.mockResolvedValue({
      ok: false,
      error: { code: 'OPERATION_FAILED', message: 'Cannot save' },
    });
    $('ytdlp-channel').value = 'stable';
    $('ytdlp-channel').dispatchEvent(new Event('change'));
    $('check-tool-maintenance').click();
    await vi.waitFor(() =>
      expect($('settings-save-status').textContent).toBe(window.VideoNinjaI18n.t('saveFailed')),
    );
    await vi.waitFor(() => expect($('check-tool-maintenance').disabled).toBe(false));
    expect(api.toolMaintenance).not.toHaveBeenCalled();
    expect($('notice').classList.contains('is-error')).toBe(true);
  });

  it('clears remembered website compatibility only after an explicit accepted action', async () => {
    const { api } = await boot();
    expect(api.getSiteCompatibility).not.toHaveBeenCalled();
    expect(api.clearSiteCompatibility).not.toHaveBeenCalled();
    expect($('clear-site-compatibility').disabled).toBe(true);
    api.getSiteCompatibility.mockResolvedValue(
      ok([{ origin: 'https://example.com', expiresAt: '2026-10-18T00:00:00Z' }]),
    );
    $('refresh-site-compatibility').click();
    await vi.waitFor(() => expect($('site-compatibility-status').textContent).toContain('1'));
    expect($('clear-site-compatibility').disabled).toBe(false);
    api.clearSiteCompatibility.mockResolvedValueOnce({
      ok: false,
      error: { code: 'OPERATION_FAILED', message: 'Cannot clear' },
    });
    $('clear-site-compatibility').click();
    await vi.waitFor(() => expect($('notice').classList.contains('is-error')).toBe(true));
    expect($('site-compatibility-status').textContent).toContain('1');
    expect($('clear-site-compatibility').disabled).toBe(false);
    api.clearSiteCompatibility.mockResolvedValueOnce(ok([]));
    $('clear-site-compatibility').click();
    await vi.waitFor(() => expect($('site-compatibility-status').textContent).toContain('0'));
    expect(api.clearSiteCompatibility).toHaveBeenLastCalledWith({});
    expect($('clear-site-compatibility').disabled).toBe(true);
    expect(api.saveSettings).not.toHaveBeenCalled();
    expect(api.retryDownload).not.toHaveBeenCalled();
  });

  it('has translations and accessible names for all new static controls in both languages', async () => {
    await boot();
    for (const language of ['en', 'fi']) {
      window.VideoNinjaI18n.setLanguage(language);
      for (const element of document.querySelectorAll('[data-i18n]'))
        expect(element.textContent).not.toBe(element.dataset.i18n);
      for (const field of document.querySelectorAll(
        'input:not([type="checkbox"]),select,textarea',
      )) {
        expect(document.querySelector(`label[for="${field.id}"]`), field.id).not.toBeNull();
      }
    }
  });

  it('lets quality preferences replace an exact format and saves a reusable profile without a URL', async () => {
    const { api } = await boot();
    $('video-urls').value = 'https://example.com/one';
    api.previewDownload.mockResolvedValue(
      ok({ formats: [{ formatId: '18', hasVideo: true, hasAudio: true }] }),
    );
    $('preview-button').click();
    await vi.waitFor(() => expect($('format-select').options.length).toBe(2));
    $('format-select').value = '18';
    $('format-select').dispatchEvent(new Event('change'));
    $('quality').value = '720';
    $('quality').dispatchEvent(new Event('change'));
    expect($('format-select').value).toBe('');
    $('format-select').value = '18';
    $('video-urls').value = '';
    $('profile-name').value = 'Reusable';
    api.saveProfile.mockResolvedValue(ok({ profiles: [] }));
    $('profile-save').click();
    await vi.waitFor(() =>
      expect(api.saveProfile).toHaveBeenCalledWith({
        name: 'Reusable',
        downloadPath: '/downloads',
        options: { quality: '720' },
      }),
    );
  });

  it('repairs a disk error by choosing a folder and opening retry options for that destination', async () => {
    const { api } = await boot({
      queue: {
        queue: [],
        history: [job('disk', 'failed', { errorCode: 'disk-full', error: 'No space' })],
      },
    });
    api.chooseDownloadDirectory.mockResolvedValue(ok('/new-destination'));
    document.querySelector('[data-id="disk"] .error-area button').click();
    await vi.waitFor(() => expect($('retry-dialog').open).toBe(true));
    expect($('retry-destination').textContent).toContain('/new-destination');
    expect(api.retryDownload).not.toHaveBeenCalled();
    $('retry-form').requestSubmit();
    await vi.waitFor(() =>
      expect(api.retryDownload).toHaveBeenCalledWith({
        id: 'disk',
        options: { quality: '1080', subtitles: false },
      }),
    );
    expect(api.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ downloadPath: '/new-destination' }),
    );
  });
});
