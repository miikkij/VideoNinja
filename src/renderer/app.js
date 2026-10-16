(() => {
  'use strict';
  const api = window.videoNinja;
  const i18n = window.VideoNinjaI18n;
  const t = (key, values) => i18n.t(key, values);
  const $ = (id) => document.getElementById(id);
  const listeners = new AbortController();
  const subscriptions = [];
  const rows = new Map();
  let settings = {
    language: 'en',
    quality: 'best',
    jsRuntime: 'auto',
    maxConcurrent: 1,
    profiles: [],
    theme: 'auto',
    retryAttempts: 2,
    retryDelaySeconds: 15,
    diskReserveMb: 1024,
    globalRateKbps: 0,
    scheduleEnabled: false,
    scheduleStart: '00:00',
    scheduleEnd: '06:00',
    historyRetentionDays: 0,
    privateMode: false,
    encryptedStorage: false,
    skipDuplicates: true,
    stallTimeoutSeconds: 180,
    processingTimeoutSeconds: 900,
    notifications: false,
    checkUpdatesOnStartup: true,
  };
  const numericSettings = {
    'global-rate': 'globalRateKbps',
    'history-retention': 'historyRetentionDays',
    'retry-attempts': 'retryAttempts',
    'retry-delay': 'retryDelaySeconds',
    'disk-reserve': 'diskReserveMb',
    'stall-timeout': 'stallTimeoutSeconds',
    'processing-timeout': 'processingTimeoutSeconds',
  };
  const booleanSettings = {
    notifications: 'notifications',
    'skip-duplicates': 'skipDuplicates',
    'schedule-enabled': 'scheduleEnabled',
    'private-mode': 'privateMode',
    'encrypted-storage': 'encryptedStorage',
    'check-updates-startup': 'checkUpdatesOnStartup',
  };
  let privacy = {};
  let appUpdateState = { status: 'idle' };
  let updateBusy = false;
  let toolBusy = false;
  let toolSetup = null;
  let toolDiagnostics = null;
  let metadataFormats = [];
  let formatUrl = null;
  const selectedQueue = new Set();
  const selectedHistory = new Set();
  let bulkBusy = false;
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
  let playlistRevision = 0;
  let playlistPreviewId = null;
  let playlistRows = [];
  let playlistLoading = false;
  let playlistAdding = false;
  let playlistUrl = null;
  let playlistStart = 1;
  let playlistPageSize = 500;
  let playlistHasMore = false;

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
          : ['profile-apply', 'profile-delete'].includes(button.id)
            ? !$('profile-select').value
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
    toolSetup = tools.setup || toolSetup;
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
    const ejs = toolDiagnostics?.ejs || tools.ejs || tools.ytdlp?.ejs;
    $('ejs-status').textContent =
      typeof ejs === 'object' && ejs ? t(`ejs_${ejs.status}`) : t('ejs_not_checked');
    document.querySelectorAll('[data-tool-action]').forEach((button) => {
      button.disabled = !initialized || toolBusy;
      if (button.dataset.toolAction === 'install' || button.dataset.toolAction === 'update') {
        const plan = toolSetup?.tools?.find((item) => item.tool === button.dataset.tool);
        const available =
          button.dataset.tool === 'runtime'
            ? runtimes.length > 0
            : tools[button.dataset.tool === 'yt-dlp' ? 'ytdlp' : 'ffmpeg']?.available;
        button.hidden =
          button.dataset.toolAction === 'install'
            ? plan?.managed !== false && Boolean(available)
            : plan?.managed === false || !available;
        button.textContent = t(
          plan?.managed === false
            ? 'setupInstructions'
            : button.dataset.toolAction === 'install'
              ? 'installTool'
              : 'updateTool',
        );
      }
    });
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
    $('add-downloads').disabled = !ready || adding || toolBusy;
    $('preview-button').disabled = !initialized || !tools.ytdlp?.available || toolBusy;
    $('playlist-preview-button').disabled =
      !initialized || !tools.ytdlp?.available || playlistLoading || toolBusy;
    $('readiness').textContent = toolBusy
      ? t('toolsWorking')
      : !settingsSaved
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
    $('max-concurrent').value = String(settings.maxConcurrent || 1);
    $('theme').value = settings.theme || 'auto';
    document.documentElement.dataset.theme = settings.theme || 'auto';
    for (const [id, key] of Object.entries(numericSettings)) $(id).value = String(settings[key]);
    for (const [id, key] of Object.entries(booleanSettings)) $(id).checked = Boolean(settings[key]);
    $('schedule-start').value = settings.scheduleStart;
    $('schedule-end').value = settings.scheduleEnd;
    renderPolicySettings();
    renderProfiles();
    renderAppUpdate();
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
    renderPlaylistSelection();
    if (metadataFormats.length) {
      const selected = $('format-select').value,
        audio = $('format-audio').value;
      renderFormats({ formats: metadataFormats }, formatUrl);
      $('format-select').value = selected;
      $('format-audio').value = audio;
      renderFormatDetails();
    }
  }
  function saveSettings(patch) {
    settings = { ...settings, ...patch };
    const snapshot = { ...settings };
    delete snapshot.profiles;
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
            renderPolicySettings();
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
  function parseUrls(firstOnly = false) {
    const urls = $('video-urls')
      .value.split(/\r?\n/)
      .map((url) => url.trim())
      .filter(Boolean)
      .slice(0, firstOnly ? 1 : undefined);
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
  function downloadOptions({ includeFormat = true } = {}) {
    const source =
      $('download-cookie-source').value === 'default'
        ? settings.cookieSource || ''
        : $('download-cookie-source').value;
    const options = {
      quality: $('quality').value,
      ...cookieOptions(source, settings.cookieFilePath),
    };
    delete options.cookiesFromBrowser;
    delete options.cookieFile;
    Object.assign(options, cookieOptions(source, settings.cookieFilePath));
    delete options.formatId;
    if (options.quality === 'audio') options.audioFormat = $('audio-format').value;
    if (settings.userAgent) options.userAgent = settings.userAgent;
    if (settings.extraArgs) options.extraArgs = settings.extraArgs;
    if (settings.jsRuntime && settings.jsRuntime !== 'auto') options.jsRuntime = settings.jsRuntime;
    if ($('force-ipv4').checked) options.forceIpv4 = true;
    if ($('referer').value.trim()) options.referer = $('referer').value.trim();
    if ($('extractor-args').value.trim()) options.extractorArgs = $('extractor-args').value.trim();
    const rate = readNumber('download-rate');
    if (rate) options.rateLimitKbps = rate;
    else delete options.rateLimitKbps;
    delete options.subtitles;
    delete options.subtitleLang;
    delete options.subtitleAuto;
    if ($('subtitles').checked) {
      options.subtitles = true;
      options.subtitleLang = subtitleLanguage('subtitle-lang');
      if ($('subtitle-auto').checked) options.subtitleAuto = true;
    }
    const selectedFormat = $('format-select').value;
    if (
      includeFormat &&
      selectedFormat &&
      formatUrl &&
      metadataFormats.some((format) => format.formatId === selectedFormat)
    ) {
      const urls = parseUrls();
      if (urls.length !== 1 || urls[0] !== formatUrl) throw new Error(t('formatSingle'));
      options.formatId = selectedFormat;
      const chosen = metadataFormats.find((format) => format.formatId === selectedFormat);
      if (chosen.hasVideo && !chosen.hasAudio && $('format-audio').value)
        options.formatId += `+${$('format-audio').value}`;
    }
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
      const accepted = await request('addDownloads', { urls, options });
      if ($('video-urls').value === submittedText) $('video-urls').value = '';
      $('preview-panel').hidden = true;
      notice(t('added', { count: Array.isArray(accepted) ? accepted.length : urls.length }));
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
  function readNumber(id) {
    const field = $(id);
    const value = Number(field.value);
    const min = Number(field.min);
    const max = Number(field.max);
    if (!field.value.trim() || !Number.isInteger(value) || value < min || value > max) {
      field.setAttribute('aria-invalid', 'true');
      throw new Error(
        t('invalidNumber', {
          field: document.querySelector(`label[for="${id}"]`)?.textContent || id,
          min,
          max,
        }),
      );
    }
    field.removeAttribute('aria-invalid');
    return value;
  }
  function subtitleLanguage(id) {
    const value = $(id).value.trim();
    if (!value || !/^[a-zA-Z0-9.*,-]+$/u.test(value)) {
      $(id).setAttribute('aria-invalid', 'true');
      throw new Error(t('subtitleInvalid'));
    }
    $(id).removeAttribute('aria-invalid');
    return value;
  }
  function renderPolicySettings() {
    $('schedule-fields').hidden = !$('schedule-enabled').checked;
    $('private-banner').hidden = !settings.privateMode || !settingsSaved;
    $('encrypted-storage').disabled =
      privacy.encryptionAvailable !== true && !settings.encryptedStorage;
    $('encryption-status').textContent = t(
      settings.encryptedStorage && settingsSaved
        ? 'encryptionActive'
        : privacy.encryptionAvailable
          ? 'encryptionReady'
          : 'encryptionUnavailable',
    );
    $('queue-policy-status').textContent = settings.scheduleEnabled
      ? t('scheduleSummary', { start: settings.scheduleStart, end: settings.scheduleEnd })
      : '';
  }
  function renderProfiles(selected = $('profile-select').value) {
    const select = $('profile-select');
    select.replaceChildren();
    const empty = create('option', '', select);
    empty.value = '';
    empty.textContent = t('profileNone');
    for (const profile of settings.profiles || []) {
      const option = create('option', '', select);
      option.value = profile.id;
      option.textContent = profile.name;
    }
    select.value = selected;
    $('profile-apply').disabled = !select.value;
    $('profile-delete').disabled = !select.value;
  }
  async function applyProfile() {
    const profile = (settings.profiles || []).find((item) => item.id === $('profile-select').value);
    if (!profile) return;
    const options = profile.options || {};
    if (
      !(await saveSettings({
        downloadPath: profile.downloadPath || settings.downloadPath,
        quality: options.quality || 'best',
      }))
    )
      return;
    applySettings();
    $('audio-format').value = options.audioFormat || 'original';
    $('download-cookie-source').value = 'default';
    $('download-rate').value = String(options.rateLimitKbps || 0);
    $('subtitles').checked = Boolean(options.subtitles);
    $('subtitle-lang').value = options.subtitleLang || 'en';
    $('subtitle-auto').checked = Boolean(options.subtitleAuto);
    $('subtitle-fields').hidden = !options.subtitles;
    $('force-ipv4').checked = Boolean(options.forceIpv4);
    $('referer').value = options.referer || '';
    $('extractor-args').value = options.extractorArgs || '';
    resetFormats();
    $('profile-status').textContent = t('profileApplied', { name: profile.name });
  }
  async function saveProfile() {
    const name = $('profile-name').value.trim();
    if (!name) {
      $('profile-name').focus();
      throw new Error(t('profileNameRequired'));
    }
    if (!(await saveChain)) throw new Error(t('saveFailed'));
    const options = downloadOptions({ includeFormat: false });
    delete options.formatId;
    const saved = await request('saveProfile', {
      name,
      options,
      downloadPath: settings.downloadPath,
    });
    settings = { ...settings, ...saved };
    renderProfiles((settings.profiles || []).find((item) => item.name === name)?.id || '');
    $('profile-name').value = '';
    $('profile-status').textContent = t('profileSaved');
  }
  function formatLabel(format) {
    const kind = format.hasVideo
      ? format.hasAudio
        ? 'formatVideo'
        : 'formatSilent'
      : 'formatAudio';
    return [
      format.formatId,
      t(kind),
      format.height ? `${format.height}p` : '',
      format.fps ? `${format.fps} fps` : '',
      format.ext?.toUpperCase(),
      format.vcodec && format.vcodec !== 'none' ? format.vcodec : '',
      format.acodec && format.acodec !== 'none' ? format.acodec : '',
      format.filesize
        ? bytes(format.filesize)
        : format.filesizeApprox
          ? `≈ ${bytes(format.filesizeApprox)}`
          : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }
  function resetFormats() {
    metadataFormats = [];
    formatUrl = null;
    $('format-select').replaceChildren();
    $('format-audio').replaceChildren();
    $('format-controls').hidden = true;
    $('format-audio-field').hidden = true;
  }
  function renderFormats(preview, url) {
    resetFormats();
    metadataFormats = (Array.isArray(preview?.formats) ? preview.formats : [])
      .slice(0, 200)
      .filter((format) => typeof format.formatId === 'string');
    formatUrl = url;
    $('format-controls').hidden = !metadataFormats.length;
    const automatic = create('option', '', $('format-select'));
    automatic.value = '';
    automatic.textContent = t('formatAutomatic');
    const silent = create('option', '', $('format-audio'));
    silent.value = '';
    silent.textContent = t('audioNone');
    for (const format of metadataFormats) {
      const option = create('option', '', $('format-select'));
      option.value = format.formatId;
      option.textContent = formatLabel(format);
      if (format.hasAudio && !format.hasVideo) {
        const audio = create('option', '', $('format-audio'));
        audio.value = format.formatId;
        audio.textContent = formatLabel(format);
      }
    }
    if ($('format-audio').options.length > 1) $('format-audio').selectedIndex = 1;
    renderFormatDetails();
  }
  function renderFormatDetails() {
    const format = metadataFormats.find((item) => item.formatId === $('format-select').value);
    $('format-audio-field').hidden = !format?.hasVideo || Boolean(format.hasAudio);
    const audio = !$('format-audio-field').hidden
      ? metadataFormats.find((item) => item.formatId === $('format-audio').value)
      : null;
    const pieces = [format, audio].filter(Boolean);
    const size = pieces.reduce(
      (total, item) => total + (item.filesize || item.filesizeApprox || 0),
      0,
    );
    const complete = pieces.length && pieces.every((item) => item.filesize || item.filesizeApprox);
    $('format-details').textContent = complete
      ? t(pieces.every((item) => item.filesize) ? 'formatSize' : 'formatEstimate', {
          size: bytes(size),
        })
      : t('formatUnknown');
    if (
      complete &&
      diskSpace?.available &&
      diskSpace.free - size < settings.diskReserveMb * 1024 ** 2
    )
      $('format-details').textContent += ` ${t('formatDiskWarning')}`;
  }
  function renderAppUpdate() {
    const state = appUpdateState;
    const keys = {
      idle: 'updateIdle',
      checking: 'updateChecking',
      available: 'updateAvailable',
      'not-available': 'updateCurrent',
      downloading: 'updateDownloading',
      downloaded: 'updateDownloaded',
      installing: 'updateInstalling',
      error: 'updateError',
      manual: 'updateManual',
    };
    $('app-update-status').textContent = t(keys[state.status] || 'updateIdle', {
      version: state.version || '',
    });
    if (state.status === 'error' && state.message)
      $('app-update-status').textContent += ` ${state.message}`;
    const busy = updateBusy || ['checking', 'downloading', 'installing'].includes(state.status);
    $('app-update-check').disabled = busy;
    $('app-update-download').hidden = state.status !== 'available';
    $('app-update-download').disabled = busy;
    $('app-update-install').hidden = state.status !== 'downloaded' || !state.canInstall;
    $('app-update-install').disabled =
      busy || (queue.queue || []).some((job) => job.status === 'downloading');
    $('app-update-release').hidden = !state.releaseUrl;
    const progress = typeof state.progress === 'object' ? state.progress?.percent : state.progress;
    $('app-update-progress').hidden = state.status !== 'downloading';
    if (Number.isFinite(progress))
      $('app-update-progress').value = Math.max(0, Math.min(100, progress));
    else $('app-update-progress').removeAttribute('value');
    $('release-notes').hidden = !state.releaseNotes;
    $('release-notes-text').textContent =
      typeof state.releaseNotes === 'string' ? state.releaseNotes.slice(0, 20000) : '';
  }
  async function runAppUpdate(actionName) {
    updateBusy = true;
    renderAppUpdate();
    try {
      appUpdateState = await request('appUpdate', { action: actionName });
    } catch (error) {
      appUpdateState = { ...appUpdateState, status: 'error', message: error.message };
    } finally {
      updateBusy = false;
      renderAppUpdate();
    }
  }
  function renderToolGuidance(result = {}) {
    const container = $('tool-setup');
    container.replaceChildren();
    const command = result.command;
    const url = result.url;
    if (result.status === 'guided') create('p', '', container).textContent = t('setupManual');
    if (result.status === 'installed')
      create('p', '', container).textContent = t('toolInstalled', {
        tool: result.tool || '',
        version: result.version || '',
      });
    if (result.ejs) {
      create('p', '', container).textContent = t(`ejs_${result.ejs.status}`);
      create('p', 'hint', container).textContent = [
        result.ejs.version ? `EJS ${result.ejs.version}` : '',
        result.ejs.runtime || '',
        t('ejsNoLiveTest'),
      ]
        .filter(Boolean)
        .join(' · ');
      create('p', 'hint', container).textContent = t(
        result.ffprobe?.available ? 'probeAvailable' : 'probeMissing',
      );
    }
    if (command) {
      create('pre', 'setup-command', container).textContent = command;
      const copy = create('button', '', container);
      copy.type = 'button';
      copy.dataset.copyCommand = 'true';
      copy.textContent = t('copyCommand');
    }
    if (url) {
      const link = create('button', '', container);
      link.type = 'button';
      link.dataset.setupUrl = url;
      link.textContent = t('installHelp');
    }
    container.hidden = !container.childElementCount;
  }
  async function runToolAction(tool, actionName) {
    if (toolBusy) return;
    toolBusy = true;
    $('tool-action-status').textContent = t('toolWorking', { tool });
    renderTools();
    try {
      const result = await request('toolAction', { tool, action: actionName });
      tools = result.tools || tools;
      toolSetup = result.setup || toolSetup;
      toolDiagnostics = result.result?.ejs ? result.result : null;
      renderToolGuidance(result.result || {});
      $('tool-action-status').textContent = t('toolFinished');
    } catch (error) {
      $('tool-action-status').textContent = error.message;
      notice(error.message, true);
    } finally {
      toolBusy = false;
      renderTools();
    }
  }
  function createRow(id) {
    const controller = new AbortController();
    const element = create('li', 'download-item');
    element.dataset.id = id;
    const selectLabel = create('label', 'row-select', element);
    const select = create('input', '', selectLabel);
    select.type = 'checkbox';
    select.dataset.selectJob = id;
    const selectText = create('span', 'sr-only', selectLabel);
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
    const remedy = create('button', '', errorArea);
    remedy.type = 'button';
    listen(
      remedy,
      'click',
      () => {
        void runRemedy(rows.get(id), remedy);
      },
      controller.signal,
    );
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
      select,
      selectText,
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
      remedy,
      copy,
      buttons: new Map(),
      controller,
      download: null,
    };
  }
  function desiredActions(download, list) {
    if (download.status === 'completed') return ['openFile', 'showFolder'];
    if (download.status === 'skipped') return ['reviewDuplicates'];
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
    if (name === 'reviewDuplicates') {
      openSettings(true);
      $('workflow-settings').open = true;
      $('skip-duplicates').focus();
      return;
    }
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
    row.selectText.textContent = t('selectJob', { title });
    row.select.checked = (
      ['completed', 'failed', 'cancelled', 'skipped'].includes(download.status)
        ? selectedHistory
        : selectedQueue
    ).has(download.id);
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
    if (download.options?.formatId) metadata.unshift(download.options.formatId);
    if (download.options?.rateLimitKbps) metadata.push(`${download.options.rateLimitKbps} KiB/s`);
    if (download.completedAt) {
      const date = new Date(download.completedAt);
      if (!Number.isNaN(date.getTime()))
        metadata.push(t('finishedAt', { date: date.toLocaleString(i18n.locale()) }));
    }
    row.meta.textContent = metadata.filter(Boolean).join(' · ');
    const phase = download.phase || download.stage;
    const stateKey =
      ['downloading', 'pending', 'paused'].includes(download.status) &&
      [
        'preparing',
        'merging',
        'processing',
        'retrying',
        'postprocessing',
        'waiting-retry',
        'waiting-disk',
        'waiting-schedule',
        'waiting-duplicate',
      ].includes(phase)
        ? phase
        : download.status;
    const stateParts = [t(stateKey || 'pending')];
    if (download.attempts > 1) stateParts.push(t('attemptCount', { count: download.attempts }));
    if (download.retryAt && phase === 'waiting-retry') {
      const retryDate = new Date(download.retryAt);
      if (!Number.isNaN(retryDate.getTime()))
        stateParts.push(t('retryTime', { time: retryDate.toLocaleTimeString(i18n.locale()) }));
    }
    if (download.integrity?.status === 'verified') stateParts.push(t('integrityVerified'));
    else if (download.integrity?.status === 'size-only') stateParts.push(t('integritySize'));
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
    const remedy = jobRemedy(download);
    row.errorNext.textContent = t(remedy?.message || 'errorNext');
    row.remedy.hidden = !remedy?.action;
    row.remedy.textContent = remedy?.action ? t(remedy.action) : '';
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
    for (const id of selectedQueue)
      if (!pending.some((item) => item.id === id)) selectedQueue.delete(id);
    for (const id of selectedHistory)
      if (!history.some((item) => item.id === id)) selectedHistory.delete(id);
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
    renderBulkSelection();
    renderAppUpdate();
  }
  function jobRemedy(download) {
    const code = String(download.errorCode || '').toLowerCase();
    return {
      auth: { message: 'remedy_AUTH', action: 'fixAuthentication' },
      network: { message: 'remedy_NETWORK', action: 'quickRetry' },
      'rate-limit': { message: 'remedy_RATE_LIMIT', action: 'fixLimits' },
      'tool-missing': { message: 'remedy_TOOL', action: 'fixTools' },
      'disk-full': { message: 'remedy_DISK', action: 'fixFolder' },
      unavailable: { message: 'remedy_UNAVAILABLE', action: 'copySourceLink' },
      unsupported: { message: 'remedy_UNAVAILABLE', action: 'copySourceLink' },
      stalled: { message: 'remedy_TIMEOUT', action: 'retryOptions' },
      format: { message: 'remedy_FORMAT', action: 'retryOptions' },
      integrity: { message: 'remedy_INTEGRITY', action: 'quickRetry' },
    }[code];
  }
  async function runRemedy(row, button) {
    if (!row) return;
    const remedy = jobRemedy(row.download);
    if (!remedy) return;
    if (['quickRetry', 'retryOptions'].includes(remedy.action)) {
      await runRowAction(remedy.action, row, button);
      return;
    }
    if (remedy.action === 'fixAuthentication') {
      openRetry(row.download, button);
      $('retry-cookie-source').focus();
      return;
    }
    if (remedy.action === 'fixFolder') {
      await action(button, async () => {
        const folder = await request('chooseDownloadDirectory');
        if (folder && (await saveSettings({ downloadPath: folder }))) {
          diskSpace = null;
          applySettings();
          openRetry(row.download, button);
        }
      });
      return;
    }
    if (remedy.action === 'copySourceLink') {
      await action(button, async () => {
        await navigator.clipboard.writeText(row.download.url);
        notice(t('sourceCopied'));
      });
      return;
    }
    openSettings(true);
    if (remedy.action === 'fixTools') {
      $('diagnose-tools').focus();
      await runToolAction('yt-dlp', 'diagnose');
    } else {
      $('workflow-settings').open = true;
      $('max-concurrent').focus();
    }
  }
  function eligibleSelection(actionName) {
    return (queue.queue || [])
      .filter(
        (item) =>
          selectedQueue.has(item.id) &&
          (actionName === 'pause'
            ? ['pending', 'downloading'].includes(item.status)
            : actionName === 'resume'
              ? item.status === 'paused'
              : actionName === 'move'
                ? ['pending', 'paused'].includes(item.status)
                : ['pending', 'paused', 'downloading'].includes(item.status)),
      )
      .map((item) => item.id);
  }
  function renderBulkSelection() {
    $('queue-selected').textContent = t('selectedCount', { count: selectedQueue.size });
    $('history-selected').textContent = t('selectedCount', { count: selectedHistory.size });
    $('queue-select-all').disabled = bulkBusy || !(queue.queue || []).length;
    $('queue-clear-selection').disabled = bulkBusy || !selectedQueue.size;
    $('history-select-visible').disabled =
      bulkBusy || !(queue.history || []).some((item) => !rows.get(item.id)?.element.hidden);
    $('history-clear-selection').disabled = bulkBusy || !selectedHistory.size;
    $('history-delete-selected').disabled = bulkBusy || !selectedHistory.size;
    document.querySelectorAll('[data-queue-action]').forEach((button) => {
      button.disabled = bulkBusy || !eligibleSelection(button.dataset.queueAction).length;
    });
  }
  function syncSelection() {
    for (const [id, row] of rows)
      row.select.checked = selectedQueue.has(id) || selectedHistory.has(id);
    renderBulkSelection();
  }
  async function runBulkAction(actionName) {
    const ids = eligibleSelection(actionName);
    if (bulkBusy || !ids.length) return;
    bulkBusy = true;
    renderBulkSelection();
    try {
      const input = { action: actionName, ids };
      if (actionName === 'move') input.targetIndex = 0;
      await request('queueAction', input);
      ids.forEach((id) => selectedQueue.delete(id));
      notice(t('bulkDone'));
    } catch (error) {
      notice(error.message, true);
    } finally {
      bulkBusy = false;
      syncSelection();
    }
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
    renderBulkSelection();
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
    $('retry-destination').textContent = t('ready', {
      folder: settings.downloadPath || download.outputPath || '',
    });
    $('retry-original-error').textContent = download.error || '';
    $('retry-original-error').hidden = !download.error;
    $('retry-quality').value = options.quality || 'best';
    $('retry-audio-format').value = options.audioFormat || 'original';
    $('retry-audio-format-field').hidden = $('retry-quality').value !== 'audio';
    $('retry-format').value = options.formatId || '';
    $('retry-rate').value = String(options.rateLimitKbps || 0);
    $('retry-subtitles').checked = Boolean(options.subtitles);
    $('retry-subtitle-lang').value = options.subtitleLang || 'en';
    $('retry-subtitle-auto').checked = Boolean(options.subtitleAuto);
    $('retry-subtitle-fields').hidden = !options.subtitles;
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
  function dialogKeydown(event, dialog = $('retry-dialog'), close = closeRetry) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [
      ...dialog.querySelectorAll(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
      ),
    ].filter((el) => !el.closest('[hidden]'));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  function renderPlaylistSelection() {
    const available = playlistRows.filter((row) => row.available);
    const visible = available.filter((row) => !row.element.hidden);
    const selected = available.filter((row) => row.checkbox.checked);
    const busy = playlistLoading || playlistAdding;
    for (const row of playlistRows) row.checkbox.disabled = !row.available || busy;
    $('playlist-select-all').disabled = busy || !playlistPreviewId || !visible.length;
    $('playlist-clear-selection').disabled = busy || !selected.length;
    $('playlist-add-selected').disabled = busy || !playlistPreviewId || !selected.length;
    $('playlist-close').disabled = playlistAdding;
    $('playlist-search').disabled = busy;
    $('playlist-range').disabled = busy;
    $('playlist-apply-range').disabled = busy || !playlistPreviewId;
    $('playlist-previous').disabled = busy || playlistStart <= 1 || selected.length > 0;
    $('playlist-next').disabled = busy || !playlistHasMore || selected.length > 0;
    $('playlist-no-match').hidden =
      !playlistRows.length || playlistRows.some((row) => !row.element.hidden);
    $('playlist-page').textContent =
      busy || !playlistRows.length
        ? ''
        : t('playlistPage', {
            start: playlistStart,
            end: Math.max(...playlistRows.map((row) => row.index)),
          });
    $('playlist-status').textContent = playlistAdding
      ? t('playlistAdding')
      : playlistLoading
        ? t('playlistLoading')
        : !playlistPreviewId
          ? ''
          : !available.length
            ? t('playlistEmpty')
            : t('playlistSelection', { selected: selected.length, available: available.length });
  }
  function renderPlaylist(preview) {
    playlistPreviewId = preview.previewId;
    playlistStart = Number.isInteger(preview.start) ? preview.start : playlistStart;
    playlistPageSize = Number.isInteger(preview.pageSize) ? preview.pageSize : playlistPageSize;
    playlistHasMore = Boolean(preview.hasMore);
    playlistRows = [];
    const entries = Array.isArray(preview.entries) ? preview.entries : [];
    const fragment = document.createDocumentFragment();
    const indices = new Set();
    for (const entry of entries.slice(0, 500)) {
      if (!Number.isInteger(entry.index) || entry.index < 1 || indices.has(entry.index)) continue;
      indices.add(entry.index);
      const item = create('li', '', fragment);
      item.value = entry.index;
      const label = create('label', 'playlist-entry', item);
      const checkbox = create('input', '', label);
      checkbox.type = 'checkbox';
      checkbox.dataset.index = String(entry.index);
      const info = create('span', '', label);
      const title = create('strong', '', info);
      title.textContent = entry.title || t('playlistUntitled', { index: entry.index });
      const available =
        entry.available === true && typeof entry.url === 'string' && Boolean(entry.url);
      const detail = create('small', 'hint', info);
      detail.textContent = !available
        ? t('playlistUnavailable')
        : entry.duration != null
          ? t('duration', { duration: duration(entry.duration) })
          : '';
      playlistRows.push({
        index: entry.index,
        checkbox,
        available,
        element: item,
        title: title.textContent,
      });
    }
    $('playlist-list').replaceChildren(fragment);
    $('playlist-title').textContent = preview.title || '';
    $('playlist-limit').hidden = !preview.hasMore && entries.length <= 500;
    $('playlist-limit').textContent = t('playlistLimit');
    renderPlaylistSelection();
  }
  function filterPlaylist() {
    const query = $('playlist-search').value.trim().toLocaleLowerCase(i18n.locale());
    for (const row of playlistRows)
      row.element.hidden =
        Boolean(query) &&
        !`${row.index} ${row.title}`.toLocaleLowerCase(i18n.locale()).includes(query);
    renderPlaylistSelection();
  }
  function selectPlaylistRange() {
    const value = $('playlist-range').value.trim();
    const ranges = value.split(',').map((part) => part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/));
    const last = Math.max(playlistStart, ...playlistRows.map((row) => row.index));
    if (
      !value ||
      ranges.some(
        (match) =>
          !match ||
          Number(match[1]) < playlistStart ||
          Number(match[2] || match[1]) < Number(match[1]) ||
          Number(match[2] || match[1]) > last,
      )
    ) {
      $('playlist-error').textContent = t('playlistRangeInvalid');
      $('playlist-error').hidden = false;
      $('playlist-range').setAttribute('aria-invalid', 'true');
      return;
    }
    $('playlist-range').removeAttribute('aria-invalid');
    $('playlist-error').hidden = true;
    for (const row of playlistRows)
      row.checkbox.checked =
        row.available &&
        ranges.some(
          (match) => row.index >= Number(match[1]) && row.index <= Number(match[2] || match[1]),
        );
    renderPlaylistSelection();
  }
  async function openPlaylist(start = 1, paging = false) {
    if (playlistAdding || playlistLoading) return;
    if (paging && playlistRows.some((row) => row.checkbox.checked)) return;
    formError('');
    let url;
    let options;
    try {
      url = paging ? playlistUrl : parseUrls(true)[0];
      options = downloadOptions({ includeFormat: false });
    } catch (error) {
      formError(error.message);
      return;
    }
    const revision = ++playlistRevision;
    playlistUrl = url;
    playlistStart = start;
    playlistHasMore = false;
    playlistLoading = true;
    playlistAdding = false;
    playlistPreviewId = null;
    playlistRows = [];
    $('playlist-list').replaceChildren();
    $('playlist-title').textContent = '';
    $('playlist-limit').hidden = true;
    $('playlist-error').hidden = true;
    $('playlist-search').value = '';
    $('playlist-range').value = '';
    $('playlist-range').removeAttribute('aria-invalid');
    renderPlaylistSelection();
    renderReadiness();
    if (!$('playlist-dialog').open) $('playlist-dialog').showModal();
    $('playlist-close').focus();
    try {
      const result = await request('previewPlaylist', {
        url,
        options,
        start,
        pageSize: playlistPageSize,
      });
      if (revision !== playlistRevision || !$('playlist-dialog').open) return;
      playlistLoading = false;
      renderPlaylist(result);
    } catch (error) {
      if (revision !== playlistRevision || !$('playlist-dialog').open) return;
      playlistLoading = false;
      $('playlist-error').textContent = error.message;
      $('playlist-error').hidden = false;
      renderPlaylistSelection();
    } finally {
      if (revision === playlistRevision) renderReadiness();
    }
  }
  function closePlaylist(cancel = true) {
    if (playlistAdding) return;
    playlistRevision++;
    playlistLoading = false;
    playlistPreviewId = null;
    if ($('playlist-dialog').open) $('playlist-dialog').close();
    renderReadiness();
    $('playlist-preview-button').focus();
    if (cancel) void request('cancelPlaylistPreview').catch((error) => notice(error.message, true));
  }
  async function addPlaylistSelection() {
    if (playlistAdding || !playlistPreviewId) return;
    const indices = playlistRows
      .filter((row) => row.available && row.checkbox.checked)
      .map((row) => row.index);
    if (!indices.length) return;
    playlistAdding = true;
    $('playlist-error').hidden = true;
    renderPlaylistSelection();
    try {
      if (!settings.downloadPath) throw new Error(t('needFolder'));
      if (!(await saveChain)) throw new Error(t('saveFailed'));
      const accepted = await request('addPlaylistSelection', {
        previewId: playlistPreviewId,
        indices,
        options: downloadOptions({ includeFormat: false }),
      });
      playlistAdding = false;
      closePlaylist(false);
      notice(t('added', { count: Array.isArray(accepted) ? accepted.length : indices.length }));
    } catch (error) {
      $('playlist-error').textContent = error.message;
      $('playlist-error').hidden = false;
    } finally {
      playlistAdding = false;
      renderPlaylistSelection();
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
      privacy = state.privacy || {};
      appUpdateState = state.appUpdate || appUpdateState;
      toolSetup = state.tools?.setup || state.setup || null;
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
    $('format-select').value = '';
    renderFormatDetails();
    void saveSettings({ quality: $('quality').value });
  });
  listen($('max-concurrent'), 'change', () => {
    void saveSettings({ maxConcurrent: Number($('max-concurrent').value) });
  });
  listen($('theme'), 'change', () => {
    document.documentElement.dataset.theme = $('theme').value;
    void saveSettings({ theme: $('theme').value });
  });
  for (const [id, key] of Object.entries(numericSettings))
    listen($(id), 'change', () => {
      try {
        void saveSettings({ [key]: readNumber(id) });
      } catch (error) {
        notice(error.message, true);
      }
    });
  for (const [id, key] of Object.entries(booleanSettings))
    listen($(id), 'change', () => {
      void saveSettings({ [key]: $(id).checked });
      if (id === 'schedule-enabled') $('schedule-fields').hidden = !$(id).checked;
    });
  for (const id of ['schedule-start', 'schedule-end'])
    listen($(id), 'change', () => {
      if (!/^\d{2}:\d{2}$/.test($(id).value)) {
        notice(t('invalidTime'), true);
        return;
      }
      void saveSettings({
        [id === 'schedule-start' ? 'scheduleStart' : 'scheduleEnd']: $(id).value,
      });
    });
  listen($('profile-select'), 'change', () => renderProfiles());
  listen($('profile-apply'), 'click', () => action($('profile-apply'), applyProfile));
  listen($('profile-save'), 'click', () => action($('profile-save'), saveProfile));
  listen($('profile-delete'), 'click', () =>
    action($('profile-delete'), async () => {
      const id = $('profile-select').value;
      if (!id) return;
      if (!(await saveChain)) throw new Error(t('saveFailed'));
      const saved = await request('deleteProfile', { id });
      settings = { ...settings, ...saved };
      renderProfiles('');
      $('profile-status').textContent = t('profileDeleted');
    }),
  );
  for (const actionName of ['check', 'download', 'install'])
    listen($(`app-update-${actionName}`), 'click', () => {
      void runAppUpdate(actionName);
    });
  listen($('app-update-release'), 'click', () =>
    action($('app-update-release'), () => request('openExternal', appUpdateState.releaseUrl)),
  );
  document.querySelectorAll('[data-tool-action]').forEach((button) =>
    listen(button, 'click', () => {
      void runToolAction(button.dataset.tool, button.dataset.toolAction);
    }),
  );
  listen($('tool-setup'), 'click', (event) => {
    const copy = event.target.closest?.('[data-copy-command]');
    const link = event.target.closest?.('[data-setup-url]');
    if (copy)
      void action(copy, async () => {
        await navigator.clipboard.writeText(
          $('tool-setup').querySelector('pre')?.textContent || '',
        );
        notice(t('commandCopied'));
      });
    if (link) void action(link, () => request('openExternal', link.dataset.setupUrl));
  });
  listen($('subtitles'), 'change', () => {
    $('subtitle-fields').hidden = !$('subtitles').checked;
  });
  listen($('retry-subtitles'), 'change', () => {
    $('retry-subtitle-fields').hidden = !$('retry-subtitles').checked;
  });
  listen($('format-select'), 'change', renderFormatDetails);
  listen($('format-audio'), 'change', renderFormatDetails);
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
    resetFormats();
  });
  listen($('preview-button'), 'click', () =>
    action($('preview-button'), async () => {
      formError('');
      let urls;
      let options;
      try {
        urls = parseUrls(true);
        options = downloadOptions({ includeFormat: false });
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
      renderFormats(preview, urls[0]);
      $('preview-panel').hidden = false;
      announce($('preview-title').textContent);
    }),
  );
  listen($('history-search'), 'input', filterHistory);
  for (const [id, selection] of [
    ['queue-list', selectedQueue],
    ['history-list', selectedHistory],
  ])
    listen($(id), 'change', (event) => {
      const checkbox = event.target.closest?.('input[data-select-job]');
      if (!checkbox) return;
      if (checkbox.checked) selection.add(checkbox.dataset.selectJob);
      else selection.delete(checkbox.dataset.selectJob);
      renderBulkSelection();
    });
  listen($('queue-select-all'), 'click', () => {
    (queue.queue || []).forEach((item) => selectedQueue.add(item.id));
    syncSelection();
  });
  listen($('queue-clear-selection'), 'click', () => {
    selectedQueue.clear();
    syncSelection();
  });
  document.querySelectorAll('[data-queue-action]').forEach((button) =>
    listen(button, 'click', () => {
      void runBulkAction(button.dataset.queueAction);
    }),
  );
  listen($('history-select-visible'), 'click', () => {
    (queue.history || []).forEach((item) => {
      if (!rows.get(item.id)?.element.hidden) selectedHistory.add(item.id);
    });
    syncSelection();
  });
  listen($('history-clear-selection'), 'click', () => {
    selectedHistory.clear();
    syncSelection();
  });
  listen($('history-delete-selected'), 'click', () => {
    if (bulkBusy || !selectedHistory.size) return;
    void (async () => {
      bulkBusy = true;
      renderBulkSelection();
      try {
        const result = await request('deleteHistory', { ids: [...selectedHistory] });
        if (result?.deleted > 0) {
          selectedHistory.clear();
          notice(t('historyDeleted'));
        }
      } catch (error) {
        notice(error.message, true);
      } finally {
        bulkBusy = false;
        syncSelection();
      }
    })();
  });
  listen($('playlist-preview-button'), 'click', () => {
    void openPlaylist();
  });
  listen($('playlist-close'), 'click', () => closePlaylist());
  listen($('playlist-dialog'), 'cancel', (event) => {
    event.preventDefault();
    closePlaylist();
  });
  listen($('playlist-dialog'), 'keydown', (event) =>
    dialogKeydown(event, $('playlist-dialog'), closePlaylist),
  );
  listen($('playlist-list'), 'change', renderPlaylistSelection);
  listen($('playlist-search'), 'input', filterPlaylist);
  listen($('playlist-apply-range'), 'click', selectPlaylistRange);
  listen($('playlist-range'), 'keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      selectPlaylistRange();
    }
  });
  listen($('playlist-previous'), 'click', () => {
    void openPlaylist(Math.max(1, playlistStart - playlistPageSize), true);
  });
  listen($('playlist-next'), 'click', () => {
    void openPlaylist(playlistStart + playlistPageSize, true);
  });
  listen($('playlist-select-all'), 'click', () => {
    playlistRows.forEach((row) => {
      if (!row.element.hidden) row.checkbox.checked = row.available;
    });
    renderPlaylistSelection();
  });
  listen($('playlist-clear-selection'), 'click', () => {
    playlistRows.forEach((row) => {
      row.checkbox.checked = false;
    });
    renderPlaylistSelection();
  });
  listen($('playlist-add-selected'), 'click', () => {
    void addPlaylistSelection();
  });
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
      if ($('retry-format').value.trim()) options.formatId = $('retry-format').value.trim();
      const rate = readNumber('retry-rate');
      if (rate) options.rateLimitKbps = rate;
      options.subtitles = $('retry-subtitles').checked;
      if (options.subtitles) {
        options.subtitleLang = subtitleLanguage('retry-subtitle-lang');
        options.subtitleAuto = $('retry-subtitle-auto').checked;
      }
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
    if (event.key === 'F3' && !$('retry-dialog').open && !$('playlist-dialog').open) {
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
        'onAppUpdate',
        (state) => {
          appUpdateState = state || { status: 'idle' };
          renderAppUpdate();
        },
      ],
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
