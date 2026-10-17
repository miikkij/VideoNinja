import { describe, it, expect, vi } from 'vitest';
import DownloadQueue from '../../src/main/downloadQueue.js';
import persistence from '../../src/main/persistence.js';

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

describe('concurrent queue scheduling and atomic batches', () => {
  it('holds all scheduling until the last idempotent admission lock is released', async () => {
    const { queue, runs } = controlledQueue();
    const releaseFirst = queue.holdScheduling();
    const releaseSecond = queue.holdScheduling();
    queue.addDownload(url('held'), '/tmp');
    queue.processNext();
    await flush();
    expect(runs).toHaveLength(0);
    releaseFirst();
    releaseFirst();
    await flush();
    expect(runs).toHaveLength(0);
    releaseSecond();
    await flush();
    expect(runs).toHaveLength(1);
    runs[0].resolve(success);
    await flush();
    await queue.shutdown();
  });

  it('can release a scheduling hold for shutdown without starting pending jobs', async () => {
    const { queue, runs } = controlledQueue();
    const release = queue.holdScheduling();
    queue.addDownload(url('held'), '/tmp');
    release({ start: false });
    await queue.shutdown();
    await flush();
    expect(runs).toHaveLength(0);
    expect(() => queue.holdScheduling()).toThrow(/shutting down/);
  });

  it('starts three independent jobs and fills only a settled slot', async () => {
    const { queue, runs } = controlledQueue({ maxConcurrent: 3 });
    const ids = queue.addBatch(['a', 'b', 'c', 'd', 'e'].map(url), '/tmp');
    await flush();
    expect(runs.map((run) => run.url)).toEqual(['a', 'b', 'c'].map(url));
    expect(new Set(runs.map((run) => run.signal)).size).toBe(3);
    expect(queue.getQueueState()).toMatchObject({
      activeIds: ids.slice(0, 3),
      maxConcurrent: 3,
      isProcessing: true,
      currentDownload: { id: ids[0] },
    });
    runs[1].resolve(success);
    await flush();
    expect(runs).toHaveLength(4);
    expect(runs[3].url).toBe(url('d'));
    expect(queue.getQueueState().activeIds).toEqual([ids[0], ids[2], ids[3]]);
    expect(queue.getDownload(ids[1]).status).toBe('completed');
    expect(queue.getDownload(ids[4]).status).toBe('pending');
  });

  it('keeps a cancelled slot reserved until its child exits without aborting peers', async () => {
    const { queue, runs } = controlledQueue({ maxConcurrent: 3 });
    const ids = queue.addBatch(['a', 'b', 'c', 'd'].map(url), '/tmp');
    const cancelled = vi.fn();
    queue.on('download-cancelled', cancelled);
    await flush();
    queue.cancelDownload(ids[0]);
    expect(runs.map((run) => run.signal.aborted)).toEqual([true, false, false]);
    expect(queue.getQueueState().activeIds).toContain(ids[0]);
    await flush();
    expect(runs).toHaveLength(3);
    runs[0].progress({ percent: 99 });
    runs[0].resolve(success);
    await flush();
    expect(runs).toHaveLength(4);
    expect(runs[3].url).toBe(url('d'));
    expect(queue.getDownload(ids[0])).toMatchObject({ status: 'cancelled', progress: 0 });
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(queue.history).toHaveLength(1);
  });

  it('lowers concurrency without stopping active jobs and raises it immediately', async () => {
    const { queue, runs } = controlledQueue({ maxConcurrent: 3 });
    queue.addBatch(['a', 'b', 'c', 'd', 'e', 'f'].map(url), '/tmp');
    await flush();
    expect(queue.setConcurrency(1)).toBe(1);
    expect(runs.every((run) => !run.signal.aborted)).toBe(true);
    runs[0].resolve(success);
    runs[1].resolve(success);
    await flush();
    expect(runs).toHaveLength(3);
    runs[2].resolve(success);
    await flush();
    expect(runs.map((run) => run.url)).toEqual(['a', 'b', 'c', 'd'].map(url));
    queue.setConcurrency(3);
    await flush();
    expect(runs.map((run) => run.url)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'].map(url));
    expect(queue.getQueueState().activeIds).toHaveLength(3);
  });

  it('validates the concurrency range and supports configuring a deferred restore', async () => {
    const { queue, runs } = controlledQueue();
    expect(queue.getQueueState().maxConcurrent).toBe(1);
    for (const value of [0, 6, -1, 2.5, '3', null, NaN, Infinity])
      expect(() => queue.setConcurrency(value)).toThrow(/between 1 and 5/);
    queue.loadState(
      { queue: [job('a', 'downloading'), job('b'), job('c', 'paused'), job('d')] },
      { start: false },
    );
    queue.setConcurrency(3, { start: false });
    await flush();
    expect(runs).toHaveLength(0);
    queue.processNext();
    await flush();
    expect(runs.map((run) => run.url)).toEqual(['a', 'b', 'd'].map(url));
    expect(queue.getDownload('c').status).toBe('paused');
  });

  it('does not overlap a resumed job with its exiting attempt even when another slot is free', async () => {
    const { queue, runs } = controlledQueue({ maxConcurrent: 3 });
    const [a, b] = queue.addBatch(['a', 'b'].map(url), '/tmp');
    await flush();
    queue.pauseDownload(a);
    queue.resumeDownload(a);
    await flush();
    expect(runs).toHaveLength(2);
    expect(runs[0].signal.aborted).toBe(true);
    expect(runs[1].signal.aborted).toBe(false);
    expect(queue.moveDownload(a, 1)).toBe(false);
    runs[0].reject(new Error('aborted'));
    await flush();
    expect(runs).toHaveLength(3);
    expect(runs[2].url).toBe(url('a'));
    expect(runs[2].signal).not.toBe(runs[0].signal);
    expect(queue.getQueueState().activeIds).toEqual([b, a]);
    expect(queue.history).toEqual([]);
  });

  it('serializes duplicate output keys through cancellation while unrelated URLs fill slots', async () => {
    const { queue, runs } = controlledQueue({ maxConcurrent: 3 });
    const a = queue.addDownload(url('same') + '#first', '/tmp');
    const duplicate = queue.addDownload(url('same') + '#second', '/tmp/child/..');
    const b = queue.addDownload(url('b'), '/tmp');
    const c = queue.addDownload(url('c'), '/tmp');
    await flush();
    expect(runs.map((run) => run.url)).toEqual([url('same') + '#first', url('b'), url('c')]);
    expect(queue.getDownload(duplicate).status).toBe('pending');
    queue.cancelDownload(a);
    runs[1].resolve(success);
    await flush();
    expect(runs).toHaveLength(3);
    expect(queue.getQueueState().activeIds).toEqual([a, c]);
    expect(queue.getDownload(b).status).toBe('completed');
    runs[0].resolve(success);
    await flush();
    expect(runs).toHaveLength(4);
    expect(runs[3].url).toBe(url('same') + '#second');
    expect(queue.getQueueState().activeIds).toEqual([c, duplicate]);
  });

  it('reorders only waiting work while several active jobs continue unchanged', async () => {
    const { queue, runs } = controlledQueue({ maxConcurrent: 3 });
    const ids = queue.addBatch(['a', 'b', 'c', 'd', 'e'].map(url), '/tmp');
    await flush();
    for (const id of ids.slice(0, 3)) expect(queue.moveDownload(id, 4)).toBe(false);
    expect(queue.pauseDownload(ids[3])).toBe(true);
    expect(queue.moveDownload(ids[4], 0)).toBe(true);
    runs[1].resolve(success);
    await flush();
    expect(runs[3].url).toBe(url('e'));
    expect(queue.getDownload(ids[3]).status).toBe('paused');
    expect(runs.every((run) => !run.signal.aborted)).toBe(true);
  });

  it('checkpoints every active job before shutdown and waits for all children', async () => {
    const { queue, runs } = controlledQueue({ maxConcurrent: 3 });
    const ids = queue.addBatch(['a', 'b', 'c', 'd', 'e'].map(url), '/tmp');
    await flush();
    queue.pauseDownload(ids[1]);
    queue.pauseDownload(ids[4]);
    let settled = false;
    const stopping = queue.shutdown();
    void stopping.then(() => {
      settled = true;
    });
    expect(queue.shutdown()).toBe(stopping);
    expect(queue.getStateForSave().queue.map((item) => item.status)).toEqual([
      'pending',
      'paused',
      'pending',
      'pending',
      'paused',
    ]);
    expect(runs.every((run) => run.signal.aborted)).toBe(true);
    expect(() => queue.setConcurrency(5)).toThrow(/shutting down/);
    runs[0].resolve(success);
    runs[1].reject(new Error('aborted'));
    await flush();
    expect(settled).toBe(false);
    expect(queue.getQueueState().activeIds).toEqual([ids[2]]);
    runs[2].resolve(success);
    const saved = await stopping;
    expect(saved.history).toEqual([]);
    expect(runs).toHaveLength(3);
    expect(queue.getQueueState()).toMatchObject({
      activeIds: [],
      isProcessing: false,
      currentDownload: null,
    });
    const restored = controlledQueue({ maxConcurrent: 3 });
    restored.queue.loadState(saved);
    await flush();
    expect(restored.runs.map((run) => run.url)).toEqual(['a', 'c', 'd'].map(url));
    expect(restored.queue.getDownload(ids[1]).status).toBe('paused');
    expect(restored.queue.getDownload(ids[4]).status).toBe('paused');
  });

  it('keeps batch validation, capacity and ID generation atomic', async () => {
    const { queue, runs } = controlledQueue({ maxQueue: 3, idFactory: () => 'same-id' });
    const updated = vi.fn();
    queue.on('queue-updated', updated);
    expect(() => queue.addBatch([url('valid'), 'file:///secret'], '/tmp')).toThrow();
    expect(() => queue.addBatch([url('valid')], '/tmp', { extraArgs: '--exec calc' })).toThrow();
    expect(queue.queue).toEqual([]);
    expect(updated).not.toHaveBeenCalled();
    const ids = queue.addBatch([url('a'), url('a') + '#duplicate', url('b')], '/tmp');
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(updated.mock.calls[0][0].queue.map((item) => item.status)).toEqual([
      'pending',
      'pending',
    ]);
    expect(updated.mock.calls[0][0].queue.map((item) => item.id)).toEqual(ids);
    updated.mockClear();
    expect(() => queue.addBatch([url('c'), url('d')], '/tmp')).toThrow(/full/);
    expect(queue.queue).toHaveLength(2);
    expect(updated).not.toHaveBeenCalled();
    await flush();
    expect(runs).toHaveLength(1);
  });

  it('adds 500 jobs in one complete snapshot before starting a bounded number', async () => {
    const { queue, runs } = controlledQueue({ maxConcurrent: 5 });
    const snapshots = [];
    queue.on('queue-updated', (state) => snapshots.push(state));
    const ids = queue.addBatch(
      Array.from({ length: 500 }, (_, index) => url(index)),
      '/tmp',
    );
    expect(ids).toHaveLength(500);
    expect(snapshots).toHaveLength(6);
    expect(snapshots.every((state) => state.queue.length === 500)).toBe(true);
    expect(snapshots[0].queue.every((item) => item.status === 'pending')).toBe(true);
    await flush();
    expect(runs).toHaveLength(5);
    expect(() => queue.addDownload(url('excess'), '/tmp')).toThrow(/full/);
  });

  it('persists concurrent transitions but never writes individual progress updates', async () => {
    const { queue, runs } = controlledQueue({ maxConcurrent: 3 });
    const store = { set: vi.fn() };
    const adapter = persistence.attachQueuePersistence(queue, store);
    const ids = queue.addBatch(['a', 'b', 'c'].map(url), '/tmp');
    await flush();
    store.set.mockClear();
    for (const run of runs)
      for (let percent = 1; percent <= 100; percent++) run.progress({ percent });
    expect(store.set).not.toHaveBeenCalled();
    queue.pauseDownload(ids[1]);
    expect(store.set).toHaveBeenCalledTimes(1);
    expect(store.set.mock.lastCall[1].queue.map((item) => item.status)).toEqual([
      'downloading',
      'paused',
      'downloading',
    ]);
    expect(store.set.mock.lastCall[1].queue.every((item) => item.progress === 100)).toBe(true);
    adapter.dispose();
  });
});

function controlledQueue(options = {}) {
  const runs = [];
  const downloadVideo = vi.fn((videoUrl, outputPath, downloadOptions, progress, controls) => {
    return new Promise((resolve, reject) =>
      runs.push({
        url: videoUrl,
        outputPath,
        options: downloadOptions,
        progress,
        signal: controls.signal,
        controls,
        resolve,
        reject,
      }),
    );
  });
  const queue = new DownloadQueue({ downloadVideo, ...options });
  return { queue, runs, downloadVideo };
}

function manualClock(initial = new Date(2026, 9, 16, 12).getTime()) {
  let current = initial;
  const timers = new Map();
  const deps = {
    now: () => new Date(current).toISOString(),
    nowMs: () => current,
    setTimeout(callback, delay) {
      const handle = { unref() {} };
      timers.set(handle, { callback, at: current + delay });
      return handle;
    },
    clearTimeout: (handle) => timers.delete(handle),
  };
  return {
    ...deps,
    timers,
    async advance(milliseconds) {
      current += milliseconds;
      for (;;) {
        const ready = [...timers].filter(([, timer]) => timer.at <= current);
        if (!ready.length) break;
        for (const [handle, timer] of ready) {
          if (!timers.delete(handle)) continue;
          timer.callback();
        }
        await flush();
      }
      await flush();
    },
  };
}

const prepared = (id = 'same', size = 100) => ({
  id,
  extractor: 'Fixture',
  title: 'Owned test media',
  filesize: size,
});

describe('site recovery scheduling', () => {
  it('keeps a prior public cooldown when private activity extends the in-memory delay', async () => {
    const clock = manualClock();
    const { queue, runs } = controlledQueue({ ...clock, settings: { retryAttempts: 0 } });
    queue.addDownload(url('public'), '/tmp');
    await flush();
    runs[0].reject(new Error('HTTP Error 429'));
    await flush();
    const publicLimits = queue.getStateForSave().siteLimits;
    queue.configure({ privateMode: true });
    queue.addDownload(url('private'), '/tmp');
    await clock.advance(30000);
    runs[1].reject(new Error('HTTP Error 429'));
    await flush();
    expect(queue.getStateForSave().siteLimits).toEqual(publicLimits);
    expect(queue.getStateForSave().history).toHaveLength(1);
    await queue.shutdown();
  });
  it('preserves the adapter error category even if the displayed diagnostic is redacted', async () => {
    const { queue, runs } = controlledQueue();
    const id = queue.addDownload(url('typed-error'), '/tmp');
    await flush();
    runs[0].resolve({
      success: false,
      errorCode: 'browser-challenge',
      error: '[URL] rejected access.',
    });
    await flush();
    expect(queue.getDownload(id)).toMatchObject({
      status: 'failed',
      errorCode: 'browser-challenge',
      errorAction: 'check-browser',
      retryCount: 0,
    });
    await queue.shutdown();
  });
  it('cools down only the 429 origin, then admits one job there while other origins continue', async () => {
    const clock = manualClock();
    const { queue, runs } = controlledQueue({ ...clock, maxConcurrent: 2 });
    const ids = queue.addBatch(
      [url('limited'), 'https://other.example/a', url('waiting'), 'https://other.example/b'],
      '/tmp',
    );
    await flush();
    runs[0].reject(new Error('HTTP Error 429: Too Many Requests'));
    await flush();
    expect(runs.map((run) => run.url)).toEqual([
      url('limited'),
      'https://other.example/a',
      'https://other.example/b',
    ]);
    expect(queue.getDownload(ids[2])).toMatchObject({ status: 'pending', phase: 'waiting-site' });
    runs[1].resolve(success);
    runs[2].resolve(success);
    await flush();
    await clock.advance(29999);
    expect(runs).toHaveLength(3);
    await clock.advance(1);
    expect(runs).toHaveLength(4);
    expect(runs[3].url).toBe(url('limited'));
    queue.addDownload('https://other.example/c', '/tmp');
    await flush();
    expect(runs[4].url).toBe('https://other.example/c');
    runs[3].resolve(success);
    await flush();
    expect(runs[5].url).toBe(url('waiting'));
    runs[4].resolve(success);
    runs[5].resolve(success);
    await flush();
    await queue.shutdown();
    expect(clock.timers.size).toBe(0);
  });

  it('persists cooldown even when the failed job has no retries left and restores it', async () => {
    const clock = manualClock();
    const first = controlledQueue({ ...clock, settings: { retryAttempts: 0 } });
    first.queue.addBatch([url('failed'), url('waiting')], '/tmp');
    await flush();
    first.runs[0].reject(new Error('HTTP Error 429'));
    await flush();
    const saved = await first.queue.shutdown();
    expect(saved.siteLimits).toHaveLength(1);
    expect(JSON.stringify(saved.siteLimits)).not.toContain('/failed');
    const second = controlledQueue(clock);
    second.queue.loadState(saved);
    await flush();
    expect(second.runs).toHaveLength(0);
    await clock.advance(30000);
    expect(second.runs[0].url).toBe(url('waiting'));
    second.runs[0].resolve(success);
    await flush();
    await second.queue.shutdown();
  });

  it('expires reduced concurrency and does not persist limits caused by private jobs', async () => {
    const clock = manualClock();
    const { queue, runs } = controlledQueue({
      ...clock,
      settings: { retryAttempts: 0, privateMode: true, stallTimeoutSeconds: 3600 },
    });
    queue.addDownload(url('private'), '/tmp');
    await flush();
    runs[0].reject(new Error('HTTP Error 429'));
    await flush();
    expect(queue.getStateForSave().siteLimits).toBeUndefined();
    queue.setConcurrency(3);
    queue.addBatch(['a', 'b', 'c'].map(url), '/tmp');
    await clock.advance(30000);
    expect(runs).toHaveLength(2);
    await clock.advance(15 * 60000);
    expect(runs).toHaveLength(4);
    for (const run of runs.slice(1)) run.resolve(success);
    await flush();
    await queue.shutdown();
  });

  it('carries privacy and a single recovery state across metadata and download without leaking callback input', async () => {
    let preparing;
    const { queue, runs } = controlledQueue({
      settings: { privateMode: true },
      realpath: async (value) => value,
      prepareDownload: async (_url, _options, controls) => {
        preparing = controls;
        controls.onRecovery({ type: 'browser-retry', url: 'do not expose' });
        return prepared();
      },
    });
    const id = queue.addDownload(url('recovery'), '/tmp');
    await flush();
    expect(preparing.private).toBe(true);
    expect(runs[0].controls.private).toBe(true);
    expect(preparing.signal).toBe(runs[0].signal);
    expect(queue.getDownload(id).recovery).toEqual({ type: 'browser-retry' });
    queue.pauseDownload(id);
    runs[0].controls.onRecovery({ type: 'browser-reused' });
    expect(queue.getDownload(id).recovery.type).toBe('browser-retry');
    runs[0].resolve(success);
    await flush();
    await queue.shutdown();
  });
});

describe('automatic retries, watchdogs and scheduling windows', () => {
  it('backs off transient failures twice, lets other jobs run, and then stops', async () => {
    const clock = manualClock();
    const { queue, runs } = controlledQueue({ ...clock, settings: { retryDelaySeconds: 2 } });
    const failed = vi.fn();
    queue.on('download-failed', failed);
    const [a, b] = queue.addBatch(['retry', 'other'].map(url), '/tmp');
    await flush();
    runs[0].reject(new Error('ECONNRESET'));
    await flush();
    expect(queue.getDownload(a)).toMatchObject({
      status: 'pending',
      phase: 'waiting-retry',
      attempts: 1,
      retryCount: 1,
      errorCode: 'network',
      errorAction: 'check-network',
      errorRetryable: true,
    });
    expect(runs[1].url).toBe(url('other'));
    runs[1].resolve(success);
    await flush();
    expect(queue.getDownload(b).status).toBe('completed');
    await clock.advance(1999);
    expect(runs).toHaveLength(2);
    await clock.advance(1);
    runs[2].reject(new Error('HTTP Error 503'));
    await flush();
    await clock.advance(3999);
    expect(runs).toHaveLength(3);
    await clock.advance(1);
    runs[3].reject(new Error('ETIMEDOUT'));
    await flush();
    expect(queue.getDownload(a)).toMatchObject({
      status: 'failed',
      attempts: 3,
      retryCount: 2,
      retryAt: null,
    });
    expect(failed).toHaveBeenCalledTimes(1);
    await clock.advance(60000);
    expect(runs).toHaveLength(4);
  });

  it('never automatically retries permanent authentication failures', async () => {
    const { queue, runs } = controlledQueue();
    const id = queue.addDownload(url('auth'), '/tmp');
    await flush();
    runs[0].reject(new Error('Sign in to confirm your age'));
    await flush();
    expect(queue.getDownload(id)).toMatchObject({
      status: 'failed',
      errorCode: 'auth',
      errorAction: 'update-cookies',
      retryCount: 0,
    });
  });

  it('cancels a scheduled retry and disposes every timer on shutdown', async () => {
    const clock = manualClock();
    const { queue, runs } = controlledQueue(clock);
    const id = queue.addDownload(url('retry'), '/tmp');
    await flush();
    runs[0].reject(new Error('ETIMEDOUT'));
    await flush();
    queue.cancelDownload(id);
    await clock.advance(60000);
    expect(runs).toHaveLength(1);
    await queue.shutdown();
    expect(clock.timers.size).toBe(0);
  });

  it('restores the retry deadline and already-used retry budget after restart', async () => {
    const clock = manualClock();
    const first = controlledQueue(clock);
    const id = first.queue.addDownload(url('restored-retry'), '/tmp');
    await flush();
    first.runs[0].reject(new Error('ECONNRESET'));
    await flush();
    const saved = await first.queue.shutdown();
    const second = controlledQueue({ ...clock, settings: { retryAttempts: 1 } });
    second.queue.loadState(saved);
    await flush();
    expect(second.runs).toHaveLength(0);
    expect(second.queue.getDownload(id).retryCount).toBe(1);
    await clock.advance(15000);
    expect(second.runs).toHaveLength(1);
    second.runs[0].reject(new Error('ECONNRESET'));
    await flush();
    expect(second.queue.getDownload(id)).toMatchObject({ status: 'failed', retryCount: 1 });
  });

  it('times out only after real progress stalls and holds the slot until abort settles', async () => {
    const clock = manualClock();
    const { queue, runs } = controlledQueue({
      ...clock,
      settings: { stallTimeoutSeconds: 30, retryAttempts: 0 },
    });
    const [a, b] = queue.addBatch(['stalled', 'next'].map(url), '/tmp');
    await flush();
    runs[0].progress({ percent: 1, status: 'downloading' });
    await clock.advance(20000);
    runs[0].progress({ percent: 2, status: 'downloading' });
    await clock.advance(20000);
    runs[0].progress({ percent: 2, status: 'downloading' });
    await clock.advance(10000);
    expect(runs[0].signal.aborted).toBe(true);
    expect(runs).toHaveLength(1);
    runs[0].progress({ percent: 99 });
    runs[0].resolve(success);
    await flush();
    expect(queue.getDownload(a)).toMatchObject({
      status: 'failed',
      errorCode: 'stalled',
      progress: 2,
    });
    expect(runs[1].url).toBe(url('next'));
    expect(queue.getDownload(b).status).toBe('downloading');
  });

  it('uses the separate processing timeout after merging starts', async () => {
    const clock = manualClock();
    const { queue, runs } = controlledQueue({
      ...clock,
      settings: { stallTimeoutSeconds: 30, processingTimeoutSeconds: 60 },
    });
    queue.addDownload(url('merging'), '/tmp');
    await flush();
    runs[0].progress({ percent: 100, status: 'merging' });
    await clock.advance(30000);
    expect(runs[0].signal.aborted).toBe(false);
    await clock.advance(30000);
    expect(runs[0].signal.aborted).toBe(true);
    const stopping = queue.shutdown();
    runs[0].reject(new Error('aborted'));
    const saved = await stopping;
    expect(saved.queue[0].status).toBe('pending');
    expect(saved.history).toEqual([]);
  });

  it('accepts advancing bytes when the total size and percentage are unknown', async () => {
    const clock = manualClock();
    const { queue, runs } = controlledQueue({ ...clock, settings: { stallTimeoutSeconds: 30 } });
    queue.addDownload(url('stream'), '/tmp');
    await flush();
    runs[0].progress({ percent: 0, status: 'downloading', downloadedBytes: 100 });
    await clock.advance(20000);
    runs[0].progress({ percent: 0, status: 'downloading', downloadedBytes: 200 });
    await clock.advance(20000);
    expect(runs[0].signal.aborted).toBe(false);
    runs[0].resolve(success);
    await flush();
  });

  it('aborts stalled metadata preparation without releasing its process slot early', async () => {
    const clock = manualClock();
    let resolvePreparation;
    let signal;
    const prepareDownload = vi.fn((_url, _options, context) => {
      signal = context.signal;
      return new Promise((resolve) => {
        resolvePreparation = resolve;
      });
    });
    const { queue, runs } = controlledQueue({
      ...clock,
      prepareDownload,
      settings: { stallTimeoutSeconds: 30, retryAttempts: 0 },
    });
    const id = queue.addDownload(url('metadata'), '/tmp');
    await flush();
    await clock.advance(30000);
    expect(signal.aborted).toBe(true);
    expect(queue.getQueueState().activeIds).toContain(id);
    resolvePreparation(prepared());
    await flush();
    expect(runs).toHaveLength(0);
    expect(queue.getDownload(id)).toMatchObject({ status: 'failed', errorCode: 'stalled' });
  });

  it('waits for an overnight window, pauses at its end and resumes only scheduled pauses', async () => {
    const clock = manualClock(new Date(2026, 9, 16, 21, 59).getTime());
    const { queue, runs } = controlledQueue({
      ...clock,
      maxConcurrent: 2,
      settings: { scheduleEnabled: true, scheduleStart: '22:00', scheduleEnd: '06:00' },
    });
    const [a, manual] = queue.addBatch(['scheduled', 'manual'].map(url), '/tmp');
    queue.pauseDownload(manual);
    await flush();
    expect(runs).toHaveLength(0);
    expect(queue.getDownload(a).phase).toBe('waiting-schedule');
    await clock.advance(60000);
    expect(runs).toHaveLength(1);
    // Jumping the wall clock models sleep/wake across the end of the window.
    await clock.advance(8 * 3600000);
    expect(runs[0].signal.aborted).toBe(true);
    expect(queue.getDownload(a)).toMatchObject({ status: 'paused', pausedBySchedule: true });
    runs[0].reject(new Error('aborted'));
    await flush();
    await clock.advance(16 * 3600000);
    expect(runs).toHaveLength(2);
    expect(queue.getDownload(a).pausedBySchedule).toBe(false);
    expect(queue.getDownload(manual)).toMatchObject({ status: 'paused', pausedBySchedule: false });
  });

  it('lets a user take ownership of an automatic schedule pause', async () => {
    const clock = manualClock(new Date(2026, 9, 16, 5, 59).getTime());
    const { queue, runs } = controlledQueue({
      ...clock,
      settings: { scheduleEnabled: true, scheduleStart: '22:00', scheduleEnd: '06:00' },
    });
    const id = queue.addDownload(url('scheduled'), '/tmp');
    await flush();
    await clock.advance(60000);
    expect(queue.pauseDownload(id)).toBe(true);
    runs[0].reject(new Error('aborted'));
    await flush();
    await clock.advance(16 * 3600000);
    expect(runs).toHaveLength(1);
    expect(queue.getDownload(id)).toMatchObject({ status: 'paused', pausedBySchedule: false });
  });
});

describe('disk reservations, source archive and shared bandwidth', () => {
  it('reserves concurrent temporary space on one volume and starts a blocked job later', async () => {
    const clock = manualClock();
    const { queue, runs } = controlledQueue({
      ...clock,
      maxConcurrent: 2,
      settings: { diskReserveMb: 0 },
      prepareDownload: async (value) => prepared(value),
      realpath: async (value) => value,
      getDiskSpace: async () => ({ available: true, free: 300, volumeId: 'volume-a' }),
    });
    const [a, b] = queue.addBatch(['disk-a', 'disk-b'].map(url), '/tmp');
    await flush();
    expect(runs).toHaveLength(1);
    expect(queue.getDownload(b)).toMatchObject({
      phase: 'waiting-disk',
      disk: { reservedBytes: 200, estimatedBytes: 200 },
      errorAction: 'free-space',
    });
    runs[0].resolve(success);
    await flush();
    expect(queue.getDownload(a).status).toBe('completed');
    await clock.advance(30000);
    expect(runs).toHaveLength(2);
    expect(runs[1].url).toBe(url('disk-b'));
  });

  it('keeps the reserve floor and uses a larger temporary-space estimate for audio', async () => {
    const { queue, runs } = controlledQueue({
      settings: { diskReserveMb: 1 },
      prepareDownload: async () => prepared('audio', 100),
      realpath: async (value) => value,
      getDiskSpace: async () => ({ available: true, free: 1024 * 1024 + 250 }),
    });
    const id = queue.addDownload(url('audio'), '/tmp', { quality: 'audio' });
    await flush();
    expect(runs).toHaveLength(0);
    expect(queue.getDownload(id)).toMatchObject({
      phase: 'waiting-disk',
      disk: { estimatedBytes: 300 },
    });
  });

  it('allows independent volumes and explicitly reports unknown disk information', async () => {
    const { queue, runs } = controlledQueue({
      maxConcurrent: 3,
      settings: { diskReserveMb: 0 },
      prepareDownload: async (value) => prepared(value),
      realpath: async (value) => value,
      getDiskSpace: async (folder) =>
        folder === '/unknown'
          ? { available: false, free: null }
          : { available: true, free: 250, volumeId: folder },
    });
    queue.addDownload(url('a'), '/volume-a');
    queue.addDownload(url('b'), '/volume-b');
    const unknown = queue.addDownload(url('c'), '/unknown');
    await flush();
    expect(runs).toHaveLength(3);
    expect(queue.getDownload(unknown).disk).toMatchObject({ available: false, free: null });
  });

  it('conservatively shares reservations when a disk provider cannot identify volumes', async () => {
    const { queue, runs } = controlledQueue({
      maxConcurrent: 2,
      settings: { diskReserveMb: 0 },
      prepareDownload: async (value) => prepared(value),
      realpath: async (value) => value,
      getDiskSpace: async () => ({ free: 250, available: true }),
    });
    queue.addDownload(url('a'), '/folder-a');
    const b = queue.addDownload(url('b'), '/folder-b');
    await flush();
    expect(runs).toHaveLength(1);
    expect(queue.getDownload(b).phase).toBe('waiting-disk');
  });

  it('serializes source aliases and skips the later alias only after verified success', async () => {
    const { queue, runs } = controlledQueue({
      maxConcurrent: 2,
      prepareDownload: async () => prepared(),
      realpath: async () => '/canonical',
      fileExists: async () => true,
    });
    const [a, b] = queue.addBatch([url('watch?v=one'), url('short/one')], '/tmp');
    await flush();
    expect(runs).toHaveLength(1);
    expect(queue.getDownload(b).phase).toBe('waiting-duplicate');
    runs[0].resolve(success);
    await flush();
    expect(runs).toHaveLength(1);
    expect(queue.getDownload(a).status).toBe('completed');
    expect(queue.getDownload(b)).toMatchObject({ status: 'skipped', filepath: success.filepath });
    expect(queue.getStateForSave().archive).toHaveLength(1);
  });

  it('does not archive failed attempts or block an alias permanently after cancellation', async () => {
    const { queue, runs } = controlledQueue({
      maxConcurrent: 2,
      prepareDownload: async () => prepared(),
      realpath: async () => '/canonical',
    });
    const [a, b] = queue.addBatch([url('watch'), url('alias')], '/tmp');
    await flush();
    queue.cancelDownload(a);
    expect(runs).toHaveLength(1);
    runs[0].resolve(success);
    await flush();
    expect(queue.archive).toEqual([]);
    expect(runs).toHaveLength(2);
    expect(queue.getDownload(b).status).toBe('downloading');
  });

  it('restores source aliases from the persisted archive across sessions', async () => {
    const deps = {
      prepareDownload: async () => prepared(),
      realpath: async () => '/canonical',
      fileExists: async () => true,
    };
    const first = controlledQueue(deps);
    first.queue.addDownload(url('original'), '/tmp');
    await flush();
    first.runs[0].resolve(success);
    await flush();
    const saved = await first.queue.shutdown();
    const second = controlledQueue(deps);
    expect(second.queue.loadState(saved)).toEqual([]);
    const id = second.queue.addDownload(url('alias'), '/tmp');
    await flush();
    expect(second.runs).toHaveLength(0);
    expect(second.queue.getDownload(id).status).toBe('skipped');
  });

  it('does not treat generic filename IDs from different source URLs as the same media', async () => {
    const { queue, runs } = controlledQueue({
      prepareDownload: async () => ({ ...prepared('video'), extractor: 'generic' }),
      realpath: async () => '/canonical',
      fileExists: async () => true,
    });
    queue.addDownload('https://one.example/video.mp4', '/tmp');
    await flush();
    runs[0].resolve(success);
    await flush();
    queue.addDownload('https://two.example/video.mp4', '/tmp');
    await flush();
    expect(runs).toHaveLength(2);
  });

  it('downloads missing archived files again and distinguishes output quality and folder', async () => {
    const exists = vi.fn(async () => false);
    const { queue, runs } = controlledQueue({
      prepareDownload: async () => prepared(),
      realpath: async (value) => value,
      fileExists: exists,
    });
    queue.addDownload(url('original'), '/tmp');
    await flush();
    runs[0].resolve(success);
    await flush();
    queue.addDownload(url('alias'), '/tmp');
    await flush();
    expect(exists).toHaveBeenCalledWith(success.filepath);
    expect(runs).toHaveLength(2);
    runs[1].resolve(success);
    await flush();
    exists.mockResolvedValue(true);
    queue.addDownload(url('quality'), '/tmp', { quality: '720' });
    await flush();
    expect(runs).toHaveLength(3);
    runs[2].resolve(success);
    await flush();
    queue.addDownload(url('folder'), '/another');
    await flush();
    expect(runs).toHaveLength(4);
  });

  it('enforces a conservative shared rate and restarts old-rate jobs only after all settle', async () => {
    const { queue, runs } = controlledQueue({
      maxConcurrent: 2,
      settings: { globalRateKbps: 101 },
    });
    const [a, b] = queue.addBatch(['a', 'b', 'c'].map(url), '/tmp');
    await flush();
    expect(runs.map((run) => run.options.rateLimitKbps)).toEqual([50, 50]);
    queue.configure({ globalRateKbps: 30 });
    expect(runs.every((run) => run.signal.aborted)).toBe(true);
    queue.pauseDownload(a); // Taking manual ownership must not bypass the old-rate barrier.
    runs[1].reject(new Error('aborted'));
    await flush();
    expect(runs).toHaveLength(2);
    runs[0].resolve(success);
    await flush();
    expect(runs).toHaveLength(4);
    expect(runs.slice(2).map((run) => run.options.rateLimitKbps)).toEqual([15, 15]);
    expect(queue.getDownload(a).status).toBe('paused');
    expect(queue.getDownload(b).status).toBe('downloading');
    expect(queue.history).toEqual([]);
  });

  it('respects tighter job rates and reduces concurrency for a sub-slot integer rate budget', async () => {
    const { queue, runs } = controlledQueue({ maxConcurrent: 5, settings: { globalRateKbps: 1 } });
    queue.addBatch(['a', 'b'].map(url), '/tmp');
    await flush();
    expect(runs).toHaveLength(1);
    expect(runs[0].options.rateLimitKbps).toBe(1);
    const other = controlledQueue({ maxConcurrent: 2, settings: { globalRateKbps: 100 } });
    other.queue.addDownload(url('slow'), '/tmp', { rateLimitKbps: 10 });
    await flush();
    expect(other.runs[0].options.rateLimitKbps).toBe(10);
  });

  it('waits for old allocations when changing concurrency before applying final settings', async () => {
    const { queue, runs } = controlledQueue({
      maxConcurrent: 1,
      settings: { globalRateKbps: 120 },
    });
    queue.addBatch(['a', 'b', 'c'].map(url), '/tmp');
    await flush();
    expect(runs[0].options.rateLimitKbps).toBe(120);
    queue.setConcurrency(3, { start: false });
    queue.configure({ globalRateKbps: 90 });
    expect(runs[0].signal.aborted).toBe(true);
    await flush();
    expect(runs).toHaveLength(1);
    runs[0].reject(new Error('aborted'));
    await flush();
    expect(runs).toHaveLength(4);
    expect(runs.slice(1).map((run) => run.options.rateLimitKbps)).toEqual([30, 30, 30]);
  });
});

describe('bulk controls and private bounded history', () => {
  it('validates complete bulk selections before cancelling and emits one durable snapshot', async () => {
    const { queue, runs } = controlledQueue({ maxConcurrent: 2 });
    const ids = queue.addBatch(['a', 'b', 'c'].map(url), '/tmp');
    await flush();
    expect(() => queue.bulkAction('cancel', [ids[0], 'missing'])).toThrow(/no longer available/);
    expect(runs.every((run) => !run.signal.aborted)).toBe(true);
    const updated = vi.fn();
    queue.on('queue-updated', updated);
    expect(queue.bulkAction('cancel', ids)).toEqual(ids);
    expect(updated).toHaveBeenCalledTimes(1);
    expect(queue.history).toHaveLength(3);
    expect(queue.getQueueState().activeIds).toHaveLength(2);
    runs.forEach((run) => run.resolve(success));
    await flush();
    expect(queue.getQueueState().activeIds).toEqual([]);
  });

  it('moves a waiting selection in its queue order and pauses/resumes as a batch', async () => {
    const { queue, runs } = controlledQueue();
    const ids = queue.addBatch(['a', 'b', 'c', 'd'].map(url), '/tmp');
    await flush();
    expect(queue.bulkAction('move', [ids[3], ids[1], ids[0]], 0)).toEqual([ids[1], ids[3]]);
    expect(queue.queue.map((job) => job.id)).toEqual([ids[1], ids[3], ids[0], ids[2]]);
    expect(queue.bulkAction('pause', [ids[1], ids[3]])).toEqual([ids[1], ids[3]]);
    expect(queue.bulkAction('resume', [ids[1], ids[3]])).toEqual([ids[1], ids[3]]);
    runs[0].resolve(success);
    await flush();
    expect(runs[1].url).toBe(url('b'));
  });

  it('checks bulk retry capacity before creating any new jobs', () => {
    const { queue } = controlledQueue({ maxQueue: 2 });
    queue.loadState(
      {
        queue: [job('pending', 'paused')],
        history: [job('failed', 'failed'), job('cancelled', 'cancelled')],
      },
      { start: false },
    );
    expect(() => queue.bulkAction('retry', ['failed', 'cancelled'])).toThrow(/full/);
    expect(queue.queue.map((job) => job.id)).toEqual(['pending']);
    expect(queue.bulkAction('retry', ['failed'])).toEqual(['failed']);
    expect(queue.queue).toHaveLength(2);
  });

  it('omits private jobs from every save even after the setting is switched off', async () => {
    const { queue, runs } = controlledQueue({
      prepareDownload: async () => prepared(),
      realpath: async () => '/canonical',
    });
    queue.loadState({ history: [job('public', 'completed')] }, { start: false });
    queue.configure({ privateMode: true });
    const privateId = queue.addDownload(url('secret'), '/tmp', { userAgent: 'private-agent' });
    expect(queue.getStateForSave().queue).toEqual([]);
    queue.configure({ privateMode: false });
    expect(JSON.stringify(queue.getStateForSave())).not.toContain('secret');
    await flush();
    runs[0].resolve(success);
    await flush();
    expect(queue.getDownload(privateId)).toBeNull();
    expect(queue.history.map((job) => job.id)).toEqual(['public']);
    expect(queue.archive).toEqual([]);
  });

  it('preserves the previous public archive through private mode and a restart', async () => {
    const deps = {
      prepareDownload: async () => prepared(),
      realpath: async () => '/canonical',
      fileExists: async () => true,
    };
    const first = controlledQueue(deps);
    first.queue.addDownload(url('public-original'), '/tmp');
    await flush();
    first.runs[0].resolve(success);
    await flush();
    const publicArchive = first.queue.getStateForSave().archive;
    expect(publicArchive).toHaveLength(1);
    first.queue.configure({ privateMode: true, skipDuplicates: false });
    first.queue.addDownload(url('private-download'), '/tmp', { quality: '720' });
    await flush();
    first.runs[1].resolve({ ...success, filepath: '/tmp/private.mp4' });
    await flush();
    const saved = await first.queue.shutdown();
    expect(saved.archive).toEqual(publicArchive);
    expect(JSON.stringify(saved)).not.toContain('private-download');
    const second = controlledQueue({ ...deps, settings: { privateMode: true } });
    second.queue.loadState(saved, { start: false });
    expect(second.queue.getStateForSave().archive).toEqual(publicArchive);
    second.queue.configure({ privateMode: false });
    const alias = second.queue.addDownload(url('public-alias'), '/tmp');
    await flush();
    expect(second.runs).toHaveLength(0);
    expect(second.queue.getDownload(alias).status).toBe('skipped');
  });

  it('deletes selected history and its archive without touching files or pending jobs', async () => {
    const fileExists = vi.fn();
    const { queue } = controlledQueue({ fileExists });
    queue.loadState(
      {
        queue: [job('queued', 'paused')],
        history: [job('a', 'completed', { filepath: '/tmp/a.mp4' }), job('b', 'failed')],
      },
      { start: false },
    );
    queue.archive = [{ key: 'a', filepath: '/tmp/a.mp4', completedAt: new Date().toISOString() }];
    expect(queue.deleteHistory(['a'])).toBe(1);
    expect(queue.history.map((job) => job.id)).toEqual(['b']);
    expect(queue.archive).toEqual([]);
    expect(queue.queue.map((job) => job.id)).toEqual(['queued']);
    expect(fileExists).not.toHaveBeenCalled();
  });

  it('keeps existing history by default and applies opt-in retention to history and archive', () => {
    const clock = manualClock();
    const { queue } = controlledQueue(clock);
    queue.loadState(
      {
        history: [
          job('old', 'completed', { completedAt: '2020-01-01T00:00:00.000Z' }),
          job('recent', 'completed', { completedAt: clock.now() }),
        ],
      },
      { start: false },
    );
    expect(queue.history).toHaveLength(2);
    queue.archive = [{ key: 'old', completedAt: '2020-01-01T00:00:00.000Z' }];
    queue.configure({ historyRetentionDays: 30 });
    expect(queue.history.map((job) => job.id)).toEqual(['recent']);
    expect(queue.archive).toEqual([]);
  });

  it('expires opted-in history while the application is idle without deleting media', async () => {
    const clock = manualClock();
    const { queue } = controlledQueue({ ...clock, settings: { historyRetentionDays: 1 } });
    queue.loadState({ history: [job('recent', 'completed', { completedAt: clock.now() })] });
    expect(queue.history).toHaveLength(1);
    await clock.advance(86400001);
    expect(queue.history).toEqual([]);
    expect(clock.timers.size).toBe(0);
  });

  it('bounds archive bytes in addition to entry count and validates settings atomically', () => {
    const { queue } = controlledQueue();
    queue.archive = Array.from({ length: 10000 }, (_, index) => ({
      key: String(index),
      filepath: '/' + 'x'.repeat(4000),
    }));
    const saved = queue.getStateForSave();
    expect(saved.archive.length).toBeLessThan(1000);
    expect(Buffer.byteLength(JSON.stringify(saved.archive))).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(() => queue.configure({ retryAttempts: 4, scheduleStart: '25:00' })).toThrow();
    expect(queue.settings.retryAttempts).toBe(2);
    expect(() => queue.configure({ globalRateKbps: -1 })).toThrow();
  });
});

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

  it('clears a failed exact format when retrying with a quality preset', () => {
    const { queue } = controlledQueue();
    queue.loadState(
      { history: [job('exact', 'failed', { options: { quality: 'best', formatId: '137+140' } })] },
      { start: false },
    );
    const changed = queue.retryWithOptions('exact', { quality: '720' });
    expect(queue.getDownload(changed).options).toEqual({ quality: '720' });
    const networkOnly = queue.retryWithOptions('exact', { forceIpv4: true });
    expect(queue.getDownload(networkOnly).options.formatId).toBe('137+140');
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

  it('requires explicit option review for restored jobs without losing their queue slot', () => {
    const { queue } = controlledQueue();
    queue.loadState(
      {
        queue: [job('review', 'paused', { optionsNeedReview: true, options: { quality: '720' } })],
        history: [job('old-failure', 'failed', { optionsNeedReview: true })],
      },
      { start: false },
    );
    expect(queue.resumeDownload('review')).toBe(false);
    expect(queue.retryDownload('old-failure')).toBeNull();
    expect(queue.bulkAction('resume', ['review'])).toEqual([]);
    expect(queue.bulkAction('retry', ['old-failure'])).toEqual([]);
    expect(() => queue.retryWithOptions('review', { quality: 'invalid' })).toThrow();
    expect(queue.getDownload('review').optionsNeedReview).toBe(true);
    expect(queue.retryWithOptions('review', { quality: '1080' })).toBe('review');
    expect(queue.queue).toHaveLength(1);
    expect(queue.getDownload('review').optionsNeedReview).toBeUndefined();
    expect(queue.getDownload('review').options.quality).toBe('1080');
    expect(queue.history).toHaveLength(1);
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
