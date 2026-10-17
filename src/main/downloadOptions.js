const path = require('node:path');

/**
 * @typedef {Object} DownloadOptions
 * @property {'best'|'2160'|'1440'|'1080'|'720'|'480'|'audio'} [quality]
 * @property {'original'|'mp3'|'m4a'|'opus'|'wav'} [audioFormat]
 * @property {boolean} [subtitles]
 * @property {boolean} [subtitleAuto]
 * @property {string} [subtitleLang]
 * @property {string} [formatId] One concrete format ID, optionally plus one audio ID.
 * @property {number} [rateLimitKbps] KiB per second; zero means unlimited.
 * @property {string} [cookiesFromBrowser]
 * @property {string} [cookieFile] Absolute path selected by the user.
 * @property {string} [userAgent]
 * @property {string} [referer]
 * @property {boolean} [forceIpv4]
 * @property {string} [extractorArgs] Restricted YouTube player-client selector.
 * @property {'auto'|'deno'|'node'|'quickjs'} [jsRuntime]
 * @property {'auto'|'off'|'compatible'} [browserMode] Conditional browser impersonation.
 * @property {string|string[]} [extraArgs] Only allowlisted options are accepted.
 */

const QUALITY_PRESETS = Object.freeze({
  best: 'bestvideo+bestaudio/best',
  2160: 'bestvideo[height<=2160]+bestaudio/best[height<=2160]',
  1440: 'bestvideo[height<=1440]+bestaudio/best[height<=1440]',
  1080: 'bestvideo[height<=1080]+bestaudio/best[height<=1080]',
  720: 'bestvideo[height<=720]+bestaudio/best[height<=720]',
  480: 'bestvideo[height<=480]+bestaudio/best[height<=480]',
  audio: 'bestaudio',
});
const LEGACY_FORMATS = Object.fromEntries(
  Object.entries(QUALITY_PRESETS).map(([key, value]) => [value, key]),
);
Object.assign(LEGACY_FORMATS, {
  best: 'best',
  'bestaudio/best': 'audio',
  'bestvideo[height<=4320]+bestaudio/best': '2160',
  ...Object.fromEntries(
    ['2160', '1440', '1080', '720', '480'].map((height) => [
      `bestvideo[height<=${height}]+bestaudio/best`,
      height,
    ]),
  ),
});
const OPTION_KEYS = new Set([
  'quality',
  'format',
  'audioFormat',
  'subtitles',
  'subtitleAuto',
  'subtitleLang',
  'formatId',
  'rateLimitKbps',
  'cookiesFromBrowser',
  'cookieFile',
  'userAgent',
  'referer',
  'forceIpv4',
  'extractorArgs',
  'jsRuntime',
  'browserMode',
  'extraArgs',
]);
const BROWSERS = new Set([
  'chrome',
  'chromium',
  'edge',
  'firefox',
  'brave',
  'opera',
  'safari',
  'vivaldi',
]);
const FLAG_ARGS = new Set(['--geo-bypass', '--force-ipv4']);
const NUMBER_ARGS = {
  '--sleep-interval': [0, 60],
  '--max-sleep-interval': [0, 60],
  '--retries': [0, 20],
  '--fragment-retries': [0, 20],
  '--socket-timeout': [1, 120],
};
const FORMAT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

function validateFormatId(value) {
  const text = stringValue(value, 'format selection', 129);
  const ids = text.split('+');
  if (ids.length > 2 || ids.some((id) => !FORMAT_ID.test(id)))
    throw new Error('Choose a concrete available format, optionally with one audio format.');
  if (new Set(ids).size !== ids.length) throw new Error('Choose distinct video and audio formats.');
  return text;
}

function stringValue(value, name, max = 4096) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    throw new Error(`Invalid ${name}.`);
  return value.trim();
}

function validateUrl(value) {
  const text = stringValue(value, 'URL');
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error('Enter a valid HTTP or HTTPS video URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password)
    throw new Error('Only HTTP and HTTPS URLs without embedded credentials are supported.');
  return url.href;
}

/** Tokenize quoted values without interpreting shell syntax or escapes. */
function tokenizeExtraArgs(value) {
  if (Array.isArray(value)) {
    if (value.length > 24) throw new Error('Too many advanced options.');
    return value.map((item) => stringValue(item, 'advanced option', 512));
  }
  const source = stringValue(value, 'advanced options', 2048);
  const tokens = [];
  let token = '',
    quote = null;
  for (const character of source) {
    if (quote) {
      if (character === quote) quote = null;
      else token += character;
    } else if (character === '"' || character === "'") quote = character;
    else if (/\s/u.test(character)) {
      if (token) tokens.push(token);
      token = '';
    } else token += character;
  }
  if (quote) throw new Error('Close the quote in advanced options.');
  if (token) tokens.push(token);
  if (tokens.length > 24) throw new Error('Too many advanced options.');
  return tokens;
}

function validateExtraArgs(value) {
  const tokens = tokenizeExtraArgs(value);
  const args = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (FLAG_ARGS.has(token)) {
      args.push(token);
      continue;
    }
    const range = Object.hasOwn(NUMBER_ARGS, token) ? NUMBER_ARGS[token] : null;
    if (range) {
      const text = tokens[++index];
      const number = Number(text);
      if (
        !text ||
        !/^\d+(?:\.\d+)?$/u.test(text) ||
        !Number.isFinite(number) ||
        number < range[0] ||
        number > range[1] ||
        (token.includes('retries') && !Number.isInteger(number))
      )
        throw new Error(`Invalid value for ${token}.`);
      args.push(token, text);
    } else if (token === '--limit-rate') {
      const text = tokens[++index];
      if (
        !text ||
        !/^\d+(?:\.\d+)?[KMG]?$/iu.test(text) ||
        !Number.isFinite(parseFloat(text)) ||
        parseFloat(text) <= 0
      )
        throw new Error('Invalid download rate.');
      args.push(token, text);
    } else
      throw new Error(
        `Unsupported advanced option: ${token.slice(0, 60)}. Use the documented safe options.`,
      );
  }
  return args;
}

