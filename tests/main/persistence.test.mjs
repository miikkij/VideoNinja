import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import persistence from '../../src/main/persistence.js';

const {
  sanitizeQueueState,
  sanitizeSettings,
  sanitizeWindowBounds,
  loadPersistedState,
  attachQueuePersistence,
  readConfiguration,
  redactErrorText,
} = persistence;
const job = (id, overrides = {}) => ({
  id,
  url: 'https://example.com/video',
  outputPath: '/tmp',
  options: {},
  status: 'pending',
  progress: 0,
  ...overrides,
});

describe('saved state validation and migration', () => {
  it('preserves bounded integrity details across restart', () => {
    const restored = sanitizeQueueState({
      history: [
        job('verified', {
          status: 'completed',
          integrity: {
            status: 'verified',
            size: 1024,
            duration: 1.5,
            streams: [
              { type: 'video', codec: 'h264' },
              { type: 'audio', codec: 'aac' },
            ],
          },
        }),
        job('basic', {
          status: 'completed',
          integrity: { status: 'size-only', size: 512, warning: 'ffprobe is not installed.' },
        }),
      ],
    });
    expect(restored.history[0].integrity.streams).toEqual([
      { type: 'video', codec: 'h264' },
      { type: 'audio', codec: 'aac' },
    ]);
    expect(restored.history[1].integrity.warning).toBe('ffprobe is not installed.');
  });
  it('migrates legacy presets and active states while preserving paused jobs', () => {
    const restored = sanitizeQueueState(
      {
        queue: [
          job('a', {
            status: 'downloading',
            options: { format: 'bestvideo[height<=4320]+bestaudio/best' },
          }),
          job('b', { status: 'paused' }),
          job(undefined),
        ],
      },
      { idFactory: () => 'generated-id' },
    );
    expect(restored.schemaVersion).toBe(1);
    expect(restored.queue.map((item) => item.status)).toEqual(['pending', 'paused', 'pending']);
    expect(restored.queue[0].options.quality).toBe('2160');
    expect(restored.queue[2].id).toBe('generated-id');
    expect(restored.warnings.join(' ')).toMatch(/legacy/);
  });

  it('rejects corrupt data, unsafe options, duplicate IDs and unexpected versions', () => {
    const restored = sanitizeQueueState({
      schemaVersion: 1,
      queue: [
        job('valid'),
        job('valid'),
        null,
        job('url', { url: 'file:///secret' }),
        job('options', { options: { extraArgs: '--exec command' } }),
        job('array', { options: [] }),
        job(undefined),
      ],
    });
    expect(restored.queue.map((item) => item.id)).toEqual(['valid']);
    expect(restored.warnings).toEqual(['6 invalid, duplicate or excess saved jobs were ignored.']);
    expect(sanitizeQueueState({ schemaVersion: 99, queue: [job('future')] }).queue).toEqual([]);
    expect(sanitizeQueueState({ queue: 'bad', history: {} }).warnings).toHaveLength(2);
  });

  it('bounds pending/history counts, error output, title and numeric progress', () => {
    const restored = sanitizeQueueState(
      {
        queue: Array.from({ length: 8 }, (_, i) => job('q' + i, { progress: 150 })),
        history: Array.from({ length: 8 }, (_, i) =>
          job('h' + i, { status: 'failed', error: 'x'.repeat(9000), title: 't'.repeat(900) }),
        ),
      },
      { maxQueue: 2, maxHistory: 3 },
    );
    expect(restored.queue).toHaveLength(2);
    expect(restored.history).toHaveLength(3);
    expect(restored.queue[0].progress).toBe(100);
    expect(restored.history[0].error).toHaveLength(2000);
    expect(restored.history[0].title).toHaveLength(512);
    expect(restored.warnings.join(' ')).toMatch(/11 invalid/);
  });

  it('routes interrupted cancellation into history instead of restarting it', () => {
    const restored = sanitizeQueueState({ queue: [job('cancel', { status: 'cancelling' })] });
    expect(restored.queue).toEqual([]);
    expect(restored.history[0].status).toBe('cancelled');
    expect(restored.history[0].completedAt).toBeTruthy();
  });

  it('sanitizes settings independently and never forwards arbitrary properties', () => {
    const restored = sanitizeSettings({
      downloadPath: '/tmp/downloads',
      language: 'fi',
      quality: '720',
      jsRuntime: 'bun',
      extraArgs: '--retries 3',
      userAgent: 'agent',
      unsupported: 'private',
      cookieFilePath: 'relative',
    });
    expect(restored).toMatchObject({
      schemaVersion: 1,
      downloadPath: '/tmp/downloads',
      language: 'fi',
      quality: '720',
      jsRuntime: 'auto',
      maxConcurrent: 1,
      extraArgs: '--retries 3',
      userAgent: 'agent',
    });
    expect(sanitizeSettings({ extraArgs: '--exec calc.exe' }).extraArgs).toBeUndefined();
  });

  it('defaults legacy/corrupt concurrency to one and preserves only integers from one to five', () => {
    expect(sanitizeSettings({}).maxConcurrent).toBe(1);
    for (const maxConcurrent of [undefined, null, '3', 0, 6, -1, 2.5, NaN, Infinity])
      expect(sanitizeSettings({ maxConcurrent }).maxConcurrent).toBe(1);
    for (const maxConcurrent of [1, 2, 3, 4, 5])
      expect(sanitizeSettings({ maxConcurrent }).maxConcurrent).toBe(maxConcurrent);
    expect(
      loadPersistedState({ get: (key) => (key === 'settings' ? { maxConcurrent: 4 } : undefined) })
        .settings.maxConcurrent,
    ).toBe(4);
  });

  it('accepts reasonable bounds and discards malformed/off-the-chart geometry', () => {
    expect(
      sanitizeWindowBounds({ width: 800, height: 600, x: -200, y: 80, fullscreen: true }),
    ).toEqual({ width: 800, height: 600, x: -200, y: 80 });
    expect(sanitizeWindowBounds({ width: -10, height: 600 })).toBeUndefined();
    expect(sanitizeWindowBounds(null)).toBeUndefined();
  });

  it('loads all recognized store keys with aggregate diagnostic warnings', () => {
    const data = {
      settings: { schemaVersion: 99, downloadPath: '/tmp' },
      queueState: { queue: [null] },
      windowBounds: { width: 900, height: 700 },
    };
    const saved = loadPersistedState({ get: (key) => data[key] });
    expect(saved.settings.downloadPath).toBeUndefined();
    expect(saved.queueState.queue).toEqual([]);
    expect(saved.windowBounds.width).toBe(900);
    expect(saved.warnings).toHaveLength(2);
  });

  it('redacts legacy diagnostics before returning them to the renderer or persisting again', () => {
    const entry = job('a', {
      status: 'failed',
      outputPath: '/home/alice/private',
      options: { cookieFile: '/tmp/cookies.txt', userAgent: 'Secret Agent' },
      error:
        'Failed https://name:password@example.com/video?token=secret#hash using /tmp/cookies.txt in /home/alice/private as Secret Agent',
    });
    const restored = sanitizeQueueState({ history: [entry] }).history[0].error;
    for (const secret of ['password', 'token', 'secret', '/tmp/cookies', 'alice', 'Secret Agent'])
      expect(restored).not.toContain(secret);
    expect(redactErrorText('Cookie: abc\nAuthorization: Bearer xyz')).not.toContain('abc');
  });
});

