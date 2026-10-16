import { describe, it, expect } from 'vitest';
import errors from '../../src/main/downloadErrors.js';

describe('actionable download failure classification', () => {
  it.each([
    ['HTTP Error 429: Too Many Requests', 'rate-limit', 'wait-and-retry', true],
    ['Connection reset by peer (ECONNRESET)', 'network', 'check-network', true],
    ['HTTP Error 503: unavailable', 'network', 'check-network', true],
    ['HTTP Error 403: Forbidden', 'auth', 'update-cookies', false],
    ['Sign in to confirm your age', 'auth', 'update-cookies', false],
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

  it('returns no raw URL, path or credential in its public remedy payload', () => {
    const result = errors.classifyDownloadError(
      'HTTP Error 403 https://user:secret@example.com/?token=secret C:\\private\\cookies.txt',
    );
    expect(JSON.stringify(result)).not.toMatch(/secret|private|example/);
    expect(errors.classifyDownloadError(null).code).toBe('unknown');
  });
});
