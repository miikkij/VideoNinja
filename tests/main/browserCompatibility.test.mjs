import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import downloader from '../../src/main/ytdlp.js';
import optionsModule from '../../src/main/downloadOptions.js';
import errors from '../../src/main/downloadErrors.js';
import cacheModule from '../../src/main/siteCompatibility.js';

const root = path.resolve('browser-test-downloads');
const finalFile = path.join(root, 'video.mp4');
const challenge =
  'ERROR: Got HTTP Error 403 due to Cloudflare anti-bot challenge; try generic:impersonate';
const { PROTOCOL, createDownloader } = downloader;
const metadata = {
  title: 'Video',
  id: 'source',
  extractor: 'Generic',
  formats: [{ format_id: 'main', vcodec: 'h264', acodec: 'aac' }],
};

function setup(run, overrides = {}) {
  const save = vi.fn();
  const cache = cacheModule.createSiteCompatibility({ save });
  const tool = {
    available: true,
    path: path.resolve('tools/yt-dlp'),
    version: '2026.10.14',
    jsRuntimes: [],
    impersonation: { available: true, targets: ['Chrome:Windows'] },
    ...overrides,
  };
  const runProcess = vi.fn(run);
  const service = createDownloader({
    tools: {
      checkYtDlpAvailability: async () => tool,
      checkFfmpegAvailability: async () => ({ available: false }),
    },
    runProcess,
    siteCompatibility: cache,
    fs: {
      realpath: async (file) => file,
      stat: async (file) => ({
        isDirectory: () => file === root,
        isFile: () => file !== root,
        size: 1024,
      }),
      access: async () => {},
    },
  });
  return { service, cache, save, tool, runProcess };
}

function succeed(_file, args, handlers) {
  if (args.includes('--flat-playlist'))
    handlers.onStdoutLine(
      `${PROTOCOL.playlist}${JSON.stringify({ type: 'playlist', entries: [] })}`,
    );
  else if (args.includes('--skip-download'))
    handlers.onStdoutLine(`${PROTOCOL.metadata}${JSON.stringify(metadata)}`);
  else handlers.onStdoutLine(`${PROTOCOL.file}${JSON.stringify(finalFile)}`);
  return { code: 0 };
}
function fail(handlers, message = challenge) {
  handlers.onStderrLine(message);
  return { code: 1 };
}

