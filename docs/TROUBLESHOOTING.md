# Troubleshooting

Start with [Quick Start](../QUICK_START.md). These instructions describe version
1.1; the interface is available in English and Finnish.

## First launch or missing download folder

Settings opens automatically when no download folder is configured. Choose a
writable folder using **Choose folder** and check the tool status before adding
links. Open **Settings** or press **F3** to change it later.

A disconnected external drive, moved folder or changed permissions can make a
saved destination unavailable. Choose the folder again through the native
dialog. Changing the default folder affects new jobs; existing queued jobs keep
their original destination.

If settings do not save, keep the app open, check free space and permissions in
the application's user-data directory, then use **Retry saving**. Configuration
and media can be on different drives.

## A tool is missing

Check in a new terminal:

```sh
yt-dlp --version
ffmpeg -version
ffprobe -version
deno --version
# If using an external Node.js runtime:
node --version
```

Install executable files from trusted sources and put their directories on PATH.
VideoNinja also checks the application directory and standard platform locations.
It deliberately does not search an arbitrary current working directory.
Windows discovery expects executables, not shell aliases or batch wrappers.

Use **Check tools again** after installing or updating a tool. It runs new probes
without resetting the queue. If PATH changed, fully quit and restart VideoNinja
so it inherits the new environment; a source terminal may need reopening too.
Finder, desktop launchers and shortcuts can have a different PATH from your
terminal. The detected ffmpeg and runtime paths are passed to yt-dlp explicitly.

Closing a window normally hides it when the tray is available; use tray **Quit**
to exit. If the tray is unavailable, the app shows a warning and window closing
can exit normally.

## YouTube reports a JavaScript challenge or EJS error

