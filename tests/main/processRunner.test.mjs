import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import runnerModule from '../../src/main/processRunner.js';

const { createLineDecoder, createProcessRunner } = runnerModule;
function childProcess() {
  const child = new EventEmitter();
  child.pid = 123;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

describe('line protocol', () => {
  it('reassembles split UTF-8 and multiple CR/LF lines', () => {
    const lines = [];
    const decoder = createLineDecoder((line) => lines.push(line));
    const data = Buffer.from('hello ä\nsecond\r\nthird');
    decoder.write(data.subarray(0, 7));
    decoder.write(data.subarray(7, 12));
    decoder.write(data.subarray(12));
    decoder.end();
    expect(lines).toEqual(['hello ä', 'second', 'third']);
  });
  it('discards oversized lines without dropping subsequent protocol records', () => {
    const lines = [];
    const decoder = createLineDecoder((line) => lines.push(line), 8);
    decoder.write(Buffer.from('a'.repeat(40)));
    decoder.write(Buffer.from('discard\nvalid\n'));
    decoder.end();
    expect(lines).toEqual(['valid']);
  });
});

describe('child process lifecycle', () => {
  it('uses shell-free literal arguments and waits for close', async () => {
    const child = childProcess();
    const spawn = vi.fn(() => child);
    const lines = [];
    const runner = createProcessRunner({ spawn, platform: 'win32' });
    const args = ['path with spaces', 'https://example.com/?a=1&b=2', '$(literal)'];
    const pending = runner.runProcess('C:\\Tools\\tool.exe', args, {
      cwd: 'C:\\Output',
      onStdoutLine: (line) => lines.push(line),
    });
    child.stdout.emit('data', Buffer.from('final'));
    child.emit('close', 0, null);
    expect(await pending).toEqual({ code: 0, signal: null });
    expect(spawn).toHaveBeenCalledWith(
      'C:\\Tools\\tool.exe',
      args,
      expect.objectContaining({
        shell: false,
        windowsHide: true,
        detached: false,
        cwd: 'C:\\Output',
      }),
    );
    expect(lines).toEqual(['final']);
  });
  it('rejects a spawn error once even when close follows', async () => {
    const child = childProcess();
    const runner = createProcessRunner({ spawn: () => child });
    const pending = runner.runProcess('missing', []);
    child.emit('error', new Error('ENOENT'));
    child.emit('close', -2, null);
    child.emit('close', -2, null);
    await expect(pending).rejects.toThrow('ENOENT');
  });
  it('does not launch an already aborted request', async () => {
    const spawn = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(
      createProcessRunner({ spawn }).runProcess('tool', [], { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(spawn).not.toHaveBeenCalled();
  });
  it('cancels the Windows process tree and waits for taskkill completion', async () => {
    const child = childProcess();
    let finishKill;
    const execFile = vi.fn((_file, _args, _options, callback) => {
      finishKill = callback;
    });
    const runner = createProcessRunner({
      spawn: () => child,
      execFile,
      platform: 'win32',
      systemRoot: 'C:\\Windows',
    });
    const controller = new AbortController();
    let settled = false;
    const pending = runner.runProcess('tool.exe', [], { signal: controller.signal });
    const check = pending.catch((error) => {
      settled = true;
      return error;
    });
    controller.abort();
    child.emit('close', 1, null);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(execFile).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\taskkill.exe',
      ['/PID', '123', '/T', '/F'],
      expect.objectContaining({ shell: false, windowsHide: true }),
      expect.any(Function),
    );
    finishKill(null);
    expect((await check).name).toBe('AbortError');
  });
  it('cancels a separate POSIX process group including descendants', async () => {
    const child = childProcess();
    const spawn = vi.fn(() => child),
      kill = vi.fn();
    const runner = createProcessRunner({ spawn, kill, platform: 'linux' });
    const controller = new AbortController();
    const pending = runner.runProcess('/bin/tool', [], { signal: controller.signal });
    controller.abort();
    child.emit('close', null, 'SIGKILL');
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(kill).toHaveBeenCalledWith(-123, 'SIGKILL');
    expect(spawn.mock.calls[0][2].detached).toBe(true);
  });
  it('terminates excessive combined stdout/stderr output and rejects after cleanup', async () => {
    const child = childProcess();
    const kill = vi.fn();
    const lines = [];
    const pending = createProcessRunner({ spawn: () => child, kill, platform: 'linux' }).runProcess(
      '/bin/tool',
      [],
      {
        maxOutputBytes: 12,
        onStdoutLine: (line) => lines.push(line),
        onStderrLine: (line) => lines.push(line),
      },
    );
    child.stdout.emit('data', Buffer.from('first\n'));
    child.stderr.emit('data', Buffer.from('too much\n'));
    child.stdout.emit('data', Buffer.from('ignored\n'));
    child.emit('close', null, 'SIGKILL');
    await expect(pending).rejects.toThrow('output limit');
    expect(kill).toHaveBeenCalledWith(-123, 'SIGKILL');
    expect(lines).toEqual(['first']);
  });
});

describe('native process boundary without media or network', () => {
  it('stops an owned Node child and its descendant on cancellation', async () => {
    const controller = new AbortController();
    let descendant;
    const source = `
      const { spawn } = require('node:child_process');
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
      child.once('spawn', () => console.log(child.pid));
      setInterval(() => {}, 1000);
    `;
    const isRunning = async (pid) => {
      try {
        process.kill(pid, 0);
        if (process.platform === 'linux') {
          const status = await readFile(`/proc/${pid}/stat`, 'utf8');
          if (status.slice(status.lastIndexOf(')') + 2).startsWith('Z')) return false;
        }
        return true;
      } catch (error) {
        if (['ESRCH', 'ENOENT'].includes(error.code)) return false;
        throw error;
      }
    };
    try {
      const pending = createProcessRunner().runProcess(process.execPath, ['-e', source], {
        signal: controller.signal,
        timeoutMs: 5000,
        onStdoutLine: (line) => {
          descendant = Number(line);
          controller.abort();
        },
      });
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(Number.isSafeInteger(descendant)).toBe(true);
      for (let attempt = 0; attempt < 50 && (await isRunning(descendant)); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(await isRunning(descendant)).toBe(false);
    } finally {
      controller.abort();
      if (Number.isSafeInteger(descendant) && (await isRunning(descendant)))
        process.kill(descendant, 'SIGKILL');
    }
  }, 15000);
});