describe('conditional browser compatibility', () => {
  it('accepts only typed modes and keeps raw impersonation/extractor arguments blocked', () => {
    for (const browserMode of ['auto', 'off', 'compatible'])
      expect(optionsModule.normalizeOptions({ browserMode }).browserMode).toBe(browserMode);
    expect(optionsModule.normalizeOptions({})).not.toHaveProperty('browserMode');
    for (const browserMode of ['chrome', true, {}, '--exec'])
      expect(() => optionsModule.normalizeOptions({ browserMode })).toThrow();
    for (const input of [
      { extraArgs: '--impersonate chrome' },
      { extraArgs: '--extractor-args generic:impersonate' },
      { extractorArgs: 'generic:impersonate' },
    ])
      expect(() => optionsModule.normalizeOptions(input)).toThrow();
  });

  it.each(['fetchMetadata', 'fetchPlaylist', 'downloadVideo'])(
    'retries %s once with fixed generic flags and unchanged credentials',
    async (operation) => {
      let attempt = 0;
      const { service, runProcess, cache } = setup((file, args, handlers) =>
        ++attempt === 1 ? fail(handlers) : succeed(file, args, handlers),
      );
      const onRecovery = vi.fn();
      const input = {
        cookiesFromBrowser: 'firefox',
        userAgent: 'Saved agent',
        referer: 'https://example.test/login',
      };
      const control = { signal: new AbortController().signal, onRecovery };
      if (operation === 'downloadVideo')
        expect(
          (
            await service.downloadVideo(
              'https://example.test/private?secret=x',
              root,
              input,
              null,
              control,
            )
          ).success,
        ).toBe(true);
      else await service[operation]('https://example.test/private?secret=x', input, control);
      expect(runProcess).toHaveBeenCalledTimes(2);
      const first = runProcess.mock.calls[0][1],
        second = runProcess.mock.calls[1][1];
      expect(first).not.toContain('generic:impersonate');
      expect(second.slice(0, -4)).toEqual(first.slice(0, -2));
      expect(second.slice(-4)).toEqual([
        '--extractor-args',
        'generic:impersonate',
        '--',
        'https://example.test/private?secret=x',
      ]);
      expect(second).not.toContain('--impersonate');
      expect(onRecovery.mock.calls).toEqual([[{ type: 'browser-retry' }]]);
      expect(cache.list()[0].origin).toBe('https://example.test');
    },
  );

  it('shares the one fallback across preflight, exact format revalidation and download', async () => {
    let calls = 0;
    const { service, runProcess } = setup((file, args, handlers) =>
      ++calls === 1 ? fail(handlers) : succeed(file, args, handlers),
    );
    const control = { signal: new AbortController().signal, onRecovery: vi.fn() };
    await service.fetchMetadata('https://example.test/video', { formatId: 'main' }, control);
    expect(
      (
        await service.downloadVideo(
          'https://example.test/video',
          root,
          { formatId: 'main' },
          null,
          control,
        )
      ).success,
    ).toBe(true);
    expect(runProcess).toHaveBeenCalledTimes(4);
    expect(
      runProcess.mock.calls.slice(1).every(([, args]) => args.includes('generic:impersonate')),
    ).toBe(true);
    expect(control.onRecovery).toHaveBeenCalledTimes(1);
  });

  it('does not spend another fallback when the actual download challenges after recovered metadata', async () => {
    let calls = 0;
    const { service, runProcess } = setup((file, args, handlers) =>
      ++calls === 2 ? succeed(file, args, handlers) : fail(handlers),
    );
    const control = { signal: new AbortController().signal };
    await service.fetchMetadata('https://example.test/video', {}, control);
    const result = await service.downloadVideo(
      'https://example.test/video',
      root,
      {},
      null,
      control,
    );
    expect(result.success).toBe(false);
    expect(errors.classifyDownloadError(result.error).code).toBe('browser-challenge');
    expect(runProcess).toHaveBeenCalledTimes(3);
  });

  it.each([
    'ERROR: HTTP Error 403: Forbidden',
    'ERROR: Login required; use cookies',
    'WARNING: Cloudflare 403\nERROR: Login required',
    'ERROR: HTTP Error 429: Too Many Requests',
  ])('does not retry unrelated failure: %s', async (message) => {
    const { service, runProcess, cache } = setup((_file, _args, handlers) =>
      fail(handlers, message),
    );
    await expect(service.fetchMetadata('https://example.test', {})).rejects.toThrow();
    expect(runProcess).toHaveBeenCalledTimes(1);
    expect(cache.list()).toEqual([]);
  });

  it('off never retries or reuses a remembered preference', async () => {
    const { service, cache, runProcess } = setup((_file, _args, handlers) => fail(handlers));
    cache.remember('https://example.test', '2026.10.14');
    await expect(
      service.fetchMetadata('https://example.test', { browserMode: 'off' }),
    ).rejects.toMatchObject({ downloadCode: 'browser-challenge' });
    expect(runProcess).toHaveBeenCalledTimes(1);
    expect(runProcess.mock.calls[0][1]).not.toContain('generic:impersonate');
  });

  it('reports absent support only when needed; ordinary extraction remains usable', async () => {
    const { service, runProcess } = setup(succeed, { impersonation: { available: false } });
    await service.fetchMetadata('https://example.test');
    await expect(
      service.fetchMetadata('https://example.test', { browserMode: 'compatible' }),
    ).rejects.toMatchObject({ downloadCode: 'browser-support' });
    runProcess.mockImplementation((_file, _args, handlers) => fail(handlers));
    await expect(service.fetchMetadata('https://example.test')).rejects.toMatchObject({
      downloadCode: 'browser-support',
    });
    expect(runProcess).toHaveBeenCalledTimes(2);
  });

  it('explicit compatible mode starts with impersonation and never falls back again', async () => {
    const { service, runProcess } = setup((_file, _args, handlers) => fail(handlers));
    await expect(
      service.fetchMetadata('https://example.test', { browserMode: 'compatible' }),
    ).rejects.toMatchObject({ downloadCode: 'browser-challenge' });
    expect(runProcess).toHaveBeenCalledTimes(1);
    expect(runProcess.mock.calls[0][1].filter((arg) => arg === 'generic:impersonate')).toHaveLength(
      1,
    );
  });

  it('reuses a learned origin once per signal and bypasses it in private mode', async () => {
    const { service, cache, save, runProcess } = setup(succeed);
    cache.remember('https://example.test', '2026.10.14');
    const control = { signal: new AbortController().signal, onRecovery: vi.fn() };
    await service.fetchMetadata('https://example.test/video', {}, control);
    await service.downloadVideo('https://example.test/video', root, {}, null, control);
    expect(control.onRecovery.mock.calls).toEqual([[{ type: 'browser-reused' }]]);
    expect(runProcess.mock.calls.every(([, args]) => args.includes('generic:impersonate'))).toBe(
      true,
    );
    save.mockClear();
    await service.fetchMetadata('https://example.test/private', {}, { private: true });
    expect(runProcess.mock.lastCall[1]).not.toContain('generic:impersonate');
    expect(save).not.toHaveBeenCalled();
  });

  it('private retries work but never learn and callbacks receive no source data', async () => {
    let calls = 0;
    const { service, save } = setup((file, args, handlers) =>
      ++calls === 1 ? fail(handlers) : succeed(file, args, handlers),
    );
    const onRecovery = vi.fn(() => {
      throw new Error('UI callback');
    });
    await service.fetchMetadata(
      'https://example.test/private?token=secret',
      {},
      { private: true, onRecovery },
    );
    expect(onRecovery.mock.calls).toEqual([[{ type: 'browser-retry' }]]);
    expect(save).not.toHaveBeenCalled();
  });

  it('checks cancellation between attempts and never learns from a failed retry', async () => {
    const controller = new AbortController();
    const { service, runProcess, cache } = setup((_file, _args, handlers) => fail(handlers));
    await expect(
      service.fetchMetadata(
        'https://example.test',
        {},
        { signal: controller.signal, onRecovery: () => controller.abort() },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(runProcess).toHaveBeenCalledTimes(1);
    await expect(service.fetchMetadata('https://example.test')).rejects.toMatchObject({
      downloadCode: 'browser-challenge',
    });
    expect(runProcess).toHaveBeenCalledTimes(3);
    expect(cache.list()).toEqual([]);
  });

  it('redacts diagnostics and distinguishes browser challenge/support remedies', async () => {
    const { service } = setup((_file, _args, handlers) =>
      fail(handlers, `${challenge} https://example.test/path?secret=secret`),
    );
    const result = await service.downloadVideo('https://example.test/path?secret=secret', root);
    expect(result.error).not.toContain('secret');
    expect(result.errorCode).toBe('browser-challenge');
    expect(errors.classifyDownloadError(result.error)).toEqual({
      code: 'browser-challenge',
      action: 'check-browser',
      retryable: false,
    });
    expect(errors.classifyDownloadError('Browser impersonation support is unavailable.')).toEqual({
      code: 'browser-support',
      action: 'check-tools',
      retryable: false,
    });
  });
});
