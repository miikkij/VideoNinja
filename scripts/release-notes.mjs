import fs from 'node:fs';
import path from 'node:path';

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MAX_BYTES = 1024 * 1024;

export function parseVersion(value) {
  const match = typeof value === 'string' && VERSION.exec(value);
  const parts = match && match.slice(1).map(Number);
  if (!parts || parts.some((part) => !Number.isSafeInteger(part)))
    throw new Error('A stable x.y.z version without leading zeroes is required.');
  return parts;
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateReleaseNotes(value, expectedVersion) {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.releases) ||
    value.releases.length < 1 ||
    value.releases.length > 100
  ) {
    throw new Error('Release notes require schemaVersion 1 and 1–100 releases.');
  }
  let previous;
  for (const release of value.releases) {
    if (!record(release)) throw new Error('Invalid release notes entry.');
    parseVersion(release.version);
    if (previous && compareVersions(previous, release.version) <= 0)
      throw new Error('Release notes versions must be unique and ordered newest first.');
    previous = release.version;
    const date =
      typeof release.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(release.date)
        ? new Date(`${release.date}T00:00:00.000Z`)
        : null;
    if (
      !date ||
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== release.date
    )
      throw new Error(`Release ${release.version} requires a valid YYYY-MM-DD date.`);
    for (const language of ['en', 'fi']) {
      const notes = record(release.notes) && release.notes[language];
      if (
        !Array.isArray(notes) ||
        notes.length < 1 ||
        notes.length > 20 ||
        notes.some((note) => typeof note !== 'string' || !note.trim() || note.trim().length > 600)
      ) {
        throw new Error(
          `Release ${release.version} requires 1–20 nonempty ${language} notes of at most 600 characters each.`,
        );
      }
    }
  }
  if (expectedVersion !== undefined) {
    parseVersion(expectedVersion);
    if (value.releases[0].version !== expectedVersion)
      throw new Error(`Latest release notes must describe version ${expectedVersion}.`);
  }
  return value;
}

export function readReleaseNotes(root, expectedVersion) {
  const filename = path.join(root, 'src', 'shared', 'releaseNotes.json');
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_BYTES)
    throw new Error('Release notes must be a nonempty regular JSON file of at most 1 MiB.');
  return validateReleaseNotes(JSON.parse(fs.readFileSync(filename, 'utf8')), expectedVersion);
}
