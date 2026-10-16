import { describe, it, expect, vi } from 'vitest';
import DownloadQueue from '../../src/main/downloadQueue.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));
const success = { success: true, filepath: '/tmp/video.mp4' };
const url = (suffix) => 'https://example.com/' + suffix;
const job = (id, status = 'pending', extra = {}) => ({
  id,
  url: url(id),
  outputPath: '/tmp',
  options: {},
  status,
  progress: 0,
  ...extra,
});

function controlledQueue(options = {}) {
  const runs = [];
  const downloadVideo = vi.fn((videoUrl, outputPath, downloadOptions, progress, { signal }) => {
    return new Promise((resolve, reject) =>
      runs.push({
        url: videoUrl,
        outputPath,
        options: downloadOptions,
        progress,
        signal,
        resolve,
        reject,
      }),
    );
  });
  const queue = new DownloadQueue({ downloadVideo, ...options });
  return { queue, runs, downloadVideo };
}

describe('DownloadQueue lifecycle', () => {
  it('creates unique UUIDs even when the clock does not advance', () => {
    const { queue } = controlledQueue({ now: () => '2026-10-16T00:00:00.000Z' });
    const ids = Array.from({ length: 100 }, (_, index) => queue.addDownload(url(index), '/tmp'));
    expect(new Set(ids).size).toBe(100);
    expect(ids.every((id) => /^[a-f0-9-]{36}$/.test(id))).toBe(true);
    expect(new Set(queue.queue.map((item) => item.addedAt)).size).toBe(1);
  });

  it('does not allow invalid jobs or options into the queue', () => {
    const { queue } = controlledQueue();
    expect(() => queue.addDownload('file:///etc/passwd', '/tmp')).toThrow();
    expect(() => queue.addDownload(url('a'), 'relative')).toThrow();
    expect(() => queue.addDownload(url('a'), '/tmp', { extraArgs: '--exec calc.exe' })).toThrow();
    expect(queue.queue).toHaveLength(0);
  });

  it('passes normalized options and an AbortSignal to the downloader', async () => {
    const { queue, runs } = controlledQueue();
    queue.addDownload(url('a'), '/tmp', { quality: '720' });
    await flush();
    expect(runs[0].options.quality).toBe('720');
    expect(runs[0].signal).toBeInstanceOf(AbortSignal);
    expect(runs[0].signal.aborted).toBe(false);
  });

  it('cancels active A once, waits for its process, and preserves B despite late success', async () => {
    const { queue, runs, downloadVideo } = controlledQueue();
    const completed = vi.fn(),
      cancelled = vi.fn(),
      failed = vi.fn();
    queue
      .on('download-completed', completed)
      .on('download-cancelled', cancelled)
      .on('download-failed', failed);
    const a = queue.addDownload(url('a'), '/tmp');
    const b = queue.addDownload(url('b'), '/tmp');
    await flush();
    expect(queue.cancelDownload(a)).toBe(true);
    expect(runs[0].signal.aborted).toBe(true);
    expect(queue.getStateForSave().history[0].status).toBe('cancelled');
    expect(queue.queue.map((item) => item.id)).toEqual([b]);
    expect(downloadVideo).toHaveBeenCalledTimes(1);
    runs[0].progress({ percent: 99, status: 'downloading' });
    runs[0].resolve(success);
    await flush();
    expect(downloadVideo).toHaveBeenCalledTimes(2);
    expect(runs[1].url).toBe(url('b'));
    expect(queue.getDownload(a).status).toBe('cancelled');
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(completed).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
    runs[1].resolve(success);
    await flush();
    expect(queue.getDownload(b).status).toBe('completed');
    expect(queue.queue).toEqual([]);
  });

  it('can cancel before a deferred process starts', async () => {
    const { queue, downloadVideo } = controlledQueue();
    const a = queue.addDownload(url('a'), '/tmp');
    queue.cancelDownload(a);
    await flush();
    expect(downloadVideo).not.toHaveBeenCalled();
    expect(queue.history).toHaveLength(1);
    expect(queue.isProcessing).toBe(false);
  });

  it('pending cancellation does not affect the active job and is history bounded', async () => {
    const { queue, runs } = controlledQueue({ maxHistory: 3 });
    const a = queue.addDownload(url('a'), '/tmp');
    for (let index = 0; index < 10; index++)
      queue.cancelDownload(queue.addDownload(url(index), '/tmp'));
    await flush();
    expect(queue.queue.map((item) => item.id)).toEqual([a]);
    expect(runs[0].signal.aborted).toBe(false);
    expect(queue.history).toHaveLength(3);
    expect(queue.history.every((item) => item.status === 'cancelled' && item.completedAt)).toBe(
      true,
    );
    expect(queue.cancelDownload('missing')).toBe(false);
  });

  it('pauses active work without terminal history and resumes the same ID only after exit', async () => {
    const { queue, runs } = controlledQueue();
    const a = queue.addDownload(url('a'), '/tmp');
    await flush();
    runs[0].progress({ percent: 45, status: 'downloading' });
    expect(queue.pauseDownload(a)).toBe(true);
    expect(runs[0].signal.aborted).toBe(true);
    expect(queue.getDownload(a).status).toBe('paused');
    expect(queue.getDownload(a).progress).toBe(45);
    expect(queue.history).toEqual([]);
    expect(queue.resumeDownload(a)).toBe(true);
    expect(runs).toHaveLength(1);
    runs[0].reject(new Error('aborted'));
    await flush();
    expect(runs).toHaveLength(2);
    expect(queue.currentDownload.id).toBe(a);
    expect(queue.history).toEqual([]);
    runs[1].resolve(success);
    await flush();
    expect(queue.history.map((item) => item.id)).toEqual([a]);
  });

  it('skips paused jobs and processes pending jobs in reordered order', async () => {
    const { queue, runs } = controlledQueue();
    const a = queue.addDownload(url('a'), '/tmp');
    const b = queue.addDownload(url('b'), '/tmp');
    const c = queue.addDownload(url('c'), '/tmp');
    expect(queue.pauseDownload(b)).toBe(true);
    expect(queue.moveDownload(c, 0)).toBe(true);
    expect(queue.moveDownload(a, 0)).toBe(false);
    expect(queue.moveDownload(c, -1)).toBe(false);
    await flush();
    runs[0].resolve(success);
    await flush();
    expect(runs[1].url).toBe(url('c'));
    runs[1].resolve(success);
    await flush();
    expect(queue.queue.map((item) => item.id)).toEqual([b]);
    expect(queue.isProcessing).toBe(false);
  });

  it('shuts down with a pending checkpoint before abort settles and never starts B', async () => {
    const { queue, runs } = controlledQueue();
    const a = queue.addDownload(url('a'), '/tmp');
    const b = queue.addDownload(url('b'), '/tmp');
    await flush();
    const stopping = queue.shutdown();
    expect(queue.getStateForSave().queue.map((item) => item.status)).toEqual([
      'pending',
      'pending',
    ]);
    expect(runs[0].signal.aborted).toBe(true);
    expect(() => queue.addDownload(url('c'), '/tmp')).toThrow(/shutting down/);
    runs[0].resolve(success);
    const saved = await stopping;
    expect(saved.queue.map((item) => item.id)).toEqual([a, b]);
    expect(saved.history).toEqual([]);
    expect(runs).toHaveLength(1);
    expect(queue.shutdown()).toBe(stopping);
  });

  it('keeps a user-paused job paused through shutdown', async () => {
    const { queue, runs } = controlledQueue();
    const a = queue.addDownload(url('a'), '/tmp');
    await flush();
    queue.pauseDownload(a);
    const stopping = queue.shutdown();
    runs[0].reject(new Error('aborted'));
    const saved = await stopping;
    expect(saved.queue[0].status).toBe('paused');
    expect(saved.history).toEqual([]);
  });

  it('emits progress separately from durable state transitions', async () => {
    const { queue, runs } = controlledQueue();
    const durable = vi.fn(),
      progress = vi.fn();
    queue.on('queue-updated', durable).on('download-progress', progress);
    const a = queue.addDownload(url('a'), '/tmp');
    await flush();
    durable.mockClear();
    for (let percent = 0; percent < 100; percent++)
      runs[0].progress({ percent, status: 'downloading', title: 'Video' });
    expect(progress).toHaveBeenCalledTimes(100);
    expect(durable).not.toHaveBeenCalled();
    expect(queue.getDownload(a).progress).toBe(99);
    runs[0].progress({ percent: 105, status: 'merging' });
    expect(queue.getDownload(a).progress).toBe(100);
    expect(queue.getDownload(a).phase).toBe('merging');
  });

  it('bounds failures and handles rejected downloader promises once', async () => {
    const { queue, runs } = controlledQueue({ maxHistory: 2 });
    const failed = vi.fn();
    queue.on('download-failed', failed);
    for (let index = 0; index < 3; index++) {
      queue.addDownload(url(index), '/tmp');
      await flush();
      runs[index].reject(new Error('x'.repeat(5000)));
      await flush();
    }
    expect(failed).toHaveBeenCalledTimes(3);
    expect(queue.history).toHaveLength(2);
    expect(queue.history[0].error).toHaveLength(2000);
    expect(queue.history.every((item) => item.completedAt)).toBe(true);
  });

  it('requires a usable result path and does not publish false success', async () => {
    const { queue, runs } = controlledQueue();
    const a = queue.addDownload(url('a'), '/tmp');
    await flush();
    runs[0].resolve({ success: true, filepath: null });
    await flush();
    expect(queue.getDownload(a).status).toBe('failed');
  });

  it('uses adapter metadata and retains numeric speed/ETA across merging updates', async () => {
    const { queue, runs } = controlledQueue();
    const a = queue.addDownload(url('a'), '/tmp');
    const progress = vi.fn();
    queue.on('download-progress', progress);
    await flush();
    runs[0].progress({
      type: 'metadata',
      metadata: { title: 'Actual video', duration: 61, id: 'source-id' },
      status: 'downloading',
      percent: 0,
    });
    runs[0].progress({ type: 'progress', percent: 50, speed: 2048, eta: 3, status: 'downloading' });
    runs[0].progress({ type: 'progress', percent: 100, status: 'merging' });
    expect(queue.getDownload(a)).toMatchObject({
      title: 'Actual video',
      speed: 2048,
      eta: 3,
      phase: 'merging',
    });
    expect(progress.mock.lastCall[0].metadata.duration).toBe(61);
    runs[0].resolve({ ...success, metadata: { title: 'Final video', duration: 62 } });
    await flush();
    expect(queue.getDownload(a)).toMatchObject({
      title: 'Final video',
      metadata: { duration: 62 },
      status: 'completed',
    });
    expect(queue.getStateForSave().history[0].metadata.title).toBe('Final video');
  });

  it('returns copies and retries with a fresh ID without changing history', async () => {
    const { queue, runs } = controlledQueue();
    const a = queue.addDownload(url('a'), '/tmp', {
      quality: '720',
      cookiesFromBrowser: 'firefox',
    });
    await flush();
    runs[0].resolve({ success: false, error: 'failed' });
    await flush();
    const snapshot = queue.getDownload(a);
    snapshot.status = 'completed';
    expect(queue.getDownload(a).status).toBe('failed');
    const b = queue.retryWithOptions(a, { forceIpv4: true });
    expect(b).not.toBe(a);
    expect(queue.getDownload(b).options.quality).toBe('720');
    expect(queue.getDownload(b).options.cookiesFromBrowser).toBeUndefined();
    expect(queue.getDownload(b).options.forceIpv4).toBe(true);
    expect(queue.history).toHaveLength(1);
  });

  it('restores validated legacy data, preserves pause, and skips corrupt jobs', async () => {
    const { queue, runs } = controlledQueue();
    const warnings = queue.loadState({
      queue: [job('a', 'downloading'), job('b', 'paused'), { url: 'broken' }],
      history: [],
    });
    await flush();
    expect(warnings.join(' ')).toMatch(/1 invalid/);
    expect(runs[0].url).toBe(url('a'));
    expect(queue.getDownload('b').status).toBe('paused');
    expect(() => queue.loadState({})).toThrow(/running/);
  });

  it('allows deferred restore and applies queue capacity', () => {
    const { queue, downloadVideo } = controlledQueue({ maxQueue: 2 });
    queue.loadState({ queue: [job('a'), job('b')] }, { start: false });
    expect(downloadVideo).not.toHaveBeenCalled();
    expect(() => queue.addDownload(url('c'), '/tmp')).toThrow(/full/);
    expect(queue.getStateForSave().schemaVersion).toBe(1);
  });

  it('exports only redacted history and clearing history leaves queued jobs intact', () => {
    const { queue } = controlledQueue();
    queue.loadState(
      {
        queue: [job('queued', 'paused')],
        history: [
          job('done', 'completed', {
            url: 'https://example.com/watch?token=secret#private',
            options: { cookieFile: '/tmp/auth-cookies.txt', userAgent: 'private' },
            filepath: '/tmp/private/video.mp4',
            error: 'sensitive diagnostic',
          }),
        ],
      },
      { start: false },
    );
    const exported = JSON.stringify(queue.exportHistory());
    expect(exported).toContain('https://example.com/watch');
    for (const secret of ['token', 'secret', 'private', 'cookieFile', 'outputPath', 'error'])
      expect(exported).not.toContain(secret);
    expect(queue.clearHistory()).toBe(1);
    expect(queue.history).toEqual([]);
    expect(queue.queue).toHaveLength(1);
  });
});
