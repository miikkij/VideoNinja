# Contributing to VideoNinja

Start with the [architecture](docs/ARCHITECTURE.md) and the
[development plan](docs/DEVELOPMENT_PLAN.md). Version 1.1 introduces the isolated
renderer, validated download pipeline, recoverable queue and bilingual interface
described there.

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
| `pnpm test:media`                 | Test the actual yt-dlp/ffmpeg pipeline against generated local media.                     |
| `pnpm build:win`                  | Build Windows NSIS and portable x64 packages, without publishing.                         |
| `pnpm build:mac`                  | Build macOS DMG and ZIP packages, without publishing.                                     |
| `pnpm build:linux`                | Build Linux AppImage and Debian packages, without publishing.                             |
| `pnpm release:verify --artifacts` | Check the current OS's expected, nonempty package files and exact version.                |
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
cancellation, tool discovery, format arguments, final file validation, concurrent
queue races, atomic batches, bounded playlist previews and selections, persistence
recovery, startup registration and renderer behavior. Add a
regression test for changed behavior instead of copying an implementation's
regular expressions into a test.

The source and packaged smoke commands both run `scripts/smoke-test.mjs`. They
launch real Electron, create an isolated temporary profile, exercise first-run
setup and language persistence, then restore 500 paused jobs and 100 history
entries. They check the sandbox, rejected IPC requests, text-only rendering,
history search, retry dialog focus, reorder, reload and layout at 200% zoom.
Playlist selection and the saved concurrency setting are exercised through real
IPC and queue code with a controlled external-tool boundary.
Screenshots are written to the ignored `test-results/` directory. These checks do
not download internet content or test OS installer/uninstaller behavior.

On a headless Linux machine with a correctly configured Electron sandbox, use:

```sh
xvfb-run -a pnpm test:smoke
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
and valid streams. The script removes its temporary fixture tree. This validates media processing;
it does not establish current YouTube extractor or EJS compatibility.

For UI, queue or lifecycle changes, also check the relevant behavior manually:
missing-tool recovery, per-job pause/cancel with several active jobs, raising and
lowering concurrency, retry, completion and file opening,
tray reopen, quit/restart, keyboard access, both languages and native startup
registration. A source run cannot enable start at login. Use media you are
authorized to download for an explicit live-service check.

Playlist checks should cover a preview with no automatic selections, unavailable
entries, the first-500 notice, cancellation, expired previews, selection capacity
and a failed enqueue retaining the selection. Ordinary input accepts 100 links;
the selected playlist may contribute up to 500 jobs within the same total queue
limit. Both paths use one atomic, deduplicated batch. A queued job must remain a
single media item: `--no-playlist --playlist-items 1`. Test same-URL output
serialization and separate files for distinct URL aliases under concurrency.

The concurrency setting is an integer from 1 to 5, default 1. Reducing it must
not abort running jobs, and cancelling one job must not affect another job's
controller. Exiting processes retain their slot/output reservation until their
promises settle. Keep progress-only events free of persistence writes.

To isolate a manual source run from your normal profile, set
`VIDEONINJA_USER_DATA` to a new absolute directory before launching. Never
silently erase a user's existing profile or partial downloads.

## CI, packaging and release

[CI](.github/workflows/ci.yml) is configured for Ubuntu, Windows and macOS. Each
job installs with the frozen lockfile, runs lint/tests and the audit gate,
smokes the source app, builds the native installers, smokes the unpacked app and
verifies its expected artifacts, then runs the native-package smoke. This
describes the workflow; inspect the result
for the exact pushed commit before reporting a platform as verified.

[Build & Release](.github/workflows/build.yml) runs the checks, native packaging,
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

Code signing and macOS notarization are not configured. The version 1.1
implementation work does not itself publish a release or establish signed
distribution. There is no automatic application updater.

## Artwork maintenance

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

Create a focused branch, run the relevant checks, update affected documentation
and describe observable behavior and verification in the pull request. Prefer
Conventional Commits such as `fix: preserve paused downloads during shutdown`.

Use the issue templates for bugs and feature requests. Follow
[SECURITY.md](SECURITY.md) for vulnerabilities; do not include exploit details,
cookie files or private URLs in an ordinary issue.
