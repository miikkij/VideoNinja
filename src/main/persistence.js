const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { normalizeOptions, validateUrl } = require('./downloadOptions');

const SCHEMA_VERSION = 1;
const MAX_QUEUE_ITEMS = 500;
const MAX_HISTORY_ITEMS = 100;
const MAX_ERROR_LENGTH = 2000;
const MAX_CONFIG_BYTES = 10 * 1024 * 1024;
const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled']);
const isRecord = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

/** Legacy diagnostics may contain authentication values and machine-local paths. */
function redactErrorText(value, job = {}) {
  let message = typeof value === 'string' ? value.slice(0, 16000) : '';
  for (const secret of [
    job.outputPath,
    job.filepath,
    job.options?.cookieFile,
    job.options?.userAgent,
  ]) {
    if (typeof secret === 'string' && secret) message = message.split(secret).join('[redacted]');
  }
  return message
    .replace(/https?:\/\/[^\s<>"']+/gi, '[URL]')
    .replace(/(["'])(?:[A-Za-z]:[\\/]|\/)[^"'\r\n]+\1/g, '[path]')
    .replace(/\b[A-Za-z]:[\\/][^\s"'<>]+/g, '[path]')
    .replace(/\/(?:Users|home|tmp|private|var|mnt|media|Volumes|run)\/[^\s"'<>]+/g, '[path]')
    .replace(
      /\b(?:authorization|cookie|set-cookie|password|token|api[-_]?key)\s*[:=]\s*[^\r\n]+/gi,
      '[credential redacted]',
    )
    .slice(0, MAX_ERROR_LENGTH);
}

function isAbsoluteFilePath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 4096 &&
    [...value].every(
      (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
    ) &&
    (path.isAbsolute(value) || path.win32.isAbsolute(value))
  );
}

function sanitizeMetadata(value) {
  if (!isRecord(value)) return undefined;
  const result = {};
  for (const key of ['id', 'title', 'ext']) {
    if (typeof value[key] === 'string')
      result[key] = value[key].slice(0, key === 'title' ? 512 : 256);
  }
  if (Number.isFinite(value.duration) && value.duration >= 0)
    result.duration = Math.min(value.duration, 31536000);
  return result;
}

/** Recover settings independently, so one obsolete option does not erase the folder. */
function sanitizeSettings(raw) {
  const input =
    isRecord(raw) &&
    (raw.schemaVersion === undefined || [0, SCHEMA_VERSION].includes(raw.schemaVersion))
      ? raw
      : {};
  const result = {
    schemaVersion: SCHEMA_VERSION,
    language: 'en',
    quality: 'best',
    jsRuntime: 'auto',
  };
  if (isAbsoluteFilePath(input.downloadPath)) result.downloadPath = input.downloadPath;
  if (isAbsoluteFilePath(input.cookieFilePath)) result.cookieFilePath = input.cookieFilePath;
  if (['en', 'fi'].includes(input.language)) result.language = input.language;
  if (
    [
      '',
      'file',
      'chrome',
      'chromium',
      'edge',
      'firefox',
      'brave',
      'opera',
      'safari',
      'vivaldi',
    ].includes(input.cookieSource)
  )
    result.cookieSource = input.cookieSource;
  for (const key of ['quality', 'jsRuntime', 'userAgent', 'extraArgs']) {
    if (input[key] === undefined) continue;
    try {
      const normalized = normalizeOptions({ [key]: input[key] });
      if (normalized[key] !== undefined)
        result[key] = key === 'extraArgs' ? normalized[key].join(' ') : normalized[key];
    } catch {
      // Invalid and removed options are deliberately not restored.
    }
  }
  return result;
}

function sanitizeWindowBounds(raw) {
  if (!isRecord(raw)) return undefined;
  const result = {};
  for (const key of ['width', 'height']) {
    if (!Number.isInteger(raw[key]) || raw[key] < 320 || raw[key] > 10000) return undefined;
    result[key] = raw[key];
  }
  for (const key of ['x', 'y']) {
    if (Number.isInteger(raw[key]) && Math.abs(raw[key]) <= 100000) result[key] = raw[key];
  }
  return result;
}

function timestamp(value, fallback = null) {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value))
    ? value
    : fallback;
}

/** Migrate unversioned data and reject malformed entries before the queue can execute them. */
function sanitizeQueueState(
  raw,
  {
    maxQueue = MAX_QUEUE_ITEMS,
    maxHistory = MAX_HISTORY_ITEMS,
    idFactory = randomUUID,
    now = () => new Date().toISOString(),
  } = {},
) {
  const result = { schemaVersion: SCHEMA_VERSION, queue: [], history: [], warnings: [] };
  if (raw === undefined || raw === null) return result;
  if (
    !isRecord(raw) ||
    (raw.schemaVersion !== undefined && ![0, SCHEMA_VERSION].includes(raw.schemaVersion))
  ) {
    result.warnings.push('Unsupported or invalid saved queue was not restored.');
    return result;
  }
  const ids = new Set();
  let dropped = 0;
  let migratedIds = 0;
  const restore = (entry, fromHistory) => {
    if (!isRecord(entry) || !isAbsoluteFilePath(entry.outputPath)) throw new Error('Invalid job.');
    if (entry.options !== undefined && !isRecord(entry.options))
      throw new Error('Invalid saved options.');
    let id = entry.id;
    if (id === undefined && !raw.schemaVersion) {
      id = idFactory();
      migratedIds++;
    }
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id) || ids.has(id))
      throw new Error('Invalid or duplicate ID.');
    let status = entry.status;
    if (['downloading', 'merging'].includes(status)) status = 'pending';
    if (status === 'pausing') status = 'paused';
    if (status === 'cancelling') status = 'cancelled';
    if (
      !['pending', 'paused', ...TERMINAL_STATES].includes(status) ||
      (fromHistory && !TERMINAL_STATES.has(status))
    )
      throw new Error('Invalid state.');
    const restored = {
      id,
      url: validateUrl(entry.url),
      outputPath: entry.outputPath,
      options: normalizeOptions(isRecord(entry.options) ? entry.options : {}),
      status,
      phase: status,
      progress:
        status === 'completed'
          ? 100
          : Math.max(0, Math.min(100, Number.isFinite(entry.progress) ? entry.progress : 0)),
      title: text(entry.title, 512),
      metadata: sanitizeMetadata(entry.metadata),
      addedAt: timestamp(entry.addedAt, now()),
      startedAt: timestamp(entry.startedAt),
      completedAt: TERMINAL_STATES.has(status) ? timestamp(entry.completedAt, now()) : null,
      error: typeof entry.error === 'string' ? redactErrorText(entry.error, entry) : null,
      filepath: isAbsoluteFilePath(entry.filepath) ? entry.filepath : null,
    };
    const destination = TERMINAL_STATES.has(status) ? result.history : result.queue;
    if (destination.length >= (TERMINAL_STATES.has(status) ? maxHistory : maxQueue))
      throw new Error('Saved job limit reached.');
    ids.add(id);
    destination.push(restored);
  };
  for (const [key, limit] of [
    ['queue', maxQueue + maxHistory],
    ['history', maxHistory],
  ]) {
    if (raw[key] === undefined) continue;
    if (!Array.isArray(raw[key])) {
      result.warnings.push(`Saved ${key} was not a list and was ignored.`);
      continue;
    }
    dropped += Math.max(0, raw[key].length - limit);
    for (const entry of raw[key].slice(0, limit)) {
      try {
        restore(entry, key === 'history');
      } catch {
        dropped++;
      }
    }
  }
  if (dropped)
    result.warnings.push(`${dropped} invalid, duplicate or excess saved jobs were ignored.`);
  if (migratedIds) result.warnings.push(`${migratedIds} legacy jobs received new IDs.`);
  return result;
}

/** electron-store adapter. The caller constructs Store after optional raw-file recovery. */
function loadPersistedState(store) {
  const queueState = sanitizeQueueState(store.get('queueState'));
  const settings = store.get('settings');
  const warnings = [...queueState.warnings];
  if (
    isRecord(settings) &&
    settings.schemaVersion !== undefined &&
    ![0, SCHEMA_VERSION].includes(settings.schemaVersion)
  )
    warnings.push('Unsupported settings version was not restored.');
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: sanitizeSettings(settings),
    windowBounds: sanitizeWindowBounds(store.get('windowBounds')),
    queueState,
    warnings,
  };
}

/** Durable transitions write immediately; progress events never write the entire queue. */
function attachQueuePersistence(queue, store, { onError = () => {} } = {}) {
  let previous;
  const checkpoint = () => {
    const state = queue.getStateForSave();
    const serialized = JSON.stringify(state);
    if (serialized === previous) return true;
    try {
      store.set('queueState', state);
      previous = serialized;
      return true;
    } catch (error) {
      onError(error);
      return false;
    }
  };
  queue.on('queue-updated', checkpoint);
  return { checkpoint, dispose: () => queue.off('queue-updated', checkpoint) };
}

function quarantineCorruptConfig(
  filePath,
  { fs: fileSystem = fs, now = () => new Date().toISOString(), idFactory = randomUUID } = {},
) {
  const suffix = `${now().replace(/[^0-9A-Za-z_-]/g, '-')}-${idFactory()}`;
  const quarantinedPath = `${filePath}.corrupt-${suffix}`;
  fileSystem.renameSync(filePath, quarantinedPath);
  return quarantinedPath;
}

/** Call before new Store(). Preserve corrupt bytes; never silently overwrite unreadable data. */
function readConfiguration(filePath, { fs: fileSystem = fs, ...options } = {}) {
  let contents;
  try {
    const stat = fileSystem.statSync(filePath);
    if (stat.size > MAX_CONFIG_BYTES) throw new Error('Configuration is too large to load safely.');
    contents = fileSystem.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { data: {}, quarantinedPath: null, warnings: [] };
    throw error;
  }
  try {
    const data = JSON.parse(contents);
    if (!isRecord(data)) throw new SyntaxError('Configuration must be an object.');
    return { data, quarantinedPath: null, warnings: [] };
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    const quarantinedPath = quarantineCorruptConfig(filePath, { fs: fileSystem, ...options });
    return {
      data: {},
      quarantinedPath,
      warnings: [
        'Damaged configuration was preserved in a separate file. Settings have been reset.',
      ],
    };
  }
}

module.exports = {
  SCHEMA_VERSION,
  MAX_QUEUE_ITEMS,
  MAX_HISTORY_ITEMS,
  MAX_ERROR_LENGTH,
  isAbsoluteFilePath,
  redactErrorText,
  sanitizeSettings,
  sanitizeWindowBounds,
  sanitizeQueueState,
  sanitizeMetadata,
  loadPersistedState,
  attachQueuePersistence,
  quarantineCorruptConfig,
  readConfiguration,
};
