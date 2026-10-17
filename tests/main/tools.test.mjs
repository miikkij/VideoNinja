import { describe, it, expect, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import toolsModule from '../../src/main/tools.js';

const { createToolService } = toolsModule;

describe('browser impersonation capabilities', () => {
  const tool = { available: true, path: 'C:\\Tools\\yt-dlp.exe', version: '2026.10.14' };
  it('parses actual target rows, ignores unavailable rows and caches by executable/version', async () => {
    const execFile = vi.fn(async () => ({
      stdout:
        '[info] Available impersonate targets\nClient OS Source\nChrome-133 Macos-15 curl_cffi\nSafari-17.2 Ios-17.2 curl_cffi\nFirefox-133 Macos-14 curl_cffi (not available)\ninvalid diagnostic',
      stderr: '',
    }));
    const service = createToolService({ platform: 'win32', execFile });
    expect(await service.checkImpersonation(tool)).toEqual({
      available: true,
      targets: ['Chrome-133:Macos-15', 'Safari-17.2:Ios-17.2'],
    });
    const cached = await service.checkImpersonation(tool);
    cached.targets.push('tampered');
    expect((await service.checkImpersonation(tool)).targets).toHaveLength(2);
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(execFile.mock.calls[0][1]).toEqual([
      '--ignore-config',
      '--no-plugin-dirs',
      '--no-remote-components',
      '--no-js-runtimes',
      '--color',
      'never',
      '--list-impersonate-targets',
    ]);
    expect(execFile.mock.calls[0][2]).toMatchObject({
      shell: false,
      timeout: 5000,
      maxBuffer: 128 * 1024,
      cwd: 'C:\\Tools',
    });
    await service.checkImpersonation({ ...tool, version: '2026.10.15' });
    await service.checkImpersonation({ ...tool, path: 'C:\\Other\\yt-dlp.exe' });
    expect(execFile).toHaveBeenCalledTimes(3);
  });
  it('leaves unsupported or failed probes optional and retries transient failures on the next check', async () => {
    const execFile = vi
      .fn()
      .mockRejectedValueOnce(new Error('timed out'))
      .mockResolvedValue({ stdout: 'Chrome-133 Macos-15 curl_cffi' });
    const service = createToolService({ platform: 'win32', execFile });
    expect(await service.checkImpersonation(tool)).toEqual({ available: false, targets: [] });
    expect((await service.checkImpersonation(tool)).available).toBe(true);
    expect(execFile).toHaveBeenCalledTimes(2);
    expect(await service.checkImpersonation({ available: false })).toEqual({
      available: false,
      targets: [],
    });
  });
  it('bounds targets and does not mistake an unavailable library for support', async () => {
    const execFile = vi.fn(async () => ({
      stdout: 'Chrome-133 Macos-15 curl_cffi (not available)',
    }));
    const service = createToolService({ platform: 'win32', execFile });
    expect((await service.checkImpersonation(tool)).available).toBe(false);
    execFile.mockResolvedValue({
      stdout: Array.from(
        { length: 101 },
        (_, index) => `Chrome-${index} Windows-10 curl_cffi`,
      ).join('\n'),
    });
    expect(
      (await service.checkImpersonation({ ...tool, version: '2026.10.15' })).targets,
    ).toHaveLength(100);
  });
  it('awaits the aborted probe child close and does not cache its result', async () => {
    const controller = new AbortController();
    const child = new EventEmitter();
    let rejectProbe;
    const probe = new Promise((_resolve, reject) => {
      rejectProbe = reject;
    });
    probe.child = child;
    const execFile = vi
      .fn()
      .mockReturnValueOnce(probe)
      .mockResolvedValue({ stdout: 'Chrome-133 Macos-15 curl_cffi' });
    const service = createToolService({ platform: 'win32', execFile });
    let settled = false;
    const pending = service.checkImpersonation(tool, { signal: controller.signal });
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    controller.abort();
    rejectProbe(new Error('aborted'));
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    child.emit('close');
    await rejection;
    expect((await service.checkImpersonation(tool)).available).toBe(true);
    expect(execFile).toHaveBeenCalledTimes(2);
  });
});

function serviceWith(files, platform = 'win32', overrides = {}) {
  const fs = {
    realpath: vi.fn(async (file) => {
      if (!files[file]) throw new Error('ENOENT');
      return file;
    }),
    stat: vi.fn(async () => ({ isFile: () => true })),
    access: vi.fn(async () => {}),
  };
  const execFile = vi.fn(async (file) => ({ stdout: files[file], stderr: '' }));
  const service = createToolService({
    platform,
    env: { PATH: platform === 'win32' ? '.;relative;C:\\Tools' : '.:relative:/tools' },
    execPath: platform === 'win32' ? 'C:\\App\\VideoNinja.exe' : '/app/VideoNinja',
    fs,
    execFile,
    homeDir: '/home/test',
    ...overrides,
  });
  return { service, execFile, fs };
}

describe('resolved executable discovery', () => {
  it.each([
    ['2026.07.19', '2026-10-17T23:59:59.999Z', false, 90, '2026-07-19'],
    ['2026.07.18', '2026-10-17T00:00:00.000Z', true, 91, '2026-07-18'],
    ['2026.07.18.232846', '2026-10-17T00:00:00.000Z', true, 91, '2026-07-18'],
    ['2026.10.18', '2026-10-17T00:00:00.000Z', false, 0, '2026-10-18'],
    ['2024.02.29', '2024-05-30T00:00:00.000Z', true, 91, '2024-02-29'],
    ['2026.02.29', '2026-10-17T00:00:00.000Z', false, null, null],
    ['2026.13.01', '2026-10-17T00:00:00.000Z', false, null, null],
  ])(
    'reports date-based freshness for %s at %s',
    async (version, clock, stale, ageDays, releaseDate) => {
      const { service } = serviceWith({ 'C:\\Tools\\yt-dlp.exe': version }, 'win32', {
        now: () => Date.parse(clock),
      });
      expect(await service.checkYtDlpAvailability()).toMatchObject({
        available: true,
        version,
        stale,
        ageDays,
        releaseDate,
      });
    },
  );
  it('does not invent a release date or stale warning for missing or unknown versions', async () => {
    for (const files of [{}, { 'C:\\Tools\\yt-dlp.exe': 'custom-development' }]) {
      const { service } = serviceWith(files);
      expect(await service.checkYtDlpAvailability()).toMatchObject({
        available: false,
        stale: false,
        ageDays: null,
        releaseDate: null,
      });
    }
  });
  it('recomputes freshness when tools are checked again', async () => {
    const now = vi
      .fn()
      .mockReturnValueOnce(Date.parse('2026-10-16'))
      .mockReturnValueOnce(Date.parse('2026-10-17'));
    const { service } = serviceWith({ 'C:\\Tools\\yt-dlp.exe': '2026.07.18' }, 'win32', { now });
    expect((await service.checkYtDlpAvailability()).stale).toBe(false);
    expect((await service.checkYtDlpAvailability()).stale).toBe(true);
  });
  it('prefers isolated managed tools and their per-tool directories', () => {
    const service = createToolService({
      platform: 'win32',
      managedDir: 'C:\\Profile\\tools',
      env: { PATH: 'C:\\Global' },
      execPath: 'C:\\App\\VideoNinja.exe',
    });
    expect(service.candidates('yt-dlp').slice(0, 2)).toEqual([
      'C:\\Profile\\tools\\yt-dlp.exe',
      'C:\\Profile\\tools\\yt-dlp\\yt-dlp.exe',
    ]);
    expect(service.candidates('deno')).toContain('C:\\Profile\\tools\\runtime\\deno.exe');
    expect(service.candidates('ffprobe')).toContain('C:\\Profile\\tools\\ffmpeg\\ffprobe.exe');
  });
  it('diagnoses the actual EJS package and selected runtime without contacting a media URL', async () => {
    const runProcess = vi.fn(async (_file, args, handlers) => {
      handlers.onStderrLine('[debug] yt-dlp version stable@2026.10.14 [abcdef123]');
      handlers.onStderrLine('[debug] Optional libraries: yt_dlp_ejs-0.8.0, requests-1.0');
      handlers.onStderrLine('[debug] JS runtimes: deno-2.9.7');
      expect(args.at(-1)).toBe('--');
      return { code: 2 };
    });
    const base = serviceWith({
      'C:\\Tools\\yt-dlp.exe': '2026.10.14',
      'C:\\Tools\\deno.exe': 'deno 2.9.7',
    });
    const service = createToolService({
      platform: 'win32',
      env: { PATH: 'C:\\Tools' },
      execPath: 'C:\\App\\VideoNinja.exe',
      fs: base.fs,
      execFile: base.execFile,
      runProcess,
    });
    expect(await service.diagnoseEjs()).toEqual({
      status: 'present-unverified',
      version: '0.8.0',
      runtime: 'deno',
      revision: 'abcdef123',
    });
    expect(runProcess).toHaveBeenCalledWith(
      'C:\\Tools\\yt-dlp.exe',
      expect.arrayContaining(['--no-remote-components', '--ignore-config', '--simulate']),
      expect.objectContaining({ maxOutputBytes: 128 * 1024, timeoutMs: 30000 }),
    );
  });
  it('waits for every parallel probe before propagating an abort', async () => {
    let finishSecond;
    let settled = false;
    const failure = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const pending = toolsModule
      .settleProbes([
        Promise.reject(failure),
        new Promise((resolve) => {
          finishSecond = resolve;
        }),
      ])
      .catch((error) => {
        settled = true;
        return error;
      });
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    finishSecond({ available: false });
    expect(await pending).toBe(failure);
  });
  it('waits for an actual cancelled Node probe to close before discovery rejects', async () => {
    const execute = promisify(execFile);
    const controller = new AbortController();
    let child;
    let closed = false;
    const service = createToolService({
      env: { PATH: '' },
      execPath: process.execPath,
      execFile: (...args) => {
        const probe = execute(...args);
        child = probe.child;
        child.once('close', () => {
          closed = true;
        });
        return probe;
      },
    });
    const pending = service
      .discover(
        'node',
        ['-e', 'setInterval(() => {}, 1000)'],
        () => 'fixture',
        () => true,
        { signal: controller.signal },
      )
      .catch((error) => error);
    try {
      await vi.waitFor(() => expect(child?.pid).toBeGreaterThan(0));
      controller.abort();
      expect((await pending).name).toBe('AbortError');
      expect(closed).toBe(true);
    } finally {
      controller.abort();
      if (child && !closed) child.kill();
    }
  });
  it('searches the executable directory and absolute PATH entries without cwd or shell wrappers', () => {
    const { service } = serviceWith({});
    const candidates = service.candidates('yt-dlp');
    expect(candidates[0]).toBe('C:\\App\\yt-dlp.exe');
    expect(candidates).toContain('C:\\Tools\\yt-dlp.exe');
    expect(candidates.every((candidate) => /^[A-Z]:\\/u.test(candidate))).toBe(true);
    expect(
      candidates.some((candidate) => candidate.includes('relative') || candidate.endsWith('.cmd')),
    ).toBe(false);
  });
  it('passes absolute paths and bounded shell-free probes', async () => {
    const { service, execFile } = serviceWith({ 'C:\\Tools\\yt-dlp.exe': '2026.10.14\n' });
    expect(await service.checkYtDlpAvailability()).toMatchObject({
      available: true,
      path: 'C:\\Tools\\yt-dlp.exe',
      ejs: 'not-checked',
    });
    expect(execFile).toHaveBeenCalledWith(
      'C:\\Tools\\yt-dlp.exe',
      expect.arrayContaining([
        '--ignore-config',
        '--no-plugin-dirs',
        '--no-remote-components',
        '--version',
      ]),
      expect.objectContaining({ shell: false, timeout: 5000, windowsHide: true }),
    );
  });
  it('filters old runtimes and prefers supported Deno before Node', async () => {
    const { service } = serviceWith({
      'C:\\App\\deno.exe': 'deno 2.2.9',
      'C:\\Tools\\deno.exe': 'deno 2.3.0',
      'C:\\App\\node.exe': 'v20.19.0',
      'C:\\Tools\\node.exe': 'v24.1.0',
      'C:\\Tools\\qjs.exe': 'QuickJS version 2023-12-9',
    });
    const checks = await service.checkJsRuntimes();
    expect(
      checks
        .filter((runtime) => runtime.available)
        .map((runtime) => [runtime.name, runtime.version]),
    ).toEqual([
      ['deno', '2.3.0'],
      ['node', '24.1.0'],
      ['quickjs', '2023-12-9'],
    ]);
    expect(checks[0].path).toBe('C:\\Tools\\deno.exe');
  });
  it('rejects older QuickJS and does not invent a runtime', async () => {
    const { service } = serviceWith({ 'C:\\Tools\\qjs.exe': 'QuickJS version 2023-12-1' });
    expect((await service.checkJsRuntimes()).every((runtime) => !runtime.available)).toBe(true);
  });
  it('recognizes Bellard QuickJS help output despite its documented exit code 1', async () => {
    const { service, execFile } = serviceWith({
      'C:\\Tools\\qjs.exe': 'QuickJS version 2025-09-13',
    });
    execFile.mockRejectedValue(
      Object.assign(new Error('Command failed'), {
        code: 1,
        killed: false,
        signal: null,
        stdout: 'QuickJS version 2025-09-13\nusage: qjs [options] [file [args]]\n',
        stderr: '',
      }),
    );
    expect(
      (await service.checkJsRuntimes()).find((runtime) => runtime.name === 'quickjs'),
    ).toMatchObject({
      available: true,
      version: '2025-09-13',
    });
  });
  it.each([
    { code: 2 },
    { code: 1, killed: true },
    { code: 1, signal: 'SIGTERM' },
    { code: 'ABORT_ERR' },
    { code: 1, stdout: 'unrecognized output' },
  ])('does not accept an unsuccessful QuickJS probe: %j', async (failure) => {
    const { service, execFile } = serviceWith({ 'C:\\Tools\\qjs.exe': 'available' });
    execFile.mockRejectedValue(
      Object.assign(new Error('Probe failed'), {
        stdout: 'QuickJS version 2025-09-13',
        ...failure,
      }),
    );
    expect(
      (await service.checkJsRuntimes()).find((runtime) => runtime.name === 'quickjs').available,
    ).toBe(false);
  });
  it('still aborts discovery when QuickJS help races with cancellation', async () => {
    const { service, execFile } = serviceWith({ 'C:\\Tools\\qjs.exe': 'available' });
    const controller = new AbortController();
    execFile.mockImplementation(async () => {
      controller.abort();
      throw Object.assign(new Error('Command failed'), {
        code: 1,
        stdout: 'QuickJS version 2025-09-13',
      });
    });
    await expect(service.checkJsRuntimes({ signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
  it.each(['darwin', 'linux'])('supports %s and ffmpeg outside PATH', async (platform) => {
    const { service } = serviceWith({ '/app/ffmpeg': 'ffmpeg version 8.0 Copyright' }, platform);
    expect(await service.checkFfmpegAvailability()).toMatchObject({
      available: true,
      path: '/app/ffmpeg',
      version: '8.0',
    });
    expect(service.candidates('yt-dlp')).toContain('/tools/yt-dlp');
  });
});
