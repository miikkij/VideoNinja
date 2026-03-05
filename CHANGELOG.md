# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

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
