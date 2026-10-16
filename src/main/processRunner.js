const { spawn, execFile } = require('node:child_process');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');

function abortError() {
  const error = new Error('Download cancelled.');
  error.name = 'AbortError';
  return error;
}

/** Decode complete UTF-8 lines, with a hard cap on untrusted unterminated output. */
function createLineDecoder(onLine, maxLine = 1024 * 1024) {
  const decoder = new StringDecoder('utf8');
  let pending = '',
    discarding = false;
  const consume = (text) => {
    pending += text;
    let end;
    while ((end = pending.search(/[\r\n]/u)) !== -1) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      if (!discarding && line.length <= maxLine && line) onLine(line);
      discarding = false;
    }
    if (pending.length > maxLine) {
      pending = '';
      discarding = true;
    }
  };
  return {
    write: (chunk) => consume(decoder.write(chunk)),
    end: () => {
      consume(decoder.end());
      if (pending && !discarding) onLine(pending);
      pending = '';
    },
  };
}

function createProcessRunner(deps = {}) {
  const launch = deps.spawn || spawn;
  const execute = deps.execFile || execFile;
  const platform = deps.platform || process.platform;
  const kill = deps.kill || process.kill.bind(process);
  const systemRoot = deps.systemRoot || process.env.SystemRoot || 'C:\\Windows';

  function stopTree(child) {
    if (!Number.isSafeInteger(child.pid) || child.pid <= 0) return Promise.resolve();
    if (platform === 'win32') {
      return new Promise((resolve) => {
        execute(
          path.win32.join(systemRoot, 'System32', 'taskkill.exe'),
          ['/PID', String(child.pid), '/T', '/F'],
          { shell: false, windowsHide: true, timeout: 5000, maxBuffer: 65536 },
          (error) => {
            // A process that exited concurrently no longer needs termination.
            if (error) {
              try {
                child.kill();
              } catch {
                /* Already gone. */
              }
            }
            resolve();
          },
        );
      });
    }
    // Each child owns a POSIX group, including ffmpeg descendants. Force-killing
    // the group prevents the next queue item overlapping a cancelled merger.
    try {
      kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') {
        try {
          child.kill('SIGKILL');
        } catch {
          /* Already gone. */
        }
      }
    }
    return Promise.resolve();
  }

  /** Resolve only after process close and cancellation tree cleanup. */
  function runProcess(
    executable,
    args,
    {
      cwd,
      signal,
      onStdoutLine = () => {},
      onStderrLine = () => {},
      timeoutMs = 0,
      maxLine,
      maxOutputBytes = 0,
    } = {},
  ) {
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = launch(executable, args, {
          shell: false,
          windowsHide: true,
          detached: platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe'],
          cwd,
        });
      } catch (error) {
        reject(error);
        return;
      }
      let settled = false,
        cancelled = false,
        timedOut = false,
        outputExceeded = false,
        outputBytes = 0,
        processError = null,
        cleanup = Promise.resolve(),
        timer;
      const stdout = createLineDecoder(onStdoutLine, maxLine);
      const stderr = createLineDecoder(onStderrLine, maxLine);
      const cancel = () => {
        if (!cancelled) {
          cancelled = true;
          cleanup = stopTree(child);
        }
      };
      const consume = (decoder, chunk) => {
        if (cancelled) return;
        outputBytes += chunk.length;
        if (maxOutputBytes > 0 && outputBytes > maxOutputBytes) {
          outputExceeded = true;
          cancel();
          return;
        }
        decoder.write(chunk);
      };
      child.stdout.on('data', (chunk) => consume(stdout, chunk));
      child.stderr.on('data', (chunk) => consume(stderr, chunk));
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      if (timeoutMs > 0)
        timer = setTimeout(() => {
          timedOut = true;
          cancel();
        }, timeoutMs);
      child.on('error', (error) => {
        processError = error;
      });
      child.on('close', async (code, exitSignal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        stdout.end();
        stderr.end();
        await cleanup;
        if (outputExceeded) reject(new Error('The media tool exceeded its output limit.'));
        else if (timedOut) reject(new Error('The media tool timed out. Please retry.'));
        else if (cancelled) reject(abortError());
        else if (processError) reject(processError);
        else resolve({ code, signal: exitSignal });
      });
    });
  }
  return { runProcess, stopTree };
}

module.exports = { abortError, createLineDecoder, createProcessRunner, ...createProcessRunner() };
