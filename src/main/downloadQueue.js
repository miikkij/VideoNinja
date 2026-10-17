const EventEmitter = require('node:events');
const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { classifyDownloadError, downloadError } = require('./downloadErrors');
const { normalizeOptions, validateUrl } = require('./downloadOptions');
const { siteOrigin, sanitizeSiteLimits, MAX_SITES, LIMITED_FOR } = require('./siteLimits');
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

const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled', 'skipped']);
const MAX_ARCHIVE = 10000;
const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024;
const DEFAULT_SETTINGS = Object.freeze({
  retryAttempts: 2,
  retryDelaySeconds: 15,
  diskReserveMb: 1024,
  globalRateKbps: 0,
  scheduleEnabled: false,
  scheduleStart: '00:00',
  scheduleEnd: '06:00',
  historyRetentionDays: 0,
  privateMode: false,
  skipDuplicates: true,
  stallTimeoutSeconds: 180,
  processingTimeoutSeconds: 900,
});
const SETTING_RANGES = {
  retryAttempts: [0, 5],
  retryDelaySeconds: [1, 300],
  diskReserveMb: [0, 1048576],
  globalRateKbps: [0, 1000000],
  historyRetentionDays: [0, 3650],
  stallTimeoutSeconds: [30, 3600],
  processingTimeoutSeconds: [60, 7200],
};
const clone = (value) => structuredClone(value);
const boundedText = (value, limit) => (typeof value === 'string' ? value.slice(0, limit) : '');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const boundedArchive = (entries) => {
  let bytes = 2;
  const result = [];
  for (const entry of entries.slice(0, MAX_ARCHIVE)) {
    bytes += Buffer.byteLength(JSON.stringify(entry)) + 1;
    if (bytes > MAX_ARCHIVE_BYTES) break;
    result.push(entry);
  }
  return result;
};

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
    this._clock = deps.nowMs || (() => Date.parse(this._now()));
    this._setTimeout = deps.setTimeout || setTimeout;
    this._clearTimeout = deps.clearTimeout || clearTimeout;
    this._prepareDownload = deps.prepareDownload;
    this._getDiskSpace = deps.getDiskSpace;
    this._fileExists =
      deps.fileExists ||
      (async (file) => {
        try {
          const stat = await fs.stat(file);
          return stat.isFile() && stat.size > 0;
        } catch {
          return false;
        }
      });
    this._realpath =
      deps.realpath || ((folder) => fs.realpath(folder).catch(() => path.resolve(folder)));
    this._idFactory = deps.idFactory || randomUUID;
    this._maxQueue = deps.maxQueue || MAX_QUEUE_ITEMS;
    this._maxHistory = deps.maxHistory || MAX_HISTORY_ITEMS;
    this.queue = [];
    this.history = [];
    this.archive = [];
    this.settings = { ...DEFAULT_SETTINGS };
    this.currentDownload = null;
    this.isProcessing = false;
    this.maxConcurrent = deps.maxConcurrent ?? 1;
    if (!validConcurrency(this.maxConcurrent))
      throw new Error('Choose between 1 and 5 concurrent downloads.');
    this._active = new Map();
    this._duplicateBlockers = new Map();
    this._siteLimits = new Map();
    this._scheduling = false;
    this._shuttingDown = false;
    this._shutdownPromise = null;
    this._wakeTimer = null;
    this._batching = false;
    this._batchChanged = false;
    this._rateEpoch = 0;
    this._schedulingHolds = 0;
    if (deps.settings) this.configure(deps.settings, { start: false });
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
        attempts: 0,
        retryCount: 0,
        retryAt: null,
        private: this.settings.privateMode,
        pausedBySchedule: false,
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
      if (this.settings.globalRateKbps) this._restartForBandwidth();
      this._notify();
    }
    if (start) this.processNext();
    return this.maxConcurrent;
  }

  configure(input, { start = true } = {}) {
    if (this._shuttingDown) throw new Error('The application is shutting down.');
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('Queue settings must be an object.');
    const next = { ...this.settings };
    for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
      if (input[key] === undefined) continue;
      const value = input[key];
      if (SETTING_RANGES[key]) {
        const [minimum, maximum] = SETTING_RANGES[key];
        if (!Number.isInteger(value) || value < minimum || value > maximum)
          throw new Error(`Invalid ${key} setting.`);
      } else if (
        typeof fallback === 'boolean'
          ? typeof value !== 'boolean'
          : !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
      ) {
        throw new Error(`Invalid ${key} setting.`);
      }
      next[key] = value;
    }
    const changedRate = next.globalRateKbps !== this.settings.globalRateKbps;
    this.settings = next;
    if (changedRate) this._restartForBandwidth();
    this._pruneHistory();
    for (const active of this._active.values()) this._watch(active);
    this._notify();
    if (start) this.processNext();
    return clone(this.settings);
  }

  _restartForBandwidth() {
    this._rateEpoch++;
    for (const active of this._active.values()) {
      if (active.intent) continue;
      active.intent = 'reconfigure';
      active.download.status = 'pending';
      active.download.phase = 'pending';
      active.controller.abort();
    }
  }

  _scheduleOpen() {
    if (!this.settings.scheduleEnabled || this.settings.scheduleStart === this.settings.scheduleEnd)
      return true;
    const minutes = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    const date = new Date(this._clock());
    const current = date.getHours() * 60 + date.getMinutes();
    const start = minutes(this.settings.scheduleStart),
      end = minutes(this.settings.scheduleEnd);
    return start < end ? current >= start && current < end : current >= start || current < end;
  }

  _applySchedule() {
    const open = this._scheduleOpen();
    let changed = false;
    for (const download of this.queue) {
      if (open && download.pausedBySchedule) {
        download.pausedBySchedule = false;
        download.status = 'pending';
        download.phase = 'pending';
        changed = true;
      } else if (!open && download.status === 'downloading') {
        const active = this._active.get(download.id);
        if (active && !active.intent) {
          active.intent = 'schedule';
          active.controller.abort();
          download.status = 'paused';
          download.phase = 'waiting-schedule';
          download.pausedBySchedule = true;
          changed = true;
        }
      } else if (!open && download.status === 'pending' && download.phase !== 'waiting-schedule') {
        download.phase = 'waiting-schedule';
        changed = true;
      } else if (open && download.status === 'pending' && download.phase === 'waiting-schedule') {
        download.phase = download.retryAt ? 'waiting-retry' : 'pending';
        changed = true;
      }
    }
    if (changed) this._notify();
    return open;
  }

  _armWake() {
    if (this._wakeTimer) this._clearTimeout(this._wakeTimer);
    this._wakeTimer = null;
    if (this._shuttingDown) return;
    const now = this._clock();
    const deadlines = this.queue
      .filter((job) => job.status === 'pending' && job.retryAt)
      .map((job) => Date.parse(job.retryAt))
      .filter((time) => time > now);
    for (const limit of this._siteLimits.values()) {
      if (
        this.queue.some((job) => job.status === 'pending' && siteOrigin(job.url) === limit.origin)
      ) {
        const expiry = Date.parse(limit.limitedUntil);
        if (expiry > now) deadlines.push(expiry);
      }
    }
    // Check local wall-clock boundaries every minute, including DST and clock changes.
    if (this.settings.scheduleEnabled && this.queue.length)
      deadlines.push(now + (60000 - (now % 60000)));
    if (this.settings.historyRetentionDays) {
      const duration = this.settings.historyRetentionDays * 86400000;
      for (const entry of [...this.history, ...this.archive]) {
        const expiry = Date.parse(entry.completedAt) + duration + 1;
        if (Number.isFinite(expiry)) deadlines.push(Math.max(now + 1, expiry));
      }
    }
    if (!deadlines.length) return;
    this._wakeTimer = this._setTimeout(
      () => {
        this._wakeTimer = null;
        this.processNext();
      },
      Math.max(1, Math.min(2147483647, Math.min(...deadlines) - now)),
    );
    this._wakeTimer?.unref?.();
  }

  _recordSiteLimit(download) {
    const origin = siteOrigin(download.url);
    if (!origin) return;
    const previous = this._siteLimits.get(origin);
    const strikes = Math.min(
      6,
      (previous && Date.parse(previous.limitedUntil) > this._clock() ? previous.strikes : 0) + 1,
    );
    const seconds = Math.min(
      900,
      Math.max(30, this.settings.retryDelaySeconds) * 2 ** (strikes - 1),
    );
    const retryAt = Math.max(this._clock() + seconds * 1000, Date.parse(previous?.retryAt) || 0);
    this._siteLimits.delete(origin);
    this._siteLimits.set(origin, {
      origin,
      strikes,
      retryAt: new Date(retryAt).toISOString(),
      limitedUntil: new Date(retryAt + LIMITED_FOR).toISOString(),
      private: Boolean(download.private),
      // Private activity may extend the in-memory delay, but cannot replace or
      // disclose changes to the previously persisted public cooldown.
      ...(download.private && previous
        ? { publicLimit: previous.private ? previous.publicLimit : previous }
        : {}),
    });
    while (this._siteLimits.size > MAX_SITES)
      this._siteLimits.delete(this._siteLimits.keys().next().value);
  }

  _siteAvailable(download) {
    const origin = siteOrigin(download.url),
      limit = this._siteLimits.get(origin);
    if (!limit) return true;
    if (Date.parse(limit.limitedUntil) <= this._clock()) {
      this._siteLimits.delete(origin);
      return true;
    }
    const waiting = Date.parse(limit.retryAt) > this._clock();
    const occupied = [...this._active.values()].some(
      (active) => siteOrigin(active.download.url) === origin,
    );
    if (!waiting && !occupied) return true;
    const previousPhase = download.phase,
      previousRetry = download.retryAt;
    download.phase = 'waiting-site';
    if (waiting && (!download.retryAt || Date.parse(download.retryAt) < Date.parse(limit.retryAt)))
      download.retryAt = limit.retryAt;
    if (download.phase !== previousPhase || download.retryAt !== previousRetry)
      this._siteStateChanged = true;
    return false;
  }

  _recovery(active, value) {
    if (
      active.intent ||
      active.controller.signal.aborted ||
      !['browser-retry', 'browser-reused'].includes(value?.type)
    )
      return;
    active.download.recovery = { type: value.type };
    this._notify();
  }

  _controls(active) {
    return {
      signal: active.controller.signal,
      private: Boolean(active.download.private),
      onRecovery: (value) => this._recovery(active, value),
    };
  }

  _watch(active) {
    if (active.watchdog) this._clearTimeout(active.watchdog);
    active.watchdog = null;
    if (active.intent || this._shuttingDown) return;
    const seconds =
      active.download.phase === 'merging'
        ? this.settings.processingTimeoutSeconds
        : this.settings.stallTimeoutSeconds;
    active.watchdog = this._setTimeout(() => {
      active.watchdog = null;
      if (active.intent || this._active.get(active.download.id) !== active) return;
      active.failure = downloadError(
        'stalled',
        active.download.phase === 'merging'
          ? 'Media processing stopped responding. Retry the download or check FFmpeg.'
          : 'The download stopped making progress. Check the connection and retry.',
      );
      active.controller.abort();
    }, seconds * 1000);
    active.watchdog?.unref?.();
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

  /** Temporarily hold new starts during an installer handoff, without changing jobs. */
  holdScheduling() {
    if (this._shuttingDown) throw new Error('The application is shutting down.');
    this._schedulingHolds++;
    if (this._wakeTimer) this._clearTimeout(this._wakeTimer);
    this._wakeTimer = null;
    let released = false;
    return ({ start = true } = {}) => {
      if (released) return;
      released = true;
      this._schedulingHolds--;
      if (start) this.processNext();
    };
  }

  /** Exiting children occupy their slots and output keys until their promises settle. */
  processNext() {
    if (this._shuttingDown || this._scheduling || this._batching || this._schedulingHolds) return;
    this._scheduling = true;
    try {
      if (this._pruneHistory()) this._notify();
      if (!this._applySchedule()) return;
      // Old children retain their previous rate until they have actually exited.
      if ([...this._active.values()].some((active) => active.rateEpoch !== this._rateEpoch)) return;
      const limit = this.settings.globalRateKbps
        ? Math.min(this.maxConcurrent, this.settings.globalRateKbps)
        : this.maxConcurrent;
      while (!this._shuttingDown && this._active.size < limit) {
        const outputKeys = new Set([...this._active.values()].map((active) => active.outputKey));
        const download = this.queue.find(
          (item) =>
            item.status === 'pending' &&
            this._siteAvailable(item) &&
            (!item.retryAt || Date.parse(item.retryAt) <= this._clock()) &&
            (!this._duplicateBlockers.has(item.id) ||
              !this._active.has(this._duplicateBlockers.get(item.id))) &&
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
          reservation: 0,
          volumeId: null,
          sourceKey: null,
          watchdog: null,
          failure: null,
          rateEpoch: this._rateEpoch,
        };
        this._active.set(download.id, active);
        this._syncActiveState();
        download.status = 'downloading';
        download.phase = 'preparing';
        download.startedAt = this._now();
        download.error = null;
        download.errorCode = null;
        download.errorAction = null;
        download.errorRetryable = false;
        delete download.recovery;
        download.retryAt = null;
        this._duplicateBlockers.delete(download.id);
        this._watch(active);
        // Promise assignment precedes events so reentrant shutdown can wait for every child.
        active.promise = Promise.resolve().then(() => this._run(active));
        this.emit('download-started', clone(download));
        this._notify();
      }
    } finally {
      if (this._siteStateChanged) {
        this._siteStateChanged = false;
        this._notify();
      }
      this._scheduling = false;
      this._armWake();
    }
  }

  _wait(active, phase, milliseconds = 0) {
    const { download } = active;
    download.status = 'pending';
    download.phase = phase;
    download.retryAt = milliseconds ? new Date(this._clock() + milliseconds).toISOString() : null;
    this._notify();
  }

  async _prepare(active) {
    const { download, controller } = active;
    let metadata;
    if (this._prepareDownload) {
      metadata = await this._prepareDownload(download.url, clone(download.options), {
        ...this._controls(active),
      });
      if (controller.signal.aborted) return false;
      if (metadata && typeof metadata === 'object') {
        download.metadata = sanitizeMetadata(metadata);
        if (download.metadata?.title) download.title = download.metadata.title;
      }
    }
    if (
      typeof metadata?.id === 'string' &&
      metadata.id.trim() &&
      typeof metadata?.extractor === 'string' &&
      metadata.extractor.trim()
    ) {
      let root = await this._realpath(download.outputPath);
      if (controller.signal.aborted) return false;
      if (process.platform === 'win32') root = root.toLowerCase();
      const profile = hash(
        JSON.stringify([
          download.options.quality,
          download.options.formatId || '',
          download.options.audioFormat || '',
          Boolean(download.options.subtitles),
          Boolean(download.options.subtitleAuto),
          download.options.subtitleLang || '',
        ]),
      ).slice(0, 16);
      // Generic IDs are often only a filename and are not unique across websites.
      const sourceId = /^(?:generic|html5)$/i.test(metadata.extractor)
        ? resourceUrl(download.url)
        : metadata.id;
      active.sourceKey = hash(
        JSON.stringify([root, metadata.extractor.toLowerCase(), sourceId, profile]),
      );
      active.source = {
        key: active.sourceKey,
        extractor: metadata.extractor.slice(0, 256),
        id: metadata.id.slice(0, 256),
        profile,
      };
      const duplicate =
        this.settings.skipDuplicates &&
        [...this._active.values()].find(
          (other) => other !== active && other.sourceKey === active.sourceKey,
        );
      if (duplicate) {
        // This attempt does not own the source claim; the older holder remains authoritative.
        active.sourceKey = null;
        this._duplicateBlockers.set(download.id, duplicate.download.id);
        this._wait(active, 'waiting-duplicate');
        return false;
      }
      const archived =
        this.settings.skipDuplicates && this.archive.find((item) => item.key === active.sourceKey);
      if (archived) {
        const exists = await this._fileExists(archived.filepath);
        if (controller.signal.aborted) return false;
        if (exists) {
          download.filepath = archived.filepath;
          this._finish(download, 'skipped');
          return false;
        }
        this.archive = this.archive.filter((item) => item.key !== archived.key);
      }
    }
    if (this._getDiskSpace) {
      let disk;
      try {
        disk = await this._getDiskSpace(download.outputPath);
      } catch {
        disk = { available: false };
      }
      if (controller.signal.aborted) return false;
      active.volumeId = typeof disk?.volumeId === 'string' ? disk.volumeId : null;
      const sizes = [metadata?.filesize, metadata?.filesizeApprox].filter(
        (value) => Number.isFinite(value) && value > 0,
      );
      const estimate = sizes.length
        ? Math.min(
            Number.MAX_SAFE_INTEGER,
            Math.max(...sizes) * (download.options.quality === 'audio' ? 3 : 2),
          )
        : 0;
      const reserved = [...this._active.values()]
        .filter(
          (other) =>
            other !== active &&
            (!active.volumeId || !other.volumeId || other.volumeId === active.volumeId),
        )
        .reduce((sum, other) => sum + other.reservation, 0);
      const known = disk?.available !== false && Number.isFinite(disk?.free) && disk.free >= 0;
      download.disk = {
        available: known,
        free: known ? disk.free : null,
        estimatedBytes: estimate || null,
        reservedBytes: reserved,
      };
      if (known && disk.free - reserved - estimate < this.settings.diskReserveMb * 1024 * 1024) {
        download.errorCode = 'disk-full';
        download.errorAction = 'free-space';
        this._wait(active, 'waiting-disk', 30000);
        return false;
      }
      // Check-and-reserve has no await between it: simultaneous preflights cannot overbook.
      active.reservation = estimate;
    }
    return true;
  }

  _optionsForRun(active) {
    const options = clone(active.download.options);
    if (this.settings.globalRateKbps) {
      // Rates are integers in KiB/s. A very small cap also limits effective concurrency.
      const slots = Math.min(this.maxConcurrent, this.settings.globalRateKbps);
      const share = Math.floor(this.settings.globalRateKbps / slots);
      options.rateLimitKbps = options.rateLimitKbps
        ? Math.min(options.rateLimitKbps, share)
        : share;
    }
    active.download.effectiveRateKbps = options.rateLimitKbps || 0;
    return options;
  }

  _failure(active, error) {
    const { download } = active;
    const classified = classifyDownloadError(error);
    download.error = redactErrorText(
      typeof error === 'string' ? error : error?.message || 'Download failed.',
      download,
    );
    download.errorCode = classified.code;
    download.errorAction = classified.action;
    download.errorRetryable = classified.retryable;
    if (classified.code === 'rate-limit') this._recordSiteLimit(download);
    if (classified.retryable && (download.retryCount || 0) < this.settings.retryAttempts) {
      download.retryCount = (download.retryCount || 0) + 1;
      const delay = Math.min(900, this.settings.retryDelaySeconds * 2 ** (download.retryCount - 1));
      this._wait(
        active,
        classified.code === 'rate-limit' ? 'waiting-site' : 'waiting-retry',
        delay * 1000,
      );
      if (classified.code === 'rate-limit') this._siteAvailable(download);
      this.emit('download-retrying', clone(download));
    } else {
      this._finish(download, 'failed', download.error);
    }
  }

  async _run(active) {
    const { download, controller } = active;
    try {
      if (controller.signal.aborted) return;
      download.attempts = (download.attempts || 0) + 1;
      if (!(await this._prepare(active))) {
        if (active.failure && !active.intent) this._failure(active, active.failure);
        return;
      }
      if (controller.signal.aborted) return;
      const result = await this._downloadVideo(
        download.url,
        download.outputPath,
        this._optionsForRun(active),
        (progress) => this._progress(active, progress),
        this._controls(active),
      );
      // User intent wins even when process completion and abort race each other.
      if (active.intent) return;
      if (active.failure) {
        this._failure(active, active.failure);
        return;
      }
      if (result?.success && isAbsoluteFilePath(result.filepath)) {
        download.filepath = result.filepath;
        if (result.metadata) download.metadata = sanitizeMetadata(result.metadata);
        if (download.metadata?.title) download.title = download.metadata.title;
        if (typeof result.title === 'string') download.title = result.title.slice(0, 512);
        if (result.integrity) download.integrity = clone(result.integrity);
        if (active.source && !download.private) {
          this.archive = this.archive.filter((item) => item.key !== active.source.key);
          this.archive.unshift({
            ...active.source,
            completedAt: this._now(),
            filepath: download.filepath,
            outputPath: download.outputPath,
          });
          this.archive = this.archive.slice(0, MAX_ARCHIVE);
        }
        this._finish(download, 'completed');
      } else {
        this._failure(
          active,
          downloadError(
            result?.errorCode,
            result?.error || 'The download did not produce a usable file.',
          ),
        );
      }
    } catch (error) {
      if (!active.intent) this._failure(active, active.failure || error);
    } finally {
      if (active.watchdog) this._clearTimeout(active.watchdog);
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
      active.failure ||
      !progress ||
      typeof progress !== 'object'
    )
      return;
    const download = active.download;
    const previousProgress = download.progress;
    const previousPhase = download.phase;
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
    const bytes = progress.downloadedBytes ?? progress.downloaded_bytes;
    if (
      download.progress > previousProgress ||
      download.phase !== previousPhase ||
      (Number.isFinite(bytes) && bytes > (active.lastBytes || 0))
    )
      this._watch(active);
    if (Number.isFinite(bytes)) active.lastBytes = Math.max(active.lastBytes || 0, bytes);
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
    download.retryAt = null;
    download.pausedBySchedule = false;
    this._duplicateBlockers.delete(download.id);
    download.error = error
      ? redactErrorText(typeof error === 'string' ? error : error.message, download)
      : null;
    if (status === 'completed') download.progress = 100;
    this.queue = this.queue.filter((item) => item.id !== download.id);
    if (!download.private) this.history.unshift(download);
    this._pruneHistory();
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
    if (
      !download ||
      (!['pending', 'downloading'].includes(download.status) && !download.pausedBySchedule) ||
      this._shuttingDown
    )
      return false;
    const active = this._active.get(id);
    if (active) {
      active.intent = 'pause';
      active.controller.abort();
    }
    download.status = 'paused';
    download.phase = 'paused';
    download.pausedBySchedule = false;
    this.emit('download-paused', clone(download));
    this._notify();
    this.processNext();
    return true;
  }

  resumeDownload(id) {
    const download = this.queue.find((item) => item.id === id && item.status === 'paused');
    if (!download || download.optionsNeedReview || this._shuttingDown) return false;
    download.status = 'pending';
    download.phase = 'pending';
    download.pausedBySchedule = false;
    download.retryAt = null;
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
    return download && !download.optionsNeedReview
      ? this.addDownload(download.url, download.outputPath, download.options)
      : null;
  }

  retryWithOptions(id, overrideOptions = {}, outputPath) {
    const reviewJob = this.queue.find(
      (item) => item.id === id && item.status === 'paused' && item.optionsNeedReview,
    );
    const download =
      reviewJob ||
      this.history.find((item) => item.id === id && ['failed', 'cancelled'].includes(item.status));
    if (!download || this._shuttingDown) return null;
    const original = download.options;
    const safeOriginal = {};
    for (const key of [
      'quality',
      'formatId',
      'audioFormat',
      'subtitles',
      'subtitleAuto',
      'subtitleLang',
      'rateLimitKbps',
    ]) {
      if (original[key] !== undefined) safeOriginal[key] = original[key];
    }
    if (overrideOptions.quality !== undefined && overrideOptions.formatId === undefined)
      delete safeOriginal.formatId;
    const options = normalizeOptions({
      ...safeOriginal,
      ...overrideOptions,
    });
    const folder = outputPath || download.outputPath;
    if (reviewJob) {
      if (!isAbsoluteFilePath(folder)) throw new Error('Choose a valid download folder.');
      // Review jobs retain their slot and ID, including a completely full queue.
      // Only this explicit options submission can make them runnable again.
      Object.assign(reviewJob, {
        options,
        outputPath: folder,
        status: 'pending',
        phase: 'pending',
        error: null,
        errorCode: null,
        errorAction: null,
        errorRetryable: false,
        retryCount: 0,
        retryAt: null,
        pausedBySchedule: false,
      });
      delete reviewJob.optionsNeedReview;
      this._notify();
      this.processNext();
      return reviewJob.id;
    }
    return this.addDownload(download.url, folder, options);
  }

  /** Validate the complete selection before changing any jobs. Ineligible states are skipped. */
  bulkAction(action, ids, targetIndex) {
    if (this._shuttingDown) throw new Error('The application is shutting down.');
    if (!['pause', 'resume', 'cancel', 'retry', 'move'].includes(action))
      throw new Error('Unknown queue action.');
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > MAX_QUEUE_ITEMS ||
      ids.some((id) => typeof id !== 'string')
    )
      throw new Error('Select between 1 and 500 jobs.');
    const selected = new Set(ids);
    const source = action === 'retry' ? this.history : this.queue;
    if ([...selected].some((id) => !source.some((job) => job.id === id)))
      throw new Error('A selected job is no longer available.');
    const downloads = source.filter((job) => selected.has(job.id));
    if (action === 'retry') {
      const eligible = downloads.filter(
        (job) => ['failed', 'cancelled'].includes(job.status) && !job.optionsNeedReview,
      );
      if (this.queue.length + eligible.length > this._maxQueue)
        throw new Error('The download queue is full.');
      for (const job of eligible) normalizeOptions(job.options);
    }
    if (
      action === 'move' &&
      (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= this.queue.length)
    )
      throw new Error('Choose a valid queue position.');
    const affected = [];
    this._batching = true;
    try {
      if (action === 'move') {
        const moving = downloads.filter(
          (job) => ['pending', 'paused'].includes(job.status) && !this._active.has(job.id),
        );
        const movingIds = new Set(moving.map((job) => job.id));
        this.queue = this.queue.filter((job) => !movingIds.has(job.id));
        this.queue.splice(Math.min(targetIndex, this.queue.length), 0, ...moving);
        affected.push(...movingIds);
        if (moving.length) this._notify();
      } else {
        const method = {
          pause: 'pauseDownload',
          resume: 'resumeDownload',
          cancel: 'cancelDownload',
          retry: 'retryDownload',
        }[action];
        for (const job of downloads) if (this[method](job.id)) affected.push(job.id);
      }
    } finally {
      this._batching = false;
      if (this._batchChanged) {
        this._batchChanged = false;
        this._notify();
      }
      this.processNext();
    }
    return affected;
  }

  _pruneHistory() {
    const before = this.history.length + this.archive.length;
    const cutoff = this.settings.historyRetentionDays
      ? this._clock() - this.settings.historyRetentionDays * 86400000
      : -Infinity;
    this.history = this.history
      .filter((job) => !job.private && (!job.completedAt || Date.parse(job.completedAt) >= cutoff))
      .slice(0, this._maxHistory);
    this.archive = boundedArchive(
      this.archive.filter((item) => Date.parse(item.completedAt) >= cutoff),
    );
    return before !== this.history.length + this.archive.length;
  }

  deleteHistory(ids) {
    if (
      !Array.isArray(ids) ||
      ids.length > this._maxHistory ||
      ids.some((id) => typeof id !== 'string')
    )
      throw new Error('Select valid history entries.');
    const selected = new Set(ids);
    const paths = new Set(
      this.history
        .filter((job) => selected.has(job.id))
        .map((job) => job.filepath)
        .filter(Boolean),
    );
    const before = this.history.length;
    this.history = this.history.filter((job) => !selected.has(job.id));
    this.archive = this.archive.filter((item) => !paths.has(item.filepath));
    if (before !== this.history.length) this._notify();
    return before - this.history.length;
  }

  getQueueState() {
    return clone({
      queue: this.queue,
      history: this.history,
      currentDownload: this.currentDownload,
      isProcessing: this.isProcessing,
      activeIds: [...this._active.keys()],
      maxConcurrent: this.maxConcurrent,
      settings: this.settings,
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
    this.archive = restored.archive || [];
    this._siteLimits = new Map(
      sanitizeSiteLimits(restored.siteLimits, this._clock()).map((item) => [item.origin, item]),
    );
    this._duplicateBlockers.clear();
    this._pruneHistory();
    this._notify();
    if (start) this.processNext();
    return restored.warnings;
  }

  getStateForSave() {
    const siteLimits = sanitizeSiteLimits(
      [...this._siteLimits.values()]
        .map((item) => (item.private ? item.publicLimit : item))
        .filter(Boolean),
      this._clock(),
    );
    return clone({
      schemaVersion: SCHEMA_VERSION,
      queue: this.queue.filter((job) => !job.private),
      history: this.history.filter((job) => !job.private),
      archive: boundedArchive(this.archive),
      ...(siteLimits.length ? { siteLimits } : {}),
    });
  }

  clearHistory() {
    const removed = this.history.length;
    this.history = [];
    this.archive = [];
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
    if (this._wakeTimer) this._clearTimeout(this._wakeTimer);
    this._wakeTimer = null;
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
    for (const active of activeJobs) {
      if (active.watchdog) this._clearTimeout(active.watchdog);
      active.controller.abort();
    }
    this._notify();
    return this._shutdownPromise;
  }

  _notify() {
    if (this._batching) {
      this._batchChanged = true;
      return;
    }
    this.emit('queue-updated', this.getQueueState());
  }
}

module.exports = DownloadQueue;
module.exports.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
