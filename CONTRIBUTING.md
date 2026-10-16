# Contributing to VideoNinja

Start with the [architecture](docs/ARCHITECTURE.md) and the
[development plan](docs/DEVELOPMENT_PLAN.md). The source tree is the unreleased
1.2.0 development version; public downloads remain at 1.1.0. The implementation
record distinguishes completed code, local evidence and outstanding release work.

## Development environment

Use **Node.js 24.22.0**, pinned in `.nvmrc`, and **pnpm 10.20.0**, pinned in
`package.json#packageManager`. CI reads these same pins. Use the native target OS
when validating Windows, macOS or Linux packaging.

```sh
git clone https://github.com/miikkij/VideoNinja.git
cd VideoNinja
npm install --global pnpm@10.20.0
pnpm install --frozen-lockfile
pnpm check
pnpm start
```

Install yt-dlp, ffmpeg/ffprobe and a supported external JavaScript runtime for
actual download testing. Unit tests and the Electron UI smoke use controlled
fixtures and do not require download tools. See [Quick Start](QUICK_START.md).

There is no frontend bundler or development server. Electron serves the local
renderer through the restricted `videoninja://app/` protocol. Restart the app
after main-process or preload changes; renderer reload fetches a fresh initial
state without restoring or starting the queue twice.

## Commands

| Command                           | Purpose                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| `pnpm start`                      | Launch Electron from source.                                                              |
| `pnpm check`                      | Run lint and all Vitest tests.                                                            |
| `pnpm lint`                       | Check source, scripts, tests and root `.mjs` configurations; warnings fail.               |
| `pnpm lint:fix`                   | Apply ESLint fixes; review the diff.                                                      |
| `pnpm test`                       | Run Vitest once.                                                                          |
| `pnpm run audit`                  | Gate high/critical findings in the full tree and all findings in production dependencies. |
| `pnpm test:smoke`                 | Exercise the source application in real Electron with an isolated profile.                |
| `pnpm test:smoke --packaged`      | Exercise the native unpacked app under `dist/`; build first.                              |
| `pnpm test:features`              | Exercise 1.2 features through real Electron/IPC with isolated fixtures.                   |
| `pnpm test:features --packaged`   | Exercise the same feature flows in the native unpacked app; build first.                  |
| `pnpm test:media`                 | Test the actual yt-dlp/ffmpeg pipeline against generated local media.                     |
| `pnpm build:win`                  | Build Windows NSIS and portable x64 packages, without publishing.                         |
| `pnpm build:mac`                  | Build macOS DMG and ZIP packages, without publishing.                                     |
| `pnpm build:linux`                | Build Linux AppImage and Debian packages, without publishing.                             |
| `pnpm release:verify --artifacts` | Check native package versions, update manifests/hashes and packaged update configuration. |
| `pnpm format`                     | Rewrite formatting throughout `src/`; keep broad reformatting separate from fixes.        |
| `pnpm clean`                      | Delete generated `dist/` and `node_modules/.cache`.                                       |

Use **`pnpm run audit`** to invoke the repository's two-stage gate. **`pnpm audit`**
is pnpm's built-in command and reports the whole dependency tree; it does not
invoke that script. Read [SECURITY.md](SECURITY.md) for the known moderate build
dependency advisory. Electron is a development dependency whose runtime ships in
the app, so a production-only audit is insufficient.

`pnpm build` builds all configured targets for the current OS. It does not build
all three operating systems. Windows targets x64; macOS and Linux use the build
host's architecture unless explicitly overridden. Keep dependencies, build
outputs, credentials and downloaded media out of Git.

## Code and verification

Application modules use CommonJS; test/configuration files use ES modules
(`.mjs`). Follow the existing ESLint and Prettier configuration. Exercise
production functions with injected process, filesystem and Electron boundaries
when a deterministic unit test is appropriate.

The automated coverage includes IPC validation, process output framing and
cancellation, tool installation/rollback, EJS diagnostics, exact-format validation,
final-file integrity, concurrent queue races, retries, disk reservations, bandwidth
limits, schedules, archive identity, private/encrypted storage, updater behavior,
notifications, paged playlist selection and renderer behavior. Add a
regression test for changed behavior instead of copying an implementation's
regular expressions into a test.

The source and packaged smoke commands both run `scripts/smoke-test.mjs`. They
launch real Electron, create an isolated temporary profile, exercise first-run
setup and language persistence, then restore 500 paused jobs and 100 history
entries. They check the sandbox, rejected IPC requests, text-only rendering,
history search, retry dialog focus, reorder, reload and layout at 200% zoom.
Playlist selection and saved concurrency are exercised through real IPC and queue
code with a controlled external-tool boundary. `pnpm test:features` additionally
checks profiles, format/subtitle selection, paging beyond entry 500, bulk actions,
archive skips, selective history deletion, private jobs, theme and encryption
round-trip/relaunch. OS secret-store availability is environment-specific.
Screenshots are written to the ignored `test-results/` directory. These checks do
not download internet content or test OS installer/uninstaller behavior.

