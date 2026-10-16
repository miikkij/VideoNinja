const { contextBridge, ipcRenderer } = require('electron');

// No generic invoke/send or Electron objects cross the isolated preload boundary.
const invoke = (name, value) => ipcRenderer.invoke(`video-ninja:${name}`, value);
const subscribe = (channel, callback) => {
  if (typeof callback !== 'function') throw new TypeError('A callback is required.');
  const listener = (_event, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld(
  'videoNinja',
  Object.freeze({
    getInitialState: () => invoke('getInitialState'),
    recheckTools: () => invoke('recheckTools'),
    chooseDownloadDirectory: () => invoke('chooseDownloadDirectory'),
    chooseCookieFile: () => invoke('chooseCookieFile'),
    saveSettings: (settings) => invoke('saveSettings', settings),
    addDownloads: (request) => invoke('addDownloads', request),
    cancelDownload: (id) => invoke('cancelDownload', id),
    pauseDownload: (id) => invoke('pauseDownload', id),
    resumeDownload: (id) => invoke('resumeDownload', id),
    moveDownload: (request) => invoke('moveDownload', request),
    retryDownload: (request) => invoke('retryDownload', request),
    openFile: (id) => invoke('openFile', id),
    showInFolder: (id) => invoke('showInFolder', id),
    setStartup: (enabled) => invoke('setStartup', enabled),
    hideWindow: () => invoke('hideWindow'),
    clearHistory: () => invoke('clearHistory'),
    exportHistory: () => invoke('exportHistory'),
    previewDownload: (request) => invoke('previewDownload', request),
    openExternal: (url) => invoke('openExternal', url),
    onState: (callback) => subscribe('video-ninja:state', callback),
    onProgress: (callback) => subscribe('video-ninja:progress', callback),
    onDiskSpace: (callback) => subscribe('video-ninja:disk-space', callback),
    onTools: (callback) => subscribe('video-ninja:tools', callback),
    onWarnings: (callback) => subscribe('video-ninja:warnings', callback),
  }),
);
