import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyRelease } from '../../scripts/verify-release.mjs';

const source = fileURLToPath(new URL('../../scripts/verify-release.mjs', import.meta.url));
const version = '1.2.3';
const hash = (value) => createHash('sha512').update(value).digest('base64');

describe('release verifier', () => {
  let fixture;
  const dist = () => path.join(fixture, 'dist');
  const check = (options = {}) =>
    verifyRelease({
      root: fixture,
      platform: 'win32',
      arch: 'x64',
      artifacts: true,
      env: {},
      ...options,
    });
  const write = (filename, value) => {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, value);
  };
  const json = (filename, value) => write(filename, JSON.stringify(value));

  beforeEach(() => {
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'videoninja-release-test-'));
    fs.mkdirSync(dist());
    json(path.join(fixture, 'package.json'), {
      name: 'video-ninja',
      version,
      repository: { url: 'https://github.com/miikkij/VideoNinja.git' },
      build: { productName: 'VideoNinja' },
    });
  });

  afterEach(() => {
    const resolved = fs.realpathSync(fixture);
    const temporaryRoot = fs.realpathSync(os.tmpdir());
    if (
      path.dirname(resolved) !== temporaryRoot ||
      !path.basename(resolved).startsWith('videoninja-release-test-')
    )
      throw new Error('Refusing to clean outside the test-owned temporary directory.');
    fs.rmSync(resolved, { recursive: true, force: true });
  });

  function complete(platform = 'win32', arch = 'x64', { signed = false } = {}) {
    const names =
      platform === 'win32'
        ? [`VideoNinja-Setup-${version}-${arch}.exe`, `VideoNinja-Portable-${version}-${arch}.exe`]
        : platform === 'darwin'
          ? [`VideoNinja-${version}-mac-${arch}.dmg`, `VideoNinja-${version}-mac-${arch}.zip`]
          : [
              `VideoNinja-${version}-linux-${arch}.AppImage`,
              `VideoNinja-${version}-linux-${arch}.deb`,
            ];
    names.forEach((name, index) =>
      write(path.join(dist(), name), `fixture media package ${index}`),
    );
    const updateName = names[platform === 'darwin' ? 1 : 0];
    const contents = fs.readFileSync(path.join(dist(), updateName));
    const manifest = {
      version,
      files: [{ url: updateName, size: contents.length, sha512: hash(contents) }],
      path: updateName,
      sha512: hash(contents),
    };
    const manifestFile = path.join(
      dist(),
      platform === 'win32'
        ? 'latest.yml'
        : platform === 'darwin'
          ? 'latest-mac.yml'
          : `latest-linux${arch === 'x64' ? '' : arch === 'armv7l' ? '-arm' : `-${arch}`}.yml`,
    );
    json(manifestFile, manifest); // JSON is a strict YAML subset; separate tests exercise builder YAML.
    const unpacked =
      platform === 'win32'
        ? 'win-unpacked'
        : platform === 'darwin'
          ? `mac-${arch}`
          : arch === 'x64'
            ? 'linux-unpacked'
            : `linux-${arch}-unpacked`;
    const resources =
      platform === 'darwin'
        ? path.join(dist(), unpacked, 'VideoNinja.app', 'Contents', 'Resources')
        : path.join(dist(), unpacked, 'resources');
    const publish = { provider: 'github', owner: 'miikkij', repo: 'VideoNinja' };
    const policy = {
      signed,
      automatic: platform === 'linux' || signed,
      publisherName: signed && platform === 'win32' ? 'VideoNinja Publisher' : null,
    };
    if (signed && platform === 'win32') publish.publisherName = ['VideoNinja Publisher'];
    json(path.join(resources, 'app-update.yml'), publish);
    json(path.join(resources, 'update-policy.json'), policy);
    return { names, manifest, manifestFile, resources, publish, policy };
  }

  function runVersion(env = {}, throughDirectoryLink = false) {
    const filename = path.join(fixture, 'scripts', 'verify-release.mjs');
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.copyFileSync(source, filename);
    let entry = filename;
    if (throughDirectoryLink) {
      const link = path.join(fixture, 'linked-scripts');
      if (!fs.existsSync(link))
        fs.symlinkSync(
          path.dirname(filename),
          link,
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      entry = path.join(link, path.basename(filename));
    }
    return spawnSync(process.execPath, [entry], {
      cwd: fixture,
      env: { ...process.env, GITHUB_REF_TYPE: '', GITHUB_REF_NAME: '', RELEASE_TAG: '', ...env },
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 10000,
    });
  }

  it('keeps the pre-install version CLI independent of node_modules', () => {
    expect(runVersion().status).toBe(0);
    expect(runVersion({ GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: `v${version}` }).status).toBe(0);
    expect(runVersion({ RELEASE_TAG: `v${version}` }).status).toBe(0);
    const wrong = runVersion({ RELEASE_TAG: 'v1.2.4' });
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toContain(`Release tag must be v${version}`);
  });

  it('executes the CLI and rejects a wrong tag when its entry directory is a symlink or junction', () => {
    const valid = runVersion({}, true);
    expect(valid.status).toBe(0);
    expect(valid.stdout).toContain(`Release metadata verified for ${version}.`);
    const wrong = runVersion({ RELEASE_TAG: 'v1.2.4' }, true);
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toContain(`Release tag must be v${version}`);
  });

  it('rejects mismatched tags before looking for artifacts', async () => {
    await expect(
      check({ env: { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v1.2.4' } }),
    ).rejects.toThrow(`Release tag must be v${version}`);
  });

  it.each(['win32', 'darwin', 'linux'])(
    'accepts valid unsigned %s packages and their platform update metadata',
    async (platform) => {
      complete(platform);
      await expect(check({ platform })).resolves.toBe(version);
    },
  );

  it.each(['win32', 'darwin'])('accepts a consistent signed %s update policy', async (platform) => {
    complete(platform, 'x64', { signed: true });
    await expect(check({ platform })).resolves.toBe(version);
  });

  it.each(['arm64', 'armv7l'])(
    'requires the correct Linux %s updater manifest name',
    async (arch) => {
      const build = complete('linux', arch);
      await expect(check({ platform: 'linux', arch })).resolves.toBe(version);
      fs.renameSync(build.manifestFile, path.join(dist(), 'latest-linux.yml'));
      await expect(check({ platform: 'linux', arch })).rejects.toThrow(
        /latest-linux-(arm64|arm)\.yml/,
      );
    },
  );

  it('parses real builder YAML and matches only its ASCII-space-to-hyphen asset aliases', async () => {
    const build = complete();
    const original = `VideoNinja Setup ${version}.exe`,
      safe = original.replaceAll(' ', '-');
    fs.renameSync(path.join(dist(), build.names[0]), path.join(dist(), original));
    const digest = build.manifest.sha512,
      size = build.manifest.files[0].size;
    write(
      build.manifestFile,
      `version: ${version}\nfiles:\n  - url: ${safe}\n    sha512: ${digest}\n    size: ${size}\npath: ${safe}\nsha512: ${digest}\nreleaseDate: '2026-10-16T18:00:00Z'\n`,
    );
    await expect(check()).resolves.toBe(version);
    write(path.join(dist(), safe), fs.readFileSync(path.join(dist(), original)));
    await expect(check()).rejects.toThrow('ambiguous');
  });

  it.each([0, 1])('rejects a missing required package at index %s', async (index) => {
    const build = complete();
    fs.unlinkSync(path.join(dist(), build.names[index]));
    await expect(check()).rejects.toThrow('Missing');
  });

  it.each(['0.9.0', '21.2.3', '1.2.30', '1.2.3.4', '1.2.3-beta.1'])(
    'rejects stale or misleading artifact version %s',
    async (wrongVersion) => {
      const build = complete();
      for (const name of build.names)
        fs.renameSync(
          path.join(dist(), name),
          path.join(dist(), name.replace(version, wrongVersion)),
        );
      await expect(check()).rejects.toThrow('Missing');
    },
  );

  it.each(['directory', 'empty'])('rejects a %s masquerading as a package', async (kind) => {
    const build = complete();
    const file = path.join(dist(), build.names[0]);
    fs.unlinkSync(file);
    if (kind === 'directory') fs.mkdirSync(file);
    else write(file, '');
    await expect(check()).rejects.toThrow('Missing');
  });

  it.each(['win32', 'darwin', 'linux'])(
    'rejects missing %s update metadata even when packages exist',
    async (platform) => {
      const build = complete(platform);
      fs.unlinkSync(build.manifestFile);
      await expect(check({ platform })).rejects.toThrow(/latest.*\.yml/);
    },
  );

  it('rejects a manifest whose version does not match source package.json', async () => {
    const build = complete();
    build.manifest.version = '1.2.2';
    json(build.manifestFile, build.manifest);
    await expect(check()).rejects.toThrow('manifest version');
  });

  it('rejects a modified package even when its length did not change', async () => {
    const build = complete();
    write(path.join(dist(), build.names[0]), 'X'.repeat(build.manifest.files[0].size));
    await expect(check()).rejects.toThrow('SHA512 mismatch');
  });

  it('rejects a wrong declared size', async () => {
    const build = complete();
    build.manifest.files[0].size++;
    json(build.manifestFile, build.manifest);
    await expect(check()).rejects.toThrow('size mismatch');
  });

  it.each([
    '../outside.exe',
    '%2e%2e%2foutside.exe',
    'https://evil.invalid/update.exe',
    'missing-1.2.3.exe',
  ])('rejects unsafe or absent update file reference %s', async (url) => {
    const build = complete();
    build.manifest.files[0].url = url;
    json(build.manifestFile, build.manifest);
    await expect(check()).rejects.toThrow(/local filename|Missing or ambiguous/);
  });

  it('rejects duplicate references and inconsistent legacy hashes', async () => {
    const build = complete();
    build.manifest.files.push({ ...build.manifest.files[0] });
    json(build.manifestFile, build.manifest);
    await expect(check()).rejects.toThrow('Duplicate');
    build.manifest.files.pop();
    build.manifest.sha512 = hash('other');
    json(build.manifestFile, build.manifest);
    await expect(check()).rejects.toThrow('Legacy');
  });

  it.each(['app-update.yml', 'update-policy.json'])('requires packaged %s', async (name) => {
    const build = complete();
    fs.unlinkSync(path.join(build.resources, name));
    await expect(check()).rejects.toThrow(name);
  });

  it('rejects packaged updates pointing at a different repository', async () => {
    const build = complete();
    build.publish.repo = 'Other';
    json(path.join(build.resources, 'app-update.yml'), build.publish);
    await expect(check()).rejects.toThrow('source repository');
  });

  it.each(['win32', 'darwin'])(
    'rejects automatic updates for unsigned %s builds',
    async (platform) => {
      const build = complete(platform);
      build.policy.automatic = true;
      json(path.join(build.resources, 'update-policy.json'), build.policy);
      await expect(check({ platform })).rejects.toThrow('manual updates');
    },
  );

  it.each(['missing', 'different', 'additional', 'disabled'])(
    'rejects %s Windows publisher verification',
    async (kind) => {
      const build = complete('win32', 'x64', { signed: true });
      if (kind === 'missing') delete build.publish.publisherName;
      if (kind === 'different') build.publish.publisherName = ['Other Publisher'];
      if (kind === 'additional') build.publish.publisherName.push('Other Publisher');
      if (kind === 'disabled') build.publish.verifyUpdateCodeSignature = false;
      json(path.join(build.resources, 'app-update.yml'), build.publish);
      await expect(check()).rejects.toThrow('publisher verification');
    },
  );

  it('rejects scalar policies and duplicate YAML keys', async () => {
    const build = complete();
    write(path.join(build.resources, 'update-policy.json'), 'true');
    await expect(check()).rejects.toThrow('metadata object');
    json(path.join(build.resources, 'update-policy.json'), build.policy);
    write(build.manifestFile, `version: ${version}\nversion: 1.2.4\n`);
    await expect(check()).rejects.toThrow('duplicated mapping key');
  });
});
