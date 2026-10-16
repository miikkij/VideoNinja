const fs = require('node:fs/promises');
const path = require('node:path');
const { build } = require('../package.json');
const signing = Boolean(process.env.CSC_LINK);
const windows = process.platform === 'win32';
const mac = process.platform === 'darwin';
const publisher = process.env.WINDOWS_PUBLISHER_NAME || '';
if (windows && signing && !publisher)
  throw new Error('Set WINDOWS_PUBLISHER_NAME for signed Windows updates.');
if (
  mac &&
  signing &&
  (!process.env.APPLE_API_KEY || !process.env.APPLE_API_KEY_ID || !process.env.APPLE_API_ISSUER)
)
  throw new Error('Signed macOS releases require Apple notarization API credentials.');

module.exports = {
  ...build,
  publish: [{ provider: 'github', owner: 'miikkij', repo: 'VideoNinja', releaseType: 'draft' }],
  forceCodeSigning: signing && (windows || mac),
  win: {
    ...build.win,
    artifactName: 'VideoNinja-${version}-win-${arch}.${ext}',
    signExecutable: signing,
    verifyUpdateCodeSignature: true,
    ...(signing && windows ? { signtoolOptions: { publisherName: publisher } } : {}),
  },
  nsis: {
    ...build.nsis,
    artifactName: 'VideoNinja-Setup-${version}-${arch}.${ext}',
  },
  portable: {
    ...build.portable,
    artifactName: 'VideoNinja-Portable-${version}-${arch}.${ext}',
  },
  mac: {
    ...build.mac,
    artifactName: 'VideoNinja-${version}-mac-${arch}.${ext}',
    hardenedRuntime: true,
    notarize: signing && mac,
  },
  linux: {
    ...build.linux,
    artifactName: 'VideoNinja-${version}-linux-${arch}.${ext}',
  },
  afterPack: async (context) => {
    const platform = context.electronPlatformName;
    const policy = {
      signed: signing && ['darwin', 'win32'].includes(platform),
      automatic: platform === 'linux' || signing,
      publisherName: platform === 'win32' && signing ? publisher : null,
    };
    await fs.writeFile(
      path.join(context.packager.getResourcesDir(context.appOutDir), 'update-policy.json'),
      JSON.stringify(policy),
    );
  },
};
