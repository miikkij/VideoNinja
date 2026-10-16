import { describe, it, expect, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import toolsModule from '../../src/main/tools.js';

const { createToolService } = toolsModule;
function serviceWith(files, platform = 'win32') {
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
  });
  return { service, execFile, fs };
}

describe('resolved executable discovery', () => {
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
