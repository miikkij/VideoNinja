import { describe, it, expect, vi } from 'vitest';
import module from '../../src/main/appRelease.js';

const { createAppRelease } = module;
const version = '1.2.1';
const notes = {
  schemaVersion: 1,
  releases: [
    {
      version,
      date: '2026-10-18',
      notes: { en: ['Browser compatibility'], fi: ['Selainyhteensopivuus'] },
    },
    {
      version: '1.2.0',
      date: '2026-10-17',
      notes: { en: ['Older release'], fi: ['Vanha julkaisu'] },
    },
  ],
};

function storage(initial) {
  let value = structuredClone(initial);
  return {
    load: vi.fn(() => structuredClone(value)),
    save: vi.fn((next) => {
      value = structuredClone(next);
    }),
    read: () => structuredClone(value),
  };
}

describe('installed release acknowledgement', () => {
  it.each([undefined, null, {}, { settings: { schemaVersion: 1 }, queueState: { history: [{}] } }])(
    'does not invent an upgrade source from absent or legacy state: %j',
    (initial) => {
      const store = storage(initial);
      const release = createAppRelease({ version, notes, ...store });
      expect(release.getState()).toEqual({
        version,
        previousVersion: null,
        showNotice: true,
        notes: notes.releases[0].notes,
      });
      expect(store.read()).toEqual({ version, previousVersion: null, acknowledged: false });
    },
  );

  it('persists acknowledgement and does not show or rewrite it on every restart', () => {
    const store = storage();
    const release = createAppRelease({ version, notes, ...store });
    expect(release.acknowledge(version)).toEqual({ acknowledged: true });
    expect(release.getState().showNotice).toBe(false);
    const writes = store.save.mock.calls.length;
    const restarted = createAppRelease({ version, notes, ...store });
    expect(restarted.getState()).toEqual(release.getState());
    expect(restarted.acknowledge(version)).toEqual({ acknowledged: true });
    expect(store.save).toHaveBeenCalledTimes(writes);
  });

  it('retains a real previous version across restarts before and after acknowledgement', () => {
    const store = storage({ version: '1.2.0', previousVersion: null, acknowledged: true });
    const release = createAppRelease({ version, notes, ...store });
    expect(release.getState()).toMatchObject({ previousVersion: '1.2.0', showNotice: true });
    const restarted = createAppRelease({ version, notes, ...store });
    expect(restarted.getState()).toEqual(release.getState());
    restarted.acknowledge(version);
    expect(createAppRelease({ version, notes, ...store }).getState()).toMatchObject({
      previousVersion: '1.2.0',
      showNotice: false,
    });
  });

  it.each([
    ['1.2.9', '1.2.10'],
    ['1.9.9', '1.10.0'],
    ['1.99.99', '2.0.0'],
  ])('compares numeric version components: %s -> %s', (before, current) => {
    const store = storage({ version: before, previousVersion: null, acknowledged: true });
    expect(createAppRelease({ version: current, ...store }).getState()).toMatchObject({
      previousVersion: before,
      showNotice: true,
    });
  });

  it.each([
    '1.2.2',
    '2.0.0',
    '1.2',
    'v1.2.0',
    '01.2.0',
    '1.2.0-beta.1',
    '999999999999999999999.0.0',
    120,
    null,
  ])('does not describe a downgrade or malformed baseline as an upgrade: %s', (before) => {
    const store = storage({ version: before, previousVersion: '1.0.0', acknowledged: true });
    expect(createAppRelease({ version, ...store }).getState()).toMatchObject({
      previousVersion: null,
      showNotice: true,
    });
  });

  it.each([version, '1.3.0', 'broken', null])(
    'sanitizes an invalid same-version predecessor: %s',
    (previousVersion) => {
      const store = storage({ version, previousVersion, acknowledged: true });
      expect(createAppRelease({ version, ...store }).getState()).toMatchObject({
        previousVersion: null,
        showNotice: false,
      });
    },
  );

  it('starts a new notice for a subsequent observed release', () => {
    const store = storage({ version, previousVersion: '1.2.0', acknowledged: true });
    const release = createAppRelease({ version: '1.3.0', ...store });
    expect(release.getState()).toMatchObject({
      version: '1.3.0',
      previousVersion: version,
      showNotice: true,
      notes: { en: [], fi: [] },
    });
  });

  it.each(['1.2.0', '1.2.2', undefined, {}, ['1.2.1'], 121])(
    'rejects acknowledgement of any other value: %j',
    (requested) => {
      const store = storage();
      const release = createAppRelease({ version, ...store });
      store.save.mockClear();
      expect(() => release.acknowledge(requested)).toThrow(/current release/);
      expect(release.getState().showNotice).toBe(true);
      expect(store.save).not.toHaveBeenCalled();
    },
  );

  it('keeps the notice unacknowledged when writes fail and allows a later successful retry', () => {
    const store = storage({ version: '1.2.0', previousVersion: null, acknowledged: true });
    const save = vi.fn(() => {
      throw new Error('disk full');
    });
    const release = createAppRelease({ version, load: store.load, save });
    expect(release.getState()).toMatchObject({ previousVersion: '1.2.0', showNotice: true });
    expect(() => release.acknowledge(version)).toThrow('disk full');
    expect(release.getState().showNotice).toBe(true);
    expect(store.read().version).toBe('1.2.0');
    save.mockImplementation(store.save);
    expect(release.acknowledge(version)).toEqual({ acknowledged: true });
    expect(release.getState().showNotice).toBe(false);
    expect(createAppRelease({ version, ...store }).getState().showNotice).toBe(false);
  });

  it('does not load or modify an installed baseline from a development run', () => {
    const store = storage({ version: '1.2.0', previousVersion: null, acknowledged: true });
    const release = createAppRelease({ version, installed: false, notes, ...store });
    expect(release.getState()).toMatchObject({
      version,
      previousVersion: null,
      showNotice: false,
      notes: notes.releases[0].notes,
    });
    expect(() => release.acknowledge(version)).toThrow(/installed application/);
    expect(store.load).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it('does not make optional read failures fatal and never invents their baseline', () => {
    const release = createAppRelease({
      version,
      load: () => {
        throw new Error('unavailable');
      },
    });
    expect(release.getState()).toMatchObject({ previousVersion: null, showNotice: true });
  });

  it.each([
    undefined,
    null,
    'https://example.test/notes.html',
    { schemaVersion: 2, releases: notes.releases },
    { schemaVersion: 1, releases: [notes.releases[1]] },
    { schemaVersion: 1, releases: [{ version, notes: { en: {}, fi: null } }] },
  ])(
    'uses empty notes for absent, invalid or different-version bundled content: %j',
    (document) => {
      expect(createAppRelease({ version, notes: document }).getState().notes).toEqual({
        en: [],
        fi: [],
      });
    },
  );

  it('bounds note arrays/text and returns independent snapshots without mutating inputs', () => {
    const document = {
      schemaVersion: 1,
      releases: [
        {
          version,
          notes: { en: Array(25).fill('x'.repeat(1000)), fi: ['', '  Valid  ', 4, null] },
        },
      ],
    };
    const before = structuredClone(document);
    const loaded = { version, previousVersion: '1.2.0', acknowledged: false };
    const release = createAppRelease({ version, notes: document, load: () => loaded });
    const state = release.getState();
    expect(state.notes.en).toHaveLength(20);
    expect(state.notes.en.every((note) => note.length === 600)).toBe(true);
    expect(state.notes.fi).toEqual(['Valid']);
    state.notes.en.push('changed');
    state.previousVersion = 'changed';
    document.releases[0].notes.fi[1] = 'changed';
    expect(release.getState().notes.fi).toEqual(['Valid']);
    expect(release.getState().notes.en).toHaveLength(20);
    expect(release.getState().previousVersion).toBe('1.2.0');
    expect(before.releases[0].notes.en).toEqual(document.releases[0].notes.en);
    expect(loaded).toEqual({ version, previousVersion: '1.2.0', acknowledged: false });
  });

  it.each(['1.2', 'v1.2.1', '01.2.1', '1.2.1-beta', null, '9007199254740992.0.0'])(
    'rejects an invalid running version before touching storage: %s',
    (current) => {
      const store = storage();
      expect(() => createAppRelease({ version: current, ...store })).toThrow(/version/);
      expect(store.load).not.toHaveBeenCalled();
      expect(store.save).not.toHaveBeenCalled();
    },
  );
});
