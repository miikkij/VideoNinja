# Security policy

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/miikkij/VideoNinja/security/advisories/new)
if enabled. Include the affected version, operating system, reproduction, impact
and a proposed fix if available. Do not post exploit details, cookies, tokens or
private URLs in an ordinary issue. If private reporting is unavailable, request
a private channel without sensitive details. There is no guaranteed response time
or documented support window for historical branches.

## Application boundaries

These notes describe **1.2.0 development**. Published 1.1.0 packages do not contain
the new encryption, tool manager or application updater.

The renderer is sandboxed and context-isolated with Node integration disabled.
A restricted local protocol/CSP controls resources; untrusted values are rendered
as text. Navigation, webviews and new windows are denied. A narrow preload bridge
replaces generic IPC. Main-process commands validate the sending window/frame
and all payloads. File actions resolve a completed job ID to a checked regular
media file inside its original destination. External links use constrained help,
setup and release destinations.

Processes run without a shell. HTTP(S) URLs reject credentials and control
characters. Options and concrete format IDs are allowlisted; arbitrary selector
expressions, output templates, executable flags, plugins, user configurations and
automatic remote-component downloads are disabled. Output is bounded; errors are
redacted. Cancellation/shutdown await process-tree termination.

Playlist previews fetch bounded metadata pages and never enqueue media without
selection. Cached entries expire after 15 minutes and are revalidated at enqueue.
Metadata/formats omit signed media URLs, request headers and raw tool JSON.
Concurrency is limited to five independent controllers. Duplicate output keys
remain reserved through abort settlement; URL hashes/output profiles separate
aliases and formats. These are in-process protections, not locks against other
programs running as the same user.

ffprobe checks a nonempty final file's container/media streams when available.
The explicit size-only fallback is weaker; neither path fully decodes every frame
or establishes that source content is safe. External tools run with the user's
permissions, outside the renderer sandbox. This is not a security certification.

## Local data and authentication

Saved settings, queue/history and archive are plaintext by default under Electron's
user-data directory. They can contain original URLs/query strings, paths, cookies
source/file references, User-Agent/Referer, normalized options and redacted errors.
Private mode applies to new jobs: they are excluded from saved queue, history,
archive and native notifications. Prior public history/archive is preserved.
Private jobs disappear on exit, but their media/partials remain on disk and network
requests are not anonymous.

Optional OS-backed encryption protects the saved settings/activity payload with
Electron `safeStorage`. Linux without a secure supported secret-store backend
fails closed; `basic_text` and unknown backends are rejected. Windows/macOS use
the OS facility exposed by Electron. This is not a user-chosen password or a
portable encrypted backup. Loss of the OS key/account access can prevent opening
the profile. Decryption failure preserves the file rather than resetting it.
Window geometry is not encrypted. Same-account malware is outside this boundary.
Version 1.1 cannot read the encrypted 1.2 payload. Before downgrading, disable
encryption in 1.2 and back up the profile, or use a separate profile for 1.1.

Encryption does not cover downloaded media, external cookie files, exports,
previous plaintext config/quarantine backups or other filesystem copies. Before
recovery or moving a profile, quit and make a private backup. Config is bounded
at 32 MiB and the plaintext settings/activity payload at 20 MiB on both read and
write. Malformed JSON is quarantined; oversize/unreadable files or failed quarantine
stop startup. Do not delete config or partial media as a first troubleshooting step.

Cookie files can grant account access. Use authorized sessions, restrict access,
keep cookies outside the repository and remove them when no longer needed.
Extraction can fail through locks/permissions/encryption; the app never silently
retries without cookies after authentication fails. Saved download profiles exclude
authentication and source-specific format IDs.

History deletion/retention removes records and related archive references, never
media. Export omits local paths, auth/network options and errors, and strips URL
credentials/query/fragment. Titles and URL paths can still identify private
content. Review exports, copied errors and screenshots before sharing. Redaction
cannot guarantee that arbitrary upstream diagnostics contain no private data.

## Managed tools and network access

Tool install/update is an explicit action and requires an empty queue (including
paused jobs), settled processes and closed previews. Managed installs stay under the selected user-data
tools directory; global installations are unchanged. yt-dlp/Deno use official
GitHub release assets; Windows/Linux ffmpeg/ffprobe uses the upstream-linked
`yt-dlp/FFmpeg-Builds` distribution. macOS ffmpeg is guided through its installation
instructions. No silent privileged global installation is performed.

The manager restricts HTTPS release hosts/redirects, bounds network/archive sizes,
verifies upstream SHA-256 manifests, rejects unsafe archive entries and stages
only requested executables. It probes versions before replacing a managed tool
and attempts rollback on failure. Checksums come from the same upstream release
trust boundary; they do not substitute for an independently authenticated publisher.
Managed yt-dlp standalone/FFmpeg builds carry their upstream GPL licensing; Deno
uses MIT. Follow each distribution's terms if redistributing tools separately.

Tool probes do not prove provenance. EJS diagnosis examines the installed package
and runtime, then compares the package version with the exact upstream yt-dlp
revision when possible. It exposes unknown or incompatible results rather than
claiming success from a version probe. It does not solve a live YouTube challenge.
See the [official EJS guide](https://github.com/yt-dlp/yt-dlp/wiki/EJS).

Downloads/previews contact source services through yt-dlp. Tool installation and
EJS compatibility lookup contact upstream GitHub services. Application startup
update checks contact GitHub by default and can be disabled; app download/install
requires separate actions. There is no application cloud account or remote history
store. Download only content you are authorized to save.

## Dependencies and distribution

Use **`pnpm run audit`** for the repository gate: high/critical findings in the
entire tree and all findings in production dependencies. `pnpm audit` is pnpm's
built-in whole-tree report and does not invoke that script. Electron ships in the
app despite being a development dependency, so production-only audits are insufficient.

The local 1.2 dependency audit reviewed on **2026-10-16** had no high/critical
full-tree findings and no production findings. One moderate advisory remains:
[sprintf-js GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c),
version 1.1.3, with no patched release listed at review. The path was
`electron-builder → app-builder-lib → @electron/get → global-agent → roarr`.
Inspected logging sites used fixed format messages with variable data in structured
fields; VideoNinja does not call sprintf-js directly. This limits identified
exposure but is not a zero-risk claim. The advisory is not suppressed. Re-run the
audits after dependency changes and review actual CI results; this snapshot does
not certify new code or external executables.

The public [1.1.0 release](https://github.com/miikkij/VideoNinja/releases/tag/v1.1.0)
is unsigned and macOS is not notarized. Source 1.2 adds signing/notarization and
updater support, but credentials are not configured and no signed release exists.
[Contributing](CONTRIBUTING.md#signing-and-application-updates) lists exact secrets.
Native updating is enabled only for eligible signed installed Windows/macOS apps
or Linux AppImages; other variants use the release page. Windows publisher
verification remains enabled. Linux manifest/hash verification is not OS code signing.

Workflows validate native artifacts/update manifests and create a draft only for
matching version tags. Manual builds never publish. Verify the exact commit's CI,
artifacts, certificate/notarization results and installed update behavior before
publishing. A configured job or passing checksum is not evidence of a trusted signature.
