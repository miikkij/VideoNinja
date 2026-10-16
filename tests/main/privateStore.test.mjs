import { describe, it, expect, vi } from 'vitest';
import privacy from '../../src/main/privateStore.js';
import limits from '../../src/main/storageLimits.js';
import persistence from '../../src/main/persistence.js';

const vault = () => ({
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(text).map((byte) => byte ^ 0x55),
  decryptString: (buffer) =>
    Buffer.from(buffer)
      .map((byte) => byte ^ 0x55)
      .toString(),
  getSelectedStorageBackend: () => 'gnome_libsecret',
});

describe('private profile store', () => {
  it('atomically encrypts existing settings and queue and restores both', () => {
    const raw = {
      store: {
        settings: { language: 'fi' },
        queueState: { queue: [{ url: 'https://private.example/secret' }] },
      },
    };
    const store = privacy.createPrivateStore(raw, vault());
    store.set('settings', { language: 'fi', encryptedStorage: true });
    expect(raw.store.settings).toBeUndefined();
    expect(raw.store.queueState).toBeUndefined();
    expect(JSON.stringify(raw.store)).not.toContain('private.example');
    const restored = privacy.createPrivateStore(raw, vault());
    expect(restored.get('queueState').queue[0].url).toContain('private.example');
    restored.set('settings', { encryptedStorage: false });
    expect(raw.store.protectedState).toBeUndefined();
    expect(raw.store.queueState.queue).toHaveLength(1);
  });
  it('rejects Linux plaintext fallback and preserves the original document', () => {
    const raw = { store: { settings: { language: 'en' } } };
    const backend = { ...vault(), getSelectedStorageBackend: () => 'basic_text' };
    const store = privacy.createPrivateStore(raw, backend, { platform: 'linux' });
    expect(store.status().encryptionAvailable).toBe(false);
    expect(() => store.set('settings', { encryptedStorage: true })).toThrow(/unavailable/);
    expect(raw.store.settings).toEqual({ language: 'en' });
    expect(store.get('settings')).toEqual({ language: 'en' });
  });
  it('never overwrites encrypted data when decryption fails', () => {
    const raw = { store: { protectedState: { version: 1, data: 'YWJj' } } };
    const before = structuredClone(raw.store);
    expect(() =>
      privacy.createPrivateStore(raw, {
        ...vault(),
        decryptString: vi.fn(() => {
          throw new Error('locked');
        }),
      }),
    ).toThrow();
    expect(raw.store).toEqual(before);
  });
  it('does not change memory if an atomic disk write fails', () => {
    const raw = {
      get store() {
        return { settings: { language: 'en' } };
      },
      set store(_value) {
        throw new Error('disk full');
      },
    };
    const store = privacy.createPrivateStore(raw, vault());
    expect(() => store.set('settings', { language: 'fi' })).toThrow('disk full');
    expect(store.get('settings').language).toBe('en');
  });
  it('can reload an encrypted profile exceeding the old 10 MiB file limit', () => {
    const raw = { store: { settings: {}, queueState: { value: 'x'.repeat(11 * 1024 * 1024) } } };
    const store = privacy.createPrivateStore(raw, vault());
    store.set('settings', { encryptedStorage: true });
    const serialized = JSON.stringify(raw.store, null, '\t');
    expect(Buffer.byteLength(serialized)).toBeGreaterThan(10 * 1024 * 1024);
    const read = persistence.readConfiguration('/fixture/config.json', {
      fs: {
        statSync: () => ({ size: Buffer.byteLength(serialized) }),
        readFileSync: () => serialized,
      },
    });
    expect(
      privacy.createPrivateStore({ store: read.data }, vault()).get('queueState').value.length,
    ).toBe(11 * 1024 * 1024);
  });
  it('rejects oversized writes before changing disk or memory', () => {
    const raw = { store: { settings: { encryptedStorage: true }, queueState: { queue: [] } } };
    const store = privacy.createPrivateStore(raw, vault());
    const before = structuredClone(raw.store);
    expect(() =>
      store.set('queueState', { value: 'x'.repeat(limits.MAX_PRIVATE_PAYLOAD_BYTES) }),
    ).toThrow(/too large/);
    expect(raw.store).toEqual(before);
    expect(store.get('queueState')).toEqual({ queue: [] });
  });
});
