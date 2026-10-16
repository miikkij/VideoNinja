import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import updates from '../../src/main/appUpdater.js';
function fixture(overrides = {}) {
  const cancellationToken = { cancel: vi.fn() };
  const updater = Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn(async () => ({ updateInfo: { version: '1.3.0' }, cancellationToken })),
    downloadUpdate: vi.fn(async () => []),
    quitAndInstall: vi.fn(),
    netSession: { closeAllConnections: vi.fn(async () => {}) },
  });
  const beforeInstall = vi.fn();
  const service = updates.createAppUpdater({
    app: { isPackaged: true, getVersion: () => '1.2.0' },
    updater,
    platform: 'win32',
    env: {},
    policy: { automatic: true, signed: true, publisherName: 'Example' },
    beforeInstall,
    fetch: vi.fn(async () => ({
      ok: true,
      json: async () => ({ tag_name: 'v1.3.0', body: 'Changes', html_url: 'https://evil.example' }),
    })),
    ...overrides,
  });
  return { service, updater, beforeInstall, cancellationToken };
}
describe('application updates', () => {
  it('requires check and explicit download before verified installation', async () => {
    const { service, updater, beforeInstall } = fixture();
    expect((await service.action('install')).status).toBe('error');
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect((await service.action('check')).status).toBe('available');
    expect((await service.action('status')).releaseUrl).toBe(
      'https://github.com/miikkij/VideoNinja/releases/tag/v1.3.0',
    );
    expect(updater.autoDownload).toBe(false);
    await service.action('download');
    await service.action('install');
    expect(beforeInstall).toHaveBeenCalledOnce();
    expect(updater.quitAndInstall).toHaveBeenCalledOnce();
  });
  it('uses manual release downloads for unsigned builds and portable installs', async () => {
    for (const overrides of [
      { policy: {} },
      { policy: { automatic: true, publisherName: 'Example', signed: false } },
      { env: { PORTABLE_EXECUTABLE_FILE: 'app.exe' } },
      { platform: 'darwin', policy: { automatic: true, signed: false } },
    ]) {
      const { service, updater } = fixture(overrides);
      expect((await service.action('check')).status).toBe('manual');
      await service.action('download');
      expect(updater.downloadUpdate).not.toHaveBeenCalled();
    }
  });
  it('rejects manifest/release mismatches and downgrade versions', async () => {
    const { service, updater } = fixture();
    updater.checkForUpdates.mockResolvedValue({ updateInfo: { version: '9.0.0' } });
    expect((await service.action('check')).status).toBe('error');
    await service.action('download');
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    expect(updates.newer('1.1.0', '1.2.0')).toBe(false);
    expect(updates.newer('1.3.0-beta', '1.2.0')).toBe(false);
  });
  it('does not install if the queue checkpoint fails', async () => {
    const { service, updater } = fixture({
      beforeInstall: async () => {
        throw new Error('disk full');
      },
    });
    await service.action('check');
    await service.action('download');
    expect((await service.action('install')).status).toBe('error');
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it.each(['emitted', 'thrown'])(
    'releases the admission lock after a %s native install failure',
    async (kind) => {
      const release = vi.fn();
      const { service, updater } = fixture({ beforeInstall: async () => release });
      updater.quitAndInstall.mockImplementation(() => {
        if (kind === 'emitted') updater.emit('error', new Error('installer permission denied'));
        else throw new Error('installer permission denied');
      });
      await service.action('check');
      await service.action('download');
      expect((await service.action('install')).status).toBe('error');
      expect(release).toHaveBeenCalledOnce();
      expect((await service.action('check')).status).toBe('available');
      await service.dispose();
      expect(release).toHaveBeenCalledOnce();
    },
  );

  it('holds an asynchronous native handoff until an error or normal disposal', async () => {
    const release = vi.fn();
    const { service, updater } = fixture({ beforeInstall: async () => release });
    await service.action('check');
    await service.action('download');
    expect(await service.action('install')).toMatchObject({
      status: 'installing',
      canInstall: false,
    });
    await expect(service.action('install')).rejects.toThrow(/already running/);
    expect(release).not.toHaveBeenCalled();
    updater.emit('error', new Error('native handoff failed'));
    expect(release).toHaveBeenCalledOnce();
    expect((await service.action('status')).status).toBe('error');
    await service.action('check');
    await service.action('download');
    await service.action('install');
    await service.dispose();
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('cancels a native download and waits for it before completing disposal', async () => {
    const { service, updater, cancellationToken } = fixture();
    let finish;
    updater.downloadUpdate.mockImplementation((token) => {
      expect(token).toBe(cancellationToken);
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    await service.action('check');
    const download = service.action('download');
    let stopped = false;
    const stopping = service.dispose();
    void stopping.then(() => {
      stopped = true;
    });
    expect(service.dispose()).toBe(stopping);
    expect(cancellationToken.cancel).toHaveBeenCalledOnce();
    expect(updater.netSession.closeAllConnections).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish([]);
    await stopping;
    await download;
    expect(stopped).toBe(true);
    expect(updater.listenerCount('download-progress')).toBe(0);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    await expect(service.action('check')).rejects.toThrow(/shutting down/);
  });

  it('waits for an in-flight native manifest check and cancels its late token', async () => {
    const { service, updater, cancellationToken } = fixture();
    let finish;
    updater.checkForUpdates.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const checking = service.action('check');
    await vi.waitFor(() => expect(updater.checkForUpdates).toHaveBeenCalledOnce());
    let stopped = false;
    const stopping = service.dispose().then(() => {
      stopped = true;
    });
    expect(updater.netSession.closeAllConnections).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish({ updateInfo: { version: '1.3.0' }, cancellationToken });
    await Promise.all([stopping, checking]);
    expect(cancellationToken.cancel).toHaveBeenCalledOnce();
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });

  it('aborts release metadata and never starts a native check after disposal', async () => {
    let signal, rejectRequest;
    const { service, updater } = fixture({
      fetch: (_url, options) => {
        signal = options.signal;
        return new Promise((_resolve, reject) => {
          rejectRequest = reject;
        });
      },
    });
    const checking = service.action('check');
    const stopping = service.dispose();
    expect(signal.aborted).toBe(true);
    rejectRequest(new Error('aborted'));
    await Promise.all([checking, stopping]);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });
});
