const { validateUrl } = require('./downloadOptions');

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 100;

function originOf(url) {
  try {
    return new URL(validateUrl(url)).origin;
  } catch {
    return null;
  }
}

/** Only successful, public origin preferences are retained. Never persist source URLs. */
function createSiteCompatibility({ load = () => [], save = () => {}, now = Date.now } = {}) {
  let entries = [];
  try {
    const raw = load();
    if (Array.isArray(raw)) entries = raw.slice(-MAX_ENTRIES * 2);
  } catch {
    /* A missing or damaged preference cache must not block downloads. */
  }
  function prune() {
    const current = now();
    const unique = new Map();
    for (const entry of entries) {
      if (
        !entry ||
        typeof entry.origin !== 'string' ||
        entry.origin !== originOf(entry.origin) ||
        typeof entry.version !== 'string' ||
        !/^[\w.-]{1,80}$/u.test(entry.version) ||
        !Number.isFinite(entry.expiresAt) ||
        entry.expiresAt <= current ||
        entry.expiresAt > current + TTL_MS
      )
        continue;
      unique.delete(entry.origin);
      unique.set(entry.origin, {
        origin: entry.origin,
        version: entry.version,
        expiresAt: entry.expiresAt,
      });
    }
    entries = [...unique.values()].slice(-MAX_ENTRIES);
  }
  function persist() {
    try {
      save(entries.map((entry) => ({ ...entry })));
    } catch {
      /* Preferences are best-effort; media operations remain usable. */
    }
  }
  function isCompatible(url, version, control = {}) {
    if (control.private) return false;
    prune();
    const origin = originOf(url);
    return entries.some((entry) => entry.origin === origin && entry.version === version);
  }
  function remember(url, version, control = {}) {
    if (control.private) return false;
    const origin = originOf(url);
    if (!origin || typeof version !== 'string' || !/^[\w.-]{1,80}$/u.test(version)) return false;
    prune();
    entries = entries.filter((entry) => entry.origin !== origin);
    entries.push({ origin, version, expiresAt: now() + TTL_MS });
    entries = entries.slice(-MAX_ENTRIES);
    persist();
    return true;
  }
  function list() {
    prune();
    return entries.map((entry) => ({ ...entry }));
  }
  function clear(origin) {
    prune();
    const before = entries.length;
    entries =
      origin === undefined ? [] : entries.filter((entry) => entry.origin !== originOf(origin));
    persist();
    return before - entries.length;
  }
  prune();
  return { isCompatible, remember, list, clear };
}

module.exports = { createSiteCompatibility, TTL_MS, MAX_ENTRIES };
