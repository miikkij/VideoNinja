# Changelog

All notable changes to VideoNinja are recorded here.

Public download links still point to 1.1.0. No 1.2 release or signed binaries have
been published.

## [1.2.1] - 2026-10-18 (development build)

### Added

- One canonical application version for the visible header, native window title
  and installer metadata. Each delivered application update advances the version.
- Bundled English/Finnish What's new notes, shown for a newly installed version
  until acknowledged and always available to reopen from the header.
- A persisted per-version acknowledgement. A missing legacy version marker is
  treated as unknown; development launches do not overwrite installed-version state.
- `pnpm version:next patch|minor|major|x.y.z`, guarded by matching bilingual notes
  and release validation. The command does not commit, tag or publish a release.

## [1.2.0] - 2026-10-17 (development builds)

### Added

- One browser-compatibility retry for recognized challenges, expiring per-site
  preferences and per-site rate-limit cooldowns.
- Opt-in daily managed-tool maintenance with a remembered Stable/Nightly channel.

- Explicit managed yt-dlp/Deno installation and updates; managed Windows/Linux
  ffmpeg/ffprobe and guided macOS ffmpeg setup, with upstream checksum verification,
  staging, version probes and rollback.
- Installed EJS/runtime diagnosis and exact-revision compatibility checks when
  available; this does not test a live YouTube challenge.
- Classified actionable errors, bounded automatic retries, disk reservations and
  separate download/processing stall watchdogs.
- Queue multiselect and bulk actions; source-ID duplicate archive with file checks.
- Real format/codec/resolution/size preview and validated concrete format selection.
- Named download profiles, subtitle language selection and automatic captions.
- Playlist search, range selection and paging beyond the first 500 entries.
- Per-job and total bandwidth limits, local-time schedule windows and optional
  grouped desktop notifications.
- Selective history deletion, age retention, private jobs and optional OS-backed
  encryption of saved settings and activity.
- ffprobe container/stream validation of completed media, with explicit size-only
  status when ffprobe is unavailable.
- Light/dark/system themes and refreshed screenshots, including Finnish dark mode.
- Application update checks and explicit download/install flow; signing and macOS
  notarization configuration with update manifests. Credentials remain unconfigured.
- Three-OS real-media CI setup and a separate real-Electron feature smoke.

### Changed

- Positive total speed limits are distributed between configured slots. Changing
  the cap or capped concurrency restarts transfers after process settlement,
  preserving partial files.
- Scheduling pauses active jobs outside the window and resumes only jobs paused
  by the schedule. Private jobs never enter saved queue/history/archive records.
- Config read/write limits are shared: 32 MiB serialized profile and 20 MiB
  settings/activity payload, including encrypted envelopes.
- Release validation covers update manifests, versions, hashes and packaged
  update policy. Release workflows still create reviewable drafts only.

See the [20-item implementation and verification record](docs/DEVELOPMENT_PLAN.md)
for defaults and remaining environment/release checks.

### Fixed

- Restored all 210 original English ninja/queue/download quotes in their original
  order, with matching Finnish translations.
- Restored the clickable ninja, the camera's 100 ms flash and playful queued,
  started, completed and failed download messages without replacing actionable errors.
  The flash respects reduced-motion preferences.
- Refreshed the five existing screenshots and added a real-interface personality
  screenshot captured with isolated sample data.

## [1.1.0] - 2026-10-16

### Added

- Selectable English/Finnish interface and a Finnish quick-start guide.
- Batch URL input, explicit metadata preview, pause/resume and queue reordering.
- Explicit playlist preview and selection of up to the first 500 entries, with unavailable entries disabled and expiring previews.
- Saved concurrency setting from 1 to 5 downloads, defaulting to 1; lowering the limit lets active jobs finish.
- History search, confirmed clearing and privacy-reduced JSON export.
- Original audio, MP3, M4A, Opus and WAV selection.
- Linux AppImage/Debian packaging and native three-platform CI.
- Real Electron source/package smoke tests, local media fixtures and release artifact checks.
- Four README screenshots with a repeatable capture script and isolated sample data.

### Changed

- Electron 44.8, electron-store 12, electron-builder 26.15.3, Vitest 5 and refreshed dependencies.
- Node 24.22.0 development baseline and pinned pnpm/Actions versions.
- Sandboxed renderer, isolated preload API, validated IPC and local-only CSP.
- Shell-free downloads with allowlisted options, explicit tool paths and supported runtime checks.
- Durable schema-versioned queue storage, bounded history/errors and corrupt-config quarantine.
- Atomic, deduplicated batch insertion; ordinary input accepts 100 links and playlist selections share the 500-job queue limit.
- Accessible keyboard flows, persistent errors, stable progress rows and 200% reflow.
- Native start-at-login registration replaces auto-launch; tray uses a static busy indicator.
- README, architecture, troubleshooting, security, contribution and analysis documentation.

### Fixed

- Active cancellation no longer discards the following queued job; shutdown awaits subprocess cleanup.
- Independent cancellation and pause for concurrent jobs; duplicate URL/output jobs remain serialized until process cleanup completes.
- Output filenames distinguish source IDs, quality/audio format and a URL hash; individual jobs cannot expand an entire playlist.
- UUID job identifiers avoid same-millisecond collisions.
- Final files are verified after merging/conversion and safely constrained to the download folder.
- Correct 2160p/1440p limits and audio-only behavior.
- First-run setup, tool rechecking, renderer reload, acknowledged submission and settings-save recovery.
- Actual disk capacity replaces fabricated fallback values.
- Icon script paths, output sizes and missing/corrupt source failures.
- Windows executable metadata/icon editing remains enabled without requiring signing.

[Download VideoNinja 1.1.0](https://github.com/miikkij/VideoNinja/releases/tag/v1.1.0)
for Windows x64, macOS ARM64 and Linux x64. Code signing, notarization and an
automatic update channel are not configured.
One moderate build-only dependency advisory remains without a published fix;
see SECURITY.md.

## [1.0.1] - 2026-03-05

### Added

- ffmpeg detection in settings with status badge
- AI-assisted install help prompt for missing tools (yt-dlp/ffmpeg)
- Screenshots in README

### Fixed

- Windows .ico icon now displays correctly in Start menu
- Stale references to old project name cleaned up

### Changed

- Updated prerequisites docs to include ffmpeg
- Removed outdated roadmap from README
- Updated SECURITY.md to use GitHub private vulnerability reporting

## [1.0.0] - 2026-03-05

### Added

- Initial public release of VideoNinja
- YouTube video downloading via yt-dlp integration
- Download queue with persistence across app restarts
- Quality selection (4K, 1440p, 1080p, 720p, 480p, audio-only)
- Real-time download progress tracking
- System tray integration with flashing notifications
- Disk space monitoring with low-space warnings
- Auto-resume for interrupted downloads
- Persistent settings storage via electron-store
- One-click file access (open video or show in folder)
- Cookie/authentication support for login-protected content
- JavaScript runtime detection for YouTube compatibility
- ffmpeg detection with guided install help
- Cross-platform build support (Windows and macOS)
- CI/CD with GitHub Actions (lint, test, build, release)
