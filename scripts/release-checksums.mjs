import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
const directory = path.resolve(process.argv[2] || 'artifacts');
const files = (await fs.readdir(directory, { withFileTypes: true }))
  .filter(
    (entry) => entry.isFile() && /\.(exe|dmg|zip|AppImage|deb|blockmap|yml)$/.test(entry.name),
  )
  .map((entry) => entry.name)
  .sort();
if (files.length < 6)
  throw new Error('Expected all three platforms before generating release checksums.');
const lines = [];
for (const name of files) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path.join(directory, name))) hash.update(chunk);
  lines.push(`${hash.digest('hex')}  ${name}`);
}
await fs.writeFile(path.join(directory, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
console.log(`Generated checksums for ${files.length} release assets.`);
