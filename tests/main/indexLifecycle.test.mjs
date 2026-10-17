import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import path from 'node:path';
import DownloadQueue from '../../src/main/downloadQueue.js';
import updates from '../../src/main/appUpdater.js';
import personality from '../../src/main/personalityEvents.js';
import toolMaintenance from '../../src/main/toolMaintenance.js';
import siteCompatibility from '../../src/main/siteCompatibility.js';
import appReleaseModule from '../../src/main/appRelease.js';

const require = createRequire(import.meta.url);
const indexPath = path.resolve('src/main/index.js');
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function fixture(env = {}, nativeUpdater = null, release = {}) {
  const app = Object.assign(new EventEmitter(), {
    isPackaged: release.installed === true,
    getPath: () => path.resolve('isolated-index-fixture'),
    getVersion: () => release.version || '1.2.0',
    requestSingleInstanceLock: () => true,
    whenReady: () => new Promise(() => {}),
    quit: vi.fn(),
  });
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = Object.assign(new EventEmitter(), {
        setWindowOpenHandler() {},
        send: vi.fn(),
        session: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} },
      });
    }
    loadURL() {}
    isDestroyed() {
      return false;
    }
  }
  class Store {
    constructor() {
      this.values = release.state ? { releaseState: release.state } : {};
    }
    get(key) {
      return this.values[key];
    }
    set(key, value) {
      this.values[key] = value;
    }
    status() {
      return { encryptionAvailable: true, encrypted: false };
    }
  }
  let queue, callbacks, updaterOptions;
  const persistence = { checkpoint: vi.fn(() => true), dispose: vi.fn() };
  const services = { handlers: {}, dispose: vi.fn(async () => {}) };
  let updater = {
    action: vi.fn(async () => ({ status: 'idle' })),
    dispose: vi.fn(async () => {}),
  };
  const tools = {
    createDownloader: () => tools,
    fetchMetadata: vi.fn(async () => ({})),
    getDiskSpace: vi.fn(async () => ({ available: false })),
    checkYtDlpAvailability: vi.fn(async () => ({ available: true })),
    checkFfmpegAvailability: vi.fn(async () => ({ available: true })),
  };
  const createToolManager = vi.fn(() => ({ getSetupPlan: () => ({ tools: [] }) }));
  const fakeModules = {
    electron: {
      app,
      BrowserWindow: Window,
      protocol: { registerSchemesAsPrivileged() {}, handle() {} },
      screen: { getAllDisplays: () => [] },
      dialog: {},
    },
    'electron-store': Store,
    'electron-updater': { autoUpdater: null },
    '../shared/releaseNotes.json': {
      schemaVersion: 1,
      releases: [
        {
          version: '1.2.1',
          date: '2026-10-18',
          notes: { en: ['New version.'], fi: ['Uusi versio.'] },
        },
      ],
    },
    'node:fs': {
      readFileSync() {
        throw new Error('No packaged policy in source fixture.');
      },
    },
    './ytdlp': tools,
    './downloadQueue': class extends DownloadQueue {
      constructor(deps) {
        super({
          ...deps,
          downloadVideo: async () => ({ success: true, filepath: path.resolve('media.mp4') }),
        });
        queue = this;
        vi.spyOn(this, 'shutdown');
      }
    },
    './ipc': {
      APP_URL: 'videoninja://app/index.html',
      registerIpc() {},
      createHandlers(deps) {
        callbacks = deps;
        return services;
      },
    },
    './startup': { createStartup: () => ({ isEnabled: async () => false }) },
    './privateStore': { createPrivateStore: (store) => store },
    './notifications': { createNotifications: () => ({ record() {}, dispose() {} }) },
    './personalityEvents': personality,
    './appUpdater': {
      createAppUpdater(options) {
        updaterOptions = options;
        if (nativeUpdater)
          updater = updates.createAppUpdater({
            ...options,
            app: { isPackaged: true, getVersion: app.getVersion },
            updater: nativeUpdater,
            platform: 'win32',
            env: {},
            policy: { automatic: true, signed: true, publisherName: 'Fixture' },
            fetch: async () => ({ ok: true, json: async () => ({ tag_name: 'v1.3.0' }) }),
          });
        return updater;
      },
    },
    './toolManager': { createToolManager },
    './toolMaintenance': toolMaintenance,
    './siteCompatibility': siteCompatibility,
    './appRelease': appReleaseModule,
    './persistence': {
      readConfiguration: async () => ({ warnings: [] }),
      loadPersistedState: () => ({
        settings: { language: 'en', maxConcurrent: 1 },
        warnings: [],
        queueState: {},
      }),
      attachQueuePersistence: () => persistence,
      sanitizeWindowBounds: () => undefined,
    },
  };
  // Substitute only the ESM dependency loader; all lifecycle functions execute unchanged.
  const source = readFileSync(indexPath, 'utf8').replace(
    "const { default: Store } = await import('electron-store');",
    "const Store = require('electron-store');",
  );
  const context = {
    module: { exports: {} },
    require: (name) => (Object.hasOwn(fakeModules, name) ? fakeModules[name] : require(name)),
    __dirname: path.dirname(indexPath),
    process: {
      env: { VIDEONINJA_HEADLESS: '1', ...env },
      platform: process.platform,
      resourcesPath: path.resolve('resources'),
    },
    setInterval: () => 1,
    clearInterval() {},
    setTimeout,
    clearTimeout,
    console,
    AbortController,
  };
  vm.runInNewContext(source + '\nmodule.exports = { initialize };', context, {
    filename: indexPath,
  });
  await context.module.exports.initialize();
  await flush();
  return {
    app,
    queue,
    callbacks,
    services,
    persistence,
    updater,
    updaterOptions,
    createToolManager,
    env: context.process.env,
  };
}

