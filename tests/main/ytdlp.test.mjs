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
    expect(args[args.indexOf('--user-agent') + 1]).toBe('Example Agent "quoted"');
    expect(args[args.indexOf('--ffmpeg-location') + 1]).toBe(ffmpeg.path);
    expect(args[args.indexOf('--js-runtimes') + 1]).toBe(`deno:${yt.jsRuntimes[0].path}`);
    expect(args[args.indexOf('-o') + 1]).toContain('%(extractor_key)s-%(id)s');
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
