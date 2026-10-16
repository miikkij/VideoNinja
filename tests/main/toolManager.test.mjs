import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import managerModule from '../../src/main/toolManager.js';

const { createToolManager, readZipExecutables, checksumFor } = managerModule;
const directories = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    expect(path.dirname(directory)).toBe(os.tmpdir());
    expect(path.basename(directory).startsWith('videoninja-manager-test-')).toBe(true);
    await fs.rm(directory, { recursive: true, force: true });
  }
});

function zip(entries) {
  const locals = [],
    centrals = [];
  let offset = 0;
  for (const [name, body, mode = 0x81ed] of entries) {
    const filename = Buffer.from(name),
      bytes = Buffer.from(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, bytes);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, filename);
    offset += local.length + filename.length + bytes.length;
  }
  const directory = Buffer.concat(centrals),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

async function setup({
  tool = 'yt-dlp',
  platform = 'win32',
  arch = 'x64',
  bytes = Buffer.from('verified executable'),
  checksum,
  fsOverride,
  runProcess,
  waitForRename,
} = {}) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'videoninja-manager-test-'));
  directories.push(temporary);
  const managedDir = path.join(temporary, 'tools');
  const repository =
    tool === 'runtime'
      ? 'denoland/deno'
      : tool === 'ffmpeg'
        ? 'yt-dlp/FFmpeg-Builds'
        : 'yt-dlp/yt-dlp';
  const version = tool === 'runtime' ? 'v2.9.7' : tool === 'ffmpeg' ? 'latest' : '2026.10.14';
  const filename =
    tool === 'runtime'
      ? 'deno-x86_64-pc-windows-msvc.zip'
      : tool === 'ffmpeg'
        ? 'ffmpeg-master-latest-win64-gpl.zip'
        : platform === 'win32'
          ? 'yt-dlp.exe'
          : platform === 'darwin'
            ? 'yt-dlp_macos'
            : arch === 'arm64'
              ? 'yt-dlp_linux_aarch64'
              : 'yt-dlp_linux';
  const manifest =
    tool === 'runtime'
      ? `${filename}.sha256sum`
      : tool === 'ffmpeg'
        ? 'checksums.sha256'
        : 'SHA2-256SUMS';
  const base = `https://github.com/${repository}/releases/download/${version}/`;
  const hash = checksum || createHash('sha256').update(bytes).digest('hex');
  const responses = new Map([
    [
      `https://api.github.com/repos/${repository}/releases/latest`,
      JSON.stringify({
        tag_name: version,
        assets: [filename, manifest].map((name) => ({ name, browser_download_url: base + name })),
      }),
    ],
    [base + filename, bytes],
    [base + manifest, `${hash}  ${filename}\n`],
  ]);
  const request = vi.fn(async (url) =>
    responses.has(url)
      ? new Response(responses.get(url))
      : new Response('missing', { status: 404 }),
  );
  const execute = runProcess || vi.fn(async () => ({ code: 0 }));
  const manager = createToolManager({
    managedDir,
    platform,
    arch,
    fetch: request,
    runProcess: execute,
    waitForRename,
    fs: fsOverride ? { ...fs, ...fsOverride } : fs,
  });
  return { manager, managedDir, temporary, request, execute, responses, base, filename, hash };
}

