(() => {
  'use strict';
  const api = window.videoNinja;
  const i18n = window.VideoNinjaI18n;
  const t = (key, values) => i18n.t(key, values);
  const $ = (id) => document.getElementById(id);
  const listeners = new AbortController();
  const subscriptions = [];
  const rows = new Map();
  let settings = { language: 'en', quality: 'best', jsRuntime: 'auto' };
  let queue = { queue: [], history: [] };
  let tools = {};
  let diskSpace = null;
  let warnings = [];
  let initialized = false;
  let adding = false;
  let saveChain = Promise.resolve(true);
  let saveRevision = 0;
  let settingsSaved = true;
  let retryId = null;
  let retryOpener = null;
  let previewRevision = 0;

  function listen(element, event, callback, signal = listeners.signal) {
    element.addEventListener(event, callback, { signal });
  }
  function announce(message) {
    $('live-status').textContent = message;
  }
  function notice(message, error = false) {
    $('notice-message').textContent = String(message);
    $('notice').classList.toggle('is-error', error);
    $('notice').hidden = false;
    announce(message);
  }
  function warningMessage(item) {
    const key = typeof item === 'string' ? item : item.code;
    const translated = key ? t(key) : '';
    if (translated && translated !== key) return translated;
    const message = typeof item === 'string' ? item : item.message || '';
    const aliases = {
      'Unsupported or invalid saved queue was not restored.': 'savedQueueInvalid',
      'Unsupported settings version was not restored.': 'savedSettingsInvalid',
      'Saved queue was not a list and was ignored.': 'savedListInvalid',
      'Saved history was not a list and was ignored.': 'savedListInvalid',
      'Damaged configuration was preserved in a separate file. Settings have been reset.':
        'damagedConfig',
    };
    if (Object.hasOwn(aliases, message)) return t(aliases[message]);
    const ignored = message.match(/^(\d+) invalid, duplicate or excess saved jobs were ignored\.$/);
    if (ignored) return t('savedJobsIgnored', { count: ignored[1] });
    const migrated = message.match(/^(\d+) legacy jobs received new IDs\.$/);
    return migrated ? t('savedJobsMigrated', { count: migrated[1] }) : message;
  }
  function renderWarnings() {
    $('warnings-message').textContent = warnings.map(warningMessage).filter(Boolean).join('\n');
    $('warnings').hidden = !$('warnings-message').textContent;
  }
  async function request(method, input) {
    try {
      if (!api || typeof api[method] !== 'function') throw new Error(t('initialFailed'));
      const response = await api[method](input);
      if (!response?.ok) {
        const key = `error_${response?.error?.code}`;
        const translated = t(key);
        throw new Error(
          translated !== key ? translated : response?.error?.message || t('operationFailed'),
        );
      }
      return response.data;
    } catch (error) {
      throw new Error(error?.message || t('operationFailed'), { cause: error });
    }
  }
  async function action(button, task) {
    button.disabled = true;
    try {
      await task();
    } catch (error) {
      notice(error.message, true);
    } finally {
      if (button.isConnected) {
        button.disabled = ['clear-history', 'export-history'].includes(button.id)
          ? !(queue.history || []).length
          : false;
      }
    }
  }
  function openSettings(open, focus = false) {
    $('settings-panel').hidden = !open;
    $('settings-toggle').setAttribute('aria-expanded', String(open));
    if (open && focus) $('choose-folder').focus();
  }
  function bytes(value) {
    if (!Number.isFinite(value) || value < 0) return '—';
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    const power =
      value === 0 ? 0 : Math.min(4, Math.max(0, Math.floor(Math.log(value) / Math.log(1024))));
    return `${new Intl.NumberFormat(i18n.locale(), { maximumFractionDigits: 1 }).format(value / 1024 ** power)} ${units[power]}`;
  }
  function duration(value) {
    if (!Number.isFinite(Number(value)) || Number(value) < 0) return '';
    const seconds = Math.round(Number(value));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = String(seconds % 60).padStart(2, '0');
    return hours
      ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}`
      : `${minutes}:${remainder}`;
  }
  function renderDisk() {
    const el = $('disk-space');
    $('disk-alert').hidden = true;
    el.classList.remove('tool-missing');
    if (!settings.downloadPath) {
      el.textContent = '';
      return;
    }
    if (
      !diskSpace?.available ||
      !Number.isFinite(diskSpace.free) ||
      !Number.isFinite(diskSpace.total)
    ) {
      el.textContent = t('diskUnknown');
      return;
    }
    const key =
      diskSpace.free < 1024 ** 3
        ? 'diskCritical'
        : diskSpace.free < 5 * 1024 ** 3
          ? 'diskLow'
          : 'diskFree';
    el.textContent = t(key, { free: bytes(diskSpace.free), total: bytes(diskSpace.total) });
    el.classList.toggle('tool-missing', key !== 'diskFree');
    if (key !== 'diskFree') {
      $('disk-alert-message').textContent = el.textContent;
      $('disk-alert').classList.toggle('is-error', key === 'diskCritical');
      $('disk-alert').hidden = false;
    }
  }
  function renderTools() {
    for (const name of ['ytdlp', 'ffmpeg']) {
      const tool = tools[name];
      $(`${name}-status`).textContent = !tool
        ? t('checking')
        : tool.available
          ? t('found', { version: tool.version || '—' })
          : t('missing');
      $(`${name}-status`).classList.toggle('tool-missing', Boolean(tool && !tool.available));
      $(`${name}-path`).textContent = tool?.available ? tool.path || '' : tool?.error || '';
    }
    const runtimes = tools.ytdlp?.jsRuntimes || [];
    $('runtime-status').textContent = runtimes.length
      ? runtimes.map((item) => `${item.name}${item.version ? ` ${item.version}` : ''}`).join(', ')
      : t('noRuntime');
    $('runtime-status').classList.toggle('tool-missing', !runtimes.length);
    $('tool-help').open = Boolean(
      tools.ytdlp && (!tools.ytdlp.available || !tools.ffmpeg?.available),
    );
    renderReadiness();
  }
  function renderReadiness() {
    const ready =
      initialized &&
      settingsSaved &&
      Boolean(settings.downloadPath) &&
      Boolean(tools.ytdlp?.available);
    $('add-downloads').disabled = !ready || adding;
    $('preview-button').disabled = !initialized || !tools.ytdlp?.available;
    $('readiness').textContent = !settingsSaved
      ? t('saveFailed')
      : !settings.downloadPath
        ? t('needFolder')
        : !tools.ytdlp?.available
          ? t('needTools')
          : t('ready', { folder: settings.downloadPath });
    $('setup-hint').hidden = ready;
  }
  function applySettings() {
    i18n.setLanguage(settings.language);
    $('language').value = settings.language === 'fi' ? 'fi' : 'en';
    $('download-path').value = settings.downloadPath || '';
    $('cookie-source').value = settings.cookieSource || '';
    $('cookie-file').value = settings.cookieFilePath || '';
    $('cookie-file-field').hidden = settings.cookieSource !== 'file';
    $('js-runtime').value = settings.jsRuntime || 'auto';
    $('user-agent').value = settings.userAgent || '';
    $('extra-args').value = Array.isArray(settings.extraArgs)
      ? settings.extraArgs.join(' ')
      : settings.extraArgs || '';
    $('quality').value = ['best', '2160', '1440', '1080', '720', '480', 'audio'].includes(
      settings.quality,
    )
      ? settings.quality
      : 'best';
    $('audio-format-field').hidden = $('quality').value !== 'audio';
    renderWarnings();
    renderTools();
    renderDisk();
    renderQueue();
  }
  function saveSettings(patch) {
    settings = { ...settings, ...patch };
    const snapshot = { ...settings };
    const revision = ++saveRevision;
    $('settings-save-status').textContent = t('saving');
    saveChain = saveChain
      .catch(() => false)
      .then(async () => {
        try {
          const saved = await request('saveSettings', snapshot);
          if (revision === saveRevision) {
            settings = { ...settings, ...(saved?.settings || saved || {}) };
            settingsSaved = true;
            $('settings-save-status').textContent = t('saved');
            $('retry-save').hidden = true;
            renderReadiness();
          }
          return true;
        } catch (error) {
          if (revision === saveRevision) {
            settingsSaved = false;
            $('settings-save-status').textContent = t('saveFailed');
            $('retry-save').hidden = false;
            openSettings(true);
            renderReadiness();
            notice(`${t('saveFailed')} ${error.message}`, true);
          }
          return false;
        }
      });
    return saveChain;
  }
  function parseUrls() {
    const urls = $('video-urls')
      .value.split(/\r?\n/)
      .map((url) => url.trim())
      .filter(Boolean);
    if (!urls.length) throw new Error(t('emptyUrls'));
    if (urls.length > 100) throw new Error(t('tooManyUrls'));
    urls.forEach((value, index) => {
      try {
        const url = new URL(value);
        if (
          !['http:', 'https:'].includes(url.protocol) ||
          !url.hostname ||
          url.username ||
          url.password
        )
          throw new Error();
      } catch {
        throw new Error(t('invalidUrl', { line: index + 1 }));
      }
    });
    return urls;
  }
  function cookieOptions(source, file) {
    if (source === 'file') {
      if (!file) throw new Error(t('missingCookieFile'));
      return { cookieFile: file };
    }
    return source ? { cookiesFromBrowser: source } : {};
  }
  function downloadOptions() {
    const source =
      $('download-cookie-source').value === 'default'
        ? settings.cookieSource || ''
        : $('download-cookie-source').value;
    const options = {
      quality: $('quality').value,
      ...cookieOptions(source, settings.cookieFilePath),
    };
    if (options.quality === 'audio') options.audioFormat = $('audio-format').value;
    if (settings.userAgent) options.userAgent = settings.userAgent;
    if (settings.extraArgs) options.extraArgs = settings.extraArgs;
    if (settings.jsRuntime && settings.jsRuntime !== 'auto') options.jsRuntime = settings.jsRuntime;
    if ($('force-ipv4').checked) options.forceIpv4 = true;
    if ($('referer').value.trim()) options.referer = $('referer').value.trim();
    if ($('extractor-args').value.trim()) options.extractorArgs = $('extractor-args').value.trim();
    return options;
  }
  function formError(message) {
    $('urls-error').textContent = message || '';
    $('urls-error').hidden = !message;
    $('video-urls').setAttribute('aria-invalid', String(Boolean(message)));
  }
  async function submitDownloads(event) {
    event.preventDefault();
    if (adding) return;
    formError('');
    let urls;
    let options;
    try {
      urls = parseUrls();
      options = downloadOptions();
      if (!settings.downloadPath) throw new Error(t('needFolder'));
      if (!tools.ytdlp?.available) throw new Error(t('needTools'));
    } catch (error) {
      formError(error.message);
      $('video-urls').focus();
      return;
    }
    const submittedText = $('video-urls').value;
    adding = true;
    renderReadiness();
    try {
      if (!(await saveChain)) throw new Error(t('saveFailed'));
      await request('addDownloads', { urls, options });
      if ($('video-urls').value === submittedText) $('video-urls').value = '';
      $('preview-panel').hidden = true;
      notice(t('added', { count: urls.length }));
      $('video-urls').focus();
    } catch (error) {
      formError(error.message);
    } finally {
      adding = false;
      renderReadiness();
    }
  }
  function create(tag, className, parent) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (parent) parent.appendChild(element);
    return element;
  }
  function createRow(id) {
    const controller = new AbortController();
    const element = create('li', 'download-item');
    element.dataset.id = id;
    const title = create('h3', 'download-title', element);
    const url = create('p', 'url-text', element);
    const meta = create('p', 'download-meta', element);
    const status = create('p', 'download-state', element);
    const progressArea = create('div', 'progress-area', element);
    const progress = create('progress', '', progressArea);
    progress.max = 100;
    const percent = create('span', 'progress-value', progressArea);
    percent.setAttribute('aria-hidden', 'true');
    const actions = create('div', 'download-actions', element);
    const errorArea = create('div', 'error-area', element);
    const errorTitle = create('p', '', errorArea);
    const errorDetail = create('pre', 'error-detail', errorArea);
    const errorNext = create('p', 'hint', errorArea);
    const copy = create('button', '', errorArea);
    copy.type = 'button';
    listen(
      copy,
      'click',
      () =>
        action(copy, async () => {
          await navigator.clipboard.writeText(errorDetail.textContent);
          notice(t('copied'));
        }),
      controller.signal,
    );
    return {
      element,
      title,
      url,
      meta,
      status,
      progressArea,
      progress,
      percent,
      actions,
      errorArea,
      errorTitle,
      errorDetail,
      errorNext,
      copy,
      buttons: new Map(),
      controller,
      download: null,
    };
  }
  function desiredActions(download, list) {
    if (download.status === 'completed') return ['openFile', 'showFolder'];
    if (download.status === 'failed' || download.status === 'cancelled')
      return ['quickRetry', 'retryOptions'];
    if (download.status === 'downloading') return ['pause', 'cancel'];
    if (download.status === 'pending' || download.status === 'paused') {
      const actions = download.status === 'paused' ? ['resume', 'cancel'] : ['pause', 'cancel'];
      if (list.length > 1) actions.push('moveUp', 'moveDown');
      return actions;
    }
    return [];
  }
  async function runRowAction(name, row, button) {
    const download = row.download;
    if (name === 'retryOptions') {
      openRetry(download, button);
      return;
    }
    await action(button, async () => {
      if (name === 'quickRetry') await request('retryDownload', { id: download.id });
      else if (name === 'moveUp' || name === 'moveDown')
        await request('moveDownload', {
          id: download.id,
          direction: name === 'moveUp' ? 'up' : 'down',
        });
      else
        await request(
          {
            cancel: 'cancelDownload',
            pause: 'pauseDownload',
            resume: 'resumeDownload',
            openFile: 'openFile',
            showFolder: 'showInFolder',
          }[name],
          download.id,
        );
    });
    if (rows.has(download.id))
      updateRow(
        row,
        row.download,
        (queue.queue || []).findIndex((item) => item.id === download.id),
        queue.queue || [],
      );
  }
  function updateRow(row, download, index, list) {
    row.download = download;
    row.element.dataset.status = download.status;
    const title = download.title || download.url || 'Video';
    row.title.textContent = title;
    row.url.textContent = download.title ? download.url || '' : '';
    row.url.hidden = !download.title;
    const quality = download.options?.quality;
    const qualityLabel =
      quality === 'audio'
        ? t('qualityAudio')
        : quality === 'best'
          ? t('qualityBest')
          : quality
            ? `${quality}p`
            : '';
    const audioFormat = quality === 'audio' ? download.options?.audioFormat || 'original' : null;
    const metadata = [
      qualityLabel,
      audioFormat === 'original' ? t('audioOriginal') : audioFormat?.toUpperCase(),
      download.outputPath,
    ];
    if (download.completedAt) {
      const date = new Date(download.completedAt);
      if (!Number.isNaN(date.getTime()))
        metadata.push(t('finishedAt', { date: date.toLocaleString(i18n.locale()) }));
    }
    row.meta.textContent = metadata.filter(Boolean).join(' · ');
    const phase = download.phase || download.stage;
    const stateKey =
      download.status === 'downloading' &&
      ['preparing', 'merging', 'processing', 'retrying', 'postprocessing'].includes(phase)
        ? phase
        : download.status;
    const stateParts = [t(stateKey || 'pending')];
    if (download.status === 'downloading' && Number.isFinite(download.speed) && download.speed > 0)
      stateParts.push(t('speed', { speed: bytes(download.speed) }));
    if (download.status === 'downloading' && Number.isFinite(download.eta) && download.eta >= 0)
      stateParts.push(t('eta', { duration: duration(download.eta) }));
    row.status.textContent = stateParts.join(' · ');
    row.progressArea.hidden = !['downloading', 'paused', 'pausing', 'cancelling'].includes(
      download.status,
    );
    const progress = Number.isFinite(download.progress)
      ? Math.min(100, Math.max(0, download.progress))
      : 0;
    row.progress.value = progress;
    row.progress.setAttribute('aria-label', t('actionFor', { action: t('downloading'), title }));
    row.percent.textContent = `${Math.round(progress)}%`;
    row.errorArea.hidden = !download.error;
    row.errorTitle.textContent = t('errorDetails');
    row.errorDetail.textContent = download.error || '';
    row.errorNext.textContent = t('errorNext');
    row.copy.textContent = t('copyError');
    const actions = desiredActions(download, list);
    for (const [name, button] of row.buttons) {
      if (!actions.includes(name)) {
        const focused = document.activeElement === button;
        button.remove();
        row.buttons.delete(name);
        if (focused) {
          row.title.tabIndex = -1;
          row.title.focus();
        }
      }
    }
    for (const name of actions) {
      let button = row.buttons.get(name);
      if (!button) {
        button = create('button', name === 'cancel' ? 'danger' : '', row.actions);
        button.type = 'button';
        button.dataset.action = name;
        listen(
          button,
          'click',
          () => {
            void runRowAction(name, row, button);
          },
          row.controller.signal,
        );
        row.buttons.set(name, button);
      }
      button.textContent = t(name);
      button.setAttribute('aria-label', t('actionFor', { action: t(name), title }));
      if (name === 'moveUp')
        button.disabled = index <= 0 || !['pending', 'paused'].includes(list[index - 1]?.status);
      if (name === 'moveDown')
        button.disabled =
          index < 0 ||
          index >= list.length - 1 ||
          !['pending', 'paused'].includes(list[index + 1]?.status);
    }
  }
  function reconcileList(element, downloads) {
    downloads.forEach((download, index) => {
      let row = rows.get(download.id);
      if (!row) {
        row = createRow(download.id);
        rows.set(download.id, row);
      }
      row.element.hidden = false;
      updateRow(row, download, index, downloads);
      const current = element.children[index];
      if (current !== row.element) {
        const focused = row.element.contains(document.activeElement)
          ? document.activeElement
          : null;
        element.insertBefore(row.element, current || null);
        if (focused?.isConnected) focused.focus({ preventScroll: true });
      }
    });
  }
  function renderQueue() {
    const pending = Array.isArray(queue.queue) ? queue.queue : [];
    const history = Array.isArray(queue.history) ? queue.history : [];
    const ids = new Set([...pending, ...history].map((item) => item.id));
    for (const [id, row] of rows) {
      if (!ids.has(id)) {
        row.controller.abort();
        const focused = row.element.contains(document.activeElement);
        row.element.remove();
        rows.delete(id);
        if (focused) $('video-urls').focus({ preventScroll: true });
      }
    }
    reconcileList($('queue-list'), pending);
    reconcileList($('history-list'), history);
    $('queue-empty').hidden = pending.length > 0;
    $('queue-count').textContent = t('queueCount', { count: pending.length });
    $('clear-history').disabled = !history.length;
    $('export-history').disabled = !history.length;
    filterHistory();
  }
  function filterHistory() {
    const query = $('history-search').value.trim().toLocaleLowerCase(i18n.locale());
    const history = Array.isArray(queue.history) ? queue.history : [];
    let visible = 0;
    for (const download of history) {
      const row = rows.get(download.id);
      if (!row) continue;
      const matches =
        !query ||
        [download.title, download.url, download.filepath, download.error, t(download.status)]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase(i18n.locale())
          .includes(query);
      row.element.hidden = !matches;
      if (matches) visible++;
    }
    $('history-empty').hidden = visible > 0;
    $('history-empty').textContent = t(history.length && query ? 'historyNoMatch' : 'historyEmpty');
  }
  function setQueue(next) {
    const previous = new Map(
      [...(queue.queue || []), ...(queue.history || [])].map((item) => [item.id, item.status]),
    );
    queue = next || { queue: [], history: [] };
    renderQueue();
    const completed = [...(queue.history || [])].find(
      (item) =>
        previous.has(item.id) &&
        previous.get(item.id) !== item.status &&
        ['completed', 'failed'].includes(item.status),
    );
    if (completed) announce(`${t(completed.status)}: ${completed.title || completed.url}`);
  }
  function openRetry(download, opener) {
    retryId = download.id;
    retryOpener = opener;
    const options = download.options || {};
    $('retry-title').textContent = download.title || download.url;
    $('retry-original-error').textContent = download.error || '';
    $('retry-original-error').hidden = !download.error;
    $('retry-quality').value = options.quality || 'best';
    $('retry-audio-format').value = options.audioFormat || 'original';
    $('retry-audio-format-field').hidden = $('retry-quality').value !== 'audio';
    $('retry-cookie-source').value = options.cookieFile ? 'file' : options.cookiesFromBrowser || '';
    $('retry-cookie-file').value = options.cookieFile || settings.cookieFilePath || '';
    $('retry-cookie-field').hidden = $('retry-cookie-source').value !== 'file';
    $('retry-runtime').value = options.jsRuntime || 'auto';
    $('retry-ipv4').checked = Boolean(options.forceIpv4);
    $('retry-user-agent').value = options.userAgent || '';
    $('retry-referer').value = options.referer || '';
    $('retry-extractor').value = options.extractorArgs || '';
    $('retry-extra').value = Array.isArray(options.extraArgs)
      ? options.extraArgs.join(' ')
      : options.extraArgs || '';
    $('retry-error').hidden = true;
    $('retry-dialog').showModal();
    $('retry-quality').focus();
  }
  function closeRetry() {
    $('retry-dialog').close();
    retryId = null;
    if (retryOpener?.isConnected) retryOpener.focus();
    else $('video-urls').focus();
  }
  function dialogKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeRetry();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [
      ...$('retry-dialog').querySelectorAll(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
      ),
    ].filter((el) => !el.closest('[hidden]'));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  async function loadInitial() {
    $('loading').hidden = false;
    try {
      const state = await request('getInitialState');
      settings = { ...settings, ...state.settings };
      tools = state.tools || {};
      diskSpace = state.diskSpace;
      queue = state.queue || { queue: [], history: [] };
      warnings = state.warnings || [];
      $('app-version').textContent = state.version ? `v${state.version}` : '';
      $('startup').checked = Boolean(state.startupEnabled);
      initialized = true;
      applySettings();
      openSettings(!settings.downloadPath || !tools.ytdlp?.available);
    } catch (error) {
      openSettings(true);
      notice(`${t('initialFailed')} ${error.message}`, true);
      renderReadiness();
    } finally {
      $('loading').hidden = true;
    }
  }

  listen($('settings-toggle'), 'click', () => openSettings($('settings-panel').hidden));
  listen($('retry-save'), 'click', () =>
    action($('retry-save'), async () => {
      if (await saveSettings({})) {
        notice(t('saved'));
        $('video-urls').focus();
      }
    }),
  );
  listen($('dismiss-notice'), 'click', () => {
    $('notice').hidden = true;
  });
  listen($('hide-window'), 'click', () => action($('hide-window'), () => request('hideWindow')));
  listen($('language'), 'change', () => {
    void saveSettings({ language: $('language').value });
    applySettings();
  });
  listen($('quality'), 'change', () => {
    $('audio-format-field').hidden = $('quality').value !== 'audio';
    void saveSettings({ quality: $('quality').value });
  });
  listen($('recheck-tools'), 'click', () =>
    action($('recheck-tools'), async () => {
      if (!initialized) {
        await loadInitial();
        return;
      }
      const result = await request('recheckTools');
      tools = result?.tools || result || {};
      renderTools();
      notice(t('toolsChecked'));
    }),
  );
  listen($('choose-folder'), 'click', () =>
    action($('choose-folder'), async () => {
      const folder = await request('chooseDownloadDirectory');
      if (folder) {
        diskSpace = null;
        const saved = await saveSettings({ downloadPath: folder });
        $('download-path').value = folder;
        renderReadiness();
        renderDisk();
        if (saved) $('video-urls').focus();
      }
    }),
  );
  listen($('choose-cookie'), 'click', () =>
    action($('choose-cookie'), async () => {
      const file = await request('chooseCookieFile');
      if (file) {
        $('cookie-file').value = file;
        await saveSettings({ cookieFilePath: file });
      }
    }),
  );
  listen($('cookie-source'), 'change', () => {
    $('cookie-file-field').hidden = $('cookie-source').value !== 'file';
    void saveSettings({ cookieSource: $('cookie-source').value });
  });
  for (const [id, key] of [
    ['js-runtime', 'jsRuntime'],
    ['user-agent', 'userAgent'],
    ['extra-args', 'extraArgs'],
  ])
    listen($(id), 'change', () => {
      void saveSettings({ [key]: $(id).value.trim() });
    });
  listen($('startup'), 'change', () => {
    const checkbox = $('startup');
    const desired = checkbox.checked;
    void action(checkbox, async () => {
      try {
        const data = await request('setStartup', desired);
        checkbox.checked = Boolean(data.enabled);
        notice(t(data.enabled ? 'startupEnabled' : 'startupDisabled'));
      } catch (error) {
        checkbox.checked = !desired;
        throw error;
      }
    });
  });
  listen($('download-form'), 'submit', submitDownloads);
  listen($('video-urls'), 'keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      $('download-form').requestSubmit();
    }
  });
  listen($('video-urls'), 'input', () => {
    formError('');
    previewRevision++;
    $('preview-panel').hidden = true;
  });
  listen($('preview-button'), 'click', () =>
    action($('preview-button'), async () => {
      formError('');
      let urls;
      let options;
      try {
        urls = parseUrls();
        options = downloadOptions();
      } catch (error) {
        formError(error.message);
        return;
      }
      const revision = ++previewRevision;
      announce(t('previewLoading'));
      const preview = await request('previewDownload', { url: urls[0], options });
      if (revision !== previewRevision) return;
      $('preview-title').textContent = preview?.title || t('previewUnavailable');
      $('preview-description').textContent = [
        preview?.uploader ? t('byAuthor', { author: preview.uploader }) : '',
        preview?.duration != null ? t('duration', { duration: duration(preview.duration) }) : '',
      ]
        .filter(Boolean)
        .join(' · ');
      $('preview-url').textContent = preview?.webpageUrl || urls[0];
      $('preview-panel').hidden = false;
      announce($('preview-title').textContent);
    }),
  );
  listen($('history-search'), 'input', filterHistory);
  listen($('clear-history'), 'click', () =>
    action($('clear-history'), async () => {
      const result = await request('clearHistory');
      if (result?.cleared) notice(t('historyCleared'));
    }),
  );
  listen($('export-history'), 'click', () =>
    action($('export-history'), async () => {
      const result = await request('exportHistory');
      if (result?.exported) notice(t('historyExported'));
    }),
  );
  for (const id of ['close-retry', 'cancel-retry']) listen($(id), 'click', closeRetry);
  listen($('retry-dialog'), 'cancel', (event) => {
    event.preventDefault();
    closeRetry();
  });
  listen($('retry-dialog'), 'keydown', dialogKeydown);
  listen($('retry-quality'), 'change', () => {
    $('retry-audio-format-field').hidden = $('retry-quality').value !== 'audio';
  });
  listen($('retry-cookie-source'), 'change', () => {
    $('retry-cookie-field').hidden = $('retry-cookie-source').value !== 'file';
  });
  listen($('retry-choose-cookie'), 'click', () =>
    action($('retry-choose-cookie'), async () => {
      const file = await request('chooseCookieFile');
      if (file) $('retry-cookie-file').value = file;
    }),
  );
  listen($('retry-form'), 'submit', async (event) => {
    event.preventDefault();
    if (!retryId || $('submit-retry').disabled) return;
    $('retry-error').hidden = true;
    const button = $('submit-retry');
    button.disabled = true;
    try {
      const options = {
        quality: $('retry-quality').value,
        ...cookieOptions($('retry-cookie-source').value, $('retry-cookie-file').value),
      };
      if (options.quality === 'audio') options.audioFormat = $('retry-audio-format').value;
      if ($('retry-runtime').value !== 'auto') options.jsRuntime = $('retry-runtime').value;
      if ($('retry-ipv4').checked) options.forceIpv4 = true;
      for (const [id, key] of [
        ['retry-user-agent', 'userAgent'],
        ['retry-referer', 'referer'],
        ['retry-extractor', 'extractorArgs'],
        ['retry-extra', 'extraArgs'],
      ])
        if ($(id).value.trim()) options[key] = $(id).value.trim();
      await request('retryDownload', { id: retryId, options });
      closeRetry();
      notice(t('retryQueued'));
    } catch (error) {
      $('retry-error').textContent = error.message;
      $('retry-error').hidden = false;
    } finally {
      button.disabled = false;
    }
  });
  listen(document, 'keydown', (event) => {
    if (event.key === 'F3' && !$('retry-dialog').open) {
      event.preventDefault();
      openSettings($('settings-panel').hidden);
    }
  });
  listen(document, 'click', (event) => {
    const localLink = event.target.closest?.('a[href^="#"]');
    if (localLink) {
      // Keep the trusted document URL unchanged while providing in-page navigation.
      event.preventDefault();
      const target = $(localLink.getAttribute('href').slice(1));
      target?.focus();
      target?.scrollIntoView?.({ block: 'start' });
      return;
    }
    const link = event.target.closest?.('a[data-external]');
    if (link) {
      event.preventDefault();
      void request('openExternal', link.href).catch((error) => notice(error.message, true));
    }
  });
  if (api) {
    for (const [name, callback] of [
      ['onState', setQueue],
      [
        'onWarnings',
        (next) => {
          warnings = Array.isArray(next) ? next : [];
          renderWarnings();
        },
      ],
      [
        'onTools',
        (next) => {
          tools = next?.tools || next || {};
          renderTools();
        },
      ],
      [
        'onDiskSpace',
        (next) => {
          diskSpace = next;
          renderDisk();
        },
      ],
      [
        'onProgress',
        (progress) => {
          const row = rows.get(progress?.id);
          if (row) {
            const job = (queue.queue || []).find((item) => item.id === progress.id);
            const next = {
              ...row.download,
              ...progress,
              status: row.download.status,
              phase: progress.phase || progress.status || row.download.phase,
            };
            if (job) Object.assign(job, next);
            updateRow(
              row,
              next,
              (queue.queue || []).findIndex((item) => item.id === progress.id),
              queue.queue || [],
            );
          }
        },
      ],
    ])
      if (typeof api[name] === 'function') subscriptions.push(api[name](callback));
  }
  window.addEventListener(
    'pagehide',
    () => {
      listeners.abort();
      rows.forEach((row) => row.controller.abort());
      subscriptions.forEach((unsubscribe) => {
        if (typeof unsubscribe === 'function') unsubscribe();
      });
    },
    { once: true },
  );
  void loadInitial();
})();