describe('durable checkpoint adapter', () => {
  it('writes transitions immediately, ignores progress, deduplicates and detaches', () => {
    const queue = new EventEmitter();
    let state = { schemaVersion: 1, queue: [], history: [] };
    queue.getStateForSave = () => state;
    const store = { set: vi.fn() };
    const adapter = attachQueuePersistence(queue, store);
    queue.emit('queue-updated');
    queue.emit('queue-updated');
    queue.emit('download-progress', { percent: 50 });
    expect(store.set).toHaveBeenCalledTimes(1);
    state = { ...state, queue: [job('a')] };
    queue.emit('queue-updated');
    expect(store.set).toHaveBeenCalledTimes(2);
    adapter.dispose();
    state = { ...state, queue: [] };
    queue.emit('queue-updated');
    expect(store.set).toHaveBeenCalledTimes(2);
  });

  it('reports disk-write failures and retries instead of considering them saved', () => {
    const queue = new EventEmitter();
    queue.getStateForSave = () => ({ schemaVersion: 1, queue: [], history: [] });
    const error = new Error('disk full');
    const store = {
      set: vi.fn().mockImplementationOnce(() => {
        throw error;
      }),
    };
    const onError = vi.fn();
    const adapter = attachQueuePersistence(queue, store, { onError });
    expect(adapter.checkpoint()).toBe(false);
    expect(onError).toHaveBeenCalledWith(error);
    expect(adapter.checkpoint()).toBe(true);
    expect(store.set).toHaveBeenCalledTimes(2);
  });
});

describe('raw configuration recovery', () => {
  const fakeFs = (contents) => ({
    statSync: vi.fn(() => ({ size: contents.length })),
    readFileSync: vi.fn(() => contents),
    renameSync: vi.fn(),
  });

  it('loads valid JSON without moving files and handles a new profile', () => {
    const fs = fakeFs('{"settings":{"language":"fi"}}');
    expect(readConfiguration('/config.json', { fs }).data.settings.language).toBe('fi');
    expect(fs.renameSync).not.toHaveBeenCalled();
    fs.statSync.mockImplementation(() => {
      throw Object.assign(new Error(), { code: 'ENOENT' });
    });
    expect(readConfiguration('/config.json', { fs }).data).toEqual({});
  });

  it.each(['{broken', '[]', 'null'])(
    'preserves corrupt bytes before defaults for %s',
    (contents) => {
      const fs = fakeFs(contents);
      const result = readConfiguration('/config.json', {
        fs,
        now: () => '2026-10-16T01:02:03Z',
        idFactory: () => 'unique',
      });
      expect(result.data).toEqual({});
      expect(result.quarantinedPath).toBe('/config.json.corrupt-2026-10-16T01-02-03Z-unique');
      expect(fs.renameSync).toHaveBeenCalledWith('/config.json', result.quarantinedPath);
      expect(result.warnings).toHaveLength(1);
    },
  );

  it('never treats permission errors or failed quarantine as a fresh profile', () => {
    const fs = fakeFs('broken');
    fs.readFileSync.mockImplementation(() => {
      throw Object.assign(new Error('denied'), { code: 'EACCES' });
    });
    expect(() => readConfiguration('/config.json', { fs })).toThrow('denied');
    expect(fs.renameSync).not.toHaveBeenCalled();
    fs.readFileSync.mockReturnValue('broken');
    fs.renameSync.mockImplementation(() => {
      throw new Error('cannot preserve config');
    });
    expect(() => readConfiguration('/config.json', { fs })).toThrow('cannot preserve');
  });

  it('does not read an oversized file into memory', () => {
    const fs = fakeFs('{}');
    fs.statSync.mockReturnValue({ size: 64 * 1024 * 1024 });
    expect(() => readConfiguration('/config.json', { fs })).toThrow('too large');
    expect(fs.readFileSync).not.toHaveBeenCalled();
    expect(fs.renameSync).not.toHaveBeenCalled();
  });
});
