const EventEmitter = require('node:events');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { normalizeOptions, validateUrl } = require('./downloadOptions');
const {
  SCHEMA_VERSION,
  MAX_QUEUE_ITEMS,
  MAX_HISTORY_ITEMS,
  MAX_CONCURRENT_DOWNLOADS,
  isAbsoluteFilePath,
  redactErrorText,
  sanitizeQueueState,
  sanitizeMetadata,
} = require('./persistence');

const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled']);
const clone = (value) => structuredClone(value);
const boundedText = (value, limit) => (typeof value === 'string' ? value.slice(0, limit) : '');

const resourceUrl = (value) => {
  const url = new URL(value);
  url.hash = '';
  return url.href;
};
const validConcurrency = (value) =>
  Number.isInteger(value) && value >= 1 && value <= MAX_CONCURRENT_DOWNLOADS;

/** Bounded concurrent jobs. The downloader owns child-process cleanup and media files. */
class DownloadQueue extends EventEmitter {
  constructor(deps = {}) {
    super();
    this._downloadVideo =
      deps.downloadVideo || ((...args) => require('./ytdlp').downloadVideo(...args));
    this._now = deps.now || (() => new Date().toISOString());
    this._idFactory = deps.idFactory || randomUUID;
    this._maxQueue = deps.maxQueue || MAX_QUEUE_ITEMS;
    this._maxHistory = deps.maxHistory || MAX_HISTORY_ITEMS;
    this.queue = [];
    this.history = [];
    this.currentDownload = null;
    this.isProcessing = false;
    this.maxConcurrent = deps.maxConcurrent ?? 1;
    if (!validConcurrency(this.maxConcurrent))
      throw new Error('Choose between 1 and 5 concurrent downloads.');
    this._active = new Map();
    this._scheduling = false;
    this._shuttingDown = false;
    this._shutdownPromise = null;
  }

  addDownload(url, outputPath, options = {}) {
    return this.addBatch([url], outputPath, options)[0];
  }

