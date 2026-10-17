const MAX_SITES = 100;
const LIMITED_FOR = 15 * 60 * 1000;

function siteOrigin(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** No paths, cookies or media identifiers are retained in the site cooldown. */
function sanitizeSiteLimits(raw, now = Date.now()) {
  const sites = new Map();
  for (const item of (Array.isArray(raw) ? raw : []).slice(0, MAX_SITES)) {
    if (!item || typeof item !== 'object') continue;
    const origin = siteOrigin(item.origin);
    if (!origin || origin !== item.origin || origin.length > 2048) continue;
    const retryAt = Date.parse(item.retryAt),
      limitedUntil = Date.parse(item.limitedUntil);
    if (
      !Number.isFinite(retryAt) ||
      !Number.isFinite(limitedUntil) ||
      limitedUntil <= now ||
      limitedUntil > now + 2 * LIMITED_FOR ||
      retryAt > limitedUntil ||
      !Number.isInteger(item.strikes) ||
      item.strikes < 1 ||
      item.strikes > 6
    )
      continue;
    sites.set(origin, {
      origin,
      retryAt: new Date(retryAt).toISOString(),
      limitedUntil: new Date(limitedUntil).toISOString(),
      strikes: item.strikes,
    });
  }
  return [...sites.values()];
}

module.exports = { siteOrigin, sanitizeSiteLimits, MAX_SITES, LIMITED_FOR };
