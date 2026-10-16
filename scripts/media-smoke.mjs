import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import ytdlp from '../src/main/ytdlp.js';
import toolService from '../src/main/tools.js';

// Explicit integration check: generate owned fixtures, use loopback only, and
// never alter a user's profile, media collection, or installed tool versions.
const execute = promisify(execFile);
const temporary = await mkdtemp(path.join(os.tmpdir(), 'videoninja-media-smoke-'));
const source = path.join(temporary, 'fixtures');
const output = path.join(temporary, 'Lataukset ä space 100%');
const controller = new AbortController();
const deadline = setTimeout(() => controller.abort(), 240000);
let server;

async function runTool(file, args, cwd = source) {
  return execute(file, args, {
    cwd,
    shell: false,
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 1024 * 1024,
    signal: controller.signal,
  });
}

async function hashFile(filename) {
  return createHash('sha256')
    .update(await readFile(filename))
    .digest('hex');
}

async function removeFixtures() {
  // Verify the absolute deletion target is the exact mkdtemp child we created.
  const expectedParent = path.resolve(os.tmpdir());
  const resolved = path.resolve(temporary);
  if (
    path.dirname(resolved) !== expectedParent ||
    !path.basename(resolved).startsWith('videoninja-media-smoke-')
  ) {
    throw new Error('Refusing to remove an unexpected smoke-test directory.');
  }
  await rm(resolved, { recursive: true, force: true });
}

