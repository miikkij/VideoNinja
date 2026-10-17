import { describe, it, expect, vi } from 'vitest';
import module from '../../src/main/siteCompatibility.js';

const { createSiteCompatibility, TTL_MS } = module;
const version = '2026.10.14';

describe('bounded origin compatibility preferences', () => {
  it('stores only origins, expires in seven days and matches the tool version', () => {
    let time = 1000;
    const save = vi.fn();
    const cache = createSiteCompatibility({ save, now: () => time });
    expect(cache.remember('https://example.test/private/path?token=secret#private', version)).toBe(
      true,
    );
    expect(save).toHaveBeenCalledWith([
      { origin: 'https://example.test', version, expiresAt: 1000 + TTL_MS },
    ]);
    expect(cache.isCompatible('https://example.test/another', version)).toBe(true);
    expect(cache.isCompatible('https://example.test/', '2026.10.15')).toBe(false);
    expect(cache.isCompatible('https://sub.example.test/', version)).toBe(false);
    time += TTL_MS;
    expect(cache.list()).toEqual([]);
  });

  it('neither reads nor learns preferences for private operations', () => {
    const save = vi.fn();
    const cache = createSiteCompatibility({ save });
    cache.remember('https://example.test', version);
    save.mockClear();
    expect(cache.isCompatible('https://example.test', version, { private: true })).toBe(false);
    expect(cache.remember('https://other.test/private', version, { private: true })).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(cache.list()).toHaveLength(1);
  });

  it('sanitizes restored values without mutating storage and bounds entries to 100', () => {
    const raw = [
      { origin: 'https://valid.test', version, expiresAt: 2000, secret: 'discard' },
      { origin: 'https://invalid.test/private', version, expiresAt: 2000 },
      { origin: 'https://user:secret@bad.test', version, expiresAt: 2000 },
      { origin: 'https://expired.test', version, expiresAt: 500 },
      { origin: 'https://forever.test', version, expiresAt: Number.MAX_SAFE_INTEGER },
    ];
    const cache = createSiteCompatibility({ load: () => raw, now: () => 1000 });
    expect(cache.list()).toEqual([{ origin: 'https://valid.test', version, expiresAt: 2000 }]);
    expect(raw[0].secret).toBe('discard');
    for (let index = 0; index < 101; index++) cache.remember(`https://site${index}.test`, version);
    expect(cache.list()).toHaveLength(100);
    expect(cache.isCompatible('https://site0.test', version)).toBe(false);
    const view = cache.list();
    view[0].origin = 'https://tampered.test';
    expect(cache.list()[0].origin).not.toBe(view[0].origin);
  });

  it('clears one origin or all and tolerates broken optional storage', () => {
    const cache = createSiteCompatibility({
      load: () => {
        throw new Error('storage');
      },
      save: () => {
        throw new Error('storage');
      },
    });
    cache.remember('https://one.test/path', version);
    cache.remember('https://two.test/path', version);
    expect(cache.clear('https://one.test')).toBe(1);
    expect(cache.clear()).toBe(1);
    expect(cache.list()).toEqual([]);
    expect(cache.remember('https://name:secret@example.test/', version)).toBe(false);
  });
});
