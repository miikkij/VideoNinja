/** Transient, content-free UI events; history and private data are never replayed. */
function createPersonalityEvents({ queue, onEvent }) {
  let live = new Map();
  const started = new Set();
  const listeners = [];
  let disposed = false;

  const sync = (state) => {
    live = new Map((state?.queue || []).map((job) => [job.id, job.status]));
    for (const id of started) if (!live.has(id)) started.delete(id);
  };
  const emit = (type) => {
    if (disposed) return;
    try {
      onEvent(Object.freeze({ type }));
    } catch {
      // A closing renderer must not change the outcome of a download.
    }
  };
  const listen = (name, callback) => {
    queue.on(name, callback);
    listeners.push([name, callback]);
  };
  const finish = (job, type) => {
    if (!live.delete(job?.id)) return;
    started.delete(job.id);
    if (type) emit(type);
  };

  sync(queue.getQueueState());
  listen('queue-updated', sync);
  listen('download-progress', (progress) => {
    if (
      live.get(progress?.id) !== 'downloading' ||
      started.has(progress.id) ||
      !['downloading', 'merging'].includes(progress.phase || progress.status)
    )
      return;
    started.add(progress.id);
    emit('started');
  });
  listen('download-completed', (job) => finish(job, 'completed'));
  listen('download-failed', (job) => finish(job, 'failed'));
  listen('download-cancelled', (job) => finish(job));
  listen('download-skipped', (job) => finish(job));

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const [name, callback] of listeners) queue.removeListener(name, callback);
      listeners.length = 0;
      live.clear();
      started.clear();
    },
  };
}

module.exports = { createPersonalityEvents };
