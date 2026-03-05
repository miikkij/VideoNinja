# Contributing to VideoNinja

Thank you for your interest in contributing to VideoNinja! This guide will help you get started.

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 9
- [yt-dlp](https://github.com/yt-dlp/yt-dlp/releases) installed and accessible in PATH (for testing downloads)

### Getting Started

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/VideoNinja.git
cd VideoNinja

# Install dependencies
pnpm install

# Start the app in development mode
pnpm start
```

## Project Architecture

VideoNinja is an Electron application with two processes:

```
src/
├── main/               # Electron main process (Node.js)
│   ├── index.js        # App lifecycle, tray, IPC handlers, window management
│   ├── ytdlp.js        # yt-dlp detection, download execution, disk space checks
│   └── downloadQueue.js # Download queue with persistence (EventEmitter-based)
├── renderer/           # Electron renderer process (Browser)
│   ├── index.html      # UI structure
│   ├── app.js          # UI logic, IPC communication
│   └── styles.css      # Styling
└── assets/
    └── icons/          # App icons (PNG, SVG)
```

**Main process** (`src/main/`) handles system-level operations: tray icon, file system access, yt-dlp execution, and settings persistence.

**Renderer process** (`src/renderer/`) handles the UI: displaying download progress, settings panel, and user interactions.

The two processes communicate via Electron's IPC (Inter-Process Communication).

## How to Contribute

### Reporting Bugs

1. Check [existing issues](https://github.com/YOUR_USERNAME/VideoNinja/issues) to avoid duplicates
2. Use the **Bug Report** issue template
3. Include steps to reproduce, expected behavior, and your environment details

### Suggesting Features

1. Check existing issues and discussions first
2. Use the **Feature Request** issue template
3. Explain the problem you're trying to solve, not just the solution

### Submitting Code

1. Fork the repository
2. Create a feature branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. Make your changes
4. Run linting:
   ```bash
   pnpm lint
   ```
5. Commit using [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat: add batch download support
   fix: resolve memory leak in converter
   docs: update installation instructions
   chore: upgrade electron to v28
   ```
6. Push your branch and open a Pull Request

### Pull Request Guidelines

- Fill out the PR template completely
- Keep PRs focused — one feature or fix per PR
- Update documentation if your change affects user-facing behavior
- Ensure linting passes

## Code Style

- We use **ESLint** for linting and **Prettier** for formatting
- Run `pnpm lint` before committing
- Use `require()` (CommonJS) — the project does not use ES modules
- Prefer descriptive variable names over comments

## Branch Naming

- `feature/description` — New features
- `fix/description` — Bug fixes
- `docs/description` — Documentation changes
- `chore/description` — Maintenance tasks

## Questions?

Open an issue with the question label, or start a discussion if enabled on the repository.