  /** Validate and append one complete batch before any of its downloaders can run. */
  addBatch(urls, outputPath, options = {}) {
    if (this._shuttingDown) throw new Error('The application is shutting down.');
    if (!Array.isArray(urls) || urls.length < 1 || urls.length > MAX_QUEUE_ITEMS)
      throw new Error('Add between 1 and 500 video URLs at a time.');
    if (!isAbsoluteFilePath(outputPath)) throw new Error('Choose an absolute download folder.');
    const normalizedOptions = normalizeOptions(options);
    const uniqueUrls = new Map();
    for (const input of urls) {
      const url = validateUrl(input);
      if (!uniqueUrls.has(resourceUrl(url))) uniqueUrls.set(resourceUrl(url), url);
    }
    if (this.queue.length + uniqueUrls.size > this._maxQueue)
      throw new Error('The download queue is full.');
    const usedIds = new Set([
      ...this.queue.map((item) => item.id),
      ...this.history.map((item) => item.id),
      ...this._active.keys(),
    ]);
    const downloads = [...uniqueUrls.values()].map((url) => {
      let id = this._idFactory();
      // An injected factory must not collide with this batch, history or exiting children.
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id) || usedIds.has(id)) {
        do id = randomUUID();
        while (usedIds.has(id));
      }
      usedIds.add(id);
      return {
        id,
        url,
        outputPath,
        options: clone(normalizedOptions),
        status: 'pending',
        phase: 'pending',
        progress: 0,
        title: '',
        addedAt: this._now(),
        startedAt: null,
        completedAt: null,
        error: null,
        filepath: null,
      };
    });
    this.queue.push(...downloads);
    this._notify();
    this.processNext();
    return downloads.map((download) => download.id);
  }

  setConcurrency(value, { start = true } = {}) {
    if (!validConcurrency(value)) throw new Error('Choose between 1 and 5 concurrent downloads.');
    if (this._shuttingDown) throw new Error('The application is shutting down.');
    if (this.maxConcurrent !== value) {
      this.maxConcurrent = value;
      this._notify();
    }
    if (start) this.processNext();
    return this.maxConcurrent;
  }

  _outputKey(download) {
    const outputPath = path.resolve(download.outputPath);
    return JSON.stringify([
      resourceUrl(download.url),
      process.platform === 'win32' ? outputPath.toLowerCase() : outputPath,
    ]);
  }

  _syncActiveState() {
    this.currentDownload = this._active.values().next().value?.download || null;
    this.isProcessing = this._active.size > 0;
  }

  /** Exiting children occupy their slots and output keys until their promises settle. */
  processNext() {
    if (this._shuttingDown || this._scheduling) return;
    this._scheduling = true;
    try {
      while (!this._shuttingDown && this._active.size < this.maxConcurrent) {
        const outputKeys = new Set([...this._active.values()].map((active) => active.outputKey));
        const download = this.queue.find(
          (item) =>
            item.status === 'pending' &&
            !this._active.has(item.id) &&
            !outputKeys.has(this._outputKey(item)),
        );
        if (!download) break;
        const active = {
          download,
          outputKey: this._outputKey(download),
          controller: new AbortController(),
          intent: null,
          promise: null,
        };
        this._active.set(download.id, active);
        this._syncActiveState();
        download.status = 'downloading';
        download.phase = 'preparing';
        download.startedAt = this._now();
        download.error = null;
        // Promise assignment precedes events so reentrant shutdown can wait for every child.
        active.promise = Promise.resolve().then(() => this._run(active));
        this.emit('download-started', clone(download));
        this._notify();
      }
    } finally {
      this._scheduling = false;
    }
  }

  async _run(active) {
    const { download, controller } = active;
    try {
      if (controller.signal.aborted) return;
      const result = await this._downloadVideo(
        download.url,
        download.outputPath,
        clone(download.options),
        (progress) => this._progress(active, progress),
        { signal: controller.signal },
      );
      // User intent wins even when process completion and abort race each other.
      if (active.intent) return;
      if (result?.success && isAbsoluteFilePath(result.filepath)) {
        download.filepath = result.filepath;
        if (result.metadata) download.metadata = sanitizeMetadata(result.metadata);
        if (download.metadata?.title) download.title = download.metadata.title;
        if (typeof result.title === 'string') download.title = result.title.slice(0, 512);
        this._finish(download, 'completed');
      } else {
        this._finish(
          download,
          'failed',
          result?.error || 'The download did not produce a usable file.',
        );
      }
    } catch (error) {
      if (!active.intent) this._finish(download, 'failed', error?.message || 'Download failed.');
    } finally {
      if (this._active.get(download.id) === active) {
        this._active.delete(download.id);
        this._syncActiveState();
        this._notify();
        this.processNext();
      }
    }
  }

  _progress(active, progress) {
    if (
      this._active.get(active.download.id) !== active ||
      active.intent ||
      !progress ||
      typeof progress !== 'object'
    )
      return;
    const download = active.download;
    if (Number.isFinite(progress.percent))
      download.progress = Math.max(0, Math.min(100, progress.percent));
    if (typeof progress.title === 'string') download.title = progress.title.slice(0, 512);
    if (progress.metadata) {
      download.metadata = sanitizeMetadata(progress.metadata);
      if (download.metadata?.title) download.title = download.metadata.title;
    }
    if (['preparing', 'downloading', 'merging'].includes(progress.status))
      download.phase = progress.status;
    if (progress.speed !== undefined)
      download.speed = Number.isFinite(progress.speed)
        ? Math.max(0, progress.speed)
        : boundedText(progress.speed, 80);
    if (progress.eta !== undefined)
      download.eta = Number.isFinite(progress.eta)
        ? Math.max(0, progress.eta)
        : boundedText(progress.eta, 80);
    this.emit('download-progress', {
      id: download.id,
      progress: download.progress,
      status: download.phase,
      phase: download.phase,
      title: download.title,
      metadata: clone(download.metadata),
      speed: download.speed,
      eta: download.eta,
    });
  }

  _finish(download, status, error = null) {
    if (TERMINAL_STATES.has(download.status)) return false;
    download.status = status;
    download.phase = status;
    download.completedAt = this._now();
    download.error = error
      ? redactErrorText(typeof error === 'string' ? error : error.message, download)
      : null;
    if (status === 'completed') download.progress = 100;
    this.queue = this.queue.filter((item) => item.id !== download.id);
    this.history.unshift(download);
    this.history = this.history.slice(0, this._maxHistory);
    this.emit('download-' + status, clone(download));
    this._notify();
    return true;
  }

  cancelDownload(id) {
    const download = this.queue.find((item) => item.id === id);
    if (!download || this._shuttingDown) return false;
    const active = this._active.get(id);
    if (active) {
      active.intent = 'cancel';
      active.controller.abort();
    }
    // Record cancellation immediately so a crash cannot restart a cancelled job.
    this._finish(download, 'cancelled');
    this.processNext();
    return true;
  }

  pauseDownload(id) {
    const download = this.queue.find((item) => item.id === id);
    if (!download || !['pending', 'downloading'].includes(download.status) || this._shuttingDown)
      return false;
    const active = this._active.get(id);
    if (active) {
      active.intent = 'pause';
      active.controller.abort();
    }
    download.status = 'paused';
    download.phase = 'paused';
    this.emit('download-paused', clone(download));
    this._notify();
    this.processNext();
    return true;
  }

  resumeDownload(id) {
    const download = this.queue.find((item) => item.id === id && item.status === 'paused');
    if (!download || this._shuttingDown) return false;
    download.status = 'pending';
    download.phase = 'pending';
    this._notify();
    // If the previous process is still exiting, its finally block starts this run.
    this.processNext();
    return true;
  }

  moveDownload(id, targetIndex) {
    if (
      this._shuttingDown ||
      !Number.isInteger(targetIndex) ||
      targetIndex < 0 ||
      targetIndex >= this.queue.length
    )
      return false;
    const index = this.queue.findIndex(
      (item) => item.id === id && ['pending', 'paused'].includes(item.status),
    );
    if (index < 0 || this._active.has(id)) return false;
    const [download] = this.queue.splice(index, 1);
    this.queue.splice(targetIndex, 0, download);
    this._notify();
    return true;
  }

  retryDownload(id) {
    const download = this.history.find(
      (item) => item.id === id && ['failed', 'cancelled'].includes(item.status),
    );
    return download ? this.addDownload(download.url, download.outputPath, download.options) : null;
  }

  retryWithOptions(id, overrideOptions = {}) {
    const download = this.history.find(
      (item) => item.id === id && ['failed', 'cancelled'].includes(item.status),
    );
    if (!download) return null;
    const original = download.options;
    const safeOriginal = {};
    for (const key of ['quality', 'audioFormat', 'subtitles', 'subtitleLang']) {
      if (original[key] !== undefined) safeOriginal[key] = original[key];
    }
    return this.addDownload(download.url, download.outputPath, {
      ...safeOriginal,
      ...overrideOptions,
    });
  }

  getQueueState() {
    return clone({
      queue: this.queue,
      history: this.history,
      currentDownload: this.currentDownload,
      isProcessing: this.isProcessing,
      activeIds: [...this._active.keys()],
      maxConcurrent: this.maxConcurrent,
    });
  }

  getDownload(id) {
    const download =
      this.queue.find((item) => item.id === id) || this.history.find((item) => item.id === id);
    return download ? clone(download) : null;
  }

  loadState(state, { start = true } = {}) {
    if (this._active.size || this._shuttingDown)
      throw new Error('Cannot restore while the queue is running.');
    const restored = sanitizeQueueState(state, {
      maxQueue: this._maxQueue,
      maxHistory: this._maxHistory,
      idFactory: this._idFactory,
      now: this._now,
    });
    this.queue = restored.queue;
    this.history = restored.history;
    this._notify();
    if (start) this.processNext();
    return restored.warnings;
  }

  getStateForSave() {
    return clone({ schemaVersion: SCHEMA_VERSION, queue: this.queue, history: this.history });
  }

  clearHistory() {
    const removed = this.history.length;
    this.history = [];
    this._notify();
    return removed;
  }

  /** Export omits local paths, errors and authentication/network options. */
  exportHistory() {
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: this._now(),
      downloads: this.history.map((download) => {
        const url = new URL(download.url);
        url.username = '';
        url.password = '';
        url.search = '';
        url.hash = '';
        return {
          id: download.id,
          url: url.href,
          title: download.title,
          status: download.status,
          quality: download.options.quality,
          addedAt: download.addedAt,
          completedAt: download.completedAt,
        };
      }),
    };
  }

  shutdown() {
    if (this._shutdownPromise) return this._shutdownPromise;
    this._shuttingDown = true;
    const activeJobs = [...this._active.values()];
    this._shutdownPromise = Promise.all(activeJobs.map((active) => active.promise)).then(() =>
      this.getStateForSave(),
    );
    for (const active of activeJobs) {
      if (!active.intent) {
        active.intent = 'shutdown';
        active.download.status = 'pending';
        active.download.phase = 'pending';
      }
    }
    for (const active of activeJobs) active.controller.abort();
    this._notify();
    return this._shutdownPromise;
  }

  _notify() {
    this.emit('queue-updated', this.getQueueState());
  }
}

module.exports = DownloadQueue;