try {
  const [yt, ffmpeg, ffprobe] = await Promise.all([
    ytdlp.checkYtDlpAvailability({ signal: controller.signal }),
    ytdlp.checkFfmpegAvailability({ signal: controller.signal }),
    toolService.discover(
      'ffprobe',
      ['-version'],
      (text) => text.match(/ffprobe version\s+(\S+)/u)?.[1],
      () => true,
      { signal: controller.signal },
    ),
  ]);
  assert(yt.available, 'Install yt-dlp before running the local media smoke test.');
  assert(
    ffmpeg.available && ffprobe.available,
    'Install ffmpeg and ffprobe before running the local media smoke test.',
  );
  await mkdir(source);
  await mkdir(output);
  await runTool(ffmpeg.path, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=160x90:r=10',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=44100',
    '-t',
    '1',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    '-movflags',
    '+faststart',
    'fixture.mp4',
  ]);
  await runTool(ffmpeg.path, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-y',
    '-i',
    'fixture.mp4',
    '-map',
    '0:v:0',
    '-map',
    '0:a:0',
    '-c',
    'copy',
    '-f',
    'dash',
    '-seg_duration',
    '1',
    '-use_template',
    '1',
    '-use_timeline',
    '1',
    '-adaptation_sets',
    'id=0,streams=v id=1,streams=a',
    'manifest.mpd',
  ]);
  await runTool(ffmpeg.path, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-y',
    '-i',
    'fixture.mp4',
    '-vn',
    '-c:a',
    'copy',
    'audio.m4a',
  ]);

  const files = new Map(
    (await readdir(source)).map((name) => [`/${name}`, path.join(source, name)]),
  );
  const requests = [];
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      requests.push({ path: url.pathname, method: request.method });
      if (url.pathname === '/playlist.html' && ['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(
          request.method === 'HEAD'
            ? undefined
            : '<html><head><title>Owned playlist</title></head><body>' +
                '<video controls src="/fixture.mp4?alias=playlist-one"></video>' +
                '<video controls src="/fixture.mp4?alias=playlist-two"></video></body></html>',
        );
        return;
      }
      const filename = files.get(decodeURIComponent(url.pathname));
      if (!filename || !['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(404).end();
        return;
      }
      const { size } = await stat(filename);
      let start = 0,
        end = size - 1;
      if (request.headers.range) {
        const match = /^bytes=(\d+)-(\d*)$/u.exec(request.headers.range);
        if (!match) {
          response.writeHead(416).end();
          return;
        }
        start = Number(match[1]);
        end = match[2] ? Math.min(Number(match[2]), end) : end;
        if (start > end || start >= size) {
          response.writeHead(416).end();
          return;
        }
      }
      const type = filename.endsWith('.mpd')
        ? 'application/dash+xml'
        : filename.endsWith('.m4a')
          ? 'audio/mp4'
          : 'video/mp4';
      response.writeHead(request.headers.range ? 206 : 200, {
        'Content-Type': type,
        'Content-Length': end - start + 1,
        'Accept-Ranges': 'bytes',
        ...(request.headers.range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
      });
      if (request.method === 'HEAD') response.end();
      else
        createReadStream(filename, { start, end })
          .on('error', () => response.destroy())
          .pipe(response);
    } catch {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function download(url, folder, options = {}) {
    const events = [];
    const result = await ytdlp.downloadVideo(url, folder, options, (event) => events.push(event), {
      signal: controller.signal,
    });
    assert.equal(result.success, true, result.error || 'Download did not succeed.');
    assert(
      (await stat(result.filepath)).isFile(),
      'Final output must be an existing regular file.',
    );
    assert.equal(path.dirname(await realpath(result.filepath)), await realpath(folder));
    assert.equal(
      result.integrity?.status,
      'verified',
      'Completion must include ffprobe verification.',
    );
    assert(result.integrity.size > 0 && result.integrity.streams.length > 0);
    return { ...result, events };
  }
  async function streamTypes(filename) {
    const { stdout } = await runTool(ffprobe.path, [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type',
      '-of',
      'json',
      filename,
    ]);
    return JSON.parse(stdout)
      .streams.map((stream) => stream.codec_type)
      .sort();
  }

  const url = `${base}/fixture.mp4?literal=one&second=two`;
  const playlist = await ytdlp.fetchPlaylist(
    `${base}/playlist.html`,
    {},
    {
      signal: controller.signal,
    },
  );
  assert.equal(playlist.title, 'Owned playlist');
  assert.equal(playlist.entries.length, 2);
  assert.equal(playlist.hasMore, false);
  assert.deepEqual(
    playlist.entries.map((entry) => ({
      index: entry.index,
      url: entry.url,
      available: entry.available,
    })),
    [
      { index: 1, url: `${base}/fixture.mp4?alias=playlist-one`, available: true },
      { index: 2, url: `${base}/fixture.mp4?alias=playlist-two`, available: true },
    ],
  );
  assert(
    requests.every((request) => request.path === '/playlist.html' || request.method === 'HEAD'),
    'Flat playlist preview must not download the media fixtures.',
  );
  const secondPage = await ytdlp.fetchPlaylist(
    `${base}/playlist.html`,
    {},
    {
      signal: controller.signal,
      start: 2,
      pageSize: 1,
    },
  );
  assert.equal(secondPage.start, 2);
  assert.equal(secondPage.pageSize, 1);
  assert.equal(secondPage.hasMore, false);
  assert.deepEqual(
    secondPage.entries.map((entry) => entry.index),
    [2],
  );
  assert.equal(secondPage.entries[0].url, `${base}/fixture.mp4?alias=playlist-two`);
  assert(
    requests.every((request) => request.path === '/playlist.html' || request.method === 'HEAD'),
    'Paging a flat playlist must not download its media.',
  );
  const metadata = await ytdlp.fetchMetadata(url, {}, { signal: controller.signal });
  assert(metadata.title && metadata.id, 'Metadata preview should return a title and source ID.');
  // Generic direct-file metadata can omit codec details; verify actual streams below.
  const progressiveFormat = metadata.formats[0];
  assert(progressiveFormat?.formatId, 'The progressive fixture must expose a concrete format ID.');
  const exactProgressive = await download(url, output, { formatId: progressiveFormat.formatId });
  assert.deepEqual(await streamTypes(exactProgressive.filepath), ['audio', 'video']);
  const first = await download(url, output);
  assert.notEqual(
    exactProgressive.filepath,
    first.filepath,
    'Exact formats have a distinct output profile.',
  );
  assert.deepEqual(await streamTypes(first.filepath), ['audio', 'video']);
  const before = await stat(first.filepath),
    originalHash = await hashFile(first.filepath);
  const repeated = await download(url, output);
  assert.equal(
    repeated.filepath,
    first.filepath,
    'Already-downloaded results must report the final path again.',
  );
  assert.equal(await hashFile(repeated.filepath), originalHash);
  assert.equal(
    (await stat(repeated.filepath)).mtimeMs,
    before.mtimeMs,
    'Existing complete files must not be overwritten.',
  );
  const aliases = await Promise.all([
    download(`${base}/fixture.mp4?alias=a`, output),
    download(`${base}/fixture.mp4?alias=b`, output),
  ]);
  assert.notEqual(aliases[0].filepath, aliases[1].filepath);
  for (const alias of aliases) {
    assert.match(path.basename(alias.filepath), /\[best-[a-f0-9]{16}\]/u);
    assert.equal(await hashFile(alias.filepath), originalHash);
    assert.deepEqual(await streamTypes(alias.filepath), ['audio', 'video']);
  }

  const dashMetadata = await ytdlp.fetchMetadata(
    `${base}/manifest.mpd`,
    {},
    { signal: controller.signal },
  );
  const videoFormat = dashMetadata.formats.find((format) => format.hasVideo && !format.hasAudio);
  const audioFormat = dashMetadata.formats.find((format) => format.hasAudio && !format.hasVideo);
  assert(videoFormat && audioFormat, 'DASH must expose separate video and audio format IDs.');
  const exactDash = await download(`${base}/manifest.mpd`, output, {
    formatId: `${videoFormat.formatId}+${audioFormat.formatId}`,
  });
  assert.deepEqual(await streamTypes(exactDash.filepath), ['audio', 'video']);
  const merged = await download(`${base}/manifest.mpd`, output);
  assert.deepEqual(await streamTypes(merged.filepath), ['audio', 'video']);
  assert(
    merged.events.some((event) => event.status === 'merging'),
    'A separate-stream download should report its postprocessing phase.',
  );
  assert(
    !/\.f\d+\./u.test(path.basename(merged.filepath)),
    'Do not return an intermediate stream filename.',
  );
  const audioOriginal = await download(`${base}/audio.m4a`, output, { quality: 'audio' });
  assert.deepEqual(await streamTypes(audioOriginal.filepath), ['audio']);
  const convertedFolder = path.join(output, 'MP3 conversion');
  await mkdir(convertedFolder);
  const audioConverted = await download(`${base}/audio.m4a`, convertedFolder, {
    quality: 'audio',
    audioFormat: 'mp3',
  });
  assert.equal(path.extname(audioConverted.filepath), '.mp3');
  assert.deepEqual(await streamTypes(audioConverted.filepath), ['audio']);

  console.log(
    JSON.stringify(
      {
        passed: [
          'flat-playlist-without-media-downloads',
          'playlist-second-page',
          'exact-progressive-format',
          'exact-dash-video-audio-formats',
          'ffprobe-integrity',
          'metadata',
          'progressive',
          'already-downloaded',
          'parallel-alias-isolation',
          'dash-merge',
          'original-audio',
          'mp3-conversion',
          'unicode-space-percent-folder',
        ],
        tools: { ytdlp: yt.version, ffmpeg: ffmpeg.version },
        network: '127.0.0.1 only',
      },
      null,
      2,
    ),
  );
} finally {
  clearTimeout(deadline);
  controller.abort();
  if (server?.listening) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await removeFixtures();
}
