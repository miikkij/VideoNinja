import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import downloaderModule from '../../src/main/ytdlp.js';

const { createDownloader, buildDownloadArgs, formatBytes, redactError, PROTOCOL } =
  downloaderModule;
const root = path.resolve('test-downloads');
const finalFile = path.join(root, 'Täst video [Youtube-abc].mp4');
const yt = {
  available: true,
  path: path.resolve('tools/yt-dlp'),
  jsRuntimes: [{ name: 'deno', path: path.resolve('tools/deno'), version: '2.3.0' }],
};
const ffmpeg = { available: true, path: path.resolve('tools/ffmpeg') };

function setup(
  run = async (_file, _args, handlers) => {
    handlers.onStdoutLine(`${PROTOCOL.file}${JSON.stringify(finalFile)}`);
    return { code: 0 };
  },
  fsOverrides = {},
) {
  const fileSystem = {
    realpath: vi.fn(async (filename) => filename),
    stat: vi.fn(async (filename) => ({
      isDirectory: () => filename === root,
      isFile: () => filename !== root,
    })),
    access: vi.fn(async () => {}),
    statfs: vi.fn(async () => ({ blocks: 1000n, bsize: 4096n, bavail: 200n, bfree: 250n })),
    ...fsOverrides,
  };
  const runProcess = vi.fn(run);
  const tools = {
    checkYtDlpAvailability: vi.fn(async () => yt),
    checkFfmpegAvailability: vi.fn(async () => ffmpeg),
  };
  return {
    service: createDownloader({ fs: fileSystem, runProcess, tools }),
    runProcess,
    fileSystem,
    tools,
  };
}

describe('production argument builder', () => {
  it('isolates config/plugins/remote code and uses literal final URL, tool paths and source IDs', () => {
    const url = 'https://example.com/watch?a=1&b=$(literal)';
    const args = buildDownloadArgs(
      url,
      root,
      { userAgent: 'Example Agent "quoted"', quality: '1440' },
      yt,
      ffmpeg,
    );
    expect(args.slice(-2)).toEqual(['--', url]);
    expect(args).toContain('--ignore-config');
    expect(args).toContain('--no-plugin-dirs');
    expect(args).toContain('--no-remote-components');
    expect(args).toContain('--no-playlist');
    expect(args[args.indexOf('--playlist-items') + 1]).toBe('1');
    expect(args[args.indexOf('--user-agent') + 1]).toBe('Example Agent "quoted"');
    expect(args[args.indexOf('--ffmpeg-location') + 1]).toBe(ffmpeg.path);
    expect(args[args.indexOf('--js-runtimes') + 1]).toBe(`deno:${yt.jsRuntimes[0].path}`);
    expect(args[args.indexOf('-o') + 1]).toContain('%(extractor_key).24B-%(id).40B');
    expect(args[args.indexOf('-f') + 1]).toBe(
      'bestvideo[height<=1440]+bestaudio/best[height<=1440]',
    );
  });
  it('supports original audio and explicit conversion without silent video fallback', () => {
    const original = buildDownloadArgs('https://example.com/', root, { quality: 'audio' }, yt, {
      available: false,
    });
    expect(original[original.indexOf('-f') + 1]).toBe('bestaudio');
    expect(original).not.toContain('--extract-audio');
    const mp3 = buildDownloadArgs(
      'https://example.com/',
      root,
      { quality: 'audio', audioFormat: 'mp3' },
      yt,
      ffmpeg,
    );
    expect(mp3).toContain('--extract-audio');
    expect(mp3[mp3.indexOf('--audio-format') + 1]).toBe('mp3');
    expect(() =>
      buildDownloadArgs(
        'https://example.com/',
        root,
        { quality: 'audio', audioFormat: 'mp3' },
        yt,
        { available: false },
      ),
    ).toThrow(/ffmpeg/u);
  });
  it('rejects a missing explicitly selected runtime', () => {
    expect(() =>
      buildDownloadArgs('https://example.com/', root, { jsRuntime: 'node' }, yt, ffmpeg),
    ).toThrow(/missing or unsupported/u);
  });
  it('isolates aliases and requested formats while keeping same-input filenames stable', () => {
    const template = (url, options = {}) => {
      const args = buildDownloadArgs(url, root, options, yt, ffmpeg);
      return args[args.indexOf('-o') + 1];
    };
    const first = template('https://example.com/watch?alias=a');
    expect(first).toBe(template('https://EXAMPLE.COM/watch?alias=a'));
    expect(first).not.toBe(template('https://example.com/watch?alias=b'));
    expect(first).not.toBe(template('https://example.com/watch?alias=a', { quality: '720' }));
    expect(first).toMatch(/\[best-[a-f0-9]{16}\]/u);
    expect(template('https://example.com/', { quality: 'audio', audioFormat: 'mp3' })).toMatch(
      /\[audio-mp3-[a-f0-9]{16}\]/u,
    );
    const longest = path.basename(
      template('https://example.com/', { quality: 'audio', audioFormat: 'original' }),
    );
    expect(longest).toContain('%(title).140B');
    expect(longest).toContain('%(extractor_key).24B-%(id).40B');
    const expanded = longest
      .replace('%(title).140B', 't'.repeat(140))
      .replace('%(extractor_key).24B', 'e'.repeat(24))
      .replace('%(id).40B', 'i'.repeat(40))
      .replace('%(ext)s', 'webm');
    expect(Buffer.byteLength(expanded)).toBeLessThanOrEqual(255);
  });
});

