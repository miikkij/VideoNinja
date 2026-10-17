import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { compareVersions, parseVersion, readReleaseNotes } from './release-notes.mjs';

const script = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(script), '..');

export function nextVersion(current, requested) {
  const parts = parseVersion(current);
  const index = ['major', 'minor', 'patch'].indexOf(requested);
  let target = requested;
  if (index !== -1) {
    parts[index]++;
    for (let lower = index + 1; lower < parts.length; lower++) parts[lower] = 0;
    target = parts.join('.');
  }
  if (compareVersions(target, current) <= 0)
    throw new Error(`Version must advance beyond ${current}; received ${target}.`);
  return target;
}

/** Change only the package version after its bilingual release notes are ready. */
export function bumpVersion({ root = projectRoot, target, fsImpl = fs } = {}) {
  const filename = path.join(root, 'package.json');
  const stat = fsImpl.lstatSync(filename);
  if (!stat.isFile() || stat.size === 0 || stat.size > 1024 * 1024)
    throw new Error('package.json must be a nonempty regular file of at most 1 MiB.');
  const original = fsImpl.readFileSync(filename, 'utf8');
  const pkg = JSON.parse(original);
  const version = nextVersion(pkg.version, target);
  readReleaseNotes(root, version);

  // Retain the existing indentation, line endings and every unrelated package field.
  let replacements = 0;
  const updated = original.replace(
    /("version"\s*:\s*")([^"\\]*)(")/g,
    (match, prefix, old, suffix) => {
      if (old !== pkg.version) return match;
      replacements++;
      return `${prefix}${version}${suffix}`;
    },
  );
  const parsed = JSON.parse(updated);
  if (
    replacements !== 1 ||
    parsed.version !== version ||
    JSON.stringify({ ...parsed, version: pkg.version }) !== JSON.stringify(pkg)
  ) {
    throw new Error('Cannot safely locate the unique package version field.');
  }

  const temporary = path.join(root, `.package.json.version-${randomUUID()}.tmp`);
  let owned = false;
  try {
    const descriptor = fsImpl.openSync(temporary, 'wx', stat.mode);
    owned = true;
    try {
      fsImpl.writeFileSync(descriptor, updated, 'utf8');
      fsImpl.fsyncSync(descriptor);
    } finally {
      fsImpl.closeSync(descriptor);
    }
    if (fsImpl.readFileSync(filename, 'utf8') !== original)
      throw new Error('package.json changed during versioning; retry after reviewing the changes.');
    fsImpl.renameSync(temporary, filename);
    owned = false;
  } finally {
    if (owned) fsImpl.unlinkSync(temporary);
  }
  return { previous: pkg.version, version };
}

if (
  process.argv[1] &&
  fs.existsSync(process.argv[1]) &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(script)
) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1) throw new Error('Usage: pnpm version:next patch|minor|major|x.y.z');
    const result = bumpVersion({ target: args[0] });
    console.log(`Application version advanced from ${result.previous} to ${result.version}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
