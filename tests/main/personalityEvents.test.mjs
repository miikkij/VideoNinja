import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import personality from '../../src/main/personalityEvents.js';
import DownloadQueue from '../../src/main/downloadQueue.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));
const outputPath = path.resolve('personality-test-downloads');
const success = { success: true, filepath: path.join(outputPath, 'video.mp4') };

function fixture(options = {}) {
  const runs = [];
  const queue = new DownloadQueue({
    maxConcurrent: 3,
    settings: { retryAttempts: 0 },
    downloadVideo: (url, _folder, _options, progress, { signal }) =>
      new Promise((resolve, reject) => runs.push({ url, progress, signal, resolve, reject })),
    ...options,
  });
  const onEvent = vi.fn();
  const bridge = personality.createPersonalityEvents({ queue, onEvent });
  return {
    queue,
    runs,
    onEvent,
    bridge,
    types: () => onEvent.mock.calls.map(([event]) => event.type),
  };
}

describe('transient download personality events', () => {
  it('emits one actual start per parallel job and only definitive completion or failure', async () => {
    const { queue, runs, onEvent, types, bridge } = fixture();
    queue.addBatch(
      ['a', 'b'].map((id) => `https://example.com/${id}`),
      outputPath,
    );
    await flush();
    expect(types()).toEqual([]);
    runs[0].progress({ status: 'preparing', title: 'Sensitive title' });
    runs[0].progress({ status: 'downloading', percent: 0 });
    runs[0].progress({ status: 'downloading', percent: 25 });
    runs[0].progress({ status: 'merging', percent: 100 });
    runs[1].progress({ status: 'merging', percent: 100 });
    expect(types()).toEqual(['started', 'started']);
    runs[1].resolve({ success: false, error: 'Sensitive download error' });
    runs[0].resolve(success);
    await flush();
    expect(types()).toEqual(['started', 'started', 'failed', 'completed']);
    for (const [event] of onEvent.mock.calls) {
      expect(Object.keys(event)).toEqual(['type']);
      expect(Object.isFrozen(event)).toBe(true);
    }
    bridge.dispose();
    await queue.shutdown();
  });

  it('does not repeat a start after pause/resume or an automatic retry wait', async () => {
    const queue = Object.assign(new EventEmitter(), { getQueueState: () => ({ queue: [] }) });
    const onEvent = vi.fn();
    const bridge = personality.createPersonalityEvents({ queue, onEvent });
    for (const status of [
      'downloading',
      'paused',
      'pending',
      'downloading',
      'pending',
      'downloading',
    ]) {
      queue.emit('queue-updated', { queue: [{ id: 'same-job', status }] });
      queue.emit('download-progress', { id: 'same-job', phase: 'downloading' });
    }
    expect(onEvent).toHaveBeenCalledExactlyOnceWith({ type: 'started' });
    queue.emit('download-completed', { id: 'same-job' });
    queue.emit('download-completed', { id: 'same-job' });
    expect(onEvent.mock.calls.map(([event]) => event.type)).toEqual(['started', 'completed']);
    bridge.dispose();
  });

  it('includes generic private outcomes without creating private history', async () => {
    const { queue, runs, onEvent, types, bridge } = fixture({
      settings: { privateMode: true, retryAttempts: 0 },
    });
    queue.addBatch(
      ['private-a', 'private-b'].map((id) => `https://example.com/${id}`),
      outputPath,
    );
    await flush();
    runs[0].progress({ status: 'downloading', title: 'Private title' });
    runs[1].progress({ status: 'downloading' });
    runs[1].resolve({ success: false, error: 'Private diagnostic' });
    runs[0].resolve(success);
    await flush();
    expect(types()).toEqual(['started', 'started', 'failed', 'completed']);
    expect(queue.history).toEqual([]);
    expect(JSON.stringify(onEvent.mock.calls)).not.toMatch(/private|https|title|diagnostic/i);
    bridge.dispose();
    await queue.shutdown();
  });

  it('never turns cancellation or late child completion into a success', async () => {
    const { queue, runs, types, bridge } = fixture();
    const id = queue.addDownload('https://example.com/cancel', outputPath);
    await flush();
    queue.cancelDownload(id);
    runs[0].progress({ status: 'downloading' });
    runs[0].resolve(success);
    await flush();
    expect(types()).toEqual([]);
    bridge.dispose();
    await queue.shutdown();
  });

  it('does not announce archived duplicates that finish during preflight', async () => {
    const { queue, runs, types, bridge } = fixture({
      prepareDownload: async () => ({ id: 'source-id', extractor: 'YouTube' }),
      realpath: async (folder) => folder,
      fileExists: async () => true,
    });
    queue.addDownload('https://example.com/original', outputPath);
    await flush();
    runs[0].resolve(success);
    await flush();
    expect(types()).toEqual(['completed']);
    const duplicate = queue.addDownload('https://example.com/alias', outputPath);
    await flush();
    expect(queue.getDownload(duplicate).status).toBe('skipped');
    expect(runs).toHaveLength(1);
    expect(types()).toEqual(['completed']);
    bridge.dispose();
    await queue.shutdown();
  });

  it('does not replay restored history and releases listeners on disposal', async () => {
    const { queue, onEvent, bridge } = fixture();
    queue.loadState({
      history: ['completed', 'failed'].map((status) => ({
        id: status,
        url: `https://example.com/${status}`,
        outputPath,
        options: {},
        status,
      })),
    });
    expect(onEvent).not.toHaveBeenCalled();
    bridge.dispose();
    bridge.dispose();
    for (const name of [
      'queue-updated',
      'download-progress',
      'download-completed',
      'download-failed',
      'download-cancelled',
      'download-skipped',
    ])
      expect(queue.listenerCount(name)).toBe(0);
    queue.emit('download-completed', { id: 'late' });
    expect(onEvent).not.toHaveBeenCalled();
    await queue.shutdown();
  });

  it('does not let a closed renderer change the download result', async () => {
    const queue = new DownloadQueue({ downloadVideo: async () => success });
    const onEvent = vi.fn(() => {
      throw new Error('renderer destroyed');
    });
    const bridge = personality.createPersonalityEvents({ queue, onEvent });
    const id = queue.addDownload('https://example.com/closing', outputPath);
    await flush();
    expect(queue.getDownload(id).status).toBe('completed');
    expect(onEvent).toHaveBeenCalledExactlyOnceWith({ type: 'completed' });
    bridge.dispose();
    await queue.shutdown();
  });

  it('exposes the exact event subscription through the frozen preload API', () => {
    const ipcRenderer = Object.assign(new EventEmitter(), { invoke: vi.fn() });
    const exposeInMainWorld = vi.fn();
    vm.runInNewContext(readFileSync('src/preload.js', 'utf8'), {
      require: () => ({ ipcRenderer, contextBridge: { exposeInMainWorld } }),
    });
    const [name, api] = exposeInMainWorld.mock.calls[0];
    expect(name).toBe('videoNinja');
    expect(Object.isFrozen(api)).toBe(true);
    const callback = vi.fn();
    const unsubscribe = api.onDownloadEvent(callback);
    const event = { type: 'started' };
    ipcRenderer.emit('video-ninja:download-event', { sender: 'not exposed' }, event);
    expect(callback).toHaveBeenCalledExactlyOnceWith(event);
    unsubscribe();
    expect(ipcRenderer.listenerCount('video-ninja:download-event')).toBe(0);
  });
});
