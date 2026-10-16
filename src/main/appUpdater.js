const RELEASES = 'https://github.com/miikkij/VideoNinja/releases';
const API = 'https://api.github.com/repos/miikkij/VideoNinja/releases/latest';
const newer = (candidate, current) => {
  if (!/^\d+\.\d+\.\d+$/.test(candidate) || !/^\d+\.\d+\.\d+$/.test(current)) return false;
  const a = candidate.split('.').map(Number),
    b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
};

/** Explicit user download/install; unsigned and unsupported builds use the release page. */
function createAppUpdater({
  app,
  updater,
  policy = {},
  platform = process.platform,
  env = process.env,
  fetch: fetcher = globalThis.fetch,
  onState = () => {},
  beforeInstall = async () => {},
}) {
  const native = Boolean(
    app.isPackaged &&
    updater &&
    policy.automatic &&
    ((platform === 'win32' &&
      policy.signed &&
      policy.publisherName &&
      !env.PORTABLE_EXECUTABLE_FILE) ||
      (platform === 'darwin' && policy.signed) ||
      (platform === 'linux' && env.APPIMAGE)),
  );
  let state = { status: 'idle', canInstall: false, releaseUrl: RELEASES };
  let operation = null,
    requestController = null,
    disposed = false,
    disposal = null,
    downloadToken = null,
    releaseInstallation = null;
  const releaseInstallLock = () => {
    const release = releaseInstallation;
    releaseInstallation = null;
    release?.();
  };
  const listeners = [];
  const update = (value) => {
    if (!disposed) {
      state = { ...state, ...value };
      onState(structuredClone(state));
    }
    return structuredClone(state);
  };
  if (native) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.disableWebInstaller = true;
    updater.logger = null;
    const listen = (event, callback) => {
      updater.on(event, callback);
      listeners.push([event, callback]);
    };
    listen('download-progress', (info) =>
      update({
        status: 'downloading',
        progress: Math.max(0, Math.min(100, Number(info.percent) || 0)),
      }),
    );
    listen('update-downloaded', () =>
      update({ status: 'downloaded', progress: 100, canInstall: true }),
    );
    listen('error', () => {
      releaseInstallLock();
      update({
        status: 'error',
        canInstall: false,
        message: 'The update could not be verified. Try again or use the release page.',
      });
    });
  }
  async function latest() {
    requestController = new AbortController();
    const timeout = setTimeout(() => requestController?.abort(), 20000);
    try {
      const response = await fetcher(API, {
        signal: requestController.signal,
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!response.ok) throw new Error('Update service unavailable.');
      if (Number(response.headers?.get('content-length')) > 1000000)
        throw new Error('Update response is too large.');
      const reader = response.body?.getReader?.();
      let release;
      if (reader) {
        let size = 0;
        const chunks = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 1000000) {
            await reader.cancel();
            throw new Error('Update response is too large.');
          }
          chunks.push(Buffer.from(value));
        }
        release = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } else release = await response.json();
      const version = String(release.tag_name || '').replace(/^v/, '');
      if (release.draft || release.prerelease || !/^\d+\.\d+\.\d+$/.test(version))
        throw new Error('Invalid release metadata.');
      return {
        version,
        releaseUrl: `${RELEASES}/tag/v${version}`,
        releaseNotes: typeof release.body === 'string' ? release.body.slice(0, 20000) : '',
      };
    } finally {
      clearTimeout(timeout);
      requestController = null;
    }
  }
  async function action(name) {
    if (name === 'status') return structuredClone(state);
    if (disposed) throw new Error('Updates are shutting down.');
    if (state.status === 'installing')
      throw new Error('An update installation is already running.');
    if (operation) throw new Error('An update operation is already running.');
    if (!['check', 'download', 'install'].includes(name)) throw new Error('Invalid update action.');
    operation = (async () => {
      if (name === 'check') {
        update({ status: 'checking', canInstall: false, progress: 0, message: '' });
        const release = await latest();
        if (disposed) throw new Error('Updates are shutting down.');
        if (!newer(release.version, app.getVersion()))
          return update({ ...release, status: 'not-available' });
        if (!native)
          return update({
            ...release,
            status: 'manual',
            message: 'Download the package from the release page for this installation.',
          });
        const result = await updater.checkForUpdates();
        downloadToken = result?.cancellationToken || null;
        if (disposed) {
          downloadToken?.cancel();
          throw new Error('Updates are shutting down.');
        }
        if (result?.updateInfo?.version !== release.version)
          throw new Error('Update manifest does not match the published release.');
        if (result.isUpdateAvailable === false || typeof downloadToken?.cancel !== 'function')
          throw new Error('A cancellable update is unavailable.');
        return update({ ...release, status: 'available' });
      }
      if (name === 'download') {
        if (!native || state.status !== 'available')
          throw new Error('Check for an installable update first.');
        update({ status: 'downloading', progress: 0 });
        await updater.downloadUpdate(downloadToken);
        if (disposed) throw new Error('Updates are shutting down.');
        return update({ status: 'downloaded', canInstall: true, progress: 100 });
      }
      if (!native || state.status !== 'downloaded' || !state.canInstall)
        throw new Error('Download and verify an update first.');
      const release = await beforeInstall();
      releaseInstallation = typeof release === 'function' ? release : null;
      if (disposed || state.status === 'error')
        throw new Error('The update installation was interrupted.');
      update({ status: 'installing', canInstall: false });
      updater.quitAndInstall(false, true);
      return structuredClone(state);
    })();
    try {
      return await operation;
    } catch {
      releaseInstallLock();
      return update({
        status: 'error',
        canInstall: false,
        message: 'The update could not be completed. Check the connection or use the release page.',
      });
    } finally {
      operation = null;
    }
  }
  return {
    action,
    dispose() {
      if (disposal) return disposal;
      disposed = true;
      releaseInstallLock();
      requestController?.abort();
      downloadToken?.cancel();
      // electron-updater owns an isolated session. Closing it also interrupts a
      // manifest check, whose public API does not accept a cancellation token.
      const closing = (async () => {
        if (native && operation) await updater.netSession?.closeAllConnections?.();
      })();
      disposal = Promise.allSettled([operation, closing]).then(() => {
        for (const [event, fn] of listeners) updater.removeListener(event, fn);
      });
      return disposal;
    },
  };
}
module.exports = { createAppUpdater, newer, RELEASES };
