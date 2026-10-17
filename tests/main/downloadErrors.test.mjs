import { describe, it, expect } from 'vitest';
import errors from '../../src/main/downloadErrors.js';

describe('actionable download failure classification', () => {
  it.each([
    ['HTTP Error 429: Too Many Requests', 'rate-limit', 'wait-and-retry', true],
    ['Connection reset by peer (ECONNRESET)', 'network', 'check-network', true],
    ['HTTP Error 503: unavailable', 'network', 'check-network', true],
    ['HTTP Error 403: Forbidden', 'auth', 'update-cookies', false],
    ['Sign in to confirm your age', 'auth', 'update-cookies', false],
    [
      'Requested content is not available, rate-limit reached or login required. Use --cookies for authentication.',
      'access',
      'check-access',
      false,
    ],
    ['Could not copy Chrome cookie database.', 'cookie-access', 'check-cookies', false],
    ['Failed to decrypt with DPAPI', 'cookie-access', 'check-cookies', false],
    ['Unable to extract shared data; please report this issue', 'extractor', 'update-tools', false],
    ['Video unavailable: removed by uploader', 'unavailable', 'open-source', false],
    ['Unsupported URL: https://example.com/', 'unsupported', 'check-source', false],
    ['Requested format is not available', 'format', 'change-quality', false],
    ['ENOSPC: no space left on device', 'disk-full', 'free-space', false],
    ['FFmpeg not found', 'tool-missing', 'check-tools', false],
    ['The downloaded file failed ffprobe integrity validation.', 'integrity', 'retry', false],
    ['Something unexpected happened', 'unknown', 'view-details', false],
  ])(
    'classifies %s without guessing a retry for permanent failures',
    (message, code, action, retryable) => {
      expect(errors.classifyDownloadError(new Error(message))).toEqual({ code, action, retryable });
    },
  );

  it('uses an internal watchdog category and rejects unrecognized supplied categories', () => {
    expect(errors.classifyDownloadError(errors.downloadError('stalled', 'Stopped'))).toEqual({
      code: 'stalled',
      action: 'retry',
      retryable: true,
    });
    expect(
      errors.classifyDownloadError({ downloadCode: '__proto__', message: 'Failure' }).code,
    ).toBe('unknown');
  });

  it('uses the terminal Instagram error rather than failures from earlier fallback requests', () => {
    const log = [
      'WARNING: Your yt-dlp version (2026.05.25.234532) is older than 90 days!',
      'WARNING: [Instagram] No csrf token set by Instagram API',
      'WARNING: [Instagram] unable to extract shared data',
      'WARNING: [Instagram] Unable to download webpage: HTTP Error 404: Not Found',
      'ERROR: [Instagram] DebtnuayevY: Requested content is not available, rate-limit reached or login required. Use --cookies-from-browser or --cookies for authentication.',
    ].join('\n');
    expect(errors.classifyDownloadError(log)).toEqual({
      code: 'access',
      action: 'check-access',
      retryable: false,
    });
    expect(
      errors.classifyDownloadError('WARNING: HTTP Error 429\nERROR: Failed to decrypt with DPAPI')
        .code,
    ).toBe('cookie-access');
    expect(
      errors.classifyDownloadError(
        'WARNING: Cookies unavailable\nERROR: HTTP Error 429: Too Many Requests',
      ).code,
    ).toBe('rate-limit');
  });

  it('does not treat digits in media IDs as HTTP errors', () => {
    expect(errors.classifyDownloadError('Unexpected failure for item 429404410').code).toBe(
      'unknown',
    );
  });

  it('returns no raw URL, path or credential in its public remedy payload', () => {
    const result = errors.classifyDownloadError(
      'HTTP Error 403 https://user:secret@example.com/?token=secret C:\\private\\cookies.txt',
    );
    expect(JSON.stringify(result)).not.toMatch(/secret|private|example/);
    expect(errors.classifyDownloadError(null).code).toBe('unknown');
  });
});
