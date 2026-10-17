const { abortError } = require('./processRunner');

const DAY_MS = 24 * 60 * 60 * 1000;
const BUSY_RETRY_MS = 60 * 1000;
const clone = (value) => structuredClone(value);

/** Optional daily maintenance. runExclusive must hold queue scheduling and the
 * shared tool/preview lock through this callback and its final tool probes. */
function createToolMaintenance(deps) {
  const clock = deps.now || Date.now;
  const schedule = deps.setTimeout || setTimeout;
  const unschedule = deps.clearTimeout || clearTimeout;
  const getSettings = deps.getSettings;
  let disposed = false,
    started = false,
    timer = null,
    task = null,
    controller = null;
  let loading = null;
  let attemptedChannel = null;
  let settingsKey = null;
  const state = {
    status: 'idle',
    lastAttemptAt: null,
    lastCheckedAt: null,
    tools: [],
    error: null,
  };

  const preferences = () => {
    const settings = getSettings() || {};
    return {
      enabled: settings.autoToolUpdates === true,
      channel: settings.ytdlpChannel === 'nightly' ? 'nightly' : 'stable',
    };
  };
  const publish = (changes) => {
    Object.assign(state, changes);
    deps.onState?.(clone(state));
  };
  const persist = () =>
    deps.saveState?.({
      lastAttemptAt: state.lastAttemptAt,
      lastCheckedAt: state.lastCheckedAt,
      channel: attemptedChannel,
    });
  const clearTimer = () => {
    if (timer !== null) unschedule(timer);
    timer = null;
  };
  const remaining = (channel) => {
    if (channel !== attemptedChannel || !state.lastAttemptAt) return 0;
    return Math.max(0, Date.parse(state.lastAttemptAt) + DAY_MS - Number(clock()));
  };
  const arm = (milliseconds) => {
    clearTimer();
    if (disposed || !started || !preferences().enabled) return;
    timer = schedule(
      () => {
        timer = null;
        void checkNow();
      },
      Math.max(1, milliseconds),
    );
    timer?.unref?.();
  };
  async function load() {
    if (!loading)
      loading = Promise.resolve().then(async () => {
        const saved = await deps.loadState?.();
        if (!saved || typeof saved !== 'object') return;
        for (const key of ['lastAttemptAt', 'lastCheckedAt']) {
          const value = typeof saved[key] === 'string' ? Date.parse(saved[key]) : NaN;
          if (Number.isFinite(value))
            state[key] = new Date(Math.min(value, Number(clock()))).toISOString();
        }
        if (['stable', 'nightly'].includes(saved.channel)) attemptedChannel = saved.channel;
        publish({});
      });
    return loading;
  }

  function checkNow() {
    if (disposed) return Promise.resolve(clone(state));
    if (task) return task;
    clearTimer();
    controller = new AbortController();
    const activeController = controller;
    const selected = preferences();
    let deferred = false;
    task = Promise.resolve()
      .then(async () => {
        await load();
        if (!selected.enabled || activeController.signal.aborted || disposed) return;
        if (remaining(selected.channel)) return;
        await deps.runExclusive(
          async (context = {}) => {
            const signal = context.signal || activeController.signal;
            const checkAbort = () => {
              if (signal.aborted || activeController.signal.aborted || disposed) throw abortError();
            };
            checkAbort();
            // Record the attempt before network I/O; failures cannot create a restart loop.
            attemptedChannel = selected.channel;
            publish({
              status: 'checking',
              lastAttemptAt: new Date(clock()).toISOString(),
              tools: [],
              error: null,
            });
            await persist();
            checkAbort();
            const result = await deps.manager.checkUpdates({ channel: selected.channel, signal });
            checkAbort();
            publish({ lastCheckedAt: new Date(clock()).toISOString(), tools: result.tools });
            await persist();
            for (let index = 0; index < state.tools.length; index++) {
              const tool = state.tools[index];
              if (tool.status !== 'update-available') continue;
              checkAbort();
              state.tools[index] = { ...tool, status: 'updating' };
              publish({ status: 'updating' });
              try {
                const installed = await deps.manager.install(tool.tool, {
                  channel: selected.channel,
                  signal,
                  updateOnly: true,
                });
                // An atomic switch may complete just before cancellation; retain that outcome.
                state.tools[index] = {
                  ...tool,
                  status: installed.status === 'installed' ? 'updated' : installed.status,
                  ...(installed.version ? { installedVersion: installed.version } : {}),
                };
              } catch (error) {
                if (
                  signal.aborted ||
                  activeController.signal.aborted ||
                  error.name === 'AbortError'
                ) {
                  state.tools[index] = { ...tool, status: 'deferred' };
                  throw abortError();
                }
                state.tools[index] = {
                  ...tool,
                  status: 'error',
                  reason: 'The managed tool could not be updated. Review the manual tool controls.',
                };
              }
              publish({});
            }
            checkAbort();
            const failed = state.tools.some((tool) => tool.status === 'error');
            const needsReview = state.tools.some((tool) => tool.status === 'needs-review');
            publish({
              status:
                failed || needsReview
                  ? 'error'
                  : state.tools.some((tool) => tool.status === 'updated')
                    ? 'updated'
                    : 'current',
              error: failed
                ? 'Some managed tools could not be maintained. Review their status.'
                : needsReview
                  ? 'Some managed tools need a manual update decision before changing versions.'
                  : null,
            });
          },
          { signal: activeController.signal },
        );
      })
      .catch((error) => {
        if (disposed || activeController.signal.aborted || error.name === 'AbortError') {
          publish({ status: 'idle', error: null });
        } else if (error.code === 'TOOLS_BUSY') {
          deferred = true;
          publish({ status: 'deferred', error: null });
        } else {
          publish({
            status: 'error',
            error:
              'Automatic tool maintenance could not complete. Review the manual tool controls.',
          });
        }
      })
      .finally(() => {
        task = null;
        controller = null;
        if (!disposed && preferences().enabled) {
          const wait = remaining(preferences().channel);
          arm(deferred || !wait ? BUSY_RETRY_MS : wait);
        }
      })
      .then(() => clone(state));
    return task;
  }

  function settingsChanged() {
    const selected = preferences();
    const nextKey = `${selected.enabled}:${selected.channel}`;
    if (nextKey === settingsKey) return task || Promise.resolve(clone(state));
    settingsKey = nextKey;
    clearTimer();
    if (task) {
      controller?.abort();
      return task.then(() => (selected.enabled && !disposed ? checkNow() : clone(state)));
    }
    if (!selected.enabled) {
      publish({ status: 'idle', error: null });
      return Promise.resolve(clone(state));
    }
    return started ? checkNow() : Promise.resolve(clone(state));
  }
  function start() {
    if (disposed) return Promise.resolve(clone(state));
    started = true;
    const selected = preferences();
    settingsKey = `${selected.enabled}:${selected.channel}`;
    // Restore the last check for display even when maintenance is switched off.
    return checkNow();
  }
  async function dispose() {
    disposed = true;
    clearTimer();
    controller?.abort();
    await task;
  }
  return { start, settingsChanged, checkNow, getState: () => clone(state), dispose };
}

module.exports = { createToolMaintenance, DAY_MS, BUSY_RETRY_MS };
