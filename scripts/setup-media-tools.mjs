import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createCiToolFetch } from './ci-tool-fetch.mjs';
const require = createRequire(import.meta.url);
const { createToolManager } = require('../src/main/toolManager.js');
if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.GITHUB_ENV)
  throw new Error('This helper is only for disposable GitHub runners.');
const managedDir = path.resolve('.tools', 'ci-media');
process.env.VIDEONINJA_TOOLS_DIR = managedDir;
const manager = createToolManager({
  managedDir,
  fetch: createCiToolFetch(process.env.GITHUB_TOKEN),
});
console.log('Installing checksum-verified yt-dlp for generated local-media tests.');
await manager.install('yt-dlp');
if (process.platform !== 'darwin') await manager.install('ffmpeg');
await fs.appendFile(process.env.GITHUB_ENV, `VIDEONINJA_TOOLS_DIR=${managedDir}\n`);
console.log('Managed media tools are ready. macOS uses its Homebrew ffmpeg package.');
