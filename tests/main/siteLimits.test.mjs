import { describe, it, expect } from 'vitest';
import limits from '../../src/main/siteLimits.js';
import persistence from '../../src/main/persistence.js';

const now = Date.parse('2026-10-17T12:00:00.000Z');
const entry = {
  origin: 'https://example.com',
  retryAt: new Date(now + 30000).toISOString(),
  limitedUntil: new Date(now + 930000).toISOString(),
  strikes: 1,
};

describe('persisted site cooldown boundaries', () => {
  it('keeps only exact safe origins with bounded deadlines and no extra fields', () => {
    const values = [
      { ...entry, cookie: 'secret', url: 'https://example.com/private' },
      { ...entry, origin: 'https://example.com/private' },
      { ...entry, origin: 'https://user:password@example.com' },
      { ...entry, origin: 'file:///private' },
      { ...entry, limitedUntil: new Date(now - 1).toISOString() },
      { ...entry, limitedUntil: new Date(now + 86400000).toISOString() },
      { ...entry, retryAt: new Date(now + 2000000).toISOString() },
      { ...entry, strikes: 99 },
    ];
    expect(limits.sanitizeSiteLimits(values, now)).toEqual([entry]);
    expect(
      persistence.sanitizeQueueState(
        { siteLimits: values },
        { now: () => new Date(now).toISOString() },
      ).siteLimits,
    ).toEqual([entry]);
  });
  it('bounds the persisted map and rejects non-arrays', () => {
    expect(limits.sanitizeSiteLimits({}, now)).toEqual([]);
    const values = Array.from({ length: 120 }, (_, index) => ({
      ...entry,
      origin: `https://site${index}.example`,
    }));
    expect(limits.sanitizeSiteLimits(values, now)).toHaveLength(100);
  });
});
