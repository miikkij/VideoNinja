# VideoNinja — GitHub Public Release Plan

A step-by-step plan to take VideoNinja from its current state to a polished, publicly publishable GitHub project.

---

## Current State Assessment

### What's Already Done ✅

| Item | Status | Notes |
|------|--------|-------|
| README.md | ✅ Good | Well-structured with features, install, usage, project structure |
| .gitignore | ✅ Good | Comprehensive, covers deps/build/OS/IDE/electron |
| GitHub Actions (build.yml) | ✅ Exists | Cross-platform build matrix (macOS + Windows) |
| Functional app | ✅ Works | Electron app with yt-dlp integration, queue, tray, settings |
| Project structure | ✅ Clean | `src/main/`, `src/renderer/`, `src/assets/` separation |
| pnpm workspace | ✅ Configured | Lock file and workspace yaml present |

### What's Missing ❌

| Item | Priority | Impact |
|------|----------|--------|
| LICENSE file | 🔴 Critical | Cannot be open source without one |
| CONTRIBUTING.md | 🔴 High | Contributors won't know how to help |
| CODE_OF_CONDUCT.md | 🟡 Medium | GitHub community standards requirement |
| CHANGELOG.md | 🟡 Medium | No version history for users |
| SECURITY.md | 🟡 Medium | No vulnerability reporting process |
| Issue templates | 🟡 Medium | Unstructured bug reports |
| PR template | 🟡 Medium | Inconsistent pull requests |
| Badges in README | 🟢 Low | Missing visual trust signals |
| Tests | 🔴 High | Zero test coverage |
| Linter/Formatter config | 🟡 Medium | No enforced code style |
| .editorconfig | 🟢 Low | Inconsistent editor settings |
| Social preview image | 🟢 Low | Bland appearance on social shares |
| Dependabot config | 🟢 Low | No automated dep updates |
| CODEOWNERS | 🟢 Low | No defined ownership |

### Cleanup Needed 🧹

| Item | Issue |
|------|-------|
| Finnish-language docs | MEGATODOLIST.md, PROJEKTIN_MUUTOKSET.md are in Finnish — decide: keep internal or translate |
| Excess build docs | BUILD_MAC.md, MAC_BUILD_OPTIONS.md, GITHUB_ACTIONS_BUILD.md, ICON_INSTRUCTIONS.md clutter root |
| Utility scripts in root | `convert-icons-to-png.js`, `create-512-icon.js`, `create-icons.js`, `generate-icons.js`, `prepare-build.js` |
| `continue-on-error: true` in CI | Build failures are silently ignored |
| No `lint` or `test` scripts | package.json has no quality gates |
| Description in package.json | Says "YouTube video downloader using yt-dlp" — could be more polished |
| Disclaimer | README mentions YouTube — ensure legal disclaimer is prominent |

---

## Phase 1: Critical — Must Do Before Public Release

> **Goal:** Meet the absolute minimum bar for a credible public project.

### 1.1 Add LICENSE file

- [ ] Choose license (MIT is simplest for desktop apps)
- [ ] Create `LICENSE` file in root
- [ ] Ensure `package.json` `"license"` field matches
- [ ] Verify README license section matches

### 1.2 Clean Up Root Directory

Move internal/build docs out of root to reduce noise:

- [ ] Create `docs/` directory
- [ ] Move to `docs/internal/`: `MEGATODOLIST.md`, `PROJEKTIN_MUUTOKSET.md`
- [ ] Move to `docs/build/`: `BUILD_MAC.md`, `MAC_BUILD_OPTIONS.md`, `GITHUB_ACTIONS_BUILD.md`, `ICON_INSTRUCTIONS.md`
- [ ] Move to `scripts/`: `convert-icons-to-png.js`, `create-512-icon.js`, `create-icons.js`, `generate-icons.js`, `prepare-build.js`
- [ ] Move `install.bat`, `install.sh`, `build-mac.sh`, `quick-build-mac.sh` to `scripts/`
- [ ] Update any references to moved files
- [ ] Delete or move `github_optics.md` (reference doc, not part of the project itself)

**Target root directory after cleanup:**
```
VideoNinja/
├── .github/
├── docs/
├── scripts/
├── src/
├── .editorconfig
├── .gitignore
├── CHANGELOG.md
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md
├── LICENSE
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── QUICK_START.md
├── README.md
└── SECURITY.md
```

### 1.3 Audit for Secrets & Sensitive Data

- [ ] Scan git history for accidentally committed secrets, API keys, tokens
- [ ] Ensure no hardcoded paths to personal directories exist in source
- [ ] Check that no personal email addresses or names appear unintentionally
- [ ] Verify `.gitignore` blocks `.env` files

