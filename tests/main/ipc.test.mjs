import { describe, it, expect, vi } from 'vitest';
import ipc from '../../src/main/ipc.js';
import path from 'node:path';
import DownloadQueue from '../../src/main/downloadQueue.js';

const { APP_URL, createHandlers, registerIpc, completedFile } = ipc;
const folder = path.resolve('fixture-downloads');

function fixture(overrides = {}) {
  let settings = { downloadPath: folder, language: 'en', quality: 'best', jsRuntime: 'auto' };
  const queue = overrides.queue || {
    addDownload: vi.fn(() => 'new-id'),
    addBatch: vi.fn((urls, outputPath, options) =>
      urls.map((url) => queue.addDownload(url, outputPath, options)),
    ),
    getQueueState: () => ({ queue: [] }),
    cancelDownload: vi.fn(() => true),
    clearHistory: vi.fn(),
    exportHistory: () => [],
    getDownload: vi.fn(),
  };
  const dialog = { showOpenDialog: vi.fn(), showMessageBox: vi.fn(), showSaveDialog: vi.fn() };
  const shell = {
    openPath: vi.fn(async () => ''),
    openExternal: vi.fn(),
    showItemInFolder: vi.fn(),
  };
  const filesystem = {
    stat: vi.fn(async () => ({ isDirectory: () => true })),
    access: vi.fn(),
    writeFile: vi.fn(),
  };
  const { handlers, dispose } = createHandlers({
    queue,
    dialog,
    shell,
    fs: filesystem,
    tools: overrides.tools || {},
    startup: {
      setEnabled: vi.fn(async () => {
        throw new Error('sensitive native path');
      }),
    },
    getSettings: () => settings,
    putSettings: async (value) => {
      settings = value;
    },
    getWindow: () => ({}),
    canHideWindow: overrides.canHideWindow,
    getInitialState: () => ({}),
    recheckTools: () => ({}),
  });
  return { queue, dialog, shell, filesystem, handlers, dispose };
}

describe('main-process commands', () => {
  it('keeps the window reachable when no tray is available', () => {
    const { handlers } = fixture({ canHideWindow: () => false });
    expect(() => handlers.hideWindow()).toThrow(/tray is unavailable/);
  });
  it('validates the whole batch before adding any item', async () => {
    const { handlers, queue } = fixture();
    await expect(
      handlers.addDownloads({ urls: ['https://example.com/ok', 'file:///private'], options: {} }),
    ).rejects.toThrow();
    expect(queue.addDownload).not.toHaveBeenCalled();
  });
  it('uses the selected folder and rejects caller-supplied output paths', async () => {
    const { handlers, queue } = fixture();
    await handlers.addDownloads({
      urls: ['https://example.com/clip'],
      options: { quality: '1440' },
    });
    expect(queue.addDownload).toHaveBeenCalledWith('https://example.com/clip', folder, {
      quality: '1440',
    });
    await expect(
      handlers.addDownloads({ urls: ['https://example.com/clip'], outputPath: '/elsewhere' }),
    ).rejects.toThrow();
  });
  it('rejects unsupported flags and cookie files not chosen by the user', async () => {
    const { handlers, queue } = fixture();
    for (const options of [
      { extraArgs: '--exec arbitrary' },
      { cookieFile: path.resolve('private.txt') },
    ]) {
      await expect(
        handlers.addDownloads({ urls: ['https://example.com/clip'], options }),
      ).rejects.toThrow();
    }
    expect(queue.addDownload).not.toHaveBeenCalled();
  });
  it('requires a native folder selection before settings can change it', async () => {
    const { handlers, dialog } = fixture();
    const selected = path.resolve('another folder');
    await expect(handlers.saveSettings({ downloadPath: selected })).rejects.toThrow();
    dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [selected] });
    expect(await handlers.chooseDownloadDirectory()).toBe(selected);
    expect((await handlers.saveSettings({ downloadPath: selected })).downloadPath).toBe(selected);
  });
  it('reports unavailable folders without adding jobs', async () => {
    const { handlers, filesystem, queue } = fixture();
    filesystem.access.mockRejectedValue(new Error('Access denied'));
    await expect(handlers.addDownloads({ urls: ['https://example.com/a'] })).rejects.toThrow(
      'not writable',
    );
    expect(queue.addDownload).not.toHaveBeenCalled();
  });
  it('does not silently treat a startup error as success', async () => {
    await expect(fixture().handlers.setStartup(true)).rejects.toMatchObject({
      code: 'STARTUP_FAILED',
    });
  });
  it('preserves audio quality and conversion when retrying only network options', async () => {
    const queue = new DownloadQueue({ downloadVideo: () => new Promise(() => {}) });
    queue.history.push({
      id: 'original',
      status: 'failed',
      url: 'https://example.com/audio',
      outputPath: folder,
      options: { quality: 'audio', audioFormat: 'mp3' },
    });
    const { handlers } = fixture({ queue });
    const retry = await handlers.retryDownload({ id: 'original', options: { forceIpv4: true } });
    expect(queue.getDownload(retry).options).toEqual({
      quality: 'audio',
      audioFormat: 'mp3',
      forceIpv4: true,
    });
    const changed = await handlers.retryDownload({ id: 'original', options: { quality: '720' } });
    expect(queue.getDownload(changed).options.quality).toBe('720');
  });
  it('requires explicit history confirmation and never deletes media', async () => {
    const { handlers, dialog, queue } = fixture();
    dialog.showMessageBox
      .mockResolvedValueOnce({ response: 0 })
      .mockResolvedValueOnce({ response: 1 });
    expect(await handlers.clearHistory()).toEqual({ cleared: false });
    expect(queue.clearHistory).not.toHaveBeenCalled();
    expect(await handlers.clearHistory()).toEqual({ cleared: true });
    expect(queue.clearHistory).toHaveBeenCalledTimes(1);
  });
  it('allows only specific public help URLs to open externally', async () => {
    const { handlers, shell } = fixture();
    await expect(handlers.openExternal('https://example.com')).rejects.toThrow();
    await expect(handlers.openExternal('file:///private')).rejects.toThrow();
    await handlers.openExternal('https://github.com/yt-dlp/yt-dlp/wiki/EJS');
    expect(shell.openExternal).toHaveBeenCalledTimes(1);
  });
});

