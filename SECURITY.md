# Security policy

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/miikkij/VideoNinja/security/advisories/new)
if enabled for this repository. Include the affected version, operating system,
reproduction steps, impact and a proposed fix if available.

Do not publish exploit details, cookie files, tokens or private download URLs in
an ordinary issue. If private reporting is unavailable, ask the maintainer to
enable a private channel without including sensitive details. There is no
guaranteed response time or documented support window for historical branches.

## Version 1.1 security boundaries

The implementation now uses a sandboxed, context-isolated renderer with Node
integration disabled. A restricted local resource protocol and Content Security
Policy limit renderer resources; untrusted values enter the DOM as text.
Navigation, webviews and new windows are denied.

A narrow preload API replaces generic renderer IPC access. Main-process commands
validate the originating window/frame, URL and payload. File actions use completed
download IDs, check resolved paths against the destination folder and allow only
regular media files. External navigation is limited to fixed help links.

Download processes launch without a shell. URLs and options are validated;
arbitrary extra arguments, plugin directories, user yt-dlp configuration and
remote-component downloads are disabled. Output/errors are bounded and redacted.
Cancellation and shutdown wait for process-tree termination. Saved state is
validated and migrated; malformed configuration is preserved separately rather
than silently overwritten.

Playlist inspection is a separate, bounded metadata operation. It does not
enqueue or download media automatically. Selection requests refer to entries in
a main-process preview cache, which expires after 15 minutes; arbitrary renderer
URLs cannot be substituted for those entries. Unsafe, private or unavailable
entries are disabled, and selected URLs/options are validated again before an
atomic queue insertion. Playlist metadata is reduced to allowlisted fields and
rendered as text. Each resulting download is constrained to one media item.

Concurrency is limited to 1–5 jobs, with a separate controller for each. The same
URL/output-directory key stays reserved through process termination. Filenames
also distinguish quality/audio format and URL hashes to keep different aliases
from sharing partial files. These protections do not lock files against other
applications or processes running as the user.

These boundaries reduce the authority of renderer content. They are not a
security certification, a sandbox around yt-dlp/ffmpeg, or protection against
another process running with the user's permissions. See
[Architecture](docs/ARCHITECTURE.md) for the implemented contracts and
[Contributing](CONTRIBUTING.md) for verification.

## Dependencies and distribution

Keep Electron and the external media tools updated. Audit the whole dependency
tree as well as production dependencies: Electron is declared as a development
dependency but ships as the application's runtime.

```sh
pnpm run audit
# Inspect every advisory, including build-only moderate findings:
pnpm audit
pnpm audit --prod
```

The repository's `audit` script gates high/critical findings in the full tree and
all findings in production dependencies. Invoke it with **`pnpm run audit`**;
`pnpm audit` invokes pnpm's built-in command instead.

The local audit reviewed on **2026-10-16** reported no high/critical full-tree
findings and no production dependency findings. One moderate advisory remains:
[sprintf-js GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c),
affecting 1.1.3 with no patched release listed at that review. Untrusted format
precision can cause a formatter exception. The dependency is in the
`electron-builder → app-builder-lib → @electron/get → global-agent → roarr`
build chain.

VideoNinja does not call sprintf-js directly, and the inspected global-agent
logging sites use fixed message formats with variable data in structured fields.
This reduces the identified exposure in the present build path; it does not
establish zero risk. The advisory is not suppressed. Monitor the upstream fix,
review changes to that call path and rerun audits when dependencies change.
An audit snapshot does not assess external executables or guarantee the absence
of undisclosed vulnerabilities.

CI is configured to check Windows, macOS and Linux packages. A configured job is
not evidence that a specific commit passed; review its actual results. The
release workflow creates only a draft on matching version tags, and manual
builds do not create a release. Published packages are available through
[GitHub Releases](https://github.com/miikkij/VideoNinja/releases).
Version 1.1.0 packages are unsigned; code signing and macOS notarization are not
configured, and there is no automatic application updater.

## Local data and authentication

Settings and queue/history live in plaintext `config.json` under the Electron
user-data directory. Saved data can include original video URLs and query
strings, destination paths, cookie-file paths, browser choices, User-Agent,
Referer, normalized options and redacted errors. The store is not encrypted.
Corrupt-file backups retain the original bytes and may contain older secrets.

Cookie files can grant account access. Use only your own authorized session,
restrict file access, keep files outside the repository and remove them when no
longer needed. Browser extraction may fail because of locks, permissions or
encryption. VideoNinja does not automatically retry without cookies after a
cookie failure.

History export omits local paths, error text and authentication/network options;
it removes credentials, query strings and fragments from URLs. Titles and URL
paths remain and can still identify private content. Review exports, copied
errors and screenshots before sharing. Error redaction is a safeguard, not a
guarantee that arbitrary upstream diagnostics contain no sensitive information.

Clearing history removes records only. Downloaded/partial media, settings,
cookie files and corrupt-configuration backups remain. Those files must be
managed separately by their owner.

## External tools and source content

yt-dlp, ffmpeg/ffprobe and a JavaScript runtime are installed separately and run
with the user's permissions. Use trusted distributions and keep their
dependencies current. Executable discovery/version checks do not establish
provenance or verify that yt-dlp EJS challenge scripts are installed and usable.
Follow the [official EJS instructions](https://github.com/yt-dlp/yt-dlp/wiki/EJS)
for that setup.

Downloading or previewing a video or playlist contacts the source service through yt-dlp.
URLs, authentication choices and network options affect what that service sees.
Download only content you are authorized to save; the application does not
grant access to restricted accounts or content.
