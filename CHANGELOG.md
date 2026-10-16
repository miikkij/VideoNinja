# Changelog

All notable changes to VideoNinja are recorded here.

## [Unreleased] - 1.1.0

### Added

- Selectable English/Finnish interface and a Finnish quick-start guide.
- Batch URL input, explicit metadata preview, pause/resume and queue reordering.
- Explicit playlist preview and selection of up to the first 500 entries, with unavailable entries disabled and expiring previews.
- Saved concurrency setting from 1 to 5 downloads, defaulting to 1; lowering the limit lets active jobs finish.
- History search, confirmed clearing and privacy-reduced JSON export.
- Original audio, MP3, M4A, Opus and WAV selection.
- Linux AppImage/Debian packaging and native three-platform CI.
- Real Electron source/package smoke tests, local media fixtures and release artifact checks.

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

No public release has been created for this source change. Code signing,
notarization and an automatic update channel are not configured.
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
