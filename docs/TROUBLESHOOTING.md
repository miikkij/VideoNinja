# Troubleshooting

These instructions describe **1.2.0 development**. Public 1.1 packages do not
contain the new controls. For those packages, use the
[1.1 quick start](https://github.com/miikkij/VideoNinja/blob/v1.1.0/QUICK_START.md).
For current source, start with [Quick Start](../QUICK_START.md).

## Folder or settings cannot be saved

Choose a writable folder with the native picker. Existing jobs retain their
original destination when the default changes. A disconnected drive, moved folder
or changed permissions can invalidate a saved path. Check both the media drive
and the app's user-data drive; they can differ.

A save warning means the next restart may not reflect recent changes. Keep the
app open, correct space/permissions and use **Retry saving**. Do not erase the
profile or partial downloads to clear a warning.

## Missing tools, installation or updates

In Settings, review paths/versions and install or update the managed tool. Pause
queued jobs manually and close previews, then wait for their processes to stop.
Paused jobs remain in the queue. Jobs paused by the schedule must also be paused
manually because the schedule could otherwise resume them. Tool changes
are explicit and do not upgrade global package-manager installations.

Updating VideoNinja does not update a globally installed yt-dlp. A build older
than 90 days now displays a warning. Select Stable or Nightly in the yt-dlp card
and update the managed copy. Upstream recommends Nightly for current site fixes.
For service-specific requirements and authentication, see the
[service guide](USER_GUIDE.md).

Managed yt-dlp and Deno support Windows/Linux/macOS x64/ARM64. ffmpeg/ffprobe are
managed on Windows/Linux; macOS shows guided installation, normally
`brew install ffmpeg`. Unsupported platform/architecture combinations use setup
links. Follow the chosen installation method rather than mixing global installers.

A checksum, download or archive-validation failure stops installation. The previous
managed version is retained or restored; inspect the visible failure before
retrying. Do not disable checksum verification. Corporate proxies/firewalls may
block GitHub release hosts. Managed tools take precedence over PATH; an old managed
copy can therefore explain why a newer terminal installation is not selected.

For external installations, check in a new terminal:

```sh
yt-dlp --version
ffmpeg -version
ffprobe -version
deno --version
# If selecting an external Node runtime:
node --version
```

After changing PATH, fully quit and reopen VideoNinja. Desktop launchers can
inherit a different PATH from a terminal. Discovery checks managed directories,
known executable/platform locations and PATH, not an arbitrary working directory.
Windows expects executables, not shell aliases/batch wrappers. The selected
ffmpeg/runtime paths are passed explicitly to yt-dlp. Developer isolation uses
an absolute `VIDEONINJA_TOOLS_DIR`; normal users need not set it.

## EJS or YouTube challenges

**Check YouTube support** reads the installed yt-dlp component/runtime diagnostics.
When its exact revision is identifiable, the expected EJS version is read from
official upstream source and compared. Compatible means the installed components
match that check; it is not a successful live YouTube challenge or login test.
Unknown means the available evidence is insufficient, not a forced success.

Update managed yt-dlp and Deno together where appropriate, then diagnose again.
Automatic runtime selection prefers Deno 2.3+, then Node.js 22+, with recognized
QuickJS also supported. Electron's internal Node is not a standalone download
runtime. Follow the [official EJS guide](https://github.com/yt-dlp/yt-dlp/wiki/EJS)
for non-managed distributions. VideoNinja disables user yt-dlp configuration,
plugins and automatic remote-component fetching; normal CLI config cannot override
those arguments. Availability can still change at the source service.

## Failed jobs and automatic retries

Errors show a category, redacted details and a suggested next action. Check the
URL, tool versions, permissions and selected options. Previewing contacts the
source and can fail for the same authentication/network reasons as downloading.

Recoverable network, rate-limit and stalled-download errors can retry automatically.
Defaults are two retries with an initial 15-second delay; the maximum is five
retries and backoff is capped at 15 minutes. Authentication, unavailable content,
invalid formats and missing tools need correction. Use **Retry with options**
when the saved job contains outdated settings. Manual retry creates a new attempt.

Instagram's "not available, rate-limit reached or login required" message does
not identify a single cause. VideoNinja shows access guidance and stops automatic
retries for this message. Update yt-dlp, check the link in a browser, then use the
explicit cookie settings if the service requires your login. A confirmed HTTP 429
still uses the bounded retry policy. Browser cookie-copy/decryption failures have
their own guidance and do not become repeated network retries.

Saved jobs with unsupported legacy options are retained for review. Completed
history keeps its file links. Pending jobs stay paused until **Retry with options**
submits valid settings; that action keeps the same queue slot. Resume and bulk
retry cannot silently run a job after its old authentication/options were removed.

The watchdog requires actual byte/percentage advancement or a phase change.
Repeated status messages alone do not reset it. Defaults are 180 seconds during
transfer and 900 during processing; adjust for unusually slow sources or large
conversions. A killed process settles before another attempt uses its slot/files.

Cookie extraction may fail due to browser locks, OS encryption or permissions.
Choose an authorized cookie file if needed and keep it private. The app never
silently retries without cookies after authentication fails. Do not put credentials
in a URL, pasted command, issue or screenshot. Extra yt-dlp options have a small
allowlist; use the structured speed/subtitle/format controls where provided.

## Formats, subtitles and completed-file checks

Quality presets cap height; the source may offer less. Preview the first URL for
actual formats. Exact IDs apply only to that source and are revalidated at download
time. An unavailable ID requires a fresh preview or Automatic selection. A
video-only format needs a valid audio companion to include audio. Generic direct
media URLs can omit codec/size metadata even when the downloaded file is playable.

Audio-only keeps original audio unless conversion is selected. Merging/conversion
needs ffmpeg. Subtitle language codes such as `en,fi` request available tracks;
automatic captions need the additional checkbox. Profiles save common options,
not authentication or source-specific exact IDs. Size estimates can exclude extra
audio/subtitle streams and temporary processing files.

Completion requires a regular, nonempty final file inside the chosen folder.
With ffprobe, the container must expose valid media streams; corrupt/unreadable
output fails. Without ffprobe the UI explicitly reports size-only verification.
Install ffmpeg with ffprobe to strengthen that check. Neither test fully decodes
all frames. Processing may continue after transfer reaches 100%.

Open/reveal actions fail if the file moved, disappeared, resolved outside its
folder or has an unsupported media extension. Inspect the destination directly.
Filename profiles distinguish quality/audio, exact selections and URL aliases;
older files are not automatically renamed or matched to the new template.

## Playlist pages, search and selection

Use the first input URL and **Choose from playlist**. Nothing is preselected.
Search and range selection apply to the current page; ranges use displayed absolute
entry numbers. Add or clear a selection before changing pages. **Next page**
reaches entries after 500, but each page and the total queue are bounded at 500.

Private, unavailable, invalid and nested-playlist entries are disabled. Correct
cookies where authorized, then preview again. Metadata visibility does not promise
that a later download succeeds. A failed enqueue keeps the selection; reduce it
or free queue capacity. Duplicate URLs within a selection are added once.

Previews expire after 15 minutes and are invalidated when closed, replaced or
submitted. Closing aborts an in-flight preview, not active downloads. Previews are
not persisted. Ordinary **Add to queue** remains a single-media operation per job.

## Waiting jobs, speed limits and scheduling

The queue shows why work waits: retry time, disk, schedule or duplicate source.
Default concurrency is one; choose 1–5. Same URL/folder jobs serialize through
process cleanup; other URLs can fill free slots. Pause retains partial files and
cancel leaves media untouched. Resume support depends on yt-dlp and the source.
Bulk controls apply only to eligible selected jobs.

Without a total speed limit, lowering concurrency lets active jobs finish. With
one enabled, changing concurrency or the total limit restarts active transfers
with partials preserved. The KiB/s cap is conservatively divided across configured
slots, and an individual lower cap still applies. Idle slots may leave speed
unused; a per-job limit does not override a lower allocated total limit.

Schedule windows use local time, including overnight ranges. At the end of the
window active work pauses. Only schedule-paused jobs resume next time; manually
paused jobs remain paused. The app must stay running; it does not wake a sleeping
computer. Check OS clock/timezone when a window appears wrong.

The default free-space floor is 1024 MiB. Known media size is multiplied for
processing and reserved against other active jobs on the same volume. Insufficient
space waits and rechecks after 30 seconds. Unknown size/free-space is explicitly
uncertain. These estimates cannot reserve OS space or prevent another program
from filling the disk. The separate disk badge's warning thresholds are not the
scheduler's configurable reserve.

## Skipped downloads, history and private jobs

Duplicate skipping uses the source identity, output options and destination plus
a check that the prior output file still exists and is nonempty. It does not hash
all files or scan your collection. Disable skipping to request a new transfer;
yt-dlp can still reuse an already complete file at its expected path. A missing
archived file allows a new attempt. Private jobs never enter the archive.

History holds at most 100 entries. Retention days prune older entries; `0` disables
age pruning, not the count limit. Delete selected records or clear history to
remove records and matching archive references. These actions never delete media,
partials, cookies or backups. Review exported titles/URL paths before sharing.

Private mode applies to newly added jobs. They are omitted from saved queue,
history, archive and notifications, so they vanish when the app exits. Earlier
public history/archive stays intact. Private mode does not encrypt/delete media or
hide requests from the source. Do not expect a private job to resume after restart.

## Encryption, migration and configuration recovery

Optional encryption requires the OS secret store. Linux insecure `basic_text` or
unknown backends are rejected. Unlock/configure a supported keyring instead of
forcing a plaintext fallback. The key is tied to the OS account/environment;
copying the encrypted profile to another account may make it unreadable.

Quit and back up the profile before recovery or downgrade. **Version 1.1 cannot
read encrypted 1.2 activity.** Disable encryption while still in 1.2 and back up
the result before returning to 1.1, or give 1.1 a separate profile. Encryption
does not retroactively protect old plaintext/quarantined copies, cookie files or media.

Settings/state are validated and migrated on startup. Invalid/unsupported entries
can be skipped with warnings; media remains untouched. Malformed JSON is preserved
as `config.json.corrupt-<timestamp>-<uuid>`. An unreadable file, a serialized config
over 32 MiB, a settings/activity payload over 20 MiB or failed quarantine stops
startup instead of overwriting data. Encryption/decryption failure preserves the
existing store. Keep all recovery files private.

`config.json` is under Electron's user-data path; source and packaged runs may
use different directories. `VIDEONINJA_USER_DATA` selects a new absolute profile
for isolated source diagnosis. Ordinary quit saves non-private active jobs as
pending after termination; manual pauses remain paused. Restored work is still
subject to schedule, disk and retry conditions.

## Application updates and OS integration

Startup update checking contacts GitHub and can be disabled. Check, download and
restart/install are separate actions; installation checkpoints eligible jobs.
Source, unsigned Windows/macOS, Windows portable and Debian packages use the
release page. Native updating needs an eligible signed Windows/macOS package or
Linux AppImage. Public 1.1 has no updater; no signed 1.2 release is available yet.
Do not confuse a successful version check with a verified signing/notarization path.

Start at login requires a packaged app. Linux uses an owned XDG autostart entry;
keep AppImages at a stable path after enabling it. Closing normally hides the app
when a tray is available; use tray **Quit** for a real exit. Notifications are
opt-in, grouped and subject to OS permissions/focus settings; private jobs are omitted.

Headless Linux tests need a display and functioning Electron sandbox:

```sh
xvfb-run -a pnpm test:smoke
xvfb-run -a pnpm test:features
# After native packaging:
xvfb-run -a pnpm test:smoke --packaged
xvfb-run -a pnpm test:features --packaged
```

CI configures sandbox helpers on disposable runners. Do not bypass the sandbox
with `--no-sandbox`. OS trust prompts for the unsigned 1.1 packages do not prove
an application bug; verify the release source/checksums.

## Reproduce and report

Use Node **24.22.0** and pinned pnpm **10.20.0**:

```sh
pnpm check
pnpm run audit
pnpm test:smoke
pnpm test:features
pnpm test:media
```

Media checks use actual yt-dlp/ffmpeg/ffprobe with generated loopback fixtures;
they do not validate a live service. `pnpm audit` alone is the built-in pnpm report,
not the repository's two-stage gate. See [Contributing](../CONTRIBUTING.md).

Report OS/architecture, displayed app version, source/packaged mode, tool versions,
reproduction and a reviewed/redacted error. Use the
[bug template](../.github/ISSUE_TEMPLATE/bug_report.md) for ordinary bugs and
[private security reporting](../SECURITY.md) for vulnerabilities. Never attach
cookies, complete profiles, private URLs or signing credentials.