describe('preview shutdown', () => {
  it('awaits both current and superseded process cleanup before disposing', async () => {
    const requests = [];
    const tools = {
      fetchMetadata: vi.fn(
        (_url, _options, { signal }) =>
          new Promise((resolve, reject) => {
            requests.push({ signal, resolve, reject });
          }),
      ),
    };
    const { handlers, dispose } = fixture({ tools });
    const first = handlers
      .previewDownload({ url: 'https://example.com/one' })
      .catch((error) => error);
    await Promise.resolve();
    const second = handlers
      .previewDownload({ url: 'https://example.com/two' })
      .catch((error) => error);
    await Promise.resolve();
    expect(requests[0].signal.aborted).toBe(true);
    expect(requests[1].signal.aborted).toBe(false);
    let disposed = false;
    const disposing = dispose().then(() => {
      disposed = true;
    });
    expect(requests[1].signal.aborted).toBe(true);
    requests[1].reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
    await second;
    expect(disposed).toBe(false);
    requests[0].reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
    await first;
    await disposing;
    expect(disposed).toBe(true);
    await expect(
      handlers.previewDownload({ url: 'https://example.com/new' }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(tools.fetchMetadata).toHaveBeenCalledTimes(2);
  });
});

describe('IPC sender boundary', () => {
  function registered() {
    let request;
    const frame = { url: APP_URL };
    const webContents = { mainFrame: frame };
    const win = { isDestroyed: () => false, webContents };
    const handler = vi.fn(() => 'accepted');
    registerIpc(
      {
        handle: (_name, callback) => {
          request = callback;
        },
      },
      () => win,
      { action: handler },
    );
    return { request, handler, event: { sender: webContents, senderFrame: frame } };
  }
  it('accepts the exact application main frame', async () => {
    const { request, event } = registered();
    expect(await request(event)).toEqual({ ok: true, data: 'accepted' });
  });
  it('rejects foreign contents, subframes and navigated documents', async () => {
    const { request, handler, event } = registered();
    for (const candidate of [
      { ...event, sender: {} },
      { ...event, senderFrame: { url: APP_URL } },
    ]) {
      expect((await request(candidate)).error.code).toBe('FORBIDDEN');
    }
    event.senderFrame.url = 'https://example.com';
    expect((await request(event)).error.code).toBe('FORBIDDEN');
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('completed-file boundary', () => {
  const job = { status: 'completed', outputPath: folder, filepath: path.join(folder, 'film.mp4') };
  it('rejects symlinks that escape the real output directory', async () => {
    await expect(
      completedFile({ getDownload: () => job }, 'id', {
        realpath: async (value) =>
          value === folder ? folder : path.resolve('outside', 'film.mp4'),
      }),
    ).rejects.toThrow('outside');
  });
  it('opens a completed media file, never a downloaded executable', async () => {
    const filesystem = {
      realpath: async (value) => value,
      stat: async () => ({ isFile: () => true }),
    };
    expect(await completedFile({ getDownload: () => job }, 'id', filesystem)).toBe(job.filepath);
    await expect(
      completedFile(
        { getDownload: () => ({ ...job, filepath: path.join(folder, 'run.exe') }) },
        'id',
        filesystem,
      ),
    ).rejects.toThrow('file type');
  });
});
