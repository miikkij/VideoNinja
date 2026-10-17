import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bumpVersion, nextVersion } from '../../scripts/version.mjs';
import { readReleaseNotes, validateReleaseNotes } from '../../scripts/release-notes.mjs';

const scriptDirectory = fileURLToPath(new URL('../../scripts/', import.meta.url));
const release = (version = '1.2.4', date = '2026-10-18') => ({
  version,
  date,
  notes: { en: ['Preserve paused jobs.'], fi: ['Säilytä keskeytetyt lataukset.'] },
});
const notes = (...releases) => ({ schemaVersion: 1, releases });

describe('version workflow', () => {
  let fixture;
  let packagePath;
  let notesPath;
  let original;
  const writeNotes = (value) => fs.writeFileSync(notesPath, JSON.stringify(value));
  const bump = (target = 'patch', fsImpl = fs) => bumpVersion({ root: fixture, target, fsImpl });

  beforeEach(() => {
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'videoninja-version-test-'));
    packagePath = path.join(fixture, 'package.json');
    notesPath = path.join(fixture, 'src', 'shared', 'releaseNotes.json');
    fs.mkdirSync(path.dirname(notesPath), { recursive: true });
    original = `${JSON.stringify(
      {
        name: 'video-ninja',
        version: '1.2.3',
        dependencies: { example: '^1.2.3' },
        scripts: { test: 'vitest run' },
      },
      null,
      2,
    )}\n`.replaceAll('\n', '\r\n');
    fs.writeFileSync(packagePath, original);
    writeNotes(notes(release(), release('1.2.3')));
  });

  afterEach(() => {
    const resolved = fs.realpathSync(fixture);
    if (
      path.dirname(resolved) !== fs.realpathSync(os.tmpdir()) ||
      !path.basename(resolved).startsWith('videoninja-version-test-')
    )
      throw new Error('Refusing to clean outside the test-owned temporary directory.');
    fs.rmSync(resolved, { recursive: true, force: true });
  });

  it.each([
    ['patch', '1.2.4'],
    ['minor', '1.3.0'],
    ['major', '2.0.0'],
    ['2.4.6', '2.4.6'],
  ])('advances %s only when matching notes exist', (target, expected) => {
    writeNotes(notes(release(expected), release('1.2.3')));
    const unchangedNotes = fs.readFileSync(notesPath, 'utf8');
    expect(bump(target)).toEqual({ previous: '1.2.3', version: expected });
    expect(fs.readFileSync(packagePath, 'utf8')).toBe(
      original.replace('"version": "1.2.3"', `"version": "${expected}"`),
    );
    expect(fs.readFileSync(notesPath, 'utf8')).toBe(unchangedNotes);
    expect(fs.readdirSync(fixture).sort()).toEqual(['package.json', 'src']);
  });

  it.each(['1.2.3', '1.2.2', '0.9.0'])('refuses reused or older version %s', (target) => {
    expect(() => bump(target)).toThrow('Version must advance');
    expect(fs.readFileSync(packagePath, 'utf8')).toBe(original);
  });

  it.each([
    '01.3.0',
    '1.03.0',
    '1.3.00',
    'v1.3.0',
    '1.3',
    '1.3.0-beta.1',
    '1.3.0+build',
    '9007199254740992.0.0',
    '',
    undefined,
  ])('rejects malformed or unsupported version %s', (target) => {
    expect(() => bumpVersion({ root: fixture, target })).toThrow('stable x.y.z');
    expect(fs.readFileSync(packagePath, 'utf8')).toBe(original);
  });

  it('rejects an overflowing version increment', () => {
    expect(() => nextVersion('1.2.9007199254740991', 'patch')).toThrow('stable x.y.z');
  });

  it('does not write when the prepared notes describe a different target', () => {
    expect(() => bump('minor')).toThrow('Latest release notes must describe version 1.3.0');
    expect(fs.readFileSync(packagePath, 'utf8')).toBe(original);
  });

  it('leaves the original package intact and removes only its temporary file if replacement fails', () => {
    expect(() =>
      bump('patch', {
        ...fs,
        renameSync: () => {
          throw new Error('replacement denied');
        },
      }),
    ).toThrow('replacement denied');
    expect(fs.readFileSync(packagePath, 'utf8')).toBe(original);
    expect(fs.readdirSync(fixture).sort()).toEqual(['package.json', 'src']);
  });

  it('refuses to overwrite a concurrent package edit', () => {
    const changed = original.replace('video-ninja', 'reviewed-name');
    const fsImpl = {
      ...fs,
      writeFileSync(filename, value, options) {
        fs.writeFileSync(filename, value, options);
        fs.writeFileSync(packagePath, changed);
      },
    };
    expect(() => bump('patch', fsImpl)).toThrow('changed during versioning');
    expect(fs.readFileSync(packagePath, 'utf8')).toBe(changed);
    expect(fs.readdirSync(fixture).sort()).toEqual(['package.json', 'src']);
  });

  it('cleans a partially written temporary file without touching the package', () => {
    const fsImpl = {
      ...fs,
      writeFileSync(descriptor) {
        fs.writeFileSync(descriptor, 'partial');
        throw new Error('disk full');
      },
    };
    expect(() => bump('patch', fsImpl)).toThrow('disk full');
    expect(fs.readFileSync(packagePath, 'utf8')).toBe(original);
    expect(fs.readdirSync(fixture).sort()).toEqual(['package.json', 'src']);
  });

  it('refuses ambiguous version fields instead of changing nested metadata', () => {
    const pkg = JSON.parse(original);
    pkg.custom = { version: pkg.version };
    const ambiguous = JSON.stringify(pkg);
    fs.writeFileSync(packagePath, ambiguous);
    expect(() => bump()).toThrow('unique package version field');
    expect(fs.readFileSync(packagePath, 'utf8')).toBe(ambiguous);
  });

  it('runs the standalone CLI before installing any dependencies', () => {
    const scripts = path.join(fixture, 'scripts');
    fs.mkdirSync(scripts);
    for (const name of ['version.mjs', 'release-notes.mjs'])
      fs.copyFileSync(path.join(scriptDirectory, name), path.join(scripts, name));
    const run = (...args) =>
      spawnSync(process.execPath, [path.join(scripts, 'version.mjs'), ...args], {
        cwd: fixture,
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        timeout: 10000,
      });
    expect(run().stderr).toContain('Usage:');
    expect(run('patch', 'extra').status).toBe(1);
    const success = run('patch');
    expect(success.status).toBe(0);
    expect(success.stdout).toContain('from 1.2.3 to 1.2.4');
    expect(run('1.2.4').status).toBe(1);
  });

  it('enforces the source notes file size limit', () => {
    fs.writeFileSync(notesPath, ' '.repeat(1024 * 1024 + 1));
    expect(() => readReleaseNotes(fixture)).toThrow('at most 1 MiB');
  });
});