Follow the [official yt-dlp EJS guide](https://github.com/yt-dlp/yt-dlp/wiki/EJS)
for both the runtime and challenge-script installation appropriate to your
yt-dlp distribution.

VideoNinja's automatic choice prefers supported Deno, then Node.js, then
QuickJS. Its compatibility checks accept Deno 2.3+, Node.js 22+, and recognized
QuickJS versions. Use an up-to-date supported runtime and choose it explicitly
in Settings when diagnosing several installations. Deprecated Bun is not a
supported choice. Electron's embedded runtime does not replace a separate
download runtime.

A successful executable/version probe does **not** verify EJS availability or
current compatibility with a source service. VideoNinja disables yt-dlp's
automatic remote-component download, user configuration files and plugin
directories. Install the required components outside the app using the official
guide; a setting in your normal yt-dlp configuration will not change VideoNinja's
arguments.

## Update download tools

Update through the same trusted installation method used originally. Official
standalone yt-dlp binaries support:

```sh
yt-dlp -U
```

Package-manager and Python installations have their own update commands; see the
[official yt-dlp update instructions](https://github.com/yt-dlp/yt-dlp#update).
Update ffmpeg and the selected runtime through their installation method too,
then check tools again. Restart if environment variables or executable locations
changed. VideoNinja does not automatically update these tools or itself.

## A download or preview fails

Check the error details, URL, network, tool versions and destination folder.
Links must be complete HTTP(S) URLs without embedded usernames/passwords.
A preview makes a real metadata request through yt-dlp and can fail for the same
authentication or source-service reasons as a download.

Use **Retry** to enqueue a new attempt with the same options, or **Retry with
options** to change quality, audio conversion, cookies, runtime or network
settings. The original attempt remains in history. Available formats and service
access may change independently of VideoNinja.

Additional download options accept a limited allowlist: IPv4, geo-bypass,
bounded sleep/retry/timeout values and a rate limit. Arbitrary yt-dlp commands,
output templates, plugin settings and executable options are rejected. Leave the
field empty for normal downloads. Credentials belong in the supported cookie
controls, not in a URL or pasted command.

A saved queue entry may retain older options after default Settings change.
Retry that entry with new options or add a fresh job when you need different
settings.

## Browser cookies cannot be read

Browser locks, permissions and encryption can prevent cookie extraction. Closing
the browser may release a lock but does not resolve every restriction. If needed,
choose your own authorized cookie file with **Choose file** and keep it private.

VideoNinja does not silently retry without cookies after authentication fails.
Choose a different supported cookie source or correct the cookie file, then
retry explicitly. Never attach cookies or a complete configuration file to an
issue. Read [Security](../SECURITY.md) before sharing diagnostics.

## Quality, audio or the final file is unexpected

| Symptom                                                                 | What to check                                                                                                                                                         |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resolution is below the selected quality                                | Presets are maximum heights, not guarantees; the source must provide the format.                                                                                      |
| Audio-only is not MP3                                                   | **Original format** keeps the source audio format. Select MP3 or another conversion format explicitly; conversion needs ffmpeg.                                       |
| Download appears complete while the row still says combining/processing | ffmpeg may still be merging or converting. Completion waits for the final path.                                                                                       |
| Open file or Show in folder fails                                       | The file may have been moved/deleted, be outside its original folder after link resolution, or have an unsupported media extension. Inspect the destination directly. |
| A repeated URL finishes without transferring again                      | Continuation/no-overwrite behavior can reuse an existing completed file. Filenames include the source ID.                                                             |
| A paused job restarts instead of continuing                             | Resume depends on the source, partial files and selected format. The app retains partial files but cannot guarantee source-server resume support.                     |

Do not remove partial files if you want a continuation attempt. A cancelled or
failed job can also leave partial media; history clearing does not remove it.

## Disk-space status is unavailable or low

VideoNinja measures the chosen folder's filesystem and refreshes every 30 seconds.
Unavailable means measurement failed; it is not a fabricated free-space value.
Check the drive in your OS and ensure the folder is accessible.

Warnings start below 5 GiB, with a critical notice below 1 GiB. Merging/conversion
may temporarily need room for both source streams and the final output. These
warnings do not reserve space or guarantee that a job fits.

## Queue, pause, cancellation and restart

The queue runs one job at a time. **Pause** stops an active process and retains
the job and partial files; **Resume** makes it eligible again. **Cancel** records
a cancelled attempt in history. The next job waits until the previous process
tree exits, so cancellation may not be instantaneous.

Pending/paused items can move up or down. Add up to 100 links per submission;
the total queue limit is 500. History keeps the latest 100 entries. Its search
filters the displayed history, and **Export** writes a redacted JSON file after a
native save dialog. **Clear history** asks for confirmation and keeps all media.

On a normal quit, an active job is checkpointed as pending and stopped. Restart
can resume pending work; paused jobs remain paused. To keep work stopped after
restart, pause it before quitting. Resume progress may begin at zero until
yt-dlp reports the existing partial download.

## Recovery warnings or application startup fails

Version 1.1 validates saved data and migrates older entries. Invalid/duplicate
jobs or unsupported data versions can be skipped with a visible warning; media
files are unaffected.

Malformed JSON is preserved beside the original configuration as
`config.json.corrupt-<timestamp>-<uuid>`, then the app starts with defaults.
Keep that file private. A file larger than 10 MiB, inaccessible configuration or
failed quarantine stops startup instead of overwriting the original.

Before recovery work, quit the app and back up its user-data directory.
`config.json` is under Electron's `app.getPath('userData')`; source and packaged
runs can use different locations. Do not delete configuration or partial media
as the first troubleshooting step. For a source-only isolated diagnosis, set
`VIDEONINJA_USER_DATA` to a new absolute directory and launch again.

A **queue could not be saved** warning means the next restart may not reflect
recent actions. Keep the app open while checking disk space and permissions.

## Start at login or Linux launch problems

Start at login requires a packaged app; source mode does not register it.
Windows/macOS use native login items. Linux writes an owned
`videoninja.desktop` entry under the XDG autostart directory. Check your desktop
environment's startup settings if it does not run. Moving an AppImage after
enabling startup can invalidate the saved path; choose a stable location first.

On headless Linux, use `xvfb-run -a pnpm test:smoke` for source verification and
`xvfb-run -a pnpm test:smoke --packaged` after packaging. Electron needs a working
sandbox. CI configures its sandbox helper on disposable runners; do not add
`--no-sandbox` as a workaround.

Packages are currently unsigned and macOS notarization is not configured.
Verify where an artifact came from and report a blocked launch rather than
assuming every OS trust prompt is an application failure.

## Reproduce and report

For developer checks, use Node.js **24.22.0** and the pinned pnpm version:

```sh
pnpm check
pnpm run audit
pnpm test:smoke
pnpm test:media
# After building the native package:
pnpm test:smoke --packaged
```

The media smoke requires yt-dlp, ffmpeg and ffprobe. It generates its own fixtures
on a temporary loopback server, tests download/merge/audio conversion and checks
streams with ffprobe. It does not contact a live video service. See
[Contributing](../CONTRIBUTING.md) for coverage and packaging details.
`pnpm audit` alone is pnpm's built-in audit, not the repository's two-stage
`pnpm run audit` gate.

Include OS/architecture, the app's displayed version, source versus packaged
launch, tool versions, reproduction steps, expected behavior and a redacted
error. Review copied errors and history exports: even without query strings,
titles and URL paths can identify private content.

Use the [bug template](../.github/ISSUE_TEMPLATE/bug_report.md) for ordinary bugs
and [private security reporting](../SECURITY.md) for vulnerabilities.