### 1.4 Verify Fresh Clone Builds

- [ ] Clone the repo to a new directory
- [ ] Run `pnpm install && pnpm start` — confirm it works
- [ ] Run `pnpm build:win` — confirm build succeeds
- [ ] Document any system prerequisites not in README (e.g., Python for node-gyp)

### 1.5 Add Legal Disclaimer

- [ ] Ensure README has a clear disclaimer about YouTube ToS/copyright
- [ ] State the project is for personal/educational use
- [ ] Note that users are responsible for how they use the tool

---

## Phase 2: Professional Quality — Should Do

> **Goal:** Pass GitHub's community standards checklist and look like a maintained project.

### 2.1 Create CONTRIBUTING.md

Include:
- [ ] Prerequisites (Node.js version, pnpm, yt-dlp for testing)
- [ ] Development setup steps (`pnpm install`, `pnpm start`)
- [ ] Project architecture overview (main process vs renderer)
- [ ] Code style expectations
- [ ] How to submit issues and PRs
- [ ] Commit message format (adopt Conventional Commits)
- [ ] Branch naming convention

### 2.2 Create CODE_OF_CONDUCT.md

- [ ] Use Contributor Covenant v2.1 (industry standard)
- [ ] Fill in enforcement contact email

### 2.3 Create CHANGELOG.md

