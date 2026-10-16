const fs = require('node:fs/promises');
const path = require('node:path');
const tools = require('./tools');
const { normalizeOptions, validateUrl, QUALITY_PRESETS } = require('./downloadOptions');
const { runProcess, abortError } = require('./processRunner');

const PROTOCOL = Object.freeze({
  progress: 'VN_PROGRESS:',
  stage: 'VN_STAGE:',
  file: 'VN_FILE:',
  metadata: 'VN_META:',
});
const MAX_ERROR = 8192;

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

function selectRuntime(options, toolInfo) {
  const available = toolInfo.jsRuntimes || [];
  if (!options.jsRuntime || options.jsRuntime === 'auto') return available[0] || null;
  const selected = available.find((runtime) => runtime.name === options.jsRuntime);
  if (!selected)
    throw new Error(
      `The selected ${options.jsRuntime} JavaScript runtime is missing or unsupported.`,
    );
  return selected;
}

function buildCommonArgs(options, toolInfo, ffmpegInfo) {
  const args = [
    ...tools.SAFE_YTDLP_FLAGS,
    '--no-js-runtimes',
    '--no-playlist',
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
  const runtime = selectRuntime(options, toolInfo);
  if (runtime) args.push('--js-runtimes', `${runtime.name}:${runtime.path}`);
  if (ffmpegInfo?.available) args.push('--ffmpeg-location', ffmpegInfo.path);
  if (options.cookiesFromBrowser) args.push('--cookies-from-browser', options.cookiesFromBrowser);
  if (options.cookieFile) args.push('--cookies', options.cookieFile);
  if (options.userAgent) args.push('--user-agent', options.userAgent);
  if (options.referer) args.push('--referer', options.referer);
  if (options.forceIpv4) args.push('--force-ipv4');
  if (options.extractorArgs) args.push('--extractor-args', options.extractorArgs);
  args.push(...(options.extraArgs || []));
  return args;
}

function buildDownloadArgs(url, outputRoot, input, toolInfo, ffmpegInfo) {
  const options = normalizeOptions(input);
  const args = buildCommonArgs(options, toolInfo, ffmpegInfo);
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
    path.join(outputRoot.replaceAll('%', '%%'), '%(title).180B [%(extractor_key)s-%(id)s].%(ext)s'),
    '-f',
    QUALITY_PRESETS[options.quality],
  );
  if (options.quality === 'audio' && options.audioFormat && options.audioFormat !== 'original') {
    if (!ffmpegInfo?.available)
      throw new Error('Install ffmpeg to convert audio, or choose original audio.');
    args.push('--extract-audio', '--audio-format', options.audioFormat);
  }
  if (options.subtitles) args.push('--write-subs', '--sub-langs', options.subtitleLang || 'en');
  args.push(
    '--progress-template',
    `download:${PROTOCOL.progress}{"downloaded":%(progress.downloaded_bytes|0)j,"total":%(progress.total_bytes,progress.total_bytes_estimate|0)j,"speed":%(progress.speed|0)j,"eta":%(progress.eta|0)j}`,
  );
  args.push('--progress-template', `postprocess:${PROTOCOL.stage}merging`);
  args.push(
    '--print',
    `before_dl:${PROTOCOL.metadata}{"title":%(title)j,"id":%(id)j,"duration":%(duration|0)j,"ext":%(ext)j}`,
  );
  args.push('--print', `after_move:${PROTOCOL.file}%(filepath)j`);
  args.push('--', validateUrl(url));
  return args;
}

function safeMetadata(input) {
  if (!input || typeof input !== 'object') return null;
  return {
    title: typeof input.title === 'string' ? input.title.slice(0, 500) : '',
    id: typeof input.id === 'string' ? input.id.slice(0, 200) : '',
    duration:
      Number.isFinite(Number(input.duration)) && Number(input.duration) >= 0
        ? Number(input.duration)
        : null,
    ext: typeof input.ext === 'string' && /^[a-z0-9]{1,12}$/iu.test(input.ext) ? input.ext : '',
  };
}

/** Dependency injection keeps process, filesystem and network tests isolated. */
function createDownloader(deps = {}) {
  const fileSystem = deps.fs || fs;
  const execute = deps.runProcess || runProcess;
  const toolService = deps.tools || tools;

  async function getTools(signal) {
    if (signal?.aborted) throw abortError();
    const [ytdlpInfo, ffmpegInfo] = await Promise.all([
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
    try {
      if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath))
        throw new Error('Choose an absolute download folder.');
      const root = await fileSystem.realpath(outputPath);
      if (!(await fileSystem.stat(root)).isDirectory())
        throw new Error('The download folder is unavailable.');
      await fileSystem.access(root, 2);
      const { ytdlpInfo, ffmpegInfo } = await getTools(signal);
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
      if (!isWithin(root, finalPath) || !(await fileSystem.stat(finalPath)).isFile())
        throw new Error('The final file is outside the download folder or is not a regular file.');
      progressCallback?.({ type: 'complete', percent: 100, status: 'completed' });
      return { success: true, filepath: finalPath, error: null, metadata };
    } catch (error) {
      if (error.name === 'AbortError' || signal?.aborted) throw abortError();
      return { success: false, filepath: null, error: redactError(error.message, secrets) };
    }
  }

  async function fetchMetadata(url, input = {}, { signal } = {}) {
    url = validateUrl(url);
    const options = normalizeOptions(input);
    const secrets = [url, options.cookieFile, options.referer, options.userAgent];
    try {
      const { ytdlpInfo, ffmpegInfo } = await getTools(signal);
      const args = [
        ...buildCommonArgs(options, ytdlpInfo, ffmpegInfo),
        '--skip-download',
        '--simulate',
        '--print',
        `${PROTOCOL.metadata}{"title":%(title)j,"id":%(id)j,"duration":%(duration|0)j,"ext":%(ext)j}`,
        '--',
        url,
      ];
      let metadata = null,
        errorOutput = '';
      const result = await execute(ytdlpInfo.path, args, {
        signal,
        timeoutMs: 60000,
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
      return { available: true, total, free, used, error: null };
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
  return { downloadVideo, fetchMetadata, getDiskSpace };
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
  formatBytes,
  PROTOCOL,
  redactError,
  isWithin,
  buildDownloadArgs,
  createDownloader,
  ...createDownloader(),
};
