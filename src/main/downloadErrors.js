/** Stable categories for UI remedies; only transient failures receive automatic retries. */
const DEFINITIONS = Object.freeze({
  network: { action: 'check-network', retryable: true },
  'rate-limit': { action: 'wait-and-retry', retryable: true },
  auth: { action: 'update-cookies', retryable: false },
  access: { action: 'check-access', retryable: false },
  'cookie-access': { action: 'check-cookies', retryable: false },
  extractor: { action: 'update-tools', retryable: false },
  'options-review': { action: 'review-options', retryable: false },
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
  // Extractor warnings describe failed fallback attempts, not necessarily the
  // final failure. Classify ERROR lines first so an earlier 404/429 or cookie
  // warning cannot override the actual reason the process stopped.
  const failures = message.split(/\r?\n/u).filter((line) => /^\s*ERROR:/iu.test(line));
  const reason = failures.length ? failures.join('\n') : message;
  let code = Object.hasOwn(DEFINITIONS, supplied || '') ? supplied : 'unknown';
  if (code === 'unknown') {
    if (/download stopped making progress|media processing stopped responding/iu.test(reason))
      code = 'stalled';
    else if (
      /ENOSPC|no space left|disk (?:is )?full|not enough (?:free )?(?:disk )?space/i.test(reason)
    )
      code = 'disk-full';
    else if (
      /rate.?limit reached or log.?in required|content is not available.*or log.?in/iu.test(reason)
    )
      code = 'access';
    else if (
      /(?:could not|failed to|unable to) (?:copy|decrypt|read|load).*cookies?|DPAPI|app.bound encryption|cookie database.*(?:locked|permission|denied)/iu.test(
        reason,
      )
    )
      code = 'cookie-access';
    else if (
      /\b(?:HTTP(?: Error)?|status(?: code)?|response(?: code)?)\s*[:=]?\s*429\b|too many requests|rate.?limit|temporarily blocked/i.test(
        reason,
      )
    )
      code = 'rate-limit';
    else if (
      /sign.?in|log.?in|authentication|cookies?|private video|members.only|age.restrict|HTTP Error 40[13]/i.test(
        reason,
      )
    )
      code = 'auth';
    else if (
      /\b(?:HTTP(?: Error)?|status(?: code)?)\s*[:=]?\s*(?:404|410)\b|video (?:is )?(?:unavailable|removed|deleted)|not available in your country|geo.?restrict/i.test(
        reason,
      )
    )
      code = 'unavailable';
    else if (/unsupported URL|no suitable extractor|invalid URL/i.test(reason))
      code = 'unsupported';
    else if (
      /requested format (?:is )?not available|no video formats|no audio formats|format selection/i.test(
        reason,
      )
    )
      code = 'format';
    else if (
      /(?:ffmpeg|ffprobe|yt-dlp|javascript runtime|deno|node\.js).*(?:not found|not installed|missing|unavailable|required)|ENOENT.*(?:ffmpeg|yt-dlp)/i.test(
        reason,
      )
    )
      code = 'tool-missing';
    else if (
      /integrity|empty (?:media )?file|invalid (?:media|video)|ffprobe.*(?:failed|invalid)/i.test(
        reason,
      )
    )
      code = 'integrity';
    else if (
      /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|timed? ?out|network (?:error|unreachable)|connection (?:reset|closed|refused)|temporary failure|HTTP Error 50[0234]|HTTP Error 408/i.test(
        reason,
      )
    )
      code = 'network';
    else if (
      /unable to extract|extraction failed|failed to extract|please report this issue|signature (?:extraction|solving) failed|nsig extraction failed/iu.test(
        reason,
      )
    )
      code = 'extractor';
  }
  return { code, ...DEFINITIONS[code] };
}

function downloadError(code, message) {
  const error = new Error(message);
  error.downloadCode = Object.hasOwn(DEFINITIONS, code) ? code : 'unknown';
  return error;
}

module.exports = { classifyDownloadError, downloadError };