- [ ] Follow [Keep a Changelog](https://keepachangelog.com/) format
- [ ] Document current v1.0.0 features as the initial entry
- [ ] Reference PROJEKTIN_MUUTOKSET.md for historical changes (translate key items)

### 2.4 Create SECURITY.md

- [ ] Define supported versions
- [ ] Provide vulnerability reporting instructions (email, not public issues)
- [ ] Set response time expectations

### 2.5 Add Issue & PR Templates

- [ ] Create `.github/ISSUE_TEMPLATE/bug_report.md` with structured fields
- [ ] Create `.github/ISSUE_TEMPLATE/feature_request.md`
- [ ] Create `.github/ISSUE_TEMPLATE/config.yml` to enable blank issues or add links
- [ ] Create `.github/PULL_REQUEST_TEMPLATE.md`

### 2.6 Add Linting & Formatting

- [ ] Install ESLint + config (`eslint.config.js`)
- [ ] Install Prettier (`.prettierrc`)
- [ ] Add `"lint"` script to package.json
- [ ] Add `"format"` script to package.json
- [ ] Run linter/formatter on all existing code and fix issues
- [ ] Create `.editorconfig` (indent style, end of line, charset)

### 2.7 Improve CI Pipeline

Current `build.yml` issues to fix:
- [ ] Remove `continue-on-error: true` — builds should fail visibly
- [ ] Add a separate CI workflow that runs on push/PR to `main` (not just tags)
- [ ] Add lint step to CI
- [ ] Add test step to CI (once tests exist)
- [ ] Pin GitHub Actions to SHA hashes instead of tags (security)

Create `.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install -g pnpm
      - run: pnpm install
      - run: pnpm lint
      - run: pnpm test
```

### 2.8 Add Badges to README

Add at the top of README.md:
- [ ] CI status badge
- [ ] License badge
- [ ] Platform badge (Windows, macOS)
- [ ] Version badge (from package.json)

### 2.9 Polish README

- [ ] Add screenshot or GIF of the app in action
- [ ] Ensure all sections are in English (currently good)
- [ ] Add "Download" section linking to GitHub Releases for end users
- [ ] Make the disclaimer section more prominent

---

## Phase 3: Testing — Build Confidence

> **Goal:** Add basic test coverage so contributors don't break things.

### 3.1 Set Up Test Framework

- [ ] Install a test framework (Vitest or Jest)
- [ ] Add `"test"` script to package.json
- [ ] Create `tests/` directory mirroring `src/`

### 3.2 Write Unit Tests

Priority order based on complexity and criticality:

- [ ] `tests/main/downloadQueue.test.js` — Queue add, remove, order, persistence
- [ ] `tests/main/ytdlp.test.js` — Path detection, argument building, format parsing
- [ ] `tests/main/index.test.js` — IPC handler registration (mock Electron)

### 3.3 Add Coverage Reporting (Optional)

- [ ] Configure coverage output (lcov, text)
- [ ] Add coverage badge to README
- [ ] Set minimum threshold (e.g., 50% to start)

---

## Phase 4: Polish & Discoverability

> **Goal:** Make the project stand out and be easy to find.

### 4.1 Repository Settings (on GitHub)

- [ ] Set description: "A beautiful, user-friendly YouTube video downloader built with Electron and yt-dlp"
- [ ] Set website URL to GitHub Pages or releases page
- [ ] Add topics: `electron`, `youtube`, `video-downloader`, `yt-dlp`, `desktop-app`, `nodejs`, `javascript`, `windows`, `macos`, `cross-platform`
- [ ] Upload social preview image (1280×640)
- [ ] Disable Wikis (use `docs/` instead)
- [ ] Enable/Disable Discussions (choose based on support preference)

### 4.2 Configure Branch Protection

- [ ] Require PR reviews before merging to `main`
- [ ] Require CI status checks to pass before merging
- [ ] Enable auto-delete head branches

### 4.3 Set Up Dependabot

Create `.github/dependabot.yml`:
- [ ] Monitor npm dependencies weekly
- [ ] Monitor GitHub Actions versions monthly

### 4.4 Create First GitHub Release

- [ ] Tag current state as `v1.0.0`
- [ ] Write release notes summarizing features
- [ ] Attach Windows installer (.exe) and portable build
- [ ] Attach macOS build (.dmg) if available

### 4.5 Create Social Preview Image

- [ ] Design 1280×640 image with app logo, name, and tagline
- [ ] Upload in repository settings

### 4.6 Add CODEOWNERS

Create `.github/CODEOWNERS`:
```
* @your-github-username
```

### 4.7 Add FUNDING.yml (Optional)

If accepting sponsorship:
```yaml
github: your-username
# ko_fi: your-username
# buy_me_a_coffee: your-username
```

---

## Phase 5: Post-Launch

> **Goal:** Sustain the project after going public.

### 5.1 Announce

- [ ] Post on Reddit (r/electronjs, r/javascript, r/opensource)
- [ ] Post on Hacker News (Show HN)
- [ ] Share on dev.to or Hashnode
- [ ] Submit to relevant awesome lists (`awesome-electron`, etc.)

### 5.2 Ongoing Maintenance

- [ ] Respond to issues within 48 hours (even just to acknowledge)
- [ ] Review PRs within a week
- [ ] Keep dependencies updated (Dependabot helps)
- [ ] Make regular releases with changelogs
- [ ] Keep README current with new features

### 5.3 Monitor

- [ ] Watch for security alerts from GitHub/Dependabot
- [ ] Track star/fork growth to gauge interest
- [ ] Monitor issue trends to identify common problems

---

## Execution Order — Quick Reference

| # | Task | Effort | Phase |
|---|------|--------|-------|
| 1 | Add LICENSE file | 5 min | 1 |
| 2 | Audit for secrets/personal data | 30 min | 1 |
| 3 | Verify fresh clone builds | 15 min | 1 |
| 4 | Clean up root directory (move files) | 30 min | 1 |
| 5 | Add legal disclaimer | 10 min | 1 |
| 6 | Create CONTRIBUTING.md | 30 min | 2 |
| 7 | Create CODE_OF_CONDUCT.md | 5 min | 2 |
| 8 | Create CHANGELOG.md | 20 min | 2 |
| 9 | Create SECURITY.md | 10 min | 2 |
| 10 | Add issue & PR templates | 20 min | 2 |
| 11 | Set up ESLint + Prettier | 45 min | 2 |
| 12 | Fix CI pipeline + add CI workflow | 30 min | 2 |
| 13 | Add badges to README | 10 min | 2 |
| 14 | Take screenshot, polish README | 20 min | 2 |
| 15 | Set up test framework | 30 min | 3 |
| 16 | Write unit tests | 2-4 hrs | 3 |
| 17 | Configure GitHub repo settings | 15 min | 4 |
| 18 | Set up branch protection | 10 min | 4 |
| 19 | Configure Dependabot | 5 min | 4 |
| 20 | Create first GitHub Release (v1.0.0) | 30 min | 4 |
| 21 | Create social preview image | 30 min | 4 |
| 22 | Announce on communities | 1 hr | 5 |

---

## Definition of Done

The project is ready for public release when:

- [x] README clearly explains what it does, how to install, how to use
- [ ] LICENSE file exists and matches package.json
- [ ] No secrets or personal data in repo history
- [ ] Fresh clone builds successfully on Windows and macOS
- [ ] CONTRIBUTING.md guides new contributors
- [ ] CODE_OF_CONDUCT.md establishes community norms
- [ ] CHANGELOG.md documents version history
- [ ] SECURITY.md exists with reporting instructions
- [ ] CI runs lint on every push/PR
- [ ] Root directory is clean (non-essential files moved to docs/scripts)
- [ ] Legal disclaimer is prominent
- [ ] GitHub repo description and topics are set
- [ ] At least one GitHub Release exists with downloadable artifacts

**Minimum viable public release = Phase 1 + Phase 2 complete.**
