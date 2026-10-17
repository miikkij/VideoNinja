const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  shell,
  nativeImage,
  ipcMain,
  dialog,
  protocol,
  net,
  screen,
  safeStorage,
  Notification,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const tools = require('./ytdlp');
const DownloadQueue = require('./downloadQueue');
const { createHandlers, registerIpc, APP_URL } = require('./ipc');
const { createStartup } = require('./startup');
const { createPrivateStore } = require('./privateStore');
const { createNotifications } = require('./notifications');
const { createPersonalityEvents } = require('./personalityEvents');
const { createAppUpdater } = require('./appUpdater');
const { createToolManager } = require('./toolManager');
const { createToolMaintenance } = require('./toolMaintenance');
const { createSiteCompatibility } = require('./siteCompatibility');
const { createAppRelease } = require('./appRelease');
const releaseNotes = require('../shared/releaseNotes.json');
const {
  readConfiguration,
  loadPersistedState,
  attachQueuePersistence,
  sanitizeWindowBounds,
} = require('./persistence');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'videoninja',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

// An explicit isolated profile also makes packaged smoke tests safe for user data.
if (process.env.VIDEONINJA_USER_DATA) {
  if (!path.isAbsolute(process.env.VIDEONINJA_USER_DATA))
    throw new Error('The profile path must be absolute.');
  app.setPath('userData', process.env.VIDEONINJA_USER_DATA);
}

