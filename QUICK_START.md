# VideoNinja quick start

[Suomeksi](QUICK_START.fi.md) · [Troubleshooting](docs/TROUBLESHOOTING.md)

Download the package for your operating system from
[VideoNinja 1.1.0 downloads](README.md#download-videoninja-110).
The macOS package is for Apple Silicon. Packages are unsigned; macOS is not notarized.

## 1. Install the tools

Install [yt-dlp](https://github.com/yt-dlp/yt-dlp#installation),
[ffmpeg with ffprobe](https://ffmpeg.org/download.html) and
[Deno](https://docs.deno.com/runtime/getting_started/installation/).
They are separate from VideoNinja.

If you already use Chocolatey on Windows, run in an elevated terminal:

```powershell
choco install yt-dlp ffmpeg deno -y
```

With Homebrew on macOS:

```sh
brew install yt-dlp ffmpeg deno
```

On Linux, use your distribution's ffmpeg package and the official yt-dlp and Deno
installation instructions above. Distribution yt-dlp packages can lag site changes.
Keep executables in a trusted PATH directory, such as your user-local bin folder.

Check in a new terminal:

```sh
yt-dlp --version
ffmpeg -version
ffprobe -version
deno --version
```

Deno 2.3+ or Node.js 22+ can support YouTube challenges. The
[yt-dlp EJS guide](https://github.com/yt-dlp/yt-dlp/wiki/EJS) explains the matching
scripts. Official yt-dlp executables include EJS; other distributions may require
extra installation. VideoNinja does not download challenge code automatically.

## 2. Launch and choose a folder

Launch your packaged VideoNinja application, or follow the
[source setup](README.md#run-from-source). Select **English** or **Suomi** in the header.

1. Settings opens automatically when setup is incomplete.
2. Choose a writable **Download folder**.
3. Review yt-dlp, ffmpeg and runtime status.
4. After installing a missing tool, choose **Check tools again**.
5. Settings save automatically. A failed save stays visible with a retry action.

Restart the app after changing system PATH. **Settings** and F3 open preferences
at any time. Start at login is optional and should be enabled from the installed app.

## 3. Download

1. Paste one or more permitted HTTP(S) video links, one per line.
2. Choose the quality. **Best available** is a useful first choice.
3. Optionally choose **Preview first link** to fetch its title and duration.
4. Click **Add to queue**, or press Enter. Shift+Enter inserts a newline.
5. The form clears only after the main process accepts the batch.

The queue runs one download at a time by default. In Settings, choose 1–5 under
**Maximum simultaneous downloads**. Raising the limit starts more waiting jobs;
lowering it lets active jobs finish. Repeated jobs for the same URL and folder
wait for each other even when a slot is free. More parallel downloads share your
connection and may meet source-site limits.

Use **Pause**, **Resume**, **Cancel** and the move controls to manage each job.
Pause preserves partial files where supported. Cancel stops that job; it does not
delete downloaded or partial files. Other active jobs continue independently.
Ordinary batches accept up to 100 links, deduplicate repeated links in the batch,
and fit within the total queue limit of 500 jobs.

For **Audio only**, choose Original format or a conversion format. Conversion and
separate-stream merging require ffmpeg. A quality limit is a maximum, not a promise
that the source offers that resolution.

## 4. Select videos from a playlist

1. Paste a playlist URL as the first link in the input.
2. Choose the quality/audio options in the main form.
3. Choose **Choose from playlist**. This fetches metadata without downloading media files.
4. Tick the videos you want, or use **Select all available**. Nothing is selected initially.
5. Choose **Add selected to queue** to enqueue the selected videos.

Unavailable/private entries are disabled. The preview shows at most the first
500 entries and displays a notice if more exist. Use a smaller playlist or
individual video links for later entries. Selected jobs must fit within the
queue's remaining capacity; duplicates in the selection are added once.

The preview expires after 15 minutes. Close and preview again if it expires;
closing also cancels an in-progress preview. A failed enqueue keeps the selection
and shows its error. Ordinary **Add to queue** handles individual jobs and does
not expand the entire playlist; use the selection dialog for playlist downloads.

## 5. Use history and exit

Completed entries offer file and folder actions. A file moved or removed outside
the app can no longer be opened from its old entry. Failed entries retain an
error with copy and retry controls.

Search history, export a reduced JSON record, or clear the history after confirming.
Neither clearing nor exporting changes media files.

Closing hides the app when a tray exists. Click the tray to reopen, or choose
**Quit** to stop downloads safely and save the queue. Without a tray, closing exits.
On the next launch, pending work resumes and paused jobs remain paused.