On a headless Linux machine with a correctly configured Electron sandbox, use:

```sh
xvfb-run -a pnpm test:smoke
xvfb-run -a pnpm test:features
pnpm build:linux
xvfb-run -a pnpm test:smoke --packaged
```

CI configures the source and unpacked Linux `chrome-sandbox` helpers with
root ownership and mode 4755 on its disposable runners. Do not bypass the
sandbox with `--no-sandbox` to make a failed smoke check pass.

The native-package smoke, `node scripts/installer-smoke.mjs`, runs only on
GitHub-hosted disposable runners and refuses local/self-hosted execution. It
installs and uninstalls the Windows NSIS package, mounts the macOS DMG read-only,
or extracts the Linux Debian package, then exercises the corresponding app with
`node scripts/smoke-test.mjs --executable <absolute-path>`. DMG mounting and Debian
extraction do not establish OS install/uninstall behavior. Keep those checks in
the manual release checklist.

The separate media smoke command is also available directly:

```sh
node scripts/media-smoke.mjs
```

It requires discoverable yt-dlp, ffmpeg and ffprobe. It creates its own video and
audio fixtures, serves them only on `127.0.0.1`, and exercises metadata,
progressive download, repeat/already-downloaded behavior, DASH stream merging,
original audio and MP3 conversion through the real adapter. It checks final paths
and ffprobe streams in a folder containing spaces, Unicode and a literal percent
sign. A generated playlist checks metadata inspection without media requests;
parallel URL aliases must produce separate files with the same expected content
and valid streams. Exact progressive and paired DASH format selections, a second
playlist page and adapter-reported ffprobe integrity are also asserted. The script
removes its temporary fixture tree. This validates media processing;
it does not establish current YouTube extractor or EJS compatibility.

For UI, queue or lifecycle changes, also check the relevant behavior manually:
missing-tool recovery, per-job pause/cancel with several active jobs, raising and
lowering concurrency, retry, completion and file opening,
tray reopen, quit/restart, keyboard access, both languages and native startup
registration. A source run cannot enable start at login. Use media you are
authorized to download for an explicit live-service check.

Playlist checks should cover a preview with no automatic selections, unavailable
entries, search/range selection, next/previous pages, cancellation, expiry, capacity
and a failed enqueue retaining the selection. Ordinary input accepts 100 links;
the selected playlist may contribute up to 500 jobs within the same total queue
limit. Both paths use one atomic, deduplicated batch. A queued job must remain a
single media item: `--no-playlist --playlist-items 1`. Test same-URL output
serialization and separate files for distinct URL aliases under concurrency.

The concurrency setting is an integer from 1 to 5, default 1. Without a global
bandwidth cap, lowering it lets active jobs finish. With a cap, changing its value
or concurrency aborts/restarts active transfers after settlement to apply the new
allocation. A cancelled job must not affect another controller. Exiting processes
retain slot/output reservations until their promises settle. Keep progress-only
events free of persistence writes. Check scheduling with an injected clock and
disk reservation races with controlled filesystem measurements.

To isolate a manual source run from your normal profile, set
`VIDEONINJA_USER_DATA` to a new absolute directory before launching. Never
silently erase a user's existing profile or partial downloads.

For isolated tool installation testing, `node scripts/tool-install-smoke.mjs`
installs verified tools under ignored `.tools/tool-install-smoke` and retains
them for inspection. It has been exercised on Windows; macOS ffmpeg remains a
guided external installation. Set `VIDEONINJA_TOOLS_DIR` to that absolute
directory when running media checks against those versions. This downloads
executables from upstream; it is separate from the loopback-only media transfer.

## CI, packaging and release

[CI](.github/workflows/ci.yml) is configured for Ubuntu, Windows and macOS. Each
job installs with the frozen lockfile, runs lint/tests and the audit gate,
installs media tools and runs real media checks, smokes source/features, builds
the native installers, smokes the unpacked app and its new feature flows and
verifies its expected artifacts, then runs the native-package smoke. This
describes the workflow; inspect the result
for the exact pushed commit before reporting a platform as verified.

[Build & Release](.github/workflows/build.yml) runs the checks, real media tests, native packaging,
packaged/native-package smoke and artifact validation on all three operating systems. A manual
`workflow_dispatch` uploads artifacts without creating a release. A pushed
`v*` tag must exactly match `package.json#version`; only a successful tag run
creates a **draft** GitHub release for review. It does not publish that draft.
Do not create a release tag merely to test packaging.

Before publishing a release:

