import { describe, it, expect, vi } from 'vitest';
import { createCiToolFetch } from '../../scripts/ci-tool-fetch.mjs';

describe('CI tool metadata credentials', () => {
  it('authenticates the exact upstream release API while preserving cancellation and headers', async () => {
    const fetcher = vi.fn(async () => ({ ok: true }));
    const request = createCiToolFetch('fixture-token', fetcher);
    const signal = new AbortController().signal;
    await request('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', {
      signal,
      headers: { Accept: 'application/json' },
    });
    const [, options] = fetcher.mock.calls[0];
    expect(options.headers.get('authorization')).toBe('Bearer fixture-token');
    expect(options.headers.get('accept')).toBe('application/json');
    expect(options.signal).toBe(signal);
    expect(options.redirect).toBe('manual');
  });
  it.each([
    'https://github.com/yt-dlp/yt-dlp/releases/download/stable/yt-dlp.exe',
    'https://release-assets.githubusercontent.com/asset',
    'https://api.github.com/repos/unrelated/repository/releases/latest',
    'https://api.github.com.example.com/repos/yt-dlp/yt-dlp/releases/latest',
    'http://api.github.com/repos/yt-dlp/yt-dlp/releases/latest',
    'https://api.github.com:444/repos/yt-dlp/yt-dlp/releases/latest',
    'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest?unexpected=1',
  ])('never forwards a token to %s', async (url) => {
    const fetcher = vi.fn(async () => ({ ok: true }));
    await createCiToolFetch('fixture-token', fetcher)(url, {
      headers: { Authorization: 'old-token' },
    });
    expect(fetcher.mock.calls[0][1].headers.has('authorization')).toBe(false);
    expect(fetcher.mock.calls[0][1].redirect).toBe('manual');
  });
  it('fails clearly when the disposable runner has no token', () => {
    expect(() => createCiToolFetch('')).toThrow(/token is missing/);
  });
});
