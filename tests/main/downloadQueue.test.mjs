import { describe, it, expect, beforeEach, vi } from 'vitest';

// Import DownloadQueue — no module mocking needed, we use dependency injection
const { default: DownloadQueue } = await import('../../src/main/downloadQueue.js');

describe('DownloadQueue', () => {
  let queue;
  let mockDownloadVideo;

  beforeEach(() => {
    mockDownloadVideo = vi.fn(() => new Promise(() => {}));
    queue = new DownloadQueue({ downloadVideo: mockDownloadVideo });
  });

  describe('addDownload', () => {
    it('should add a download and return an id', () => {
      const id = queue.addDownload('https://example.com/video', '/tmp/downloads');
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
    });

    it('should set initial properties', () => {
      const id = queue.addDownload('https://example.com/video', '/tmp');
      const dl = queue.getDownload(id);
      expect(dl).toBeTruthy();
      expect(dl.url).toBe('https://example.com/video');
    });

    it('should store options', () => {
      const id = queue.addDownload('https://example.com/video', '/tmp', { format: 'best' });
      const dl = queue.getDownload(id);
      expect(dl.options.format).toBe('best');
    });

    it('should add multiple downloads to the queue', () => {
      queue.addDownload('https://example.com/v1', '/tmp');
      queue.addDownload('https://example.com/v2', '/tmp');
      expect(queue.getQueueState().queue.length).toBe(2);
    });
  });

  describe('cancelDownload', () => {
    it('should cancel a pending download', () => {
      queue.addDownload('https://example.com/v1', '/tmp');
      const id2 = queue.addDownload('https://example.com/v2', '/tmp');
      const result = queue.cancelDownload(id2);
      expect(result).toBe(true);
    });

    it('should move cancelled download to history', () => {
      queue.addDownload('https://example.com/v1', '/tmp');
      const id2 = queue.addDownload('https://example.com/v2', '/tmp');
      queue.cancelDownload(id2);
      const dl = queue.getDownload(id2);
      expect(dl.status).toBe('cancelled');
    });

    it('should return false for unknown id', () => {
      expect(queue.cancelDownload('nope')).toBe(false);
    });
  });

  describe('getQueueState', () => {
    it('should return state shape', () => {
      const s = queue.getQueueState();
      expect(s).toHaveProperty('queue');
      expect(s).toHaveProperty('history');
      expect(s).toHaveProperty('currentDownload');
      expect(s).toHaveProperty('isProcessing');
    });
  });

  describe('getDownload', () => {
    it('should return null for unknown id', () => {
      expect(queue.getDownload('x')).toBeNull();
    });
  });

  describe('loadState', () => {
    it('should reset downloading items and resume processing', () => {
      queue.loadState({
        queue: [
          { id: '1', url: 'u1', status: 'downloading', progress: 50, outputPath: '/t', options: {} },
          { id: '2', url: 'u2', status: 'pending', progress: 0, outputPath: '/t', options: {} },
        ],
        history: [],
      });
      // loadState resets then calls processNext, so the first item is being processed
      // The second item stays in the queue as pending
      expect(queue.queue.some(d => d.status === 'pending')).toBe(true);
      expect(mockDownloadVideo).toHaveBeenCalled();
    });
  });

  describe('getStateForSave', () => {
    it('should have queue and history', () => {
      const s = queue.getStateForSave();
      expect(s).toHaveProperty('queue');
      expect(s).toHaveProperty('history');
    });
  });

  describe('processNext', () => {
    it('should complete a successful download', async () => {
      mockDownloadVideo.mockResolvedValueOnce({ success: true, filepath: '/tmp/v.mp4', error: null });
      const p = new Promise(r => queue.on('download-completed', r));
      queue.addDownload('https://example.com/video', '/tmp');
      const d = await p;
      expect(d.status).toBe('completed');
      expect(d.filepath).toBe('/tmp/v.mp4');
    });

    it('should call downloadVideo with correct arguments', async () => {
      mockDownloadVideo.mockResolvedValueOnce({ success: true, filepath: '/tmp/v.mp4', error: null });
      const p = new Promise(r => queue.on('download-completed', r));
      queue.addDownload('https://example.com/video', '/tmp', { format: 'mp4' });
      await p;
      expect(mockDownloadVideo).toHaveBeenCalledWith(
        'https://example.com/video',
        '/tmp',
        { format: 'mp4' },
        expect.any(Function)
      );
    });

    it('should handle a failed download result', async () => {
      mockDownloadVideo.mockResolvedValueOnce({ success: false, filepath: null, error: 'err' });
      const p = new Promise(r => queue.on('download-failed', r));
      queue.addDownload('https://example.com/video', '/tmp');
      const d = await p;
      expect(d.status).toBe('failed');
    });

    it('should handle exceptions during download', async () => {
      mockDownloadVideo.mockRejectedValueOnce(new Error('boom'));
      const p = new Promise(r => queue.on('download-failed', r));
      queue.addDownload('https://example.com/video', '/tmp');
      const d = await p;
      expect(d.error).toBe('boom');
    });
  });

  describe('events', () => {
    it('should emit queue-updated on add', () => {
      const fn = vi.fn();
      queue.on('queue-updated', fn);
      queue.addDownload('https://example.com/video', '/tmp');
      expect(fn).toHaveBeenCalled();
    });

    it('should emit download-started when processing begins', () => {
      const fn = vi.fn();
      queue.on('download-started', fn);
      queue.addDownload('https://example.com/video', '/tmp');
      expect(fn).toHaveBeenCalledWith(expect.objectContaining({ status: 'downloading' }));
    });
  });
});