describe('bilingual release notes schema', () => {
  it('accepts real calendar dates and different bilingual bullet counts', () => {
    const entry = release('1.2.4', '2024-02-29');
    entry.notes.fi.push('Säilytä myös keskeneräiset tiedostot.');
    expect(validateReleaseNotes(notes(entry), '1.2.4').releases).toEqual([entry]);
  });

  it.each(['2026-02-29', '2026-04-31', '2026-13-01', '2026-10-18T00:00:00Z', '', null])(
    'rejects invalid date %s',
    (date) => {
      expect(() => validateReleaseNotes(notes(release('1.2.4', date)))).toThrow('valid YYYY-MM-DD');
    },
  );

  it.each([
    null,
    {},
    { schemaVersion: 2, releases: [release()] },
    notes(),
    notes(...Array(101).fill(release())),
  ])('rejects invalid document structure %#', (document) => {
    expect(() => validateReleaseNotes(document)).toThrow('schemaVersion 1');
  });

  it.each([
    [release(), release()],
    [release('1.2.3'), release()],
  ])('rejects duplicate or ascending versions %#', (...entries) => {
    expect(() => validateReleaseNotes(notes(...entries))).toThrow(
      'unique and ordered newest first',
    );
  });

  it.each(['en', 'fi'])('requires meaningful bounded %s notes', (language) => {
    for (const value of [
      undefined,
      [],
      [''],
      ['   '],
      [false],
      Array(21).fill('A change.'),
      ['x'.repeat(601)],
    ]) {
      const entry = release();
      entry.notes[language] = value;
      expect(() => validateReleaseNotes(notes(entry))).toThrow(`${language} notes`);
    }
  });

  it.each(['en', 'fi'])(
    'accepts exactly 20 %s notes with 600 trimmed characters each',
    (language) => {
      const entry = release();
      entry.notes[language] = Array(20).fill(`  ${'x'.repeat(600)}  `);
      expect(validateReleaseNotes(notes(entry)).releases[0].notes[language]).toHaveLength(20);
    },
  );
});
