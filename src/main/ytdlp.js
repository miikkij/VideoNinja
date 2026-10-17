const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const tools = require('./tools');
const {
  normalizeOptions,
  validateUrl,
  validateFormatId,
  QUALITY_PRESETS,
} = require('./downloadOptions');
const { runProcess, abortError } = require('./processRunner');

const PROTOCOL = Object.freeze({
  progress: 'VN_PROGRESS:',
  stage: 'VN_STAGE:',
  file: 'VN_FILE:',
  metadata: 'VN_META:',
  playlist: 'VN_PLAYLIST:',
});
const MAX_ERROR = 8192;
const PLAYLIST_LIMIT = 500;
const PLAYLIST_OUTPUT_LIMIT = 8 * 1024 * 1024;
const METADATA_FIELDS =
  '{"title":%(title)j,"id":%(id)j,"extractor":%(extractor_key,extractor|)j,"duration":%(duration|0)j,"ext":%(ext)j,"filesize":%(filesize|0)j,"filesizeApprox":%(filesize_approx|0)j}';
const FORMAT_FIELDS =
  '"formats":%(formats.:.{format_id,ext,width,height,fps,vcodec,acodec,filesize,filesize_approx})j';

function redactError(value, sensitive = []) {
  let text = String(value || 'The media tool could not finish the download.');
  for (const secret of sensitive.filter(Boolean).sort((a, b) => b.length - a.length))
    text = text.split(secret).join('[redacted]');
  // URLs may contain signed query strings or credentials. Do not persist them.
  return text
    .replace(/https?:\/\/[^\s<>"']+/giu, '[URL redacted]')
    .replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu'), '')
    .slice(-MAX_ERROR);
}

function isWithin(root, filename) {
  const relative = path.relative(root, filename);
  return (
    relative !== '' &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
}

function selectRuntime(options, toolInfo, url) {
  const available = toolInfo.jsRuntimes || [];
  if (!options.jsRuntime || options.jsRuntime === 'auto') return available[0] || null;
  const selected = available.find((runtime) => runtime.name === options.jsRuntime);
  const hostname = new URL(url).hostname.toLowerCase().replace(/\.$/u, '');
  const youtube = ['youtube.com', 'youtu.be', 'youtube-nocookie.com'].some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );
  // The saved YouTube runtime preference must not block other extractors.
  // Keep explicit diagnostics for YouTube and let yt-dlp diagnose embedded sources.
  if (!selected && youtube)
    throw new Error(
      `The selected ${options.jsRuntime} JavaScript runtime is missing or unsupported.`,
    );
  return selected || null;
}

function buildCommonArgs(options, toolInfo, ffmpegInfo, { url, playlist = false } = {}) {
  const args = [
    ...tools.SAFE_YTDLP_FLAGS,
    '--no-js-runtimes',
    '--color',
    'never',
    '--encoding',
    'utf-8',
    '--socket-timeout',
    '30',
    '--retries',
    '3',
    '--fragment-retries',
    '3',
  ];
  if (playlist) args.push('--yes-playlist');
  else args.push('--no-playlist', '--playlist-items', '1');
  const runtime = selectRuntime(options, toolInfo, url);
  if (runtime) args.push('--js-runtimes', `${runtime.name}:${runtime.path}`);
  if (ffmpegInfo?.available) args.push('--ffmpeg-location', ffmpegInfo.path);
  if (options.cookiesFromBrowser) args.push('--cookies-from-browser', options.cookiesFromBrowser);
  if (options.cookieFile) args.push('--cookies', options.cookieFile);
  if (options.userAgent) args.push('--user-agent', options.userAgent);
  if (options.referer) args.push('--referer', options.referer);
  if (options.forceIpv4) args.push('--force-ipv4');
  if (options.extractorArgs) args.push('--extractor-args', options.extractorArgs);
  args.push(...(options.extraArgs || []));
  // The explicit UI setting takes precedence over the legacy advanced option.
  if (options.rateLimitKbps > 0) args.push('--limit-rate', `${options.rateLimitKbps}K`);
  return args;
}

function buildDownloadArgs(url, outputRoot, input, toolInfo, ffmpegInfo) {
  url = validateUrl(url);
  const options = normalizeOptions(input);
  const args = buildCommonArgs(options, toolInfo, ffmpegInfo, { url });
  const sourceHash = createHash('sha256').update(url).digest('hex').slice(0, 16);
  const quality = options.formatId
    ? `fmt-${createHash('sha256')
        .update(`${options.formatId}:${options.audioFormat || 'original'}`)
        .digest('hex')
        .slice(0, 8)}`
    : options.quality === 'audio'
      ? `audio-${options.audioFormat || 'original'}`
      : options.quality;
  args.push(
    '--no-simulate',
    '--newline',
    '--progress',
    '--progress-delta',
    '0.3',
    '--continue',
    '--no-overwrites',
    '--windows-filenames',
  );
  args.push(
    '-o',
    path.join(
      outputRoot.replaceAll('%', '%%'),
      `%(title).140B [%(extractor_key).24B-%(id).40B] [${quality}-${sourceHash}].%(ext)s`,
    ),
    '-f',
    options.formatId
      ? options.formatId
          .split('+')
          .map((id) => `all[format_id='${id}']`)
          .join('+')
      : QUALITY_PRESETS[options.quality],
  );
  if (options.quality === 'audio' && options.audioFormat && options.audioFormat !== 'original') {
    if (!ffmpegInfo?.available)
      throw new Error('Install ffmpeg to convert audio, or choose original audio.');
    args.push('--extract-audio', '--audio-format', options.audioFormat);
  }
  if (options.subtitles) args.push('--write-subs', '--sub-langs', options.subtitleLang || 'en');
  if (options.subtitles && options.subtitleAuto) args.push('--write-auto-subs');
  args.push(
    '--progress-template',
    `download:${PROTOCOL.progress}{"downloaded":%(progress.downloaded_bytes|0)j,"total":%(progress.total_bytes,progress.total_bytes_estimate|0)j,"speed":%(progress.speed|0)j,"eta":%(progress.eta|0)j}`,
  );
  args.push('--progress-template', `postprocess:${PROTOCOL.stage}merging`);
  args.push('--print', `before_dl:${PROTOCOL.metadata}${METADATA_FIELDS}`);
  args.push('--print', `after_move:${PROTOCOL.file}%(filepath)j`);
  args.push('--', url);
  return args;
}

function safeMetadata(input) {
  if (!input || typeof input !== 'object') return null;
  const numeric = (value) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  const token = (value, limit = 200) =>
    typeof value === 'string' && /^[\w.-]+$/u.test(value) ? value.slice(0, limit) : '';
  const formats = Array.isArray(input.formats)
    ? input.formats.slice(0, 200).flatMap((format) => {
        if (!format || typeof format !== 'object') return [];
        let formatId;
        try {
          formatId = validateFormatId(format.format_id);
        } catch {
          return [];
        }
        if (formatId.includes('+')) return [];
        const vcodec = token(format.vcodec, 80),
          acodec = token(format.acodec, 80);
        return [
          {
            formatId,
            ext: token(format.ext, 12),
            width: numeric(format.width),
            height: numeric(format.height),
            fps: numeric(format.fps),
            vcodec,
            acodec,
            filesize: numeric(format.filesize),
            filesizeApprox: numeric(format.filesize_approx),
            hasVideo: Boolean(vcodec && vcodec !== 'none'),
            hasAudio: Boolean(acodec && acodec !== 'none'),
          },
        ];
      })
    : [];
  return {
    title: typeof input.title === 'string' ? input.title.slice(0, 500) : '',
    id: token(input.id),
    extractor: token(input.extractor || input.extractor_key),
    filesize: numeric(input.filesize),
    filesizeApprox: numeric(input.filesizeApprox || input.filesize_approx),
    formats,
    duration:
      Number.isFinite(Number(input.duration)) && Number(input.duration) >= 0
        ? Number(input.duration)
        : null,
    ext: typeof input.ext === 'string' && /^[a-z0-9]{1,12}$/iu.test(input.ext) ? input.ext : '',
  };
}

function safePlaylist(input, start = 1, pageSize = PLAYLIST_LIMIT) {
  if (!input || !['playlist', 'multi_video'].includes(input.type) || !Array.isArray(input.entries))
    throw new Error('This URL did not provide a playlist.');
  if (input.entries.length > pageSize + 1)
    throw new Error('The playlist exceeded the preview entry limit.');
  return {
    title: typeof input.title === 'string' ? input.title.slice(0, 500) : '',
    start,
    pageSize,
    entries: input.entries.slice(0, pageSize).map((item, offset) => {
      const entry = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
      const index =
        Number.isSafeInteger(entry.playlist_index) &&
        entry.playlist_index >= start &&
        entry.playlist_index < start + pageSize
          ? entry.playlist_index
          : start + offset;
      const youtube = [entry.ie_key, entry.extractor_key].some(
        (extractor) => typeof extractor === 'string' && extractor.toLowerCase() === 'youtube',
      );
      let candidate = entry.url || entry.webpage_url || (youtube ? entry.id : null);
      if (youtube && typeof candidate === 'string' && /^[\w-]{11}$/u.test(candidate))
        candidate = `https://www.youtube.com/watch?v=${candidate}`;
      let url = null;
      try {
        url = validateUrl(candidate);
      } catch {
        /* Unavailable or unsafe entries remain visible, but cannot be selected. */
      }
      const unavailable =
        ['playlist', 'multi_video'].includes(entry._type) ||
        ['private', 'premium_only', 'subscriber_only', 'needs_auth', 'unavailable'].includes(
          entry.availability,
        ) ||
        /^\[(?:private|deleted|unavailable) video\]$/iu.test(entry.title || '');
      return {
        id: typeof entry.id === 'string' && entry.id ? entry.id.slice(0, 200) : `entry-${index}`,
        index,
        title: typeof entry.title === 'string' ? entry.title.slice(0, 500) : '',
        url: unavailable ? null : url,
        duration:
          typeof entry.duration === 'number' &&
          Number.isFinite(entry.duration) &&
          entry.duration >= 0
            ? entry.duration
            : null,
        available: Boolean(url) && !unavailable,
      };
    }),
    hasMore: input.entries.length > pageSize,
  };
}

/** Dependency injection keeps process, filesystem and network tests isolated. */
function createDownloader(deps = {}) {
  const fileSystem = deps.fs || fs;
  const execute = deps.runProcess || runProcess;
  const toolService = deps.tools || tools;
  const writers = new Map();
  const platform = deps.platform || process.platform;

  function acquireWriter(key, signal) {
    if (signal?.aborted) return Promise.reject(abortError());
    let state = writers.get(key);
    const release = () => {
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const next = state.waiters.shift();
        if (next) {
          next.signal?.removeEventListener('abort', next.cancel);
          next.resolve(release());
        } else writers.delete(key);
      };
    };
    if (!state) {
      state = { waiters: [] };
      writers.set(key, state);
      return Promise.resolve(release());
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        signal,
        cancel: () => {
          const index = state.waiters.indexOf(waiter);
          if (index >= 0) state.waiters.splice(index, 1);
          reject(abortError());
        },
      };
      state.waiters.push(waiter);
      signal?.addEventListener('abort', waiter.cancel, { once: true });
      if (signal?.aborted) waiter.cancel();
    });
  }

  async function getTools(signal) {
    if (signal?.aborted) throw abortError();
    const [ytdlpInfo, ffmpegInfo] = await tools.settleProbes([
      toolService.checkYtDlpAvailability({ signal }),
      toolService.checkFfmpegAvailability({ signal }),
    ]);
    if (signal?.aborted) throw abortError();
    if (!ytdlpInfo.available)
      throw new Error(
        'yt-dlp is unavailable. Install or update yt-dlp, then check the tools again.',
      );
    return { ytdlpInfo, ffmpegInfo };
  }

  /**
   * @param {string} url
   * @param {string} outputPath
   * @param {import('./downloadOptions').DownloadOptions} input
   * @param {Function|null} progressCallback Receives progress, metadata and completion.
   * @param {{signal?: AbortSignal}} control
   * @returns {Promise<{success: boolean, filepath: string|null, error: string|null, metadata?: object}>}
   * @throws {Error} Invalid input or AbortError after subprocess cleanup.
   */
  async function downloadVideo(
    url,
    outputPath,
    input = {},
    progressCallback = null,
    { signal } = {},
  ) {
    url = validateUrl(url);
    const options = normalizeOptions(input);
    const secrets = [url, options.cookieFile, options.referer, options.userAgent, outputPath];
    let releaseWriter;
    try {
      if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath))
        throw new Error('Choose an absolute download folder.');
      const root = await fileSystem.realpath(outputPath);
      if (!(await fileSystem.stat(root)).isDirectory())
        throw new Error('The download folder is unavailable.');
      await fileSystem.access(root, 2);
      const writerKey = JSON.stringify([platform === 'win32' ? root.toLowerCase() : root, url]);
      releaseWriter = await acquireWriter(writerKey, signal);
      const { ytdlpInfo, ffmpegInfo } = await getTools(signal);
      if (options.formatId) {
        const preview = await fetchMetadata(url, options, { signal });
        const selected = options.formatId
          .split('+')
          .map((id) => preview.formats.find((format) => format.formatId === id));
        if (selected.some((format) => !format))
          throw new Error('The selected format is no longer available. Preview the video again.');
        if (
          selected.length === 2 &&
          (!selected[0].hasVideo || selected[1].hasVideo || !selected[1].hasAudio)
        )
          throw new Error('Choose a video format followed by an audio-only companion.');
        if (
          options.quality === 'audio' &&
          selected.some((format) => format.hasVideo || !format.hasAudio)
        )
          throw new Error('Choose an audio-only format for an audio download.');
      }
      const args = buildDownloadArgs(url, root, options, ytdlpInfo, ffmpegInfo);
      let filename = null,
        metadata = null,
        errorOutput = '',
        lastPercent = 0;
      const onLine = (line) => {
        try {
          if (line.startsWith(PROTOCOL.progress)) {
            const progress = JSON.parse(line.slice(PROTOCOL.progress.length));
            const total = Number(progress.total),
              downloaded = Number(progress.downloaded);
            const percent =
              total > 0 && Number.isFinite(downloaded)
                ? Math.max(0, Math.min(100, (downloaded / total) * 100))
                : 0;
            lastPercent = percent;
            progressCallback?.({
              type: 'progress',
              percent,
              downloadedBytes: Number.isFinite(downloaded) && downloaded >= 0 ? downloaded : 0,
              status: 'downloading',
              speed: Number(progress.speed) || 0,
              eta: Number(progress.eta) || 0,
            });
          } else if (line.startsWith(PROTOCOL.stage))
            progressCallback?.({ type: 'progress', percent: lastPercent, status: 'merging' });
          else if (line.startsWith(PROTOCOL.file)) {
            const parsed = JSON.parse(line.slice(PROTOCOL.file.length));
            if (typeof parsed === 'string') filename = parsed;
          } else if (line.startsWith(PROTOCOL.metadata)) {
            metadata = safeMetadata(JSON.parse(line.slice(PROTOCOL.metadata.length)));
            progressCallback?.({
              type: 'metadata',
              percent: lastPercent,
              status: 'downloading',
              metadata,
            });
          }
        } catch {
          /* Ignore malformed protocol lines without rendering or evaluating them. */
        }
      };
      const result = await execute(ytdlpInfo.path, args, {
        cwd: root,
        signal,
        onStdoutLine: onLine,
        onStderrLine: (line) => {
          onLine(line);
          if (!Object.values(PROTOCOL).some((prefix) => line.startsWith(prefix)))
            errorOutput = redactError(`${errorOutput}\n${line}`, secrets);
        },
      });
      if (signal?.aborted) throw abortError();
      if (result.code !== 0)
        throw new Error(errorOutput || `yt-dlp exited with code ${result.code}.`);
      if (!filename || !path.isAbsolute(filename))
        throw new Error(
          'The download finished without reporting its final file. Update yt-dlp and retry.',
        );
      const finalPath = await fileSystem.realpath(filename);
      const finalStat = await fileSystem.stat(finalPath);
      if (!isWithin(root, finalPath) || !finalStat.isFile())
        throw new Error('The final file is outside the download folder or is not a regular file.');
      if (!Number.isFinite(finalStat.size) || finalStat.size <= 0)
        throw new Error('The final media file is empty or its size could not be verified.');
      const integrity = await verifyIntegrity(finalPath, finalStat.size, options, signal);
      if (signal?.aborted) throw abortError();
      progressCallback?.({ type: 'complete', percent: 100, status: 'completed' });
      return { success: true, filepath: finalPath, error: null, metadata, integrity };
    } catch (error) {
      if (error.name === 'AbortError' || signal?.aborted) throw abortError();
      return { success: false, filepath: null, error: redactError(error.message, secrets) };
    } finally {
      releaseWriter?.();
    }
  }

  async function verifyIntegrity(filename, size, options, signal) {
    const probe = toolService.checkFfprobeAvailability
      ? await toolService.checkFfprobeAvailability({ signal })
      : { available: false };
    if (!probe.available)
      return {
        status: 'size-only',
        size,
        duration: null,
        streams: [],
        warning:
          'Install ffprobe to validate media integrity. Only the nonzero file size was checked.',
      };
    let output = '',
      probeError = false;
    const result = await execute(
      probe.path,
      [
        '-v',
        'error',
        '-protocol_whitelist',
        'file',
        '-show_entries',
        'format=duration:stream=codec_type,codec_name,width,height,duration',
        '-of',
        'json',
        '-i',
        filename,
      ],
      {
        signal,
        timeoutMs: 30000,
        maxOutputBytes: 1024 * 1024,
        maxLine: 1024 * 1024,
        onStdoutLine: (line) => {
          output += line;
        },
        onStderrLine: (line) => {
          if (line.trim()) probeError = true;
        },
      },
    );
    if (signal?.aborted) throw abortError();
    if (result.code !== 0 || probeError)
      throw new Error('The downloaded file failed ffprobe integrity validation.');
    let parsed;
    try {
      parsed = JSON.parse(output);
    } catch {
      throw new Error('ffprobe returned invalid media information.');
    }
    const streams = (Array.isArray(parsed.streams) ? parsed.streams : [])
      .slice(0, 32)
      .filter(
        (stream) =>
          ['audio', 'video'].includes(stream.codec_type) &&
          typeof stream.codec_name === 'string' &&
          /^[\w.-]{1,80}$/u.test(stream.codec_name),
      )
      .map((stream) => ({ type: stream.codec_type, codec: stream.codec_name }));
    if (
      !streams.length ||
      (options.quality === 'audio' && !streams.some((stream) => stream.type === 'audio'))
    )
      throw new Error('The downloaded file contains no usable media stream.');
    const duration = Number(parsed.format?.duration);
    return {
      status: 'verified',
      size,
      duration: Number.isFinite(duration) && duration > 0 ? duration : null,
      streams,
    };
  }

  async function fetchMetadata(url, input = {}, { signal } = {}) {
    url = validateUrl(url);
    const options = normalizeOptions(input);
    const secrets = [url, options.cookieFile, options.referer, options.userAgent];
    try {
      const { ytdlpInfo, ffmpegInfo } = await getTools(signal);
      const args = [
        ...buildCommonArgs(options, ytdlpInfo, ffmpegInfo, { url }),
        '--skip-download',
        '--simulate',
        '--print',
        `${PROTOCOL.metadata}${METADATA_FIELDS.slice(0, -1)},${FORMAT_FIELDS}}`,
        '--',
        url,
      ];
      let metadata = null,
        errorOutput = '';
      const result = await execute(ytdlpInfo.path, args, {
        signal,
        timeoutMs: 60000,
        maxLine: PLAYLIST_OUTPUT_LIMIT,
        maxOutputBytes: PLAYLIST_OUTPUT_LIMIT,
        cwd: path.dirname(ytdlpInfo.path),
        onStdoutLine: (line) => {
          if (line.startsWith(PROTOCOL.metadata)) {
            try {
              metadata = safeMetadata(JSON.parse(line.slice(PROTOCOL.metadata.length)));
            } catch {
              /* Invalid metadata. */
            }
          }
        },
        onStderrLine: (line) => {
          errorOutput = redactError(`${errorOutput}\n${line}`, secrets);
        },
      });
      if (signal?.aborted) throw abortError();
      if (result.code !== 0 || !metadata)
        throw new Error(errorOutput || 'Unable to read video information.');
      return metadata;
    } catch (error) {
      if (error.name === 'AbortError' || signal?.aborted) throw abortError();
      // Raw subprocess errors can contain cookie paths and signed URLs.
      // eslint-disable-next-line preserve-caught-error -- Intentionally discard sensitive error causes.
      throw new Error(redactError(error.message, secrets));
    }
  }

  async function fetchPlaylist(
    url,
    input = {},
    { signal, start = 1, pageSize = PLAYLIST_LIMIT } = {},
  ) {
    url = validateUrl(url);
    const options = normalizeOptions(input);
    if (
      !Number.isSafeInteger(start) ||
      start < 1 ||
      start > 1000000 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > PLAYLIST_LIMIT
    )
      throw new Error('Invalid playlist page.');
    const secrets = [url, options.cookieFile, options.referer, options.userAgent];
    try {
      const { ytdlpInfo, ffmpegInfo } = await getTools(signal);
      const args = [
        ...buildCommonArgs(options, ytdlpInfo, ffmpegInfo, { url, playlist: true }),
        '--flat-playlist',
        '--skip-download',
        '--simulate',
        '--playlist-start',
        String(start),
        '--playlist-end',
        String(start + pageSize),
        '--print',
        `playlist:${PROTOCOL.playlist}{"title":%(title|)j,"type":%(_type|)j,"entries":%(entries.:.{_type,id,title,url,webpage_url,duration,ie_key,extractor_key,availability,playlist_index})j}`,
        '--',
        url,
      ];
      let playlist = null,
        parseError = null,
        errorOutput = '';
      const result = await execute(ytdlpInfo.path, args, {
        signal,
        timeoutMs: 60000,
        maxLine: PLAYLIST_OUTPUT_LIMIT,
        maxOutputBytes: PLAYLIST_OUTPUT_LIMIT,
        cwd: path.dirname(ytdlpInfo.path),
        onStdoutLine: (line) => {
          if (!line.startsWith(PROTOCOL.playlist) || parseError) return;
          try {
            if (line.length > PLAYLIST_OUTPUT_LIMIT)
              throw new Error('The playlist exceeded the preview output limit.');
            if (playlist) throw new Error('Nested playlist previews are not supported.');
            playlist = safePlaylist(
              JSON.parse(line.slice(PROTOCOL.playlist.length)),
              start,
              pageSize,
            );
          } catch {
            parseError = new Error('Unable to read the playlist within the preview limits.');
          }
        },
        onStderrLine: (line) => {
          errorOutput = redactError(`${errorOutput}\n${line}`, secrets);
        },
      });
      if (signal?.aborted) throw abortError();
      if (result.code !== 0) throw new Error(errorOutput || 'Unable to read the playlist.');
      if (parseError) throw parseError;
      if (!playlist) throw new Error('This URL did not provide a playlist.');
      return playlist;
    } catch (error) {
      if (error.name === 'AbortError' || signal?.aborted) throw abortError();
      // eslint-disable-next-line preserve-caught-error -- Discard raw subprocess details and credentials.
      throw new Error(redactError(error.message, secrets));
    }
  }

  async function getDiskSpace(dirPath) {
    try {
      if (typeof dirPath !== 'string' || !path.isAbsolute(dirPath))
        throw new Error('Invalid folder.');
      const stats = await fileSystem.statfs(dirPath, { bigint: true });
      const total = Number(stats.blocks * stats.bsize),
        free = Number(stats.bavail * stats.bsize),
        used = Number((stats.blocks - stats.bfree) * stats.bsize);
      if (
        ![total, free, used].every((value) => Number.isFinite(value) && value >= 0) ||
        free > total ||
        used > total
      )
        throw new Error('Invalid filesystem capacity.');
      let volumeId;
      try {
        const stat = await fileSystem.stat(dirPath);
        if (stat.dev !== undefined) volumeId = String(stat.dev);
      } catch {
        /* Optional volume grouping. */
      }
      return { available: true, total, free, used, error: null, ...(volumeId ? { volumeId } : {}) };
    } catch {
      return {
        available: false,
        total: null,
        free: null,
        used: null,
        error: 'Disk space is unavailable for this folder.',
      };
    }
  }
  return { downloadVideo, fetchMetadata, fetchPlaylist, getDiskSpace };
}

function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return 'Unknown';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  const index = Math.max(
    0,
    Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024))),
  );
  return `${Number((bytes / 1024 ** index).toFixed(2))} ${units[index]}`;
}

module.exports = {
  checkYtDlpAvailability: tools.checkYtDlpAvailability,
  checkFfmpegAvailability: tools.checkFfmpegAvailability,
  checkFfprobeAvailability: tools.checkFfprobeAvailability,
  formatBytes,
  PROTOCOL,
  PLAYLIST_LIMIT,
  redactError,
  isWithin,
  buildDownloadArgs,
  createDownloader,
  ...createDownloader(),
};
