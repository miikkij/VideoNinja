import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import ipc from '../../src/main/ipc.js';
import persistence from '../../src/main/persistence.js';
import manager from '../../src/main/toolManager.js';
const folder = path.resolve('test-downloads');
function fixture(overrides = {}) {
  let settings = persistence.sanitizeSettings({ downloadPath: folder });
  const queue = {
    getQueueState: () => ({ queue: [], isProcessing: false }),
    addBatch: vi.fn(() => ['new']),
    bulkAction: vi.fn(() => ['job']),
    deleteHistory: vi.fn(() => 1),
    retryWithOptions: vi.fn(() => 'retry'),
  };
  const dialog = { showOpenDialog: vi.fn(), showMessageBox: vi.fn(async () => ({ response: 1 })) };
  const toolManager = {
    getSetupPlan: () => ({ tools: [] }),
    install: vi.fn(async () => ({ status: 'installed' })),
    diagnose: vi.fn(async () => ({ ejs: { status: 'compatible' } })),
  };
  const appUpdater = { action: vi.fn(async () => ({ status: 'idle' })) };
  const tools = {
    fetchPlaylist: vi.fn(async () => ({
      title: 'Page 2',
      start: 501,
      entries: [{ id: '501', title: 'Video', url: 'https://example.com/501', available: true }],
      hasMore: true,
    })),
  };
  const result = ipc.createHandlers({
    queue,
    dialog,
    shell: {},
    getWindow: () => ({}),
    getSettings: () => settings,
    putSettings: async (value) => {
      settings = value;
    },
    startup: {},
    tools,
    toolManager,
    appUpdater,
    fs: { stat: async () => ({ isDirectory: () => true }), access: async () => {} },
    recheckTools: async () => ({}),
    privacyStatus: () => ({ encryptionAvailable: false }),
    ...overrides,
  });
  return { ...result, queue, dialog, toolManager, appUpdater, tools, settings: () => settings };
}
describe('feature IPC validation', () => {
  it('blocks queue mutations during native installation and admits them after failure recovery', async () => {
    let installing = true;
    const { handlers, queue } = fixture({ isInstallingUpdate: () => installing });
    await expect(handlers.addDownloads({ urls: ['https://example.com/v'] })).rejects.toThrow(
      /application update/,
    );
    expect(() => handlers.queueAction({ action: 'cancel', ids: ['job'] })).toThrow(
      /application update/,
    );
    expect(() => handlers.moveDownload({ id: 'job', direction: 'up' })).toThrow(
      /application update/,
    );
    await expect(handlers.deleteHistory({ ids: ['job'] })).rejects.toThrow(/application update/);
    await expect(handlers.clearHistory()).rejects.toThrow(/application update/);
    expect(queue.addBatch).not.toHaveBeenCalled();
    expect(queue.bulkAction).not.toHaveBeenCalled();
    installing = false;
    await handlers.addDownloads({ urls: ['https://example.com/v'] });
    expect(queue.addBatch).toHaveBeenCalledOnce();
  });

  it('rechecks the installation lock after a pending history confirmation', async () => {
    let installing = false,
      answer;
    const { handlers, queue, dialog } = fixture({ isInstallingUpdate: () => installing });
    dialog.showMessageBox.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const deleting = handlers.deleteHistory({ ids: ['job'] });
    const blocked = expect(deleting).rejects.toThrow(/application update/);
    installing = true;
    answer({ response: 1 });
    await blocked;
    expect(queue.deleteHistory).not.toHaveBeenCalled();
  });

  it('rejects invalid preferences and refuses unprotected encryption', async () => {
    const { handlers, settings } = fixture();
    for (const value of [
      { retryAttempts: 99 },
      { globalRateKbps: -1 },
      { notifications: 'yes' },
      { scheduleStart: '25:00' },
      { profiles: [] },
      { autoToolUpdates: 'yes' },
      { ytdlpChannel: 'arbitrary/repository' },
    ])
      await expect(handlers.saveSettings(value)).rejects.toThrow();
    await expect(handlers.saveSettings({ encryptedStorage: true })).rejects.toThrow(/key store/);
    expect(settings().encryptedStorage).toBe(false);
  });
  it('remembers the chosen update channel and keeps maintenance opt-in', async () => {
    const { handlers, settings, toolManager } = fixture();
    expect(settings().autoToolUpdates).toBe(false);
    await handlers.saveSettings({ ytdlpChannel: 'stable', autoToolUpdates: true });
    expect(settings()).toMatchObject({ ytdlpChannel: 'stable', autoToolUpdates: true });
    await handlers.toolAction({ action: 'update', tool: 'yt-dlp' });
    expect(toolManager.install).toHaveBeenCalledWith('yt-dlp', {
      channel: 'stable',
      signal: expect.any(AbortSignal),
    });
  });
  it('opens only the validated source of an existing job and rejects arbitrary URLs', async () => {
    const shell = { openExternal: vi.fn(async () => {}) };
    const { handlers, queue } = fixture({ shell });
    queue.getDownload = vi.fn((value) =>
      value === 'job' ? { url: 'https://example.com/original' } : null,
    );
    await handlers.openSource('job');
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/original');
    await expect(handlers.openSource('missing')).rejects.toThrow();
    await expect(handlers.openSource('https://unselected.example')).rejects.toThrow();
    queue.getDownload.mockReturnValue({ url: 'file:///private' });
    await expect(handlers.openSource('job')).rejects.toThrow();
    expect(shell.openExternal).toHaveBeenCalledOnce();
  });
  it('allows clearing one exact remembered origin or all and validates the maintenance command', async () => {
    const siteCompatibility = { list: vi.fn(() => []), clear: vi.fn() };
    const maintenance = {
      getState: () => ({ status: 'idle' }),
      checkNow: vi.fn(async () => ({ status: 'current' })),
    };
    const { handlers } = fixture({ siteCompatibility, getToolMaintenance: () => maintenance });
    expect(handlers.getSiteCompatibility()).toEqual([]);
    expect(handlers.clearSiteCompatibility({ origin: 'https://example.com' })).toEqual([]);
    expect(siteCompatibility.clear).toHaveBeenCalledWith('https://example.com');
    expect(() => handlers.clearSiteCompatibility({ origin: 'https://example.com/path' })).toThrow();
    handlers.clearSiteCompatibility({});
    expect(siteCompatibility.clear).toHaveBeenLastCalledWith(undefined);
    expect(await handlers.toolMaintenance({ action: 'check' })).toEqual({
      maintenance: { status: 'current' },
    });
    await expect(handlers.toolMaintenance({ action: 'install' })).rejects.toThrow();
  });
  it('holds the same admission lock during automatic tool work and waits for cancellation cleanup', async () => {
    const { handlers, queue, runToolOperation, dispose } = fixture();
    const released = vi.fn();
    queue.holdScheduling = vi.fn(() => released);
    let control, settle;
    const running = runToolOperation(({ signal }) => {
      control = signal;
      return new Promise((resolve) => {
        settle = resolve;
      });
    });
    const failed = expect(running).rejects.toThrow(/cancelled/);
    await Promise.resolve();
    expect(queue.holdScheduling).toHaveBeenCalledOnce();
    await expect(handlers.addDownloads({ urls: ['https://example.com/a'] })).rejects.toMatchObject({
      code: 'TOOLS_BUSY',
    });
    await expect(handlers.toolAction({ action: 'update', tool: 'yt-dlp' })).rejects.toMatchObject({
      code: 'TOOLS_BUSY',
    });
    const stopping = dispose();
    expect(control.aborted).toBe(true);
    expect(released).not.toHaveBeenCalled();
    settle({});
    await Promise.all([stopping, failed]);
    expect(released).toHaveBeenCalledWith({ start: false });
  });
  it('stores reusable profiles without secrets or source-specific formats', async () => {
    const { handlers, settings } = fixture();
    await handlers.saveProfile({
      name: 'Music',
      downloadPath: folder,
      options: { quality: 'audio', audioFormat: 'mp3', userAgent: 'private agent' },
    });
    const profile = settings().profiles[0];
    expect(profile.options).toEqual({ quality: 'audio', audioFormat: 'mp3' });
    await handlers.saveProfile({
      name: 'Music',
      downloadPath: folder,
      options: { quality: '720' },
    });
    expect(settings().profiles).toHaveLength(1);
    expect(settings().profiles[0].id).toBe(profile.id);
    await handlers.deleteProfile({ id: profile.id });
    expect(settings().profiles).toEqual([]);
  });
  it('validates bulk selections before mutation and confirms history deletion', async () => {
    const { handlers, queue, dialog } = fixture();
    expect(() => handlers.queueAction({ action: 'cancel', ids: ['same', 'same'] })).toThrow();
    expect(queue.bulkAction).not.toHaveBeenCalled();
    handlers.queueAction({ action: 'move', ids: ['job'], targetIndex: 0 });
    expect(queue.bulkAction).toHaveBeenCalledWith('move', ['job'], 0);
    dialog.showMessageBox.mockResolvedValue({ response: 0 });
    expect(await handlers.deleteHistory({ ids: ['job'] })).toEqual({ deleted: 0 });
    expect(queue.deleteHistory).not.toHaveBeenCalled();
  });
  it('keeps absolute playlist indices on later pages and validates selected scope', async () => {
    const { handlers, queue } = fixture();
    const preview = await handlers.previewPlaylist({
      url: 'https://example.com/playlist',
      start: 501,
      pageSize: 100,
    });
    expect(preview.entries[0].index).toBe(501);
    expect(preview.start).toBe(501);
    await expect(
      handlers.addPlaylistSelection({ previewId: preview.previewId, indices: [1] }),
    ).rejects.toThrow();
    await handlers.addPlaylistSelection({ previewId: preview.previewId, indices: [501] });
    expect(queue.addBatch).toHaveBeenCalledWith(['https://example.com/501'], folder, {
      quality: 'best',
    });
  });
  it('does not enqueue downloads while tools are being replaced', async () => {
    const { handlers, toolManager, queue } = fixture();
    let release;
    toolManager.install.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const installing = handlers.toolAction({ action: 'install', tool: 'yt-dlp' });
    await Promise.resolve();
    await expect(handlers.addDownloads({ urls: ['https://example.com/v'] })).rejects.toThrow(
      /tool update/,
    );
    expect(queue.addBatch).not.toHaveBeenCalled();
    release({ status: 'installed' });
    await installing;
  });

  it('passes only supported yt-dlp update channels to the managed installer', async () => {
    const { handlers, toolManager } = fixture();
    await handlers.toolAction({ action: 'update', tool: 'yt-dlp', channel: 'nightly' });
    expect(toolManager.install).toHaveBeenCalledWith('yt-dlp', {
      signal: expect.any(AbortSignal),
      channel: 'nightly',
    });
    for (const input of [
      { action: 'update', tool: 'yt-dlp', channel: 'arbitrary/repo' },
      { action: 'update', tool: 'runtime', channel: 'nightly' },
      { action: 'check', tool: 'yt-dlp', channel: 'nightly' },
    ])
      await expect(handlers.toolAction(input)).rejects.toThrow(/release channel/);
    expect(toolManager.install).toHaveBeenCalledOnce();
  });
  it('retries changed options in the currently selected folder', async () => {
    const { handlers, queue } = fixture();
    await handlers.retryDownload({ id: 'job', options: { quality: '1080' } });
    expect(queue.retryWithOptions).toHaveBeenCalledWith('job', { quality: '1080' }, folder);
  });

  it('allows the exact installation links returned by the real setup plan', async () => {
    const toolManager = manager.createToolManager({ managedDir: folder });
    const shell = { openExternal: vi.fn(async () => {}) };
    const { handlers } = fixture({ toolManager, shell });
    const links = toolManager.getSetupPlan().tools.map((tool) => tool.url);
    expect(links).toContain('https://github.com/yt-dlp/yt-dlp#installation');
    for (const link of links) await handlers.openExternal(link);
    expect(shell.openExternal).toHaveBeenCalledTimes(links.length);
    await expect(
      handlers.openExternal('https://github.com/yt-dlp/yt-dlp#arbitrary'),
    ).rejects.toThrow();
  });

  it('refuses tool replacement while a cancelled child is still exiting', async () => {
    const { handlers, queue, toolManager } = fixture();
    queue.getQueueState = () => ({ queue: [], isProcessing: true, activeIds: ['exiting'] });
    await expect(handlers.toolAction({ action: 'install', tool: 'yt-dlp' })).rejects.toThrow(
      /queued downloads/,
    );
    expect(toolManager.install).not.toHaveBeenCalled();
  });

  it('updates tools without discarding manually paused downloads', async () => {
    const { handlers, queue, toolManager } = fixture();
    const jobs = [{ id: 'kept', status: 'paused', pausedBySchedule: false }];
    queue.getQueueState = () => ({ queue: jobs, isProcessing: false });
    await handlers.toolAction({ action: 'update', tool: 'yt-dlp', channel: 'nightly' });
    expect(toolManager.install).toHaveBeenCalledOnce();
    expect(jobs).toEqual([{ id: 'kept', status: 'paused', pausedBySchedule: false }]);
  });

  it.each([
    { status: 'pending' },
    { status: 'paused', pausedBySchedule: true },
    { status: 'downloading' },
  ])('does not replace tools while a job may start automatically: %s', async (job) => {
    const { handlers, queue, toolManager } = fixture();
    queue.getQueueState = () => ({ queue: [job], isProcessing: false });
    await expect(handlers.toolAction({ action: 'update', tool: 'yt-dlp' })).rejects.toThrow(
      /Pause queued/,
    );
    expect(toolManager.install).not.toHaveBeenCalled();
  });

  it.each(['add', 'playlist', 'retry'])(
    'revalidates %s after the asynchronous folder check',
    async (kind) => {
      let releaseFolder, releaseInstall;
      const filesystem = {
        stat: () =>
          new Promise((resolve) => {
            releaseFolder = () => resolve({ isDirectory: () => true });
          }),
        access: async () => {},
      };
      const { handlers, queue, toolManager } = fixture({ fs: filesystem });
      const preview =
        kind === 'playlist'
          ? await handlers.previewPlaylist({ url: 'https://example.com/playlist' })
          : null;
      const adding =
        kind === 'add'
          ? handlers.addDownloads({ urls: ['https://example.com/a'] })
          : kind === 'playlist'
            ? handlers.addPlaylistSelection({ previewId: preview.previewId, indices: [1] })
            : handlers.retryDownload({ id: 'job', options: { quality: '720' } });
      const blocked = expect(adding).rejects.toThrow(/tool update/);
      toolManager.install.mockImplementation(
        () =>
          new Promise((resolve) => {
            releaseInstall = resolve;
          }),
      );
      const installing = handlers.toolAction({ action: 'install', tool: 'yt-dlp' });
      await Promise.resolve();
      releaseFolder();
      await blocked;
      expect(queue.addBatch).not.toHaveBeenCalled();
      expect(queue.retryWithOptions).not.toHaveBeenCalled();
      releaseInstall({ status: 'installed' });
      await installing;
    },
  );

  it('does not probe tools while a replacement is active', async () => {
    const recheckTools = vi.fn(async () => ({}));
    const { handlers, toolManager } = fixture({ recheckTools });
    let finish;
    toolManager.install.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const installing = handlers.toolAction({ action: 'install', tool: 'yt-dlp' });
    await Promise.resolve();
    expect(() => handlers.recheckTools()).toThrow(/tool update/);
    await expect(handlers.toolAction({ action: 'check', tool: 'runtime' })).rejects.toThrow(
      /tool update/,
    );
    expect(recheckTools).not.toHaveBeenCalled();
    finish({ status: 'installed' });
    await installing;
    expect(recheckTools).toHaveBeenCalledOnce();
  });

  it('keeps the tool task owned through the post-install probe and awaits it on disposal', async () => {
    let finishProbe;
    const recheckTools = vi.fn(
      () =>
        new Promise((resolve) => {
          finishProbe = resolve;
        }),
    );
    const { handlers, dispose } = fixture({ recheckTools });
    const installing = handlers.toolAction({ action: 'install', tool: 'yt-dlp' });
    await vi.waitFor(() => expect(recheckTools).toHaveBeenCalledOnce());
    let stopped = false;
    const stopping = dispose().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finishProbe({});
    await Promise.all([stopping, installing]);
    expect(stopped).toBe(true);
  });

  it('does not start a post-install probe when disposal begins during installation', async () => {
    const recheckTools = vi.fn(async () => ({}));
    const { handlers, dispose, toolManager } = fixture({ recheckTools });
    let finish;
    toolManager.install.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const installing = handlers.toolAction({ action: 'install', tool: 'yt-dlp' });
    const failed = expect(installing).rejects.toThrow(/tool operation failed/);
    await Promise.resolve();
    const stopping = dispose();
    finish({ status: 'installed' });
    await Promise.all([stopping, failed]);
    expect(recheckTools).not.toHaveBeenCalled();
  });
});
