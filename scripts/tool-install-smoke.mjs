import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import toolManager from '../src/main/toolManager.js';
import tools from '../src/main/tools.js';

// This explicitly requested integration check uses only this ignored repository
// directory. It never installs into the normal application profile or global PATH.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const managedDir = path.join(root, '.tools', 'tool-install-smoke');
const service = tools.createToolService({ managedDir });
const manager = toolManager.createToolManager({ managedDir, tools: service });
const installed = [];
for (const tool of ['yt-dlp', 'runtime', 'ffmpeg']) {
  const result = await manager.install(tool);
  assert.equal(
    result.status,
    'installed',
    `Managed ${tool} is unavailable on this platform; use the documented guide.`,
  );
  installed.push({ tool, version: result.version, sha256: result.sha256 });
  console.log(`Installed and probed isolated ${tool}: ${result.version}`);
}
const report = await manager.diagnose();
for (const tool of [report.ytdlp, report.ffmpeg, report.ffprobe]) {
  assert.equal(tool.available, true);
  const relative = path.relative(managedDir, tool.path);
  assert.equal(path.isAbsolute(relative) || relative.startsWith('..'), false);
}
assert.equal(report.ytdlp.jsRuntimes[0]?.name, 'deno');
assert.equal(report.ejs.status, 'compatible');
console.log(
  JSON.stringify(
    {
      installed,
      ejs: report.ejs,
      versions: {
        ytdlp: report.ytdlp.version,
        ffmpeg: report.ffmpeg.version,
        ffprobe: report.ffprobe.version,
        runtime: report.ytdlp.jsRuntimes[0].version,
      },
      managedDirectory: '.tools/tool-install-smoke',
    },
    null,
    2,
  ),
);
