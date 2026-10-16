import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../scripts/verify-release.mjs', import.meta.url));
const version = '1.2.3';
const expected =
  process.platform === 'win32'
    ? ['VideoNinja Setup 1.2.3.exe', 'VideoNinja 1.2.3.exe']
    : process.platform === 'darwin'
      ? ['VideoNinja-1.2.3.dmg', 'VideoNinja-1.2.3-mac.zip']
      : ['VideoNinja-1.2.3.AppImage', 'video-ninja_1.2.3_amd64.deb'];

describe('release verifier CLI', () => {
  let fixture;

  beforeEach(() => {
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'videoninja-release-test-'));
    fs.mkdirSync(path.join(fixture, 'scripts'));
    fs.mkdirSync(path.join(fixture, 'dist'));
    fs.copyFileSync(source, path.join(fixture, 'scripts', 'verify-release.mjs'));
    fs.writeFileSync(
      path.join(fixture, 'package.json'),
      JSON.stringify({ name: 'video-ninja', version }),
    );
  });

  afterEach(() => {
    const resolved = fs.realpathSync(fixture);
    const temporaryRoot = fs.realpathSync(os.tmpdir());
    if (
      path.dirname(resolved) !== temporaryRoot ||
      !path.basename(resolved).startsWith('videoninja-release-test-')
    ) {
      throw new Error('Refusing to clean outside the test-owned temporary directory.');
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  });

  function run(args = [], env = {}) {
    return spawnSync(
      process.execPath,
      [path.join(fixture, 'scripts', 'verify-release.mjs'), ...args],
      {
        cwd: fixture,
        env: { ...process.env, GITHUB_REF_TYPE: '', GITHUB_REF_NAME: '', RELEASE_TAG: '', ...env },
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        timeout: 10000,
      },
    );
  }

  function artifacts(names = expected) {
    for (const name of names) fs.writeFileSync(path.join(fixture, 'dist', name), 'fixture');
  }

  it('accepts local checks and exact matching tags', () => {
    expect(run().status).toBe(0);
    expect(run([], { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v1.2.3' }).status).toBe(0);
    expect(run([], { RELEASE_TAG: 'v1.2.3' }).status).toBe(0);
  });

  it('rejects mismatched tags before considering artifacts', () => {
    artifacts();
    const result = run(['--artifacts'], { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v1.2.4' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Release tag must be v1.2.3');
  });

  it('accepts the full native artifact set', () => {
    artifacts();
    expect(run(['--artifacts']).status).toBe(0);
  });

  it('accepts architecture suffixes used by native packages', () => {
    artifacts(expected.map((name) => name.replaceAll(version, version + '-arm64')));
    expect(run(['--artifacts']).status).toBe(0);
  });

  it.each([0, 1])('rejects a missing required installer or archive at index %s', (omitted) => {
    artifacts(expected.filter((_, index) => index !== omitted));
    const result = run(['--artifacts']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Missing');
  });

  it('rejects stale artifacts from a different version', () => {
    artifacts(expected.map((name) => name.replaceAll(version, '0.9.0')));
    expect(run(['--artifacts']).status).toBe(1);
  });

  it.each(['21.2.3', '1.2.30', '1.2.3.4', '1.2.3-beta.1'])(
    'rejects a misleading version substring in %s',
    (wrongVersion) => {
      artifacts(expected.map((name) => name.replaceAll(version, wrongVersion)));
      expect(run(['--artifacts']).status).toBe(1);
    },
  );

  it('rejects directories and empty files masquerading as package artifacts', () => {
    for (const name of expected) fs.mkdirSync(path.join(fixture, 'dist', name));
    expect(run(['--artifacts']).status).toBe(1);
  });

  it('rejects empty package files', () => {
    for (const name of expected) fs.writeFileSync(path.join(fixture, 'dist', name), '');
    expect(run(['--artifacts']).status).toBe(1);
  });
});