describe('main lifecycle integration', () => {
  it('uses the running version for the title and reads acknowledgement after awaited initial-state work', async () => {
    const { callbacks, updater, queue } = await fixture({}, null, {
      installed: true,
      version: '1.2.1',
      state: { version: '1.2.0', previousVersion: null, acknowledged: true },
    });
    expect(callbacks.getWindow().options.title).toBe('VideoNinja v1.2.1');
    const titleEvent = { preventDefault: vi.fn() };
    callbacks.getWindow().emit('page-title-updated', titleEvent);
    expect(titleEvent.preventDefault).toHaveBeenCalledOnce();
    expect(callbacks.appRelease.getState()).toMatchObject({
      showNotice: true,
      previousVersion: '1.2.0',
    });
    let finish;
    updater.action.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = callbacks.getInitialState();
    callbacks.appRelease.acknowledge('1.2.1');
    finish({ status: 'idle' });
    const value = await pending;
    expect(value.version).toBe('1.2.1');
    expect(value.appRelease).toMatchObject({
      version: '1.2.1',
      showNotice: false,
      previousVersion: '1.2.0',
    });
    await queue.shutdown();
  });
  it('respects an explicit isolated managed-tools directory for manager and downloader discovery', async () => {
    const isolatedTools = path.resolve('isolated-test-tools');
    const { queue, createToolManager, env } = await fixture({
      VIDEONINJA_TOOLS_DIR: isolatedTools,
    });
    expect(createToolManager).toHaveBeenCalledWith({ managedDir: isolatedTools });
    expect(env.VIDEONINJA_TOOLS_DIR).toBe(isolatedTools);
    await queue.shutdown();
  });

  it('does not resolve a relative managed-tools override against the working directory', async () => {
    await expect(fixture({ VIDEONINJA_TOOLS_DIR: 'relative/tools' })).rejects.toThrow(
      /must be absolute/,
    );
  });

  it('takes the initial queue snapshot after the final asynchronous updater read', async () => {
    const { callbacks, updater, queue } = await fixture();
    let finishStatus;
    updater.action.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishStatus = resolve;
        }),
    );
    const initial = callbacks.getInitialState();
    queue.loadState({
      queue: [
        {
          id: 'newest',
          url: 'https://example.com/newest',
          outputPath: path.resolve('downloads'),
          status: 'paused',
          options: {},
        },
      ],
    });
    finishStatus({ status: 'available' });
    const state = await initial;
    expect(state.queue.queue.map((job) => job.id)).toEqual(['newest']);
    expect(state.appUpdate.status).toBe('available');
    await queue.shutdown();
  });

  it('leaves commands and the queue usable when the pre-install checkpoint fails', async () => {
    const { persistence, services, updaterOptions, queue, callbacks } = await fixture();
    persistence.checkpoint.mockReturnValue(false);
    await expect(updaterOptions.beforeInstall()).rejects.toThrow(/could not be saved/);
    expect(services.dispose).not.toHaveBeenCalled();
    expect(queue.shutdown).not.toHaveBeenCalled();
    await expect(
      callbacks.putSettings({ language: 'fi', maxConcurrent: 1 }),
    ).resolves.toBeUndefined();
    expect(() =>
      queue.addDownload('https://example.com/still-usable', path.resolve('downloads')),
    ).not.toThrow();
    await flush();
    await queue.shutdown();
  });

  it('waits for updater disposal as well as queue cleanup before quitting', async () => {
    const { app, updater, queue, persistence } = await fixture();
    let finishUpdater;
    updater.dispose.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishUpdater = resolve;
        }),
    );
    const event = { preventDefault: vi.fn() };
    app.emit('before-quit', event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(queue.shutdown).toHaveBeenCalledOnce();
    await flush();
    expect(app.quit).not.toHaveBeenCalled();
    finishUpdater();
    await flush();
    expect(persistence.checkpoint).toHaveBeenCalledOnce();
    expect(persistence.dispose).toHaveBeenCalledOnce();
    expect(app.quit).toHaveBeenCalledOnce();
  });

  it('recovers settings and job operations when native installation emits an error after checkpointing', async () => {
    const native = Object.assign(new EventEmitter(), {
      checkForUpdates: async () => ({
        updateInfo: { version: '1.3.0' },
        cancellationToken: { cancel() {} },
      }),
      downloadUpdate: async () => [],
      quitAndInstall: vi.fn(),
    });
    const { app, updater, callbacks, queue, persistence, services } = await fixture({}, native);
    await updater.action('check');
    await updater.action('download');
    expect((await updater.action('install')).status).toBe('installing');
    expect(persistence.checkpoint).toHaveBeenCalledOnce();
    expect(callbacks.isInstallingUpdate()).toBe(true);
    await expect(callbacks.putSettings({ language: 'fi', maxConcurrent: 1 })).rejects.toThrow(
      /restarting/,
    );
    const id = queue.addDownload('https://example.com/pending-install', path.resolve('downloads'));
    await flush();
    expect(queue.getDownload(id).status).toBe('pending');
    expect(services.dispose).not.toHaveBeenCalled();
    expect(queue.shutdown).not.toHaveBeenCalled();
    native.emit('error', new Error('Could not launch installer'));
    expect(callbacks.isInstallingUpdate()).toBe(false);
    await expect(
      callbacks.putSettings({ language: 'fi', maxConcurrent: 1 }),
    ).resolves.toBeUndefined();
    await flush();
    expect(queue.getDownload(id).status).toBe('completed');
    expect(services.dispose).not.toHaveBeenCalled();
    expect(queue.shutdown).not.toHaveBeenCalled();
    expect(app.quit).not.toHaveBeenCalled();
    await queue.shutdown();
    await updater.dispose();
  });

  it('defers irreversible cleanup until normal quit after a successful installer handoff', async () => {
    const { app, updaterOptions, callbacks, services, queue, persistence } = await fixture();
    const release = await updaterOptions.beforeInstall();
    expect(callbacks.isInstallingUpdate()).toBe(true);
    expect(services.dispose).not.toHaveBeenCalled();
    let finishServices;
    services.dispose.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishServices = resolve;
        }),
    );
    app.emit('before-quit', { preventDefault() {} });
    release();
    expect(queue.shutdown).toHaveBeenCalledOnce();
    await flush();
    expect(app.quit).not.toHaveBeenCalled();
    finishServices();
    await flush();
    expect(app.quit).toHaveBeenCalledOnce();
    expect(persistence.checkpoint).toHaveBeenCalledTimes(2);
    expect(persistence.dispose).toHaveBeenCalledOnce();
  });
});