1. Review dependency changes and the complete audit output; rerun
   `pnpm install --frozen-lockfile`, `pnpm check` and `pnpm run audit`.
2. Update the package version and changelog; commit the lockfile for dependency changes.
3. Confirm CI on the exact commit and run the media smoke with recorded tool versions.
4. Validate installation, launch, actual downloads, media opening, startup
   registration and uninstall on each supported platform and architecture.
5. Review the generated artifacts and signing/notarization status before
   publishing the draft.

## Signing and application updates

Version 1.1.0 remains the published, unsigned release for Windows x64, macOS ARM64
and Linux x64. Version 1.2 development adds updater/signing support, but signing
credentials have not been configured and no signed binaries have been published.
Configuration is not evidence of a successful signed/notarized release.

[build-config.cjs](scripts/build-config.cjs),
[build-release.mjs](scripts/build-release.mjs) and
[the release workflow](.github/workflows/build.yml) define these prerequisites:

| Platform | GitHub secrets                                                                                             | Repository variable / purpose                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Windows  | `WINDOWS_CSC_LINK`, `WINDOWS_CSC_KEY_PASSWORD`                                                             | `WINDOWS_PUBLISHER_NAME` must match the signing certificate's publisher.        |
| macOS    | `MACOS_CSC_LINK`, `MACOS_CSC_KEY_PASSWORD`, `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | Developer ID signing identity and App Store Connect notarization API key.       |
| Linux    | No signing credential wired by these scripts                                                               | AppImage updates use the GitHub release manifests; this is not OS code signing. |

The certificate secrets are mapped to electron-builder's `CSC_LINK` and
`CSC_KEY_PASSWORD`; use an appropriate exported signing certificate with its
private key. macOS API key content is base64-encoded in its secret. The wrapper
decodes it to an owned temporary `.p8` file, supplies `APPLE_API_KEY`, and removes
the temporary file afterward. macOS identity discovery is enabled in the release
job only when a certificate is supplied. A signing-enabled build fails if the
publisher/notarization prerequisites are missing; `forceCodeSigning` is enabled.
Never commit these values or paste them into logs.

For native signing locally, set the corresponding electron-builder environment
variables and use `node scripts/build-release.mjs --win`, `--mac` or `--linux`.
The wrapper handles `APPLE_API_KEY_BASE64`; direct `pnpm build:mac` instead needs
`APPLE_API_KEY` to identify an existing key file. Every build uses `--publish never`.

The packaged `update-policy.json` enables native application updates only for
signed installed Windows/macOS apps or Linux AppImages. Windows publisher
verification remains enabled. Source, unsigned Windows/macOS, Windows portable
and Debian installations offer the release page. The app checks published stable
GitHub releases; downloads and installation require separate explicit actions.
It does not auto-download or install on quit. The legacy 1.1 release has no updater.

Release artifacts include packages, `latest*.yml` manifests and blockmaps.
`release:verify --artifacts` checks versions, SHA-512/size entries and packaged
update configuration, including deliberate unsigned builds. The release workflow
generates `SHA256SUMS.txt` and creates a draft only after all matrix jobs succeed.
Review actual certificate/notarization results and an installed-app update cycle
before publishing a signed update channel. No new release is implied by this work.

## Artwork maintenance

Refresh the README screenshots from the current application with:

```sh
node scripts/capture-screenshots.mjs
```

The script launches real Electron with an isolated temporary profile and sample
tool/playlist/progress data. It captures the unmodified interface into
`docs/screenshots/`; it does not access the normal profile or download media.
Review all six images, including the Finnish dark theme and the ninja/camera
interactions, before committing them. On headless Linux, use the same display and
sandbox setup as the Electron smoke test.

```sh
node scripts/generate-icons.js
node scripts/convert-icons-to-png.js
node scripts/generate-social-preview.js
```

The first command rewrites SVG sources under `src/assets/icons/`; the second
renders PNG variants using the development dependency `sharp`. The app icon
stays 512 px and the normal/alert tray base icons 256 px. These scripts do not
update `icon.ico`; verify the Windows asset separately when changing artwork.
The social-preview script writes SVG, not the existing PNG. Review generated
changes before committing.

## Submitting changes

This is a solo-maintainer repository. Authorized maintenance changes go directly
to `main`: run the relevant checks, update affected documentation, commit the
specific paths and push to `origin/main`. Create a branch or pull request only
when the owner explicitly requests one. Confirm CI on the pushed commit.
Prefer Conventional Commits such as `fix: preserve paused downloads during shutdown`.

Routine Dependabot version-update pull requests are disabled. Review dependency
updates during maintenance and keep the audit gate and security alerts enabled.

Use the issue templates for bugs and feature requests. Follow
[SECURITY.md](SECURITY.md) for vulnerabilities; do not include exploit details,
cookie files or private URLs in an ordinary issue.
