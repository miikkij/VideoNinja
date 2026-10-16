import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import ipc from '../../src/main/ipc.js';

function fixture(
  fetchPlaylist = vi.fn(async () => ({
    title: '<script>playlist</script>',
    entries: [
      { id: 'a', index: 1, title: 'Video A', url: 'https://example.test/a', available: true },
      { id: 'b', index: 2, title: 'Unavailable', url: 'file:///private', available: true },
      { id: 'c', index: 3, title: 'Video C', url: 'https://example.test/c', available: true },
    ],
  })),
) {
  const settings = { downloadPath: path.resolve('test-media'), language: 'en' };
  const queue = {
    getQueueState: vi.fn(() => ({ queue: [] })),
    addBatch: vi.fn((urls) => urls.map((_, i) => 'job-' + i)),
  };
  const api = ipc.createHandlers({
    queue,
    tools: { fetchPlaylist },
    getSettings: () => settings,
    putSettings: vi.fn(),
    fs: { stat: async () => ({ isDirectory: () => true }), access: async () => {} },
  });
  return { ...api, queue, fetchPlaylist };
}

describe('playlist native commands', () => {
  it('previews without enqueueing and only adds selected available entries in source order', async () => {
    const { handlers, queue } = fixture();
    const preview = await handlers.previewPlaylist({
      url: 'https://example.test/list',
      options: {},
    });
    expect(queue.addBatch).not.toHaveBeenCalled();
    expect(preview.entries[1]).toMatchObject({ available: false, url: null });
    expect(preview.maxEntries).toBe(500);
    const ids = await handlers.addPlaylistSelection({
      previewId: preview.previewId,
      indices: [3, 1],
      options: { quality: '720' },
    });
    expect(ids).toEqual(['job-0', 'job-1']);
    expect(queue.addBatch).toHaveBeenCalledWith(
      ['https://example.test/a', 'https://example.test/c'],
      path.resolve('test-media'),
      { quality: '720' },
    );
    await expect(
      handlers.addPlaylistSelection({ previewId: preview.previewId, indices: [1] }),
    ).rejects.toMatchObject({ code: 'PLAYLIST_EXPIRED' });
  });
  it.each([[2], [999], [1, 1], [], ['1']])(
    'rejects invalid/unavailable selection %j atomically',
    async (indices) => {
      const { handlers, queue } = fixture();
      const preview = await handlers.previewPlaylist({ url: 'https://example.test/list' });
      await expect(
        handlers.addPlaylistSelection({ previewId: preview.previewId, indices }),
      ).rejects.toThrow();
      expect(queue.addBatch).not.toHaveBeenCalled();
    },
  );
  it('bounds preview entries and requires a fresh preview after cancellation', async () => {
    const { handlers } = fixture(
      vi.fn(async () => ({
        entries: Array.from({ length: 501 }, (_, i) => ({
          id: String(i),
          title: 'Video',
          url: 'https://example.test/' + i,
          available: true,
        })),
      })),
    );
    const preview = await handlers.previewPlaylist({ url: 'https://example.test/list' });
    expect(preview.entries).toHaveLength(500);
    expect(preview.hasMore).toBe(true);
    handlers.cancelPlaylistPreview();
    await expect(
      handlers.addPlaylistSelection({ previewId: preview.previewId, indices: [1] }),
    ).rejects.toMatchObject({ code: 'PLAYLIST_EXPIRED' });
  });
  it('rejects capacity overflow without consuming a valid preview', async () => {
    const { handlers, queue } = fixture();
    const preview = await handlers.previewPlaylist({ url: 'https://example.test/list' });
    queue.getQueueState.mockReturnValue({ queue: Array(500).fill({}) });
    await expect(
      handlers.addPlaylistSelection({ previewId: preview.previewId, indices: [1] }),
    ).rejects.toMatchObject({ code: 'QUEUE_FULL' });
    expect(queue.addBatch).not.toHaveBeenCalled();
    queue.getQueueState.mockReturnValue({ queue: [] });
    await expect(
      handlers.addPlaylistSelection({ previewId: preview.previewId, indices: [1] }),
    ).resolves.toEqual(['job-0']);
  });
  it.each(['ordinary', 'playlist'])(
    'counts unique resources at capacity for %s batches',
    async (mode) => {
      const urls = ['https://example.test/a#first', 'https://example.test/a#second'];
      const { handlers, queue } = fixture(async () => ({
        entries: urls.map((url, index) => ({ id: String(index), url, available: true })),
      }));
      queue.getQueueState.mockReturnValue({ queue: Array(499).fill({}) });
      if (mode === 'ordinary') {
        await handlers.addDownloads({ urls });
      } else {
        const preview = await handlers.previewPlaylist({ url: 'https://example.test/list' });
        await handlers.addPlaylistSelection({ previewId: preview.previewId, indices: [1, 2] });
      }
      expect(queue.addBatch).toHaveBeenCalledWith(urls, path.resolve('test-media'), {
        quality: 'best',
      });
    },
  );
  it('expires previews after fifteen minutes', async () => {
    const { handlers } = fixture();
    const preview = await handlers.previewPlaylist({ url: 'https://example.test/list' });
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60 * 1000);
    try {
      await expect(
        handlers.addPlaylistSelection({ previewId: preview.previewId, indices: [1] }),
      ).rejects.toMatchObject({ code: 'PLAYLIST_EXPIRED' });
    } finally {
      now.mockRestore();
    }
  });
  it('aborts a pending playlist and awaits cleanup during shutdown', async () => {
    let signal, finish;
    const { handlers, dispose } = fixture((_url, _options, config) => {
      signal = config.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const pending = handlers.previewPlaylist({ url: 'https://example.test/list' });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await Promise.resolve();
    let disposed = false;
    const shutdown = dispose().then(() => {
      disposed = true;
    });
    expect(signal.aborted).toBe(true);
    await Promise.resolve();
    expect(disposed).toBe(false);
    finish({ entries: [] });
    await rejected;
    await shutdown;
  });
  it.each([0, 6, 2.5, '2', null])('rejects invalid concurrency %j before saving', async (value) => {
    const { handlers } = fixture();
    await expect(handlers.saveSettings({ maxConcurrent: value })).rejects.toMatchObject({
      code: 'INVALID_OPTIONS',
    });
  });
});
