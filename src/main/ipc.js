const fs = require('node:fs/promises');
const path = require('node:path');
const { constants } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { validateUrl, normalizeOptions } = require('./downloadOptions');
const {
  sanitizeSettings,
  MAX_QUEUE_ITEMS,
  FEATURE_DEFAULTS,
  validateFeatureSettings,
  sanitizeProfiles,
} = require('./persistence');

const APP_URL = 'videoninja://app/index.html';
const HELP_URLS = new Set([
  'https://github.com/yt-dlp/yt-dlp/releases',
  'https://github.com/yt-dlp/yt-dlp#installation',
  'https://github.com/yt-dlp/yt-dlp/wiki/EJS',
  'https://ffmpeg.org/download.html',
  'https://docs.deno.com/runtime/getting_started/installation/',
  'https://github.com/miikkij/VideoNinja/issues',
  'https://github.com/miikkij/VideoNinja/releases',
  'https://brew.sh/',
]);

class UserError extends Error {
  constructor(message, code = 'INVALID_REQUEST') {
    super(message);
    this.code = code;
  }
}

function record(value, keys) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new UserError('Invalid request. Please review the selected options.');
  }
  return value;
}

function id(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) {
    throw new UserError('Invalid download identifier.');
  }
  return value;
}

// Validated URLs are canonical; fragments do not identify separate downloads.
const batchSize = (urls) => new Set(urls.map((url) => url.split('#', 1)[0])).size;

/** Only the application's top-level renderer can call native commands. */
function trustedSender(event, window) {
  return Boolean(
    window &&
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    event.senderFrame?.url === APP_URL,
  );
}

function registerIpc(ipcMain, getWindow, handlers) {
  for (const [name, handler] of Object.entries(handlers)) {
    ipcMain.handle(`video-ninja:${name}`, async (event, input) => {
      if (!trustedSender(event, getWindow())) {
        return { ok: false, error: { code: 'FORBIDDEN', message: 'This request is not allowed.' } };
      }
      try {
        return { ok: true, data: await handler(input) };
      } catch (error) {
        // Do not expose native paths, command lines, stack traces or credentials.
        return {
          ok: false,
          error: {
            code: error instanceof UserError ? error.code : 'OPERATION_FAILED',
            message:
              error instanceof UserError
                ? error.message
                : 'The operation could not be completed. Check the selected options and folder.',
          },
        };
      }
    });
  }
  return () => {
    for (const name of Object.keys(handlers)) ipcMain.removeHandler(`video-ninja:${name}`);
  };
}

/** Resolve an existing completed media file, including symlink containment. */
async function completedFile(queue, downloadId, filesystem = fs) {
  const job = queue.getDownload(id(downloadId));
  if (!job || job.status !== 'completed' || !job.filepath || !job.outputPath) {
    throw new UserError('A completed file is required.', 'FILE_UNAVAILABLE');
  }
  const [root, file] = await Promise.all([
    filesystem.realpath(job.outputPath),
    filesystem.realpath(job.filepath),
  ]);
  const relative = path.relative(root, file);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new UserError('This file is outside the selected download folder.', 'FILE_UNAVAILABLE');
  }
  if (!(await filesystem.stat(file)).isFile()) {
    throw new UserError('The downloaded file is no longer available.', 'FILE_UNAVAILABLE');
  }
  // Shell opening a downloaded executable or shortcut is not a media operation.
  if (
    !/\.(mp4|mkv|webm|mov|avi|m4v|flv|mpeg|mpg|ts|m2ts|mp3|m4a|aac|opus|ogg|oga|flac|wav|aiff|alac)$/i.test(
      file,
    )
  ) {
    throw new UserError('This file type cannot be opened from VideoNinja.', 'FILE_UNAVAILABLE');
  }
  return file;
}

