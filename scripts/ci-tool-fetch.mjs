const RELEASE_METADATA = new Set([
  '/repos/yt-dlp/yt-dlp/releases/latest',
  '/repos/yt-dlp/FFmpeg-Builds/releases/latest',
  '/repos/denoland/deno/releases/latest',
]);

/** Authenticate only CI release-metadata requests, never redirected asset hosts. */
export function createCiToolFetch(token, fetcher = globalThis.fetch) {
  if (typeof token !== 'string' || !token) throw new Error('The CI GitHub token is missing.');
  return (input, options = {}) => {
    const url = new URL(input);
    const headers = new Headers(options.headers);
    headers.delete('authorization');
    if (
      url.protocol === 'https:' &&
      url.hostname === 'api.github.com' &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      RELEASE_METADATA.has(url.pathname)
    )
      headers.set('Authorization', `Bearer ${token}`);
    return fetcher(input, { ...options, headers, redirect: 'manual' });
  };
}
