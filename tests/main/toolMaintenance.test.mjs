import { describe, expect, it, vi } from 'vitest';
import module from '../../src/main/toolMaintenance.js';

const { createToolMaintenance, DAY_MS, BUSY_RETRY_MS } = module;
const flush = async () => {
  for (let index = 0; index < 12; index++) await Promise.resolve();
};
function fixture(options = {}) {
  let time = Date.parse('2026-10-17T12:00:00Z');
  const settings = { autoToolUpdates: true, ytdlpChannel: 'nightly' };
  const timers = new Map();
  let nextTimer = 0;
  let saved = options.saved;
  const manager = {
    checkUpdates: vi.fn(async () => ({ tools: [{ tool: 'yt-dlp', status: 'current' }] })),
    install: vi.fn(async () => ({ status: 'installed', version: '2026.10.17.120000' })),
    ...options.manager,
  };
  const runExclusive =
    options.runExclusive || vi.fn(async (callback, { signal }) => callback({ signal }));
  const onState = vi.fn();
  const saveState =
    options.saveState ||
    vi.fn(async (value) => {
      saved = structuredClone(value);
    });
  const maintenance = createToolMaintenance({
    getSettings: () => settings,
    manager,
    runExclusive,
    onState,
    loadState: async () => saved,
    saveState,
    now: () => time,
    setTimeout: (callback, milliseconds) => {
      const id = ++nextTimer;
      timers.set(id, { callback, at: time + milliseconds });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  return {
    maintenance,
    settings,
    manager,
    runExclusive,
    saveState,
    onState,
    timers,
    saved: () => saved,
    advance: async (milliseconds) => {
      time += milliseconds;
      for (const [id, timer] of [...timers])
        if (timer.at <= time) {
          timers.delete(id);
          timer.callback();
        }
      await flush();
    },
  };
}

describe('optional managed-tool maintenance', () => {
  it('does no network or installation while disabled', async () => {
    const f = fixture();
    delete f.settings.autoToolUpdates;
    await f.maintenance.start();
    await f.maintenance.checkNow();
    expect(f.manager.checkUpdates).not.toHaveBeenCalled();
    expect(f.timers.size).toBe(0);
    await f.maintenance.dispose();
  });
  it('restores the previous check for display while maintenance stays disabled', async () => {
    const f = fixture({
      saved: {
        lastAttemptAt: '2026-10-17T10:00:00.000Z',
        lastCheckedAt: '2026-10-17T10:00:01.000Z',
        channel: 'nightly',
      },
    });
    f.settings.autoToolUpdates = false;
    await f.maintenance.start();
    expect(f.maintenance.getState()).toMatchObject({
      status: 'idle',
      lastCheckedAt: '2026-10-17T10:00:01.000Z',
    });
    expect(f.onState).toHaveBeenCalledWith(
      expect.objectContaining({ lastCheckedAt: '2026-10-17T10:00:01.000Z' }),
    );
    expect(f.manager.checkUpdates).not.toHaveBeenCalled();
    await f.maintenance.dispose();
  });
  it('persists the attempt before checking and respects the daily limit across restarts', async () => {
    const f = fixture();
    f.manager.checkUpdates.mockImplementation(async () => {
      expect(f.saved().lastAttemptAt).toBe('2026-10-17T12:00:00.000Z');
      return { tools: [{ tool: 'yt-dlp', status: 'current' }] };
    });
    await f.maintenance.start();
    await f.maintenance.checkNow();
    expect(f.manager.checkUpdates).toHaveBeenCalledTimes(1);
    const restarted = fixture({ saved: f.saved() });
    await restarted.maintenance.start();
    expect(restarted.manager.checkUpdates).not.toHaveBeenCalled();
    await restarted.advance(DAY_MS);
    expect(restarted.manager.checkUpdates).toHaveBeenCalledOnce();
    await Promise.all([f.maintenance.dispose(), restarted.maintenance.dispose()]);
  });
  it('defers a busy queue without consuming the daily attempt, then retries', async () => {
    const runExclusive = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'TOOLS_BUSY' }))
      .mockImplementation(async (callback, { signal }) => callback({ signal }));
    const f = fixture({ runExclusive });
    await f.maintenance.start();
    expect(f.maintenance.getState().status).toBe('deferred');
    expect(f.saveState).not.toHaveBeenCalled();
    await f.advance(BUSY_RETRY_MS);
    expect(f.manager.checkUpdates).toHaveBeenCalledOnce();
    await f.maintenance.dispose();
  });
  it('does not retry server failures on every restart or timer tick', async () => {
    const f = fixture({
      manager: {
        checkUpdates: vi.fn(async () => {
          throw new Error('offline');
        }),
      },
    });
    await f.maintenance.start();
    expect(f.maintenance.getState().status).toBe('error');
    await f.advance(BUSY_RETRY_MS);
    expect(f.manager.checkUpdates).toHaveBeenCalledOnce();
    const restarted = fixture({ saved: f.saved() });
    await restarted.maintenance.start();
    expect(restarted.manager.checkUpdates).not.toHaveBeenCalled();
    await Promise.all([f.maintenance.dispose(), restarted.maintenance.dispose()]);
  });
  it('will not contact the server if the attempt cannot be saved', async () => {
    const f = fixture({
      saveState: vi.fn(async () => {
        throw new Error('disk');
      }),
    });
    await f.maintenance.start();
    expect(f.maintenance.getState().status).toBe('error');
    expect(f.manager.checkUpdates).not.toHaveBeenCalled();
    await f.maintenance.dispose();
  });
  it('updates only available managed candidates, preserving each partial result', async () => {
    const f = fixture({
      manager: {
        checkUpdates: vi.fn(async () => ({
          tools: [
            { tool: 'yt-dlp', status: 'update-available', installedVersion: 'old' },
            { tool: 'runtime', status: 'update-available' },
            { tool: 'ffmpeg', status: 'unmanaged' },
          ],
        })),
        install: vi
          .fn()
          .mockResolvedValueOnce({ status: 'installed', version: 'new' })
          .mockRejectedValueOnce(new Error('rollback completed')),
      },
    });
    await f.maintenance.start();
    expect(f.manager.install.mock.calls.map(([tool]) => tool)).toEqual(['yt-dlp', 'runtime']);
    expect(f.manager.install).toHaveBeenCalledWith(
      'yt-dlp',
      expect.objectContaining({
        channel: 'nightly',
        updateOnly: true,
        signal: expect.any(AbortSignal),
      }),
    );
    expect(f.maintenance.getState()).toMatchObject({
      status: 'error',
      tools: [
        { tool: 'yt-dlp', status: 'updated', installedVersion: 'new' },
        { tool: 'runtime', status: 'error' },
        { tool: 'ffmpeg', status: 'unmanaged' },
      ],
    });
    await f.maintenance.dispose();
  });
  it('rechecks a newly selected channel promptly but does not install downgrade candidates', async () => {
    const f = fixture();
    await f.maintenance.start();
    f.settings.ytdlpChannel = 'stable';
    f.manager.checkUpdates.mockResolvedValue({
      tools: [{ tool: 'yt-dlp', status: 'needs-review' }],
    });
    await f.maintenance.settingsChanged();
    expect(f.manager.checkUpdates).toHaveBeenCalledTimes(2);
    expect(f.manager.checkUpdates).toHaveBeenLastCalledWith(
      expect.objectContaining({ channel: 'stable' }),
    );
    expect(f.saved().channel).toBe('stable');
    expect(f.manager.install).not.toHaveBeenCalled();
    expect(f.maintenance.getState().status).toBe('error');
    await f.maintenance.dispose();
  });
  it('uses the exclusive operation signal so app shutdown cancels actual network work', async () => {
    const exclusive = new AbortController();
    const f = fixture({
      runExclusive: async (callback) => callback({ signal: exclusive.signal }),
      manager: {
        checkUpdates: vi.fn(
          ({ signal }) =>
            new Promise((resolve, reject) => {
              signal.addEventListener(
                'abort',
                () => reject(Object.assign(new Error('app closed'), { name: 'AbortError' })),
                { once: true },
              );
            }),
        ),
      },
    });
    const running = f.maintenance.start();
    await flush();
    expect(f.manager.checkUpdates.mock.calls[0][0].signal).toBe(exclusive.signal);
    exclusive.abort();
    await running;
    expect(f.manager.install).not.toHaveBeenCalled();
    await f.maintenance.dispose();
  });
  it('settles an old channel check before checking a newly selected channel', async () => {
    let finish;
    const f = fixture();
    f.manager.checkUpdates.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = f.maintenance.start();
    await flush();
    f.settings.ytdlpChannel = 'stable';
    const changed = f.maintenance.settingsChanged();
    expect(f.manager.checkUpdates.mock.calls[0][0].signal.aborted).toBe(true);
    expect(f.manager.checkUpdates).toHaveBeenCalledOnce();
    finish({ tools: [{ tool: 'yt-dlp', status: 'update-available' }] });
    await Promise.all([first, changed]);
    expect(f.manager.checkUpdates).toHaveBeenCalledTimes(2);
    expect(f.manager.checkUpdates).toHaveBeenLastCalledWith(
      expect.objectContaining({ channel: 'stable' }),
    );
    expect(f.manager.install).not.toHaveBeenCalled();
    await f.maintenance.dispose();
  });
  it('serializes checks and waits for cancellation settlement before disable finishes', async () => {
    let finish;
    const f = fixture({
      manager: {
        checkUpdates: vi.fn(
          (_options) =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        ),
      },
    });
    const first = f.maintenance.start();
    await flush();
    const second = f.maintenance.checkNow();
    expect(f.manager.checkUpdates).toHaveBeenCalledOnce();
    const signal = f.manager.checkUpdates.mock.calls[0][0].signal;
    f.settings.autoToolUpdates = false;
    let settled = false;
    const stopping = f.maintenance.settingsChanged().then(() => {
      settled = true;
    });
    await flush();
    expect(signal.aborted).toBe(true);
    expect(settled).toBe(false);
    finish({ tools: [{ tool: 'yt-dlp', status: 'update-available' }] });
    await Promise.all([first, second, stopping]);
    expect(f.manager.install).not.toHaveBeenCalled();
    expect(f.timers.size).toBe(0);
    expect(f.maintenance.getState().status).toBe('idle');
    await f.maintenance.dispose();
  });
  it('disposal aborts an update and holds ownership until rollback settles', async () => {
    let finish;
    const f = fixture({
      manager: {
        checkUpdates: vi.fn(async () => ({
          tools: [{ tool: 'runtime', status: 'update-available' }],
        })),
        install: vi.fn(
          () =>
            new Promise((resolve, reject) => {
              finish = () =>
                reject(Object.assign(new Error('aborted after rollback'), { name: 'AbortError' }));
            }),
        ),
      },
    });
    const running = f.maintenance.start();
    await flush();
    expect(f.manager.install).toHaveBeenCalledOnce();
    let stopped = false;
    const stopping = f.maintenance.dispose().then(() => {
      stopped = true;
    });
    await flush();
    expect(f.manager.install.mock.calls[0][1].signal.aborted).toBe(true);
    expect(stopped).toBe(false);
    finish();
    await Promise.all([running, stopping]);
    expect(f.maintenance.getState().tools[0].status).toBe('deferred');
    expect(f.timers.size).toBe(0);
  });
});