describe('managed tool installation', () => {
  it('verifies an official executable before atomically replacing only the managed copy', async () => {
    const fixture = await setup();
    const previous = path.join(fixture.managedDir, 'yt-dlp');
    await fs.mkdir(previous, { recursive: true });
    await fs.writeFile(path.join(previous, 'yt-dlp.exe'), 'previous');
    const result = await fixture.manager.install('yt-dlp');
    expect(result).toMatchObject({
      status: 'installed',
      tool: 'yt-dlp',
      version: '2026.10.14',
      sha256: fixture.hash,
    });
    expect(await fs.readFile(result.path, 'utf8')).toBe('verified executable');
    expect(await fs.readdir(fixture.managedDir)).toEqual(['yt-dlp']);
    expect(fixture.execute).toHaveBeenCalledWith(
      expect.stringContaining('ready'),
      expect.arrayContaining([
        '--ignore-config',
        '--no-plugin-dirs',
        '--no-remote-components',
        '--version',
      ]),
      expect.objectContaining({ timeoutMs: 15000 }),
    );
  });
  it('preserves the existing tool on checksum mismatch and never executes downloaded bytes', async () => {
    const fixture = await setup({ checksum: '0'.repeat(64) });
    await expect(fixture.manager.installYtDlp()).rejects.toThrow('checksum');
    expect(fixture.execute).not.toHaveBeenCalled();
    await expect(fs.stat(fixture.managedDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rolls back a failed switch and cleans only its allocated staging directory', async () => {
    const fixture = await setup({
      fsOverride: {
        rename: async (from, to) => {
          if (path.basename(from) === 'ready') throw new Error('locked');
          return fs.rename(from, to);
        },
      },
    });
    const previous = path.join(fixture.managedDir, 'yt-dlp');
    await fs.mkdir(previous, { recursive: true });
    await fs.writeFile(path.join(previous, 'yt-dlp.exe'), 'old');
    await expect(fixture.manager.installYtDlp()).rejects.toThrow('locked');
    expect(await fs.readFile(path.join(previous, 'yt-dlp.exe'), 'utf8')).toBe('old');
    expect(await fs.readdir(fixture.managedDir)).toEqual(['yt-dlp']);
  });
  it('retries transient Windows locks for both previous and staged tool directories', async () => {
    const failures = {
      'yt-dlp': ['EACCES'],
      ready: ['EPERM', 'EACCES', 'EBUSY'],
    };
    const waitForRename = vi.fn(async () => {});
    const fixture = await setup({
      waitForRename,
      fsOverride: {
        rename: async (from, to) => {
          const code = failures[path.basename(from)]?.shift();
          if (code) throw Object.assign(new Error('temporarily locked'), { code });
          return fs.rename(from, to);
        },
      },
    });
    const previous = path.join(fixture.managedDir, 'yt-dlp');
    await fs.mkdir(previous, { recursive: true });
    await fs.writeFile(path.join(previous, 'yt-dlp.exe'), 'old');
    const result = await fixture.manager.installYtDlp();
    expect(await fs.readFile(result.path, 'utf8')).toBe('verified executable');
    expect(waitForRename.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([
      100, 100, 200, 400,
    ]);
    expect(fixture.execute).toHaveBeenCalledTimes(1);
    expect(await fs.readdir(fixture.managedDir)).toEqual(['yt-dlp']);
  });
  it('stops retrying persistent Windows locks and restores the previous tool', async () => {
    let switchAttempts = 0;
    const waitForRename = vi.fn(async () => {});
    const fixture = await setup({
      waitForRename,
      fsOverride: {
        rename: async (from, to) => {
          if (path.basename(from) === 'ready') {
            switchAttempts++;
            throw Object.assign(new Error('still locked'), { code: 'EBUSY' });
          }
          return fs.rename(from, to);
        },
      },
    });
    const previous = path.join(fixture.managedDir, 'yt-dlp');
    await fs.mkdir(previous, { recursive: true });
    await fs.writeFile(path.join(previous, 'yt-dlp.exe'), 'old');
    await expect(fixture.manager.installYtDlp()).rejects.toMatchObject({ code: 'EBUSY' });
    expect(switchAttempts).toBe(8);
    expect(waitForRename.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([
      100, 200, 400, 800, 1000, 1000, 1000,
    ]);
    expect(await fs.readFile(path.join(previous, 'yt-dlp.exe'), 'utf8')).toBe('old');
    expect(await fs.readdir(fixture.managedDir)).toEqual(['yt-dlp']);
  });
  it('does not retry a permanent switch error and rolls back immediately', async () => {
    const waitForRename = vi.fn(async () => {});
    const rename = vi.fn(async (from, to) => {
      if (path.basename(from) === 'ready')
        throw Object.assign(new Error('disk error'), { code: 'EIO' });
      return fs.rename(from, to);
    });
    const fixture = await setup({ waitForRename, fsOverride: { rename } });
    const previous = path.join(fixture.managedDir, 'yt-dlp');
    await fs.mkdir(previous, { recursive: true });
    await fs.writeFile(path.join(previous, 'yt-dlp.exe'), 'old');
    await expect(fixture.manager.installYtDlp()).rejects.toMatchObject({ code: 'EIO' });
    expect(rename).toHaveBeenCalledTimes(3);
    expect(waitForRename).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(previous, 'yt-dlp.exe'), 'utf8')).toBe('old');
    expect(await fs.readdir(fixture.managedDir)).toEqual(['yt-dlp']);
  });
  it('aborts Windows backoff promptly but retries rollback independently of cancellation', async () => {
    const controller = new AbortController();
    let signalWaiting;
    const waiting = new Promise((resolve) => {
      signalWaiting = resolve;
    });
    const waitForRename = vi.fn((milliseconds, signal) => {
      if (!signal) return Promise.resolve();
      signalWaiting();
      return delay(milliseconds, undefined, { signal });
    });
    let switchAttempts = 0,
      rollbackAttempts = 0;
    const fixture = await setup({
      waitForRename,
      fsOverride: {
        rename: async (from, to) => {
          const name = path.basename(from);
          if (name === 'ready') {
            switchAttempts++;
            throw Object.assign(new Error('locked'), { code: 'EPERM' });
          }
          if (name === 'previous' && ++rollbackAttempts === 1)
            throw Object.assign(new Error('rollback temporarily locked'), { code: 'EACCES' });
          return fs.rename(from, to);
        },
      },
    });
    const previous = path.join(fixture.managedDir, 'yt-dlp');
    await fs.mkdir(previous, { recursive: true });
    await fs.writeFile(path.join(previous, 'yt-dlp.exe'), 'old');
    const result = fixture.manager.installYtDlp({ signal: controller.signal });
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await waiting;
    controller.abort();
    await rejected;
    expect(switchAttempts).toBe(1);
    expect(rollbackAttempts).toBe(2);
    expect(waitForRename.mock.calls[1]).toEqual([100, undefined]);
    expect(await fs.readFile(path.join(previous, 'yt-dlp.exe'), 'utf8')).toBe('old');
    expect(await fs.readdir(fixture.managedDir)).toEqual(['yt-dlp']);
  });
  it('retains the previous-version backup if all rollback retries fail', async () => {
    let rollbackAttempts = 0;
    const waitForRename = vi.fn(async () => {});
    const fixture = await setup({
      waitForRename,
      fsOverride: {
        rename: async (from, to) => {
          if (path.basename(from) === 'ready')
            throw Object.assign(new Error('switch failed'), { code: 'EIO' });
          if (path.basename(from) === 'previous') {
            rollbackAttempts++;
            throw Object.assign(new Error('rollback locked'), { code: 'EPERM' });
          }
          return fs.rename(from, to);
        },
      },
    });
    const previous = path.join(fixture.managedDir, 'yt-dlp');
    await fs.mkdir(previous, { recursive: true });
    await fs.writeFile(path.join(previous, 'yt-dlp.exe'), 'old');
    await expect(fixture.manager.installYtDlp()).rejects.toThrow(
      'retained in the installation backup',
    );
    expect(rollbackAttempts).toBe(8);
    expect(waitForRename).toHaveBeenCalledTimes(7);
    const retained = await fs.readdir(fixture.managedDir);
    expect(retained).toHaveLength(1);
    expect(retained[0]).toMatch(/^\.yt-dlp-install-/u);
    expect(
      await fs.readFile(
        path.join(fixture.managedDir, retained[0], 'previous', 'yt-dlp.exe'),
        'utf8',
      ),
    ).toBe('old');
  });
  it('does not apply Windows lock retries on other platforms', async () => {
    const waitForRename = vi.fn(async () => {});
    const fixture = await setup({
      platform: 'linux',
      waitForRename,
      fsOverride: {
        rename: async (from, to) => {
          if (path.basename(from) === 'ready')
            throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
          return fs.rename(from, to);
        },
      },
    });
    await expect(fixture.manager.installYtDlp()).rejects.toMatchObject({ code: 'EACCES' });
    expect(waitForRename).not.toHaveBeenCalled();
    expect(await fs.readdir(fixture.managedDir)).toEqual([]);
  });
  it('does not replace an existing tool if the verified executable fails its probe', async () => {
    const fixture = await setup({ runProcess: vi.fn(async () => ({ code: 1 })) });
    await expect(fixture.manager.installYtDlp()).rejects.toThrow('did not run');
    expect(await fs.readdir(fixture.managedDir)).toEqual([]);
  });
  it('rejects redirects outside official release hosts', async () => {
    const fixture = await setup();
    fixture.request.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://example.com/tool.exe' } }),
    );
    await expect(fixture.manager.installYtDlp()).rejects.toThrow('untrusted');
    expect(fixture.request).toHaveBeenCalledTimes(1);
    expect(fixture.execute).not.toHaveBeenCalled();
  });
  it('rejects an excessive Content-Length before reading a body', async () => {
    const fixture = await setup();
    fixture.request.mockResolvedValueOnce(
      new Response('x', { headers: { 'content-length': String(400 * 1024 * 1024) } }),
    );
    await expect(fixture.manager.installYtDlp()).rejects.toThrow('size limit');
  });
  it('supports cancellation before network and serializes installation ownership', async () => {
    const fixture = await setup();
    const controller = new AbortController();
    controller.abort();
    await expect(fixture.manager.installYtDlp({ signal: controller.signal })).rejects.toMatchObject(
      { name: 'AbortError' },
    );
    expect(fixture.request).not.toHaveBeenCalled();
    let resolve;
    fixture.request.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const first = fixture.manager.installYtDlp();
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    await expect(fixture.manager.installYtDlp()).rejects.toThrow('in progress');
    resolve(new Response('missing', { status: 404 }));
    await expect(first).rejects.toThrow('HTTP 404');
  });
  it('installs Deno from a checked archive using the actual Windows checksum format', async () => {
    const fixture = await setup({ tool: 'runtime', bytes: zip([['deno.exe', 'deno executable']]) });
    fixture.responses.set(
      `${fixture.base}${fixture.filename}.sha256sum`,
      `\r\nAlgorithm : SHA256\r\nHash      : ${fixture.hash.toUpperCase()}\r\nPath      : C:\\a\\deno\\target\\${fixture.filename}\r\n`,
    );
    const result = await fixture.manager.install('runtime');
    expect(result).toMatchObject({ status: 'installed', tool: 'runtime', version: 'v2.9.7' });
    expect(await fs.readFile(result.path, 'utf8')).toBe('deno executable');
  });
  it('installs ffmpeg and ffprobe together from the checked Windows bundle', async () => {
    const fixture = await setup({
      tool: 'ffmpeg',
      bytes: zip([
        ['ffmpeg/bin/ffmpeg.exe', 'ffmpeg'],
        ['ffmpeg/bin/ffprobe.exe', 'ffprobe'],
      ]),
    });
    const result = await fixture.manager.install('ffmpeg');
    expect(await fs.readFile(result.path, 'utf8')).toBe('ffmpeg');
    expect(await fs.readFile(path.join(path.dirname(result.path), 'ffprobe.exe'), 'utf8')).toBe(
      'ffprobe',
    );
    expect(fixture.execute).toHaveBeenCalledTimes(2);
  });
  it('provides explicit guided macOS ffmpeg setup without a privileged install', async () => {
    const fixture = await setup({ platform: 'darwin', arch: 'arm64' });
    expect(await fixture.manager.install('ffmpeg')).toMatchObject({
      status: 'guided',
      command: 'brew install ffmpeg',
      url: 'https://ffmpeg.org/download.html',
    });
    expect(fixture.request).not.toHaveBeenCalled();
    expect(fixture.execute).not.toHaveBeenCalled();
  });
});

describe('tool archive boundaries', () => {
  it.each([
    { entries: [['../deno.exe', 'x']] },
    { entries: [['dir/deno.exe', 'x', 0xa1ff]] },
    {
      entries: [
        ['one/deno.exe', 'x'],
        ['two/deno.exe', 'y'],
      ],
    },
    { entries: [['other.exe', 'x']] },
  ])('rejects traversal, symlinks, ambiguous and missing executables: %j', ({ entries }) => {
    expect(() => readZipExecutables(zip(entries), ['deno.exe'])).toThrow();
  });
  it('requires the exact manifest filename and a unique checksum', () => {
    const hash = 'a'.repeat(64);
    expect(checksumFor(`${hash} *yt-dlp.exe`, 'yt-dlp.exe')).toBe(hash);
    expect(() => checksumFor(`${hash}  other.exe`, 'yt-dlp.exe')).toThrow();
    expect(() => checksumFor(`${hash}  yt-dlp.exe\n${hash}  yt-dlp.exe`, 'yt-dlp.exe')).toThrow();
  });
});

describe('actual EJS dependency diagnostics', () => {
  it.each([
    ['0.8.1', 'compatible'],
    ['0.7.9', 'version-mismatch'],
  ])('compares installed EJS %s with the exact yt-dlp revision', async (version, status) => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'videoninja-manager-test-'));
    directories.push(temporary);
    const request = vi.fn(async () => new Response("VERSION = '0.8.0'\n"));
    const tools = {
      checkYtDlpAvailability: async () => ({ available: true }),
      checkFfmpegAvailability: async () => ({ available: true }),
      checkFfprobeAvailability: async () => ({ available: true }),
      diagnoseEjs: async () => ({
        status: 'present-unverified',
        version,
        revision: 'abcdef123',
        runtime: 'deno',
      }),
    };
    const manager = createToolManager({
      managedDir: path.join(temporary, 'tools'),
      tools,
      fetch: request,
    });
    expect((await manager.diagnose()).ejs).toMatchObject({
      status,
      version,
      expectedVersion: '0.8.0',
      liveChallengeTested: false,
    });
    expect(request.mock.calls[0][0]).toBe(
      'https://raw.githubusercontent.com/yt-dlp/yt-dlp/abcdef123/yt_dlp/extractor/youtube/jsc/_builtin/vendor/_info.py',
    );
  });
});
