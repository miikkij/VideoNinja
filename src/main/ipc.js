const fs = require('node:fs/promises');
const path = require('node:path');
const { constants } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { validateUrl, normalizeOptions } = require('./downloadOptions');
const { sanitizeSettings, MAX_QUEUE_ITEMS } = require('./persistence');

const APP_URL = 'videoninja://app/index.html';
const HELP_URLS = new Set([
  'https://github.com/yt-dlp/yt-dlp/releases',
  'https://github.com/yt-dlp/yt-dlp/wiki/EJS',
  'https://ffmpeg.org/download.html',
  'https://docs.deno.com/runtime/getting_started/installation/',
  'https://github.com/miikkij/VideoNinja/issues',
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
  let disposing = false;

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
    if (!queue[method](id(value)))
      throw new UserError('This download can no longer perform that action.', 'INVALID_STATE');
    return true;
  };

  const handlers = {
    getInitialState: () => deps.getInitialState(),
    recheckTools: () => deps.recheckTools(),
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
      ]);
      const previous = getSettings();
      const merged = { ...previous, ...input };
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
        !folders.has(merged.downloadPath)
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
    addDownloads: async (input) => {
      record(input, ['urls', 'options']);
      if (!Array.isArray(input.urls) || input.urls.length < 1 || input.urls.length > 100) {
        throw new UserError('Add between 1 and 100 video URLs at a time.', 'INVALID_URL');
      }
      const urls = input.urls.map(asUrl);
      const options = asOptions(input.options);
      const folder = await requireFolder();
      if (queue.getQueueState().queue.length + batchSize(urls) > MAX_QUEUE_ITEMS)
        throw new UserError('The queue is full.', 'QUEUE_FULL');
      return queue.addBatch(urls, folder, options);
    },
    cancelDownload: (value) => changeJob('cancelDownload', value),
    pauseDownload: (value) => changeJob('pauseDownload', value),
    resumeDownload: (value) => changeJob('resumeDownload', value),
    moveDownload: (input) => {
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
      const result =
        input.options === undefined
          ? queue.retryDownload(input.id)
          : queue.retryWithOptions(input.id, overrides);
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
      if (disposing) throw new UserError('The application is shutting down.', 'INVALID_STATE');
      record(input, ['url', 'options']);
      const url = asUrl(input.url);
      const options = asOptions(input.options);
      previewController?.abort();
      const controller = new AbortController();
      previewController = controller;
      const task = Promise.resolve().then(() =>
        tools.fetchMetadata(url, options, { signal: controller.signal }),
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
      if (disposing) throw new UserError('The application is shutting down.', 'INVALID_STATE');
      record(input, ['url', 'options']);
      const url = asUrl(input.url);
      const options = asOptions(input.options);
      playlistController?.abort();
      playlistCache = null;
      const controller = new AbortController();
      playlistController = controller;
      const task = Promise.resolve().then(() =>
        tools.fetchPlaylist(url, options, { signal: controller.signal }),
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
              index: position + 1,
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
      if (typeof url !== 'string' || !HELP_URLS.has(url))
        throw new UserError('This help link is not allowed.', 'FORBIDDEN');
      await shell.openExternal(url);
      return true;
    },
  };
  return {
    handlers,
    async dispose() {
      disposing = true;
      previewController?.abort();
      playlistController?.abort();
      playlistCache = null;
      // Superseded previews can still be terminating their Windows process tree.
      await Promise.allSettled([...previewTasks]);
    },
  };
}

module.exports = { APP_URL, UserError, createHandlers, registerIpc, trustedSender, completedFile };