/**
 * Validate at every trust boundary; never forward arbitrary yt-dlp flags.
 * @param {DownloadOptions & {format?: string}} input
 * @returns {DownloadOptions} A new object; legacy format values become quality.
 */
function normalizeOptions(input = {}) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    throw new Error('Download options must be an object.');
  for (const key of Object.keys(input))
    if (!OPTION_KEYS.has(key)) throw new Error(`Unsupported download option: ${key.slice(0, 60)}.`);
  const result = {};
  const quality = input.quality ?? (input.format ? LEGACY_FORMATS[input.format] : 'best');
  if (typeof quality !== 'string' || !Object.hasOwn(QUALITY_PRESETS, quality))
    throw new Error('Choose a supported quality preset.');
  result.quality = quality;
  if (input.browserMode !== undefined) {
    if (!['auto', 'off', 'compatible'].includes(input.browserMode))
      throw new Error('Choose Auto, Off or Compatible browser mode.');
    result.browserMode = input.browserMode;
  }
  if (input.audioFormat !== undefined) {
    if (!['original', 'mp3', 'm4a', 'opus', 'wav'].includes(input.audioFormat))
      throw new Error('Unsupported audio format.');
    result.audioFormat = input.audioFormat;
  }
  if (input.formatId !== undefined && input.formatId !== '')
    result.formatId = validateFormatId(input.formatId);
  if (input.rateLimitKbps !== undefined) {
    if (
      !Number.isInteger(input.rateLimitKbps) ||
      input.rateLimitKbps < 0 ||
      input.rateLimitKbps > 1000000
    )
      throw new Error('Download rate must be an integer from 0 to 1000000 KiB/s.');
    result.rateLimitKbps = input.rateLimitKbps;
  }
  for (const key of ['subtitles', 'subtitleAuto', 'forceIpv4']) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'boolean') throw new Error(`Invalid ${key}.`);
      result[key] = input[key];
    }
  }
  for (const [key, max] of [
    ['subtitleLang', 80],
    ['cookiesFromBrowser', 20],
    ['cookieFile', 4096],
    ['userAgent', 512],
    ['referer', 4096],
    ['extractorArgs', 512],
    ['jsRuntime', 20],
  ]) {
    if (input[key] !== undefined && input[key] !== '')
      result[key] = stringValue(input[key], key, max);
  }
  if (result.subtitleLang && !/^[a-zA-Z0-9.*,-]+$/u.test(result.subtitleLang))
    throw new Error('Invalid subtitle language selector.');
  if (result.cookiesFromBrowser && !BROWSERS.has(result.cookiesFromBrowser))
    throw new Error('Unsupported cookie browser.');
  if (result.cookieFile && !path.isAbsolute(result.cookieFile))
    throw new Error('Choose an absolute cookie file path.');
  if (result.cookiesFromBrowser && result.cookieFile) throw new Error('Choose one cookie source.');
  if (result.referer) result.referer = validateUrl(result.referer);
  if (
    result.extractorArgs &&
    !/^youtube:player_client=(?:web|web_safari|web_embedded|android|ios|tv|mweb)(?:,(?:web|web_safari|web_embedded|android|ios|tv|mweb))*$/u.test(
      result.extractorArgs,
    )
  )
    throw new Error('Only known YouTube player clients are supported in extractor options.');
  if (result.jsRuntime && !['auto', 'deno', 'node', 'quickjs'].includes(result.jsRuntime))
    throw new Error('Choose Auto, Deno, Node.js or QuickJS.');
  if (input.extraArgs !== undefined) result.extraArgs = validateExtraArgs(input.extraArgs);
  return result;
}

module.exports = {
  QUALITY_PRESETS,
  validateUrl,
  normalizeOptions,
  tokenizeExtraArgs,
  validateExtraArgs,
  validateFormatId,
};
