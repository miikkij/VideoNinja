/** Stable categories for UI remedies; only transient failures receive automatic retries. */
const DEFINITIONS = Object.freeze({
  network: { action: 'check-network', retryable: true },
  'rate-limit': { action: 'wait-and-retry', retryable: true },
  auth: { action: 'update-cookies', retryable: false },
  unavailable: { action: 'open-source', retryable: false },
  unsupported: { action: 'check-source', retryable: false },
  format: { action: 'change-quality', retryable: false },
  'disk-full': { action: 'free-space', retryable: false },
  'tool-missing': { action: 'check-tools', retryable: false },
  stalled: { action: 'retry', retryable: true },
  integrity: { action: 'retry', retryable: false },
  unknown: { action: 'view-details', retryable: false },
});

function classifyDownloadError(error) {
  const message = (typeof error === 'string' ? error : error?.message || '').slice(0, 16000);
  const supplied = typeof error === 'object' ? error?.downloadCode : null;
  let code = Object.hasOwn(DEFINITIONS, supplied || '') ? supplied : 'unknown';
  if (code === 'unknown') {
    if (
      /ENOSPC|no space left|disk (?:is )?full|not enough (?:free )?(?:disk )?space/i.test(message)
    )
      code = 'disk-full';
    else if (/429|too many requests|rate.?limit|temporarily blocked/i.test(message))
      code = 'rate-limit';
    else if (
      /sign.?in|log.?in|authentication|cookies?|private video|members.only|age.restrict|HTTP Error 40[13]/i.test(
        message,
      )
    )
      code = 'auth';
    else if (
      /404|410|video (?:is )?(?:unavailable|removed|deleted)|not available in your country|geo.?restrict/i.test(
        message,
      )
    )
      code = 'unavailable';
    else if (/unsupported URL|no suitable extractor|invalid URL/i.test(message))
      code = 'unsupported';
    else if (
      /requested format (?:is )?not available|no video formats|no audio formats|format selection/i.test(
        message,
      )
    )
      code = 'format';
    else if (
      /(?:ffmpeg|ffprobe|yt-dlp|javascript runtime|deno|node\.js).*(?:not found|not installed|missing|unavailable|required)|ENOENT.*(?:ffmpeg|yt-dlp)/i.test(
        message,
      )
    )
      code = 'tool-missing';
    else if (
      /integrity|empty (?:media )?file|invalid (?:media|video)|ffprobe.*(?:failed|invalid)/i.test(
        message,
      )
    )
      code = 'integrity';
    else if (
      /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|timed? ?out|network (?:error|unreachable)|connection (?:reset|closed|refused)|temporary failure|HTTP Error 50[0234]|HTTP Error 408/i.test(
        message,
      )
    )
      code = 'network';
  }
  return { code, ...DEFINITIONS[code] };
}

function downloadError(code, message) {
  const error = new Error(message);
  error.downloadCode = Object.hasOwn(DEFINITIONS, code) ? code : 'unknown';
  return error;
}

module.exports = { classifyDownloadError, downloadError };
