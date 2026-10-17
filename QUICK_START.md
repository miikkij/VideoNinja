# VideoNinja quick start

[Suomeksi](QUICK_START.fi.md) · [Troubleshooting](docs/TROUBLESHOOTING.md)

This guide describes the **1.2 development series**, available from
[source](README.md#run-from-source). The public
[1.1.0 downloads](README.md#download-videoninja-110) remain available for Windows
x64, macOS Apple Silicon and Linux x64. Those packages are unsigned and macOS is
not notarized; they do not contain the new 1.2 controls described below.

## 1. Choose a folder and set up tools

Launch VideoNinja and select **English** or **Suomi** in the header. Settings opens
when setup is incomplete; reopen it with **Settings** or F3.

1. Choose a writable **Download folder**.
2. Review yt-dlp, ffmpeg/ffprobe and the JavaScript runtime.
3. Use the explicit install/update controls for missing or outdated managed tools.
4. On macOS, follow the ffmpeg setup instructions, then check the tools again.
5. Use **Check YouTube support** to inspect EJS and runtime compatibility.

Managed installation places tools in the app's own user-data directory. It does
not require changing global tools. Windows/Linux support managed yt-dlp, ffmpeg
with ffprobe and Deno; macOS supports managed yt-dlp/Deno and guided ffmpeg setup.
Finish or remove all queued jobs, including paused ones, and close previews before
installing or updating tools. Pausing alone does not empty the queue.
EJS diagnostics inspect installed components; they do not solve a live YouTube challenge.

For the released 1.1 app, or a manually maintained installation, use the official
[yt-dlp](https://github.com/yt-dlp/yt-dlp#installation),
[ffmpeg](https://ffmpeg.org/download.html),
[Deno](https://docs.deno.com/runtime/getting_started/installation/) and
[EJS](https://github.com/yt-dlp/yt-dlp/wiki/EJS) instructions. With Homebrew:

```sh
brew install yt-dlp ffmpeg deno
```

Check manual installations in a new terminal:

```sh
yt-dlp --version
ffmpeg -version
ffprobe -version
deno --version
```

After changing PATH, fully quit and restart the app. A failed settings save stays
visible with a retry action; fix the storage problem before exiting.

## 2. Choose what to download

1. Paste permitted HTTP(S) links, one per line.
2. Choose a quality limit or **Audio only** and its output format.
3. Optionally preview the first link to inspect available formats, codecs,
   resolution and size estimates. Choose Automatic or a concrete source format.
4. Enable subtitles and enter languages such as `en,fi`; automatic captions are
   a separate option. Availability depends on the source.
5. Optionally set a per-job speed limit in KiB/s, or apply a saved profile.
6. Choose **Add to queue**, or press Enter. Shift+Enter inserts a newline.

The form clears only after the batch is accepted. Ordinary batches accept 100
links and deduplicate repeated links. The queue holds 500 jobs in total.
An exact format belongs to the previewed link; preview again after changing the
URL. A video-only format may need an audio companion and ffmpeg. Size estimates
may omit additional audio, subtitles or processing space.

Up to 20 named profiles remember the folder, quality/audio, subtitles and speed.
They exclude authentication and source-specific exact format IDs. Quality presets
are maximum heights, not a promise that the source provides that resolution.

## 3. Select playlist entries

1. Put the playlist URL first and choose **Choose from playlist**.
2. Search the current page, tick entries or select ranges such as `1-10,15`.
3. Add the selected entries to the queue, or clear the selection before paging.
4. Use **Next page** to reach entries beyond 500.

Each page has at most 500 entries and nothing is selected initially. Unavailable,
private, invalid and nested-playlist entries cannot be selected. Search and range
selection apply to the current page; selections do not span pages. Selected jobs
must fit in the remaining queue capacity.

Previewing fetches metadata, not media. A preview expires after 15 minutes;
closing cancels inspection and discards its selection. A failed enqueue preserves
the selection. Ordinary **Add to queue** never expands a whole playlist.

## 4. Control the queue

The default concurrency is one; Settings allows 1–5. Select multiple rows to
pause, resume, cancel or move waiting jobs to the top. Per-job controls remain
available. Pause keeps partial files; cancel also leaves media files untouched.
Other jobs continue independently. Repeated URL/folder pairs wait for each other.

Settings also provides:

- **Total download speed limit:** `0` means unlimited. A positive limit is split
  conservatively between configured slots. Each job respects its own lower
  limit. Changing the total limit, or concurrency while it is enabled, restarts
  active transfers with partial files retained. Without a total limit, lowering
  concurrency lets active jobs finish.
- **Download hours:** a local-time window, including overnight windows. At its
  end, active jobs pause and retain partials. Automatically paused work resumes
  in the next window; manually paused work stays paused. The app must be running.
- **Retries:** up to five automatic retries for recoverable network, rate-limit
  or stalled-download errors, with bounded backoff. Authentication and invalid
  format errors need action instead of endless retries.
- **Disk reserve:** a free-space floor plus estimated active-job reservations.
  Jobs wait when known free space is insufficient; unknown sizes remain estimates.
- **Stall timeouts:** separate limits for download and processing phases.
- **Notifications:** optional grouped desktop notifications without media titles.

The duplicate archive can skip a previously completed source/option/destination
combination if its nonempty output file still exists. Disable duplicate skipping
when you intentionally want a new transfer. The archive does not scan or identify
every existing media file.

## 5. History, privacy and updates

Completed entries offer file/folder actions. With ffprobe, completion includes a
container/stream check; without it the UI reports size-only verification. This is
not a complete decode of every frame. Failed jobs show an error category and
suggested action; retry with changed options when needed.

Search history, delete selected records, choose retention days, export a reduced
JSON record or clear history. History retains at most 100 entries; `0` retention
days disables age pruning, not that count limit. Deletion removes matching
duplicate-archive references, but never media files.

**Private mode** applies to newly added jobs: their queue state, history and
duplicate records are not saved, so they are lost on exit. Downloaded files still
exist. Optional **Encrypt saved activity on this device** uses the OS secret
store when available. It protects saved settings/activity, not cookie files,
media or previous plaintext backups. Keep a private backup before profile recovery.
Before downgrading to 1.1, disable encryption in 1.2 and back up the profile, or
use a separate profile. Version 1.1 cannot read the encrypted 1.2 payload.

Choose a light, dark or system theme. Application update checks are enabled on
startup and can be disabled; they contact GitHub. Download and installation are
separate explicit actions. Source runs and unsupported/unsigned package types
offer the release page. No signed 1.2 release is published yet.

Closing hides the app if a tray exists. Use tray **Quit** to stop safely and save
eligible work; without a tray, closing exits. Pending jobs resume after restart,
subject to schedule/space limits. Manually paused jobs stay paused. Private jobs
do not resume. Source runs cannot enable start at login.