/** The handlers are dependency-injected so their real validation is testable. */
function createHandlers(deps) {
  const { queue, dialog, shell, getWindow, getSettings, putSettings, startup, tools } = deps;
  const filesystem = deps.fs || fs;
  const folders = new Set();
  const cookies = new Set();
  let previewController = null;
  let playlistController = null;
  let playlistCache = null;
  const previewTasks = new Set();
  let toolController = null,
    toolTask = null;
  let disposing = false;

  const ready = () => {
    if (disposing) throw new UserError('The application is shutting down.', 'INVALID_STATE');
    if (deps.isInstallingUpdate?.())
      throw new UserError('Wait for the application update to finish.', 'INVALID_STATE');
    if (toolTask)
      throw new UserError(
        'Wait for the tool update to finish before starting downloads.',
        'TOOLS_BUSY',
      );
  };
  const jobIds = (values) => {
    if (
      !Array.isArray(values) ||
      !values.length ||
      values.length > MAX_QUEUE_ITEMS ||
      new Set(values).size !== values.length
    )
      throw new UserError('Select one or more downloads.');
    return values.map(id);
  };

  const asOptions = (input = {}) => {
    let options;
    try {
      options = normalizeOptions(input);
    } catch {
      throw new UserError(
        'One or more download options are invalid or unsupported.',
        'INVALID_OPTIONS',
      );
    }
    if (
      options.cookieFile &&
      options.cookieFile !== getSettings().cookieFilePath &&
      !cookies.has(options.cookieFile)
    ) {
      throw new UserError('Select the cookie file using Choose.', 'INVALID_OPTIONS');
    }
    return options;
  };
  const asUrl = (value) => {
    try {
      return validateUrl(value);
    } catch {
      throw new UserError(
        'Enter a valid HTTP or HTTPS video URL without embedded credentials.',
        'INVALID_URL',
      );
    }
  };
  const requireFolder = async () => {
    const folder = getSettings().downloadPath;
    if (!folder || !path.isAbsolute(folder))
      throw new UserError('Choose a download folder first.', 'FOLDER_REQUIRED');
    try {
      if (!(await filesystem.stat(folder)).isDirectory()) throw new Error();
      await filesystem.access(folder, constants.W_OK);
    } catch {
      throw new UserError(
        'The download folder is unavailable or not writable.',
        'FOLDER_UNAVAILABLE',
      );
    }
    return folder;
  };
  const changeJob = (method, value) => {
    ready();
    if (!queue[method](id(value)))
      throw new UserError('This download can no longer perform that action.', 'INVALID_STATE');
    return true;
  };

  // Manual and scheduled tool work share one admission lock, including the
  // post-install probes. Scheduling cannot restart a paused job underneath it.
  const withToolLock = async (operation, { signal } = {}) => {
    ready();
    const state = queue.getQueueState();
    if (
      state.queue.some((job) => job.status !== 'paused' || job.pausedBySchedule) ||
      state.isProcessing ||
      previewTasks.size ||
      (deps.hasToolCheck?.() ?? false)
    )
      throw new UserError(
        'Pause queued downloads and close previews before changing tools. Wait for active processes to finish stopping.',
        'TOOLS_BUSY',
      );
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const release = queue.holdScheduling?.();
    toolController = controller;
    const task = Promise.resolve().then(async () => {
      if (controller.signal.aborted || disposing) throw new Error('Tool operation cancelled.');
      const result = await operation({ signal: controller.signal });
      if (controller.signal.aborted || disposing) throw new Error('Tool operation cancelled.');
      const currentTools = await deps.recheckTools();
      return { result, tools: currentTools, setup: deps.toolManager.getSetupPlan() };
    });
    toolTask = task;
    try {
      return await task;
    } finally {
      signal?.removeEventListener('abort', abort);
      if (toolTask === task) toolTask = null;
      if (toolController === controller) toolController = null;
      release?.({ start: !disposing });
    }
  };

  const handlers = {
    getInitialState: () => deps.getInitialState(),
    acknowledgeAppRelease: (input) => {
      record(input, ['version']);
      if (
        typeof input.version !== 'string' ||
        !deps.appRelease ||
        input.version !== deps.appRelease.getState().version
      )
        throw new UserError('Choose the currently running application version.', 'INVALID_VERSION');
      try {
        return deps.appRelease.acknowledge(input.version);
      } catch {
        throw new UserError(
          'The update acknowledgement could not be saved. Try again.',
          'RELEASE_ACK_FAILED',
        );
      }
    },
    recheckTools: () => {
      ready();
      return deps.recheckTools();
    },
    toolAction: async (input) => {
      record(input, ['action', 'tool', 'channel']);
      if (
        !['check', 'install', 'update', 'diagnose'].includes(input.action) ||
        !['yt-dlp', 'ffmpeg', 'runtime'].includes(input.tool)
      )
        throw new UserError('Invalid tool action.');
      if (
        input.channel !== undefined &&
        (input.tool !== 'yt-dlp' ||
          !['install', 'update'].includes(input.action) ||
          !['stable', 'nightly'].includes(input.channel))
      )
        throw new UserError('Invalid yt-dlp release channel.');
      if (!deps.toolManager)
        throw new UserError('Tool management is unavailable.', 'TOOLS_UNAVAILABLE');
      ready();
      if (input.action === 'check')
        return { tools: await deps.recheckTools(), setup: deps.toolManager.getSetupPlan() };
      try {
        return await withToolLock(({ signal }) =>
          input.action === 'diagnose'
            ? deps.toolManager.diagnose({ signal })
            : deps.toolManager.install(input.tool, {
                signal,
                ...(input.tool === 'yt-dlp'
                  ? { channel: input.channel || getSettings().ytdlpChannel || 'nightly' }
                  : {}),
              }),
        );
      } catch (error) {
        if (error instanceof UserError) throw error;
        throw new UserError(
          'The tool operation failed. Check the connection and setup instructions; the previous installation was kept.',
          'TOOL_OPERATION_FAILED',
        );
      }
    },
    toolMaintenance: async (input) => {
      record(input, ['action']);
      if (!['check', 'status'].includes(input.action) || !deps.getToolMaintenance?.())
        throw new UserError('Tool maintenance is unavailable.', 'TOOLS_UNAVAILABLE');
      const maintenance = deps.getToolMaintenance();
      return {
        maintenance:
          input.action === 'check' ? await maintenance.checkNow() : maintenance.getState(),
      };
    },
    getSiteCompatibility: () => deps.siteCompatibility?.list() || [],
    clearSiteCompatibility: (input = {}) => {
      record(input, ['origin']);
      if (input.origin !== undefined) {
        const url = asUrl(input.origin);
        if (new URL(url).origin !== input.origin)
          throw new UserError('Choose a valid site origin.');
      }
      deps.siteCompatibility?.clear(input.origin);
      return deps.siteCompatibility?.list() || [];
    },
    openSource: async (value) => {
      const job = queue.getDownload(id(value));
      if (!job) throw new UserError('The download is no longer available.', 'INVALID_STATE');
      await shell.openExternal(asUrl(job.url));
      return true;
    },
    appUpdate: (input) => {
      record(input, ['action']);
      if (!['check', 'status', 'download', 'install'].includes(input.action) || !deps.appUpdater)
        throw new UserError('Invalid application update action.');
      if (
        input.action === 'install' &&
        (toolTask || previewTasks.size || queue.getQueueState().isProcessing)
      )
        throw new UserError(
          'Pause active downloads and close previews before installing the application update.',
          'INVALID_STATE',
        );
      return deps.appUpdater.action(input.action);
    },
    chooseDownloadDirectory: async () => {
      const result = await dialog.showOpenDialog(getWindow(), {
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || !result.filePaths.length) return null;
      folders.add(result.filePaths[0]);
      return result.filePaths[0];
    },
    chooseCookieFile: async () => {
      const result = await dialog.showOpenDialog(getWindow(), {
        properties: ['openFile'],
        filters: [{ name: 'Cookie files', extensions: ['txt', 'cookies'] }],
      });
      if (result.canceled || !result.filePaths.length) return null;
      cookies.add(result.filePaths[0]);
      return result.filePaths[0];
    },
    saveSettings: async (input) => {
      record(input, [
        'schemaVersion',
        'downloadPath',
        'cookieSource',
        'cookieFilePath',
        'userAgent',
        'extraArgs',
        'jsRuntime',
        'language',
        'quality',
        'maxConcurrent',
        ...Object.keys(FEATURE_DEFAULTS),
        'checkUpdatesOnStartup',
      ]);
      const previous = getSettings();
      const merged = { ...previous, ...input };
      try {
        validateFeatureSettings(merged);
      } catch {
        throw new UserError(
          'One or more preference values are outside the supported range.',
          'INVALID_OPTIONS',
        );
      }
      if (
        merged.checkUpdatesOnStartup !== undefined &&
        typeof merged.checkUpdatesOnStartup !== 'boolean'
      )
        throw new UserError('Choose whether to check for updates.', 'INVALID_OPTIONS');
      if (merged.encryptedStorage && !deps.privacyStatus?.().encryptionAvailable)
        throw new UserError(
          'The operating system key store is unavailable. Encryption was not enabled.',
          'ENCRYPTION_UNAVAILABLE',
        );
      if (
        merged.maxConcurrent !== undefined &&
        (!Number.isInteger(merged.maxConcurrent) ||
          merged.maxConcurrent < 1 ||
          merged.maxConcurrent > 5)
      ) {
        throw new UserError('Choose between 1 and 5 simultaneous downloads.', 'INVALID_OPTIONS');
      }
      if (
        merged.downloadPath &&
        merged.downloadPath !== previous.downloadPath &&
        !folders.has(merged.downloadPath) &&
        !(previous.profiles || []).some((profile) => profile.downloadPath === merged.downloadPath)
      ) {
        throw new UserError('Select the download folder using Choose.', 'FOLDER_REQUIRED');
      }
      if (
        merged.cookieFilePath &&
        merged.cookieFilePath !== previous.cookieFilePath &&
        !cookies.has(merged.cookieFilePath)
      ) {
        throw new UserError('Select the cookie file using Choose.', 'INVALID_OPTIONS');
      }
      if (
        !['en', 'fi'].includes(merged.language) ||
        ![
          '',
          'file',
          'chrome',
          'edge',
          'brave',
          'firefox',
          'opera',
          'safari',
          'chromium',
          'vivaldi',
        ].includes(merged.cookieSource || '')
      ) {
        throw new UserError('Choose a supported language and cookie source.');
      }
      asOptions({
        quality: merged.quality || 'best',
        jsRuntime: merged.jsRuntime || 'auto',
        userAgent: merged.userAgent || '',
        extraArgs: merged.extraArgs || '',
      });
      const settings = sanitizeSettings(merged);
      await putSettings(settings);
      return settings;
    },
    saveProfile: async (input) => {
      record(input, ['name', 'options', 'downloadPath']);
      const settings = getSettings();
      if (
        typeof input.name !== 'string' ||
        !input.name.trim() ||
        input.name.length > 80 ||
        [...input.name].some((character) => character.charCodeAt(0) < 32)
      )
        throw new UserError('Give the profile a name of 1–80 characters.');
      if (
        input.downloadPath !== settings.downloadPath &&
        !folders.has(input.downloadPath) &&
        !(settings.profiles || []).some((profile) => profile.downloadPath === input.downloadPath)
      )
        throw new UserError('Select the profile folder using Choose.', 'FOLDER_REQUIRED');
      const options = asOptions(input.options);
      const profiles = [...(settings.profiles || [])];
      const index = profiles.findIndex(
        (profile) => profile.name.toLowerCase() === input.name.trim().toLowerCase(),
      );
      if (index < 0 && profiles.length >= 20)
        throw new UserError('Keep up to 20 download profiles.');
      const profile = {
        id: index < 0 ? randomUUID() : profiles[index].id,
        name: input.name.trim(),
        options,
        downloadPath: input.downloadPath,
      };
      if (index < 0) profiles.push(profile);
      else profiles[index] = profile;
      const saved = sanitizeProfiles(profiles);
      if (!saved.some((item) => item.id === profile.id))
        throw new UserError('Choose a valid profile folder and options.');
      const next = sanitizeSettings({ ...settings, profiles: saved });
      await putSettings(next);
      return next;
    },
    deleteProfile: async (input) => {
      record(input, ['id']);
      const settings = getSettings();
      const next = sanitizeSettings({
        ...settings,
        profiles: (settings.profiles || []).filter((profile) => profile.id !== id(input.id)),
      });
      await putSettings(next);
      return next;
    },
    queueAction: (input) => {
      ready();
      record(input, ['action', 'ids', 'targetIndex']);
      if (!['pause', 'resume', 'cancel', 'retry', 'move'].includes(input.action))
        throw new UserError('Choose a supported queue action.');
      const ids = jobIds(input.ids);
      if (
        input.action === 'move' &&
        (!Number.isInteger(input.targetIndex) ||
          input.targetIndex < 0 ||
          input.targetIndex >= MAX_QUEUE_ITEMS)
      )
        throw new UserError('Invalid queue position.');
      return queue.bulkAction(input.action, ids, input.targetIndex);
    },
    deleteHistory: async (input) => {
      ready();
      record(input, ['ids']);
      const ids = jobIds(input.ids);
      const fi = getSettings().language === 'fi';
      const answer = await dialog.showMessageBox(getWindow(), {
        type: 'question',
        buttons: fi ? ['Peruuta', 'Poista valitut'] : ['Cancel', 'Delete selected'],
        defaultId: 0,
        cancelId: 0,
        message: fi
          ? `Poistetaanko ${ids.length} historiariviä?`
          : `Delete ${ids.length} history entries?`,
        detail: fi ? 'Ladatut tiedostot säilyvät.' : 'Downloaded files will be kept.',
      });
      ready();
      return { deleted: answer.response === 1 ? queue.deleteHistory(ids) : 0 };
    },
    addDownloads: async (input) => {
      ready();
      record(input, ['urls', 'options']);
      if (!Array.isArray(input.urls) || input.urls.length < 1 || input.urls.length > 100) {
        throw new UserError('Add between 1 and 100 video URLs at a time.', 'INVALID_URL');
      }
      const urls = input.urls.map(asUrl);
      const options = asOptions(input.options);
      const folder = await requireFolder();
      ready();
      if (queue.getQueueState().queue.length + batchSize(urls) > MAX_QUEUE_ITEMS)
        throw new UserError('The queue is full.', 'QUEUE_FULL');
      return queue.addBatch(urls, folder, options);
    },
    cancelDownload: (value) => changeJob('cancelDownload', value),
    pauseDownload: (value) => changeJob('pauseDownload', value),
    resumeDownload: (value) => changeJob('resumeDownload', value),
    moveDownload: (input) => {
      ready();
      record(input, ['id', 'direction']);
      if (!['up', 'down'].includes(input.direction))
        throw new UserError('Choose a valid queue direction.');
      const jobs = queue.getQueueState().queue;
      const index = jobs.findIndex((job) => job.id === id(input.id));
      if (index < 0 || !queue.moveDownload(input.id, index + (input.direction === 'up' ? -1 : 1))) {
        throw new UserError('This download cannot move in that direction.', 'INVALID_STATE');
      }
      return true;
    },
    retryDownload: async (input) => {
      ready();
      record(input, ['id', 'options']);
      id(input.id);
      let overrides;
      if (input.options !== undefined) {
        overrides = asOptions(input.options);
        // Normalization supplies a default for new jobs. A partial retry must
        // preserve the previous job's explicit quality instead.
        if (input.options.quality === undefined && input.options.format === undefined) {
          delete overrides.quality;
        }
      }
      let result;
      if (input.options === undefined) result = queue.retryDownload(input.id);
      else {
        const folder = await requireFolder();
        ready();
        result = queue.retryWithOptions(input.id, overrides, folder);
      }
      if (!result)
        throw new UserError('Only failed or cancelled downloads can be retried.', 'INVALID_STATE');
      return result;
    },
    openFile: async (value) => {
      const error = await shell.openPath(await completedFile(queue, value, filesystem));
      if (error)
        throw new UserError(
          'The operating system could not open this media file.',
          'FILE_UNAVAILABLE',
        );
      return true;
    },
    showInFolder: async (value) => {
      shell.showItemInFolder(await completedFile(queue, value, filesystem));
      return true;
    },
    setStartup: async (enabled) => {
      if (typeof enabled !== 'boolean') throw new UserError('Choose whether to start at login.');
      try {
        return { enabled: await startup.setEnabled(enabled) };
      } catch {
        throw new UserError(
          'Start at login could not be changed. Check your operating system settings.',
          'STARTUP_FAILED',
        );
      }
    },
    hideWindow: () => {
      if (deps.canHideWindow && !deps.canHideWindow()) {
        throw new UserError(
          'The tray is unavailable. Keep the window open or use Close to quit.',
          'TRAY_UNAVAILABLE',
        );
      }
      getWindow().hide();
      return true;
    },
    clearHistory: async () => {
      ready();
      const fi = getSettings().language === 'fi';
      const answer = await dialog.showMessageBox(getWindow(), {
        type: 'question',
        buttons: fi ? ['Peruuta', 'Tyhjennä historia'] : ['Cancel', 'Clear history'],
        defaultId: 0,
        cancelId: 0,
        message: fi ? 'Tyhjennetäänkö lataushistoria?' : 'Clear download history?',
        detail: fi ? 'Ladatut tiedostot säilyvät.' : 'Downloaded files will be kept.',
      });
      if (answer.response !== 1) return { cleared: false };
      ready();
      queue.clearHistory();
      return { cleared: true };
    },
    exportHistory: async () => {
      const result = await dialog.showSaveDialog(getWindow(), {
        defaultPath: 'videoninja-history.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) return { exported: false };
      await filesystem.writeFile(result.filePath, JSON.stringify(queue.exportHistory(), null, 2), {
        mode: 0o600,
      });
      return { exported: true };
    },
    previewDownload: async (input) => {
      ready();
      if (disposing) throw new UserError('The application is shutting down.', 'INVALID_STATE');
      record(input, ['url', 'options']);
      const url = asUrl(input.url);
      const options = asOptions(input.options);
      previewController?.abort();
      const controller = new AbortController();
      previewController = controller;
      const task = Promise.resolve().then(() =>
        tools.fetchMetadata(url, options, {
          signal: controller.signal,
          private: Boolean(getSettings().privateMode),
        }),
      );
      previewTasks.add(task);
      try {
        return await task;
      } finally {
        previewTasks.delete(task);
        if (previewController === controller) previewController = null;
      }
    },
    previewPlaylist: async (input) => {
      ready();
      if (disposing) throw new UserError('The application is shutting down.', 'INVALID_STATE');
      record(input, ['url', 'options', 'start', 'pageSize']);
      const start = input.start ?? 1,
        pageSize = input.pageSize ?? MAX_QUEUE_ITEMS;
      if (
        !Number.isInteger(start) ||
        start < 1 ||
        start > 1000000 ||
        !Number.isInteger(pageSize) ||
        pageSize < 1 ||
        pageSize > MAX_QUEUE_ITEMS
      )
        throw new UserError('Invalid playlist page.');
      const url = asUrl(input.url);
      const options = asOptions(input.options);
      playlistController?.abort();
      playlistCache = null;
      const controller = new AbortController();
      playlistController = controller;
      const task = Promise.resolve().then(() =>
        tools.fetchPlaylist(url, options, {
          signal: controller.signal,
          start,
          pageSize,
          private: Boolean(getSettings().privateMode),
        }),
      );
      previewTasks.add(task);
      try {
        const result = await task;
        if (controller.signal.aborted || playlistController !== controller || disposing) {
          throw new UserError('The playlist preview was cancelled.', 'INVALID_STATE');
        }
        const entries = (Array.isArray(result.entries) ? result.entries : [])
          .slice(0, MAX_QUEUE_ITEMS)
          .map((entry, position) => {
            let entryUrl = null;
            try {
              entryUrl = validateUrl(entry.url);
            } catch {
              /* Unavailable items remain visible. */
            }
            return {
              id: typeof entry.id === 'string' ? entry.id.slice(0, 256) : String(position + 1),
              index: start + position,
              title: typeof entry.title === 'string' ? entry.title.slice(0, 512) : '',
              url: entryUrl,
              available: Boolean(entry.available && entryUrl),
              duration:
                Number.isFinite(entry.duration) && entry.duration >= 0 ? entry.duration : null,
            };
          });
        if (!entries.length)
          throw new UserError('No playlist entries were found.', 'PLAYLIST_EMPTY');
        const preview = {
          previewId: randomUUID(),
          title: typeof result.title === 'string' ? result.title.slice(0, 512) : '',
          entries,
          hasMore: Boolean(result.hasMore || result.entries.length > MAX_QUEUE_ITEMS),
          maxEntries: MAX_QUEUE_ITEMS,
          start,
          pageSize,
        };
        playlistCache = { preview, expires: Date.now() + 15 * 60 * 1000 };
        return preview;
      } finally {
        previewTasks.delete(task);
        if (playlistController === controller) playlistController = null;
      }
    },
    cancelPlaylistPreview: () => {
      playlistController?.abort();
      playlistCache = null;
      return true;
    },
    addPlaylistSelection: async (input) => {
      ready();
      record(input, ['previewId', 'indices', 'options']);
      const cached = playlistCache;
      if (!cached || cached.preview.previewId !== input.previewId || cached.expires < Date.now()) {
        throw new UserError('Preview the playlist again before adding it.', 'PLAYLIST_EXPIRED');
      }
      if (
        !Array.isArray(input.indices) ||
        !input.indices.length ||
        input.indices.length > MAX_QUEUE_ITEMS ||
        input.indices.some((value) => !Number.isInteger(value)) ||
        new Set(input.indices).size !== input.indices.length
      ) {
        throw new UserError('Choose one or more available playlist entries.', 'INVALID_REQUEST');
      }
      const selected = new Set(input.indices);
      const entries = cached.preview.entries.filter((entry) => selected.has(entry.index));
      if (entries.length !== selected.size || entries.some((entry) => !entry.available)) {
        throw new UserError('The selected playlist entries are unavailable.', 'INVALID_REQUEST');
      }
      const options = asOptions(input.options);
      const folder = await requireFolder();
      ready();
      if (playlistCache !== cached || disposing) {
        throw new UserError('Preview the playlist again before adding it.', 'PLAYLIST_EXPIRED');
      }
      const urls = [...new Set(entries.map((entry) => entry.url))];
      if (queue.getQueueState().queue.length + batchSize(urls) > MAX_QUEUE_ITEMS) {
        throw new UserError(
          'The queue is full. Choose fewer entries or wait for downloads to finish.',
          'QUEUE_FULL',
        );
      }
      const ids = queue.addBatch(urls, folder, options);
      playlistCache = null;
      return ids;
    },
    openExternal: async (url) => {
      const release =
        typeof url === 'string' &&
        /^https:\/\/github\.com\/miikkij\/VideoNinja\/releases\/tag\/v\d+\.\d+\.\d+$/.test(url);
      const setupLinks = deps.toolManager?.getSetupPlan?.();
      const officialSetup =
        typeof url === 'string' &&
        [
          'https://ffmpeg.org/download.html',
          'https://brew.sh/',
          'https://deno.com/',
          'https://github.com/denoland/deno/releases',
          'https://www.gyan.dev/ffmpeg/builds/',
        ].includes(url) &&
        Boolean(setupLinks);
      if (typeof url !== 'string' || (!HELP_URLS.has(url) && !release && !officialSetup))
        throw new UserError('This help link is not allowed.', 'FORBIDDEN');
      await shell.openExternal(url);
      return true;
    },
  };
  return {
    handlers,
    runToolOperation: async (operation, options) => (await withToolLock(operation, options)).result,
    async dispose() {
      disposing = true;
      previewController?.abort();
      playlistController?.abort();
      toolController?.abort();
      playlistCache = null;
      // Superseded previews can still be terminating their Windows process tree.
      await Promise.allSettled([...previewTasks, toolTask]);
    },
  };
}

module.exports = { APP_URL, UserError, createHandlers, registerIpc, trustedSender, completedFile };
