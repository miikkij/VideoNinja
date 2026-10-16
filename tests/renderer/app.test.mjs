// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const html = readFileSync(resolve('src/renderer/index.html'), 'utf8');
const translations = readFileSync(resolve('src/renderer/i18n.js'), 'utf8');
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
    'openExternal',
  ])
    api[method] = vi.fn(async () => ok(null));
  api.getInitialState = vi.fn(async () => ok(state));
  api.saveSettings = vi.fn(async (input) => ok(input));
  for (const name of ['onState', 'onProgress', 'onDiskSpace', 'onTools', 'onWarnings']) {
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
  // jsdom has no top layer; native Electron dialog behavior is checked by the app smoke suite.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  window.eval(translations);
  window.eval(application);
  await vi.waitFor(() => expect($('loading').hidden).toBe(true));
  return { api, events, state };
}

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
});

describe('production renderer', () => {
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
    resolve(ok(['one', 'two']));
    await vi.waitFor(() => expect($('video-urls').value).toBe(''));
    expect($('notice-message').textContent).toContain('2');
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
    item.querySelector('.error-area button').click();
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
        options: { quality: '720', forceIpv4: true },
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
      expect(api.retryDownload).toHaveBeenCalledWith({ id: 'failed', options: { quality: '720' } }),
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
});