describe('download result protocol', () => {
  it('uses verified after-move output instead of intermediate destinations', async () => {
    const progress = vi.fn();
    const { service } = setup(async (_file, _args, handlers) => {
      handlers.onStdoutLine('[download] Destination: ignored.f140.m4a');
      handlers.onStdoutLine(
        `${PROTOCOL.metadata}${JSON.stringify({ title: 'Täst', id: 'abc', duration: 45, ext: 'mp4', dangerous: 'ignored' })}`,
      );
      handlers.onStdoutLine(`${PROTOCOL.progress}{"downloaded":50,"total":100,"speed":2,"eta":25}`);
      handlers.onStderrLine(`${PROTOCOL.stage}merging`);
      handlers.onStdoutLine(`${PROTOCOL.file}${JSON.stringify(finalFile)}`);
      return { code: 0 };
    });
    const result = await service.downloadVideo('https://example.com/video', root, {}, progress);
    expect(result).toMatchObject({
      success: true,
      filepath: finalFile,
      metadata: { title: 'Täst', id: 'abc', duration: 45, ext: 'mp4' },
    });
    expect(result.metadata).not.toHaveProperty('dangerous');
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ percent: 50, status: 'downloading' }),
    );
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ status: 'merging' }));
    expect(progress).toHaveBeenLastCalledWith({
      type: 'complete',
      percent: 100,
      status: 'completed',
    });
  });
  it('does not mark success without a valid final file', async () => {
    const { service } = setup(async () => ({ code: 0 }));
    expect(await service.downloadVideo('https://example.com/', root)).toMatchObject({
      success: false,
      filepath: null,
    });
  });
  it.each(['outside', 'symlink', 'missing', 'directory'])(
    'rejects invalid final path: %s',
    async (mode) => {
      const outside = path.resolve('outside', 'video.mp4');
      const { service } = setup(
        async (_file, _args, handlers) => {
          handlers.onStdoutLine(
            `${PROTOCOL.file}${JSON.stringify(mode === 'outside' ? outside : finalFile)}`,
          );
          return { code: 0 };
        },
        {
          realpath: async (filename) => {
            if (filename === finalFile && mode === 'missing') throw new Error('ENOENT');
            return filename === finalFile && mode === 'symlink' ? outside : filename;
          },
          stat: async (filename) => ({
            isDirectory: () => filename === root,
            isFile: () => mode !== 'directory',
          }),
        },
      );
      expect((await service.downloadVideo('https://example.com/', root)).success).toBe(false);
    },
  );
  it('bounds and redacts failures without logging or persisting auth data', async () => {
    const cookieFile = path.resolve('private/cookies.txt');
    const { service } = setup(async (_file, _args, handlers) => {
      handlers.onStderrLine('x'.repeat(20000));
      handlers.onStderrLine(`ERROR ${cookieFile} https://user:password@example.com/?token=secret`);
      return { code: 1 };
    });
    const result = await service.downloadVideo('https://example.com/', root, { cookieFile });
    expect(result.success).toBe(false);
    expect(result.error.length).toBeLessThanOrEqual(8192);
    expect(result.error).not.toContain(cookieFile);
    expect(result.error).not.toContain('password');
    expect(result.error).not.toContain('token=');
  });
  it('does not turn a late successful exit into completion after abort', async () => {
    const controller = new AbortController();
    const progress = vi.fn();
    const { service } = setup(async (_file, _args, handlers) => {
      handlers.onStdoutLine(`${PROTOCOL.file}${JSON.stringify(finalFile)}`);
      controller.abort();
      return { code: 0 };
    });
    await expect(
      service.downloadVideo('https://example.com/', root, {}, progress, {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(progress).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
  });
  it('validates untrusted input before touching tools', async () => {
    const { service, tools, runProcess } = setup();
    await expect(service.downloadVideo('file:///secret', root)).rejects.toThrow();
    expect(tools.checkYtDlpAvailability).not.toHaveBeenCalled();
    expect(runProcess).not.toHaveBeenCalled();
  });
  it('serializes canonical-folder aliases and removes cancelled duplicate writers', async () => {
    const folderAlias = path.resolve('folder-alias');
    let finishFirst;
    let count = 0;
    const { service, runProcess } = setup(
      async (_file, _args, handlers) => {
        count++;
        if (count === 1)
          await new Promise((resolve) => {
            finishFirst = resolve;
          });
        handlers.onStdoutLine(`${PROTOCOL.file}${JSON.stringify(finalFile)}`);
        return { code: 0 };
      },
      {
        realpath: async (filename) => (filename === folderAlias ? root : filename),
      },
    );
    const first = service.downloadVideo('https://example.com/video', root);
    await vi.waitFor(() => expect(runProcess).toHaveBeenCalledTimes(1));
    const controller = new AbortController();
    const cancelled = service.downloadVideo(
      'https://EXAMPLE.COM/video',
      folderAlias,
      { quality: '720' },
      null,
      { signal: controller.signal },
    );
    const checkCancelled = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    const next = service.downloadVideo('https://example.com/video', folderAlias, {
      quality: '1080',
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(runProcess).toHaveBeenCalledTimes(1);
    controller.abort();
    await checkCancelled;
    finishFirst();
    expect((await first).success).toBe(true);
    expect((await next).success).toBe(true);
    expect(runProcess).toHaveBeenCalledTimes(2);
    expect(runProcess.mock.calls[1][1]).toContain(
      'bestvideo[height<=1080]+bestaudio/best[height<=1080]',
    );
  });
  it('allows different URL writers to run concurrently in the same folder', async () => {
    const releases = [];
    const { service, runProcess } = setup(async (_file, _args, handlers) => {
      await new Promise((resolve) => releases.push(resolve));
      handlers.onStdoutLine(`${PROTOCOL.file}${JSON.stringify(finalFile)}`);
      return { code: 0 };
    });
    const pending = [
      service.downloadVideo('https://example.com/video?alias=one', root),
      service.downloadVideo('https://example.com/video?alias=two', root),
    ];
    await vi.waitFor(() => expect(runProcess).toHaveBeenCalledTimes(2));
    releases.forEach((release) => release());
    expect((await Promise.all(pending)).every((result) => result.success)).toBe(true);
  });
});

describe('metadata and disk space', () => {
  it('fetches only bounded display metadata without downloading', async () => {
    const { service, runProcess } = setup(async (_file, _args, handlers) => {
      handlers.onStdoutLine(
        `${PROTOCOL.metadata}${JSON.stringify({ title: 'Title', duration: 15, id: 'x', ext: 'webm', thumbnails: ['https://remote'] })}`,
      );
      return { code: 0 };
    });
    expect(await service.fetchMetadata('https://example.com/')).toEqual({
      title: 'Title',
      duration: 15,
      id: 'x',
      ext: 'webm',
    });
    expect(runProcess.mock.calls[0][1]).toContain('--simulate');
    expect(runProcess.mock.calls[0][1]).toContain('--skip-download');
    expect(runProcess.mock.calls[0][1]).toContain('--no-playlist');
    expect(
      runProcess.mock.calls[0][1][runProcess.mock.calls[0][1].indexOf('--playlist-items') + 1],
    ).toBe('1');
  });
  it('uses available blocks for free space and reports unknown on filesystem errors', async () => {
    const { service, fileSystem } = setup();
    expect(await service.getDiskSpace(root)).toEqual({
      available: true,
      total: 4096000,
      free: 819200,
      used: 3072000,
      error: null,
    });
    fileSystem.statfs.mockRejectedValueOnce(new Error('access denied'));
    expect(await service.getDiskSpace(root)).toMatchObject({
      available: false,
      total: null,
      free: null,
      used: null,
    });
  });
  it('formats real values and refuses invalid capacities', () => {
    expect(formatBytes(1024)).toBe('1 KiB');
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(null)).toBe('Unknown');
    expect(formatBytes(NaN)).toBe('Unknown');
    expect(redactError('see https://example.com/?token=x')).not.toContain('token');
  });
});

describe('bounded playlist preview', () => {
  const entry = (index, overrides = {}) => ({
    id: `item-${index}`,
    title: `Video ${index}`,
    playlist_index: index,
    url: `https://media.example/video/${index}`,
    duration: index * 10,
    ...overrides,
  });
  const preview = (entries, extra = {}) => ({
    type: 'playlist',
    title: 'Owned list',
    entries,
    ...extra,
  });
  function playlistService(value) {
    return setup(async (_file, _args, handlers) => {
      handlers.onStdoutLine(`${PROTOCOL.playlist}${JSON.stringify(value)}`);
      return { code: 0 };
    });
  }
  it('uses safe flat no-download flags, cookie/runtime policy and a bounded runner', async () => {
    const { service, runProcess } = playlistService(preview([entry(1)]));
    const controller = new AbortController();
    const cookieFile = path.resolve('private/cookies.txt');
    const result = await service.fetchPlaylist(
      'https://example.com/list?a=1&b=2',
      { cookieFile, userAgent: 'Owned Agent', jsRuntime: 'deno' },
      { signal: controller.signal },
    );
    expect(result).toEqual({
      title: 'Owned list',
      entries: [
        {
          id: 'item-1',
          index: 1,
          title: 'Video 1',
          url: 'https://media.example/video/1',
          duration: 10,
          available: true,
        },
      ],
      hasMore: false,
    });
    const args = runProcess.mock.calls[0][1];
    expect(args).toEqual(
      expect.arrayContaining([
        '--ignore-config',
        '--no-plugin-dirs',
        '--no-remote-components',
        '--yes-playlist',
        '--flat-playlist',
        '--simulate',
        '--skip-download',
        '--cookies',
        cookieFile,
        '--user-agent',
        'Owned Agent',
        '--js-runtimes',
        `deno:${yt.jsRuntimes[0].path}`,
      ]),
    );
    expect(args).not.toContain('--no-playlist');
    expect(args).not.toContain('--playlist-items');
    expect(args[args.indexOf('--playlist-end') + 1]).toBe('501');
    expect(args.slice(-2)).toEqual(['--', 'https://example.com/list?a=1&b=2']);
    expect(runProcess.mock.calls[0][2]).toMatchObject({
      signal: controller.signal,
      timeoutMs: 60000,
      maxOutputBytes: 8 * 1024 * 1024,
    });
  });
  it('retains unavailable rows, validates every URL and converts only known YouTube IDs', async () => {
    const { service } = playlistService(
      preview([
        entry(1, { url: 'http://cdn.other.example/video.mp4' }),
        entry(2, { url: 'abcdefghijk', ie_key: 'Youtube' }),
        entry(3, { url: 'abcdefghijk', ie_key: 'Unknown' }),
        entry(4, { url: 'file:///private/video.mp4', webpage_url: 'https://example.com/list' }),
        entry(5, { url: 'https://user:secret@example.com/video' }),
        entry(6, { availability: 'private' }),
        entry(7, { title: '[Deleted video]' }),
        null,
        entry(9, { _type: 'playlist' }),
      ]),
    );
    const result = await service.fetchPlaylist('https://example.com/list');
    expect(result.entries.map((item) => item.available)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(result.entries[0].url).toBe('http://cdn.other.example/video.mp4');
    expect(result.entries[1].url).toBe('https://www.youtube.com/watch?v=abcdefghijk');
    expect(result.entries.slice(2).every((item) => item.url === null)).toBe(true);
    expect(result.entries[7]).toMatchObject({ id: 'entry-8', index: 8, duration: null });
  });
  it('returns at most 500 entries and detects the 501st sentinel', async () => {
    for (const count of [500, 501]) {
      const { service } = playlistService(
        preview(Array.from({ length: count }, (_, index) => entry(index + 1))),
      );
      const result = await service.fetchPlaylist('https://example.com/list');
      expect(result.entries).toHaveLength(500);
      expect(result.hasMore).toBe(count === 501);
      expect(result.entries.at(-1).index).toBe(500);
    }
  });
  it('bounds display fields and strips all unrequested remote metadata', async () => {
    const { service } = playlistService(
      preview(
        [
          entry(1, {
            id: 'a'.repeat(300),
            title: 'x'.repeat(600),
            duration: -1,
            thumbnail: 'https://remote.example/tracker',
            formats: [{ url: 'https://secret' }],
          }),
        ],
        { title: 't'.repeat(600), arbitrary: 'unused' },
      ),
    );
    const result = await service.fetchPlaylist('https://example.com/list');
    expect(result.title).toHaveLength(500);
    expect(result.entries[0].title).toHaveLength(500);
    expect(result.entries[0].id).toHaveLength(200);
    expect(result.entries[0].duration).toBeNull();
    expect(Object.keys(result.entries[0]).sort()).toEqual([
      'available',
      'duration',
      'id',
      'index',
      'title',
      'url',
    ]);
    expect(result).not.toHaveProperty('arbitrary');
  });
  it.each(['nonplaylist', 'malformed', 'oversized', 'excess-entries', 'nested'])(
    'rejects invalid playlist output: %s',
    async (mode) => {
      const { service } = setup(async (_file, _args, handlers) => {
        let output = JSON.stringify(preview([entry(1)]));
        if (mode === 'nonplaylist') output = JSON.stringify({ type: 'video', entries: [] });
        if (mode === 'malformed') output = '{invalid';
        if (mode === 'oversized') output = 'x'.repeat(8 * 1024 * 1024 + 1);
        if (mode === 'excess-entries')
          output = JSON.stringify(
            preview(Array.from({ length: 502 }, (_, index) => entry(index + 1))),
          );
        handlers.onStdoutLine(`${PROTOCOL.playlist}${output}`);
        if (mode === 'nested') handlers.onStdoutLine(`${PROTOCOL.playlist}${output}`);
        return { code: 0 };
      });
      await expect(service.fetchPlaylist('https://example.com/list')).rejects.toThrow(
        'preview limits',
      );
    },
  );
  it('rejects a single-video response and unsafe input before launching', async () => {
    const { service, runProcess } = setup(async () => ({ code: 0 }));
    await expect(service.fetchPlaylist('https://example.com/video')).rejects.toThrow('playlist');
    runProcess.mockClear();
    await expect(service.fetchPlaylist('file:///private')).rejects.toThrow();
    await expect(
      service.fetchPlaylist('https://example.com/list', { extraArgs: '--exec command' }),
    ).rejects.toThrow();
    expect(runProcess).not.toHaveBeenCalled();
  });
  it('redacts failures and lets a late cancellation win over a completed preview', async () => {
    const cookieFile = path.resolve('private/cookies.txt');
    const { service } = setup(async (_file, _args, handlers) => {
      handlers.onStderrLine(`${cookieFile} https://example.com/?secret=token`);
      return { code: 1 };
    });
    await expect(service.fetchPlaylist('https://example.com/list', { cookieFile })).rejects.toThrow(
      '[redacted]',
    );
    await service.fetchPlaylist('https://example.com/list', { cookieFile }).catch((error) => {
      expect(error.message).not.toContain('token');
      expect(error.message).not.toContain(cookieFile);
    });
    const controller = new AbortController();
    const late = setup(async (_file, _args, handlers) => {
      handlers.onStdoutLine(`${PROTOCOL.playlist}${JSON.stringify(preview([entry(1)]))}`);
      controller.abort();
      return { code: 0 };
    });
    await expect(
      late.service.fetchPlaylist('https://example.com/list', {}, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
