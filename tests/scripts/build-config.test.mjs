import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const configFile = path.resolve('scripts/build-config.cjs');
const configRequire = createRequire(configFile);
const builderEntry = require.resolve('app-builder-lib', {
  paths: [require.resolve('electron-builder')],
});
const builderRequire = createRequire(builderEntry);
const builderDirectory = path.dirname(builderEntry);
// Initialize the public entry first; internal packager modules have circular exports.
builderRequire(builderEntry);
const { PlatformPackager, computeSafeArtifactNameIfNeeded } = builderRequire(
  path.join(builderDirectory, 'platformPackager.js'),
);
const { Platform } = builderRequire(path.join(builderDirectory, 'core.js'));
const { Arch } = builderRequire('builder-util');
const { version } = require('../../package.json');

function configFor(platform) {
  const context = {
    module: { exports: {} },
    require: configRequire,
    process: { platform, env: {} },
  };
  vm.runInNewContext(readFileSync(configFile, 'utf8'), context, { filename: configFile });
  return context.module.exports;
}

function artifactName(config, platform, options, extension, architecture) {
  const proto = PlatformPackager.prototype;
  const packager = {
    config,
    platform,
    platformSpecificBuildOptions: config[platform.buildConfigurationKey],
    appInfo: {
      name: 'video-ninja',
      productName: 'VideoNinja',
      sanitizedProductName: 'VideoNinja',
      version,
    },
    artifactPatternConfig: proto.artifactPatternConfig,
    computeArtifactName: proto.computeArtifactName,
    expandMacro: proto.expandMacro,
  };
  return proto.expandArtifactNamePattern.call(
    packager,
    options,
    extension,
    architecture,
    undefined,
    true,
  );
}

describe('release artifact names', () => {
  it('uses the same GitHub-safe name for the local Windows installer and its update manifest', () => {
    const config = configFor('win32');
    const installer = artifactName(config, Platform.WINDOWS, config.nsis, 'exe', Arch.x64);
    const portable = artifactName(config, Platform.WINDOWS, config.portable, 'exe', Arch.x64);
    expect(installer).toBe(`VideoNinja-Setup-${version}-x64.exe`);
    expect(portable).toBe(`VideoNinja-Portable-${version}-x64.exe`);
    const fallback = vi.fn(() => 'unexpected.exe');
    expect(computeSafeArtifactNameIfNeeded(installer, fallback)).toBeNull();
    expect(computeSafeArtifactNameIfNeeded(portable, fallback)).toBeNull();
    expect(fallback).not.toHaveBeenCalled();
    // This is the actual upstream rewrite that caused the former manifest mismatch.
    expect(computeSafeArtifactNameIfNeeded(`VideoNinja Setup ${version}.exe`, fallback)).toBe(
      `VideoNinja-Setup-${version}.exe`,
    );
  });

  it('keeps macOS and Linux formats and architectures distinct without uploader rewriting', () => {
    const names = [];
    for (const [host, platform, extensions] of [
      ['darwin', Platform.MAC, ['dmg', 'zip']],
      ['linux', Platform.LINUX, ['AppImage', 'deb']],
    ]) {
      const config = configFor(host);
      for (const extension of extensions) {
        for (const architecture of [Arch.x64, Arch.arm64]) {
          const name = artifactName(config, platform, {}, extension, architecture);
          expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
          expect(name).toContain(`-${platform.buildConfigurationKey}-`);
          expect(computeSafeArtifactNameIfNeeded(name, () => 'unexpected')).toBeNull();
          names.push(name);
        }
      }
    }
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain(`VideoNinja-${version}-mac-x64.zip`);
    expect(names).toContain(`VideoNinja-${version}-linux-x86_64.AppImage`);
    expect(names).toContain(`VideoNinja-${version}-linux-amd64.deb`);
  });
});
