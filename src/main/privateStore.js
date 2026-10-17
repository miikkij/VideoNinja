const { MAX_CONFIG_BYTES, MAX_PRIVATE_PAYLOAD_BYTES } = require('./storageLimits');

/** Keep settings and queue URLs out of plaintext when the OS key store is enabled. */
function createPrivateStore(store, safeStorage, { platform = process.platform } = {}) {
  const available = () => {
    try {
      return (
        Boolean(safeStorage.isEncryptionAvailable()) &&
        !(
          platform === 'linux' &&
          ['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend())
        )
      );
    } catch {
      return false;
    }
  };
  let document = structuredClone(store.store);
  if (document.protectedState) {
    if (!available())
      throw new Error('The operating system key store is unavailable. Saved data was preserved.');
    const envelope = document.protectedState;
    if (
      envelope.version !== 1 ||
      typeof envelope.data !== 'string' ||
      envelope.data.length > MAX_CONFIG_BYTES ||
      envelope.data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(envelope.data)
    )
      throw new Error('Invalid encrypted profile. Saved data was preserved.');
    const plaintext = safeStorage.decryptString(Buffer.from(envelope.data, 'base64'));
    if (Buffer.byteLength(plaintext, 'utf8') > MAX_PRIVATE_PAYLOAD_BYTES)
      throw new Error('Encrypted profile is too large. Saved data was preserved.');
    const decoded = JSON.parse(plaintext);
    if (
      !decoded ||
      typeof decoded !== 'object' ||
      Array.isArray(decoded) ||
      !decoded.settings ||
      typeof decoded.settings !== 'object'
    )
      throw new Error('Invalid encrypted profile. Saved data was preserved.');
    document.settings = { ...decoded.settings, encryptedStorage: true };
    document.queueState = decoded.queueState;
    document.siteCompatibility = decoded.siteCompatibility;
    delete document.protectedState;
  }
  const commit = (next) => {
    const disk = structuredClone(next);
    const payload = JSON.stringify({
      settings: next.settings,
      queueState: next.queueState,
      siteCompatibility: next.siteCompatibility,
    });
    if (Buffer.byteLength(payload, 'utf8') > MAX_PRIVATE_PAYLOAD_BYTES)
      throw new Error('Profile is too large to save safely. Existing data was preserved.');
    if (next.settings?.encryptedStorage) {
      if (!available())
        throw new Error(
          'The operating system key store is unavailable. Encryption was not changed.',
        );
      disk.protectedState = {
        version: 1,
        data: safeStorage.encryptString(payload).toString('base64'),
      };
      delete disk.settings;
      delete disk.queueState;
      delete disk.siteCompatibility;
    }
    // conf/electron-store serializes with tab indentation. Include that overhead.
    if (Buffer.byteLength(JSON.stringify(disk, null, '\t'), 'utf8') > MAX_CONFIG_BYTES)
      throw new Error('Profile is too large to save safely. Existing data was preserved.');
    // electron-store replaces the document atomically. Update memory only after success.
    store.store = disk;
    document = next;
  };
  return {
    get(key) {
      return structuredClone(document[key]);
    },
    set(key, value) {
      commit({ ...document, [key]: structuredClone(value) });
    },
    status() {
      return {
        encryptionAvailable: available(),
        encrypted: Boolean(document.settings?.encryptedStorage),
      };
    },
  };
}

module.exports = { createPrivateStore };