const ICONS = Object.fromEntries(
  ['icon', 'icon-normal', 'icon-alert'].map((name) => [
    name,
    path.join(__dirname, '../assets/icons', name + '.png'),
  ]),
);
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";
const assets = new Map([
  ['/index.html', ['../renderer/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['../renderer/app.js', 'text/javascript; charset=utf-8']],
  ['/i18n.js', ['../renderer/i18n.js', 'text/javascript; charset=utf-8']],
  [
    '/personality-quotes.js',
    ['../renderer/personality-quotes.js', 'text/javascript; charset=utf-8'],
  ],
  ['/styles.css', ['../renderer/styles.css', 'text/css; charset=utf-8']],
  ['/assets/icons/icon.png', ['../assets/icons/icon.png', 'image/png']],
]);

let mainWindow = null;
let tray = null;
let store;
let queue;
let settings;
let startup;
let persistence;
let services;
let toolManager;
let toolMaintenance;
let siteCompatibility;
let appUpdater;
let appRelease;
let notifications;
let personalityEvents;
let updateTimer;
let diskTimer;
let toolCheck;
let toolController;
let quitting = false;
let quitAllowed = false;
let installingUpdate = false;
let warnings = [];
let toolState = {
  ytdlp: { available: false, checking: true, path: null, version: null, jsRuntimes: [] },
  ffmpeg: { available: false, checking: true, path: null, version: null },
};
let diskState = { available: false, total: null, free: null, used: null, error: null };
const silent = process.env.VIDEONINJA_HEADLESS === '1';

function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send('video-ninja:' + channel, data);
}

function warn(code) {
  if (!warnings.includes(code)) warnings.push(code);
  send('warnings', warnings);
}

async function recheckTools() {
  if (quitting) throw new Error('The application is shutting down.');
  if (toolCheck) return toolCheck;
  const controller = new AbortController();
  toolController = controller;
  toolCheck = (async () => {
    const results = await Promise.allSettled([
      tools.checkYtDlpAvailability({ signal: controller.signal }),
      tools.checkFfmpegAvailability({ signal: controller.signal }),
    ]);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;
    const [ytdlp, ffmpeg] = results.map((result) => result.value);
    toolState = {
      ytdlp,
      ffmpeg,
      setup: toolManager?.getSetupPlan(),
      maintenance: toolMaintenance?.getState(),
    };
    send('tools', toolState);
    return toolState;
  })();
  try {
    return await toolCheck;
  } finally {
    toolCheck = null;
    if (toolController === controller) toolController = null;
  }
}

async function checkDisk() {
  const selected = settings.downloadPath;
  const result = selected
    ? await tools.getDiskSpace(selected)
    : { available: false, total: null, free: null, used: null, error: null };
  if (settings.downloadPath !== selected) return;
  diskState = result;
  send('disk-space', diskState);
}

function updateTray() {
  if (!tray) return;
  const busy = queue?.getQueueState().isProcessing;
  const icon = nativeImage
    .createFromPath(busy ? ICONS['icon-alert'] : ICONS['icon-normal'])
    .resize({
      width: process.platform === 'darwin' ? 22 : 16,
      height: process.platform === 'darwin' ? 22 : 16,
    });
  // A static busy indicator respects reduced-motion preferences.
  tray.setImage(icon);
  tray.setToolTip(
    busy
      ? 'VideoNinja: ' + (settings.language === 'fi' ? 'lataus käynnissä' : 'downloading')
      : 'VideoNinja',
  );
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: settings.language === 'fi' ? 'Avaa VideoNinja' : 'Open VideoNinja',
        click: showWindow,
      },
      { type: 'separator' },
      { label: settings.language === 'fi' ? 'Lopeta' : 'Quit', click: () => app.quit() },
    ]),
  );
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  const bounds = sanitizeWindowBounds(store.get('windowBounds')) || {};
  const visible =
    bounds.x !== undefined &&
    bounds.y !== undefined &&
    screen
      .getAllDisplays()
      .some(
        ({ workArea }) =>
          bounds.x + bounds.width > workArea.x &&
          bounds.x < workArea.x + workArea.width &&
          bounds.y + bounds.height > workArea.y &&
          bounds.y < workArea.y + workArea.height,
      );
  mainWindow = new BrowserWindow({
    width: bounds.width || 1000,
    height: bounds.height || 800,
    ...(visible ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: 420,
    minHeight: 420,
    show: false,
    title: `VideoNinja v${app.getVersion()}`,
    icon: ICONS.icon,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.on('page-title-updated', (event) => event.preventDefault());
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler((contents, permission, callback) => {
    callback(
      contents === mainWindow?.webContents &&
        contents.getURL() === APP_URL &&
        permission === 'clipboard-sanitized-write',
    );
  });
  mainWindow.webContents.session.setPermissionCheckHandler(
    (contents, permission) =>
      contents === mainWindow?.webContents &&
      contents.getURL() === APP_URL &&
      permission === 'clipboard-sanitized-write',
  );
  mainWindow.on('close', (event) => {
    try {
      store.set('windowBounds', mainWindow.getBounds());
    } catch {
      warn('WINDOW_SAVE_FAILED');
    }
    if (!quitting && tray) {
      event.preventDefault();
      mainWindow.hide();
    } else if (!quitting) {
      event.preventDefault();
      app.quit();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.once('ready-to-show', () => {
    if (!silent) mainWindow.show();
  });
  mainWindow.loadURL(APP_URL);
}

async function initialize() {
  protocol.handle('videoninja', async (request) => {
    const url = new URL(request.url);
    const asset = url.host === 'app' && !url.username && !url.password && assets.get(url.pathname);
    if (request.method !== 'GET' || !asset) return new Response('Not found', { status: 404 });
    const response = await net.fetch(pathToFileURL(path.join(__dirname, asset[0])).href);
    return new Response(await response.arrayBuffer(), {
      headers: {
        'Content-Type': asset[1],
        'Content-Security-Policy': CSP,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
  const restored = await readConfiguration(path.join(app.getPath('userData'), 'config.json'));
  const { default: Store } = await import('electron-store');
  store = createPrivateStore(new Store({ clearInvalidConfig: false }), safeStorage);
  const state = loadPersistedState(store);
  settings = state.settings;
  const savedChannel = store.get('settings')?.ytdlpChannel;
  warnings = [...restored.warnings, ...state.warnings];
  store.set('schemaVersion', 1);
  store.set('settings', settings);
  appRelease = createAppRelease({
    version: app.getVersion(),
    installed: app.isPackaged,
    notes: releaseNotes,
    load: () => store.get('releaseState'),
    save: (value) => store.set('releaseState', value),
  });
  const configuredToolsDir = process.env.VIDEONINJA_TOOLS_DIR;
  if (configuredToolsDir && !path.isAbsolute(configuredToolsDir))
    throw new Error('The managed tools path must be absolute.');
  const managedDir = path.resolve(
    configuredToolsDir || path.join(app.getPath('userData'), 'tools'),
  );
  process.env.VIDEONINJA_TOOLS_DIR = managedDir;
  if (!savedChannel) {
    try {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(managedDir, 'yt-dlp', 'managed.json'), 'utf8'),
      );
      const source = new URL(manifest.source);
      if (
        source.origin === 'https://github.com' &&
        source.pathname.startsWith('/yt-dlp/yt-dlp/releases/')
      )
        settings.ytdlpChannel = 'stable';
      else if (
        source.origin === 'https://github.com' &&
        source.pathname.startsWith('/yt-dlp/yt-dlp-nightly-builds/releases/')
      )
        settings.ytdlpChannel = 'nightly';
      store.set('settings', settings);
    } catch {
      /* New profiles retain the recommended Nightly default. */
    }
  }
  toolManager = createToolManager({ managedDir });
  siteCompatibility = createSiteCompatibility({
    load: () => store.get('siteCompatibility'),
    save: (value) => store.set('siteCompatibility', value),
  });
  Object.assign(tools, tools.createDownloader({ siteCompatibility }));
  queue = new DownloadQueue({
    prepareDownload: (...args) => tools.fetchMetadata(...args),
    getDiskSpace: (...args) => tools.getDiskSpace(...args),
  });
  persistence = attachQueuePersistence(queue, store, {
    onError: () => warn('QUEUE_SAVE_FAILED'),
  });
  startup = createStartup(app);
  notifications = createNotifications({ Notification, getSettings: () => settings, showWindow });
  let policy = {};
  try {
    policy = JSON.parse(
      fs.readFileSync(path.join(process.resourcesPath, 'update-policy.json'), 'utf8'),
    );
  } catch {
    /* Unsigned/source builds use manual downloads. */
  }
  appUpdater = createAppUpdater({
    app,
    policy,
    updater: app.isPackaged ? require('electron-updater').autoUpdater : null,
    onState: (value) => send('app-update', value),
    beforeInstall: async () => {
      if (quitting || installingUpdate || queue.getQueueState().isProcessing)
        throw new Error('The application is not ready to install an update.');
      const releaseScheduling = queue.holdScheduling();
      const release = () => {
        installingUpdate = false;
        releaseScheduling({ start: !quitting });
      };
      installingUpdate = true;
      try {
        if (!persistence.checkpoint()) throw new Error('The queue could not be saved.');
        // Native installers can fail without quitting. Keep cleanup in before-quit
        // and return a reversible admission lock for the updater's error handler.
        return release;
      } catch (error) {
        release();
        throw error;
      }
    },
  });
  try {
    await startup.isEnabled();
  } catch {
    warnings.push('STARTUP_STATUS_UNAVAILABLE');
  }
  services = createHandlers({
    queue,
    dialog,
    shell,
    getWindow: () => mainWindow,
    getSettings: () => settings,
    tools,
    startup,
    toolManager,
    siteCompatibility,
    getToolMaintenance: () => toolMaintenance,
    appUpdater,
    appRelease,
    privacyStatus: () => store.status(),
    hasToolCheck: () => Boolean(toolCheck),
    isInstallingUpdate: () => installingUpdate,
    canHideWindow: () => Boolean(tray),
    putSettings: async (value) => {
      if (quitting || installingUpdate) throw new Error('The application is restarting.');
      store.set('settings', value);
      settings = value;
      toolMaintenance?.settingsChanged();
      queue.setConcurrency(settings.maxConcurrent, { start: false });
      queue.configure(settings);
      updateTray();
      await checkDisk();
    },
    recheckTools,
    getInitialState: async () => {
      const [currentTools, startupEnabled, updateState] = await Promise.all([
        toolCheck || Promise.resolve(toolState),
        startup.isEnabled().catch(() => false),
        appUpdater.action('status'),
      ]);
      // Queue transitions can happen during native checks. Snapshot only once
      // those checks have finished so initial rendering cannot replay old jobs.
      return {
        version: app.getVersion(),
        settings,
        queue: queue.getQueueState(),
        tools: { ...currentTools, maintenance: toolMaintenance?.getState() },
        diskSpace: diskState,
        startupEnabled,
        warnings,
        privacy: store.status(),
        appUpdate: updateState,
        appRelease: appRelease.getState(),
      };
    },
  });
  toolMaintenance = createToolMaintenance({
    getSettings: () => settings,
    manager: toolManager,
    runExclusive: (operation, options) => services.runToolOperation(operation, options),
    loadState: () => store.get('toolMaintenance'),
    saveState: (value) => store.set('toolMaintenance', value),
    onState: (maintenance) => {
      toolState = { ...toolState, maintenance };
      send('tools', toolState);
    },
  });
  registerIpc(ipcMain, () => mainWindow, services.handlers);
  queue.on('queue-updated', (value) => {
    send('state', value);
    updateTray();
  });
  queue.on('download-progress', (value) => send('progress', value));
  queue.on('download-completed', (job) => notifications.record('completed', job));
  queue.on('download-failed', (job) => notifications.record('failed', job));
  personalityEvents = createPersonalityEvents({
    queue,
    onEvent: (value) => send('download-event', value),
  });
  if (!silent) {
    try {
      tray = new Tray(nativeImage.createFromPath(ICONS['icon-normal']));
      tray.on('click', showWindow);
      updateTray();
    } catch {
      warnings.push('TRAY_UNAVAILABLE');
    }
  }
  createWindow();
  queue.loadState(state.queueState, { start: false });
  queue.setConcurrency(settings.maxConcurrent, { start: false });
  queue.configure(settings, { start: false });
  queue.processNext();
  void recheckTools()
    .catch(() => {
      if (quitting) return;
      warn('TOOL_CHECK_FAILED');
      toolState = { ytdlp: { available: false, jsRuntimes: [] }, ffmpeg: { available: false } };
      send('tools', toolState);
    })
    .finally(() => {
      if (!quitting) toolMaintenance.start();
    });
  void checkDisk();
  diskTimer = setInterval(() => {
    void checkDisk();
  }, 30000);
  if (app.isPackaged && !silent && settings.checkUpdatesOnStartup) {
    updateTimer = setTimeout(() => {
      if (settings.checkUpdatesOnStartup && !quitting)
        void appUpdater.action('check').catch(() => {});
    }, 15000);
    updateTimer.unref();
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (store) showWindow();
  });
  app.on('activate', () => {
    if (store) showWindow();
  });
  app.on('window-all-closed', () => {
    /* Tray and explicit Quit control application lifetime. */
  });
  app.on('before-quit', (event) => {
    if (quitAllowed || !queue) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    clearInterval(diskTimer);
    clearTimeout(updateTimer);
    notifications?.dispose();
    personalityEvents?.dispose();
    const stoppingUpdater = appUpdater?.dispose();
    const stoppingMaintenance = toolMaintenance?.dispose();
    const pendingToolCheck = toolCheck;
    toolController?.abort();
    Promise.all([
      services?.dispose(),
      queue.shutdown(),
      pendingToolCheck?.catch(() => {}),
      stoppingUpdater,
      stoppingMaintenance,
    ])
      .then(() => persistence.checkpoint())
      .catch(() => {
        // Do not print persisted URLs/options or process output.
        console.error('VideoNinja could not finish its final queue checkpoint.');
      })
      .finally(() => {
        persistence.dispose();
        quitAllowed = true;
        app.quit();
      });
  });
  app
    .whenReady()
    .then(initialize)
    .catch(() => {
      if (!silent)
        dialog.showErrorBox(
          'VideoNinja',
          'The application could not start. Check access to the user-data folder.',
        );
      app.exit(1);
    });
}
