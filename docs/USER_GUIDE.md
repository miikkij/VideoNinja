# Service download guide

This guide covers the **1.2 development series**. Start with the
[quick start](../QUICK_START.md) or [suomenkielinen pikaohje](../QUICK_START.fi.md)
for ordinary downloads, playlists and queue controls. Public 1.1 packages do not
include the managed-tool controls described here.

## Identify an installed update

The header and window title show the same version as the installer. Starting with
1.2.1, each newly installed version shows its English/Finnish What's new notes.
Use **Got it** to acknowledge them; the choice survives restarts. The header's
**What's new** button reopens the notes later. An older installation without a
version marker is shown without guessing its previous version. Application
versions and yt-dlp's separate Stable/Nightly versions identify different updates.

## Update the downloader first

In Settings, check the selected yt-dlp version and path. A warning appears when
the date in that version is more than 90 UTC calendar days old. This is an age
check, not a comparison with the latest online release; a newer version can still
need a service-specific fix.

Manually pause all queued jobs and close previews before installing or updating
tools. Wait for active processes to finish stopping; jobs paused only by the
schedule can restart automatically and must also be paused manually. The queue
and partial files can stay in place. Select **Nightly** in the yt-dlp card and use
**Install / Update** when Stable fails on a recently changed service. Upstream
recommends Nightly for regular users and asks users to try it before reporting
Stable failures. Stable remains selectable. VideoNinja uses the official release
repositories and checks downloaded files against their checksum manifests.
[yt-dlp update instructions](https://github.com/yt-dlp/yt-dlp#update)

Managed tools take priority over external installations. Updating a separate
terminal copy does not replace the managed copy shown in Settings. For an
externally maintained official binary, the upstream channel-switch command is
`yt-dlp --update-to nightly`; package-manager installations must use their own
update method. Recheck tools afterward and confirm the displayed path/version.

### Optional automatic maintenance

Enable **Automatic tool updates** in Settings to check managed yt-dlp, Deno and
ffmpeg/ffprobe once per day. It is off by default. Only tools already installed
by VideoNinja are eligible; missing tools, external installations and guided
macOS ffmpeg setup remain manual. The selected Stable/Nightly channel applies to
yt-dlp. Changing it requests a new check, but automatic maintenance never moves
yt-dlp or Deno to an older version. Use the manual update action for an intentional
channel downgrade.

Maintenance waits until downloads are idle or manually paused, active processes
have stopped and previews are closed. New downloads stay blocked during the
exclusive update operation. A busy queue is checked again later. Check attempts
are saved before network requests, so restarting after a failed check does not
cause repeated daily requests. The status shows the latest check and individual
tool outcomes; one failed tool does not erase another tool's successful update.

Current versions are not reinstalled. FFmpeg's moving `latest` release is compared
by its official checksum. A failed download, verification or activation keeps or
restores the earlier managed installation; if restoring it fails, its backup is
retained for recovery. Turning automatic updates off cancels the operation and
waits for cleanup. Manual installation and updates remain available.

## Browser challenges and site cooldowns

**Browser compatibility: Automatic** is the default download option. A recognized
Cloudflare challenge triggers one retry using yt-dlp's supported generic browser
impersonation mode. Metadata and the download share that attempt. **Off** disables
the fallback; **Compatible** requests it immediately. Missing browser support has
its own tool-update guidance. Cookie and login errors do not trigger this fallback.

Successful compatibility is remembered for that exact site and yt-dlp version
for seven days. Settings lists the remembered sites and can clear them. Private
jobs neither use nor store these preferences. The app never chooses account
cookies automatically. **Open source** lets you visit the job's page yourself;
interactive CAPTCHA or login may still require your browser and selected cookies.

HTTP 429 errors delay other waiting jobs for the same site, starting at 30 seconds
and backing off to at most 15 minutes. That site then runs one download at a time
for 15 minutes after its cooldown, while other sites can continue. Existing
transfers are allowed to finish. The queue explains that the site requested a pause and
the next retry time when available. Technical diagnostics start collapsed and
can be opened or copied when needed.

## Instagram: login, unavailable content and access limits

Use a direct post or Reel link and open the same link in your browser first.
If it requires login, use a browser account that can already view that content
and select that browser as the cookie source in Settings. Alternatively select
a valid cookie file exported from your own authorized session. Refresh expired
cookies before using **Retry with options** so the retry receives the new settings.

An Instagram access error is not necessarily a bad URL. Its extractor distinguishes
restricted posts, login redirects after anonymous access limits and empty media
responses. If the browser cannot access the post, updating yt-dlp cannot grant
access. If it plays in the browser but fails with current Nightly and appropriate
cookies, report the redacted error and version. A photo-only post has no video to
download. Whole-profile extraction has separate limitations from individual posts.
[Official Instagram extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/instagram.py)

For rate-limit errors, stop repeated retries, allow the service to recover and
reduce queue concurrency. Reusing the same restricted session across more jobs
does not resolve its access restriction.

## YouTube: runtime and EJS

Install or update managed yt-dlp and Deno, then use **Check YouTube support**.
YouTube challenge handling needs both a JavaScript runtime and compatible EJS
scripts. Upstream recommends Deno, currently at least 2.3.0; Node.js 22+ is another
supported runtime. Official standalone yt-dlp executables include EJS. External
Python/package-manager distributions may need their matching EJS package updated
separately. Follow the [official EJS guide](https://github.com/yt-dlp/yt-dlp/wiki/EJS).

VideoNinja's check inspects installed components and compares the identified
upstream requirement where available. A compatible result is not a live challenge,
account-login or download test. VideoNinja disables automatic remote-component
fetching, plugins and user yt-dlp configuration, so CLI-only setup changes may not
apply inside the app.

Account-restricted videos can still need valid cookies. Some YouTube formats also
require PO tokens; VideoNinja does not provide a PO-token setup flow. Runtime/EJS
installation does not remove those requirements. See the upstream
[YouTube extractor notes](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#youtube)
for current account and token limitations. If an exact format disappears, preview
again or return to Automatic selection.

## Browser cookie errors

Cookie extraction errors happen before the requested service can authenticate:

- **Database locked / permission denied:** fully quit the selected browser,
  including background processes, and retry. Chromium browsers can lock their
  cookie database on Windows.
  [Upstream browser-lock issue](https://github.com/yt-dlp/yt-dlp/issues/7271)
- **DPAPI / decryption failed:** Chromium cookie encryption on Windows can prevent
  extraction even after the browser closes. Use an authorized Firefox session or
  a cookie file exported through a trusted method. Do not disable browser
  encryption or run VideoNinja as administrator to work around it.
  [Upstream decryption issue](https://github.com/yt-dlp/yt-dlp/issues/10927)
- **Cookie file rejected:** select a Netscape/Mozilla-format file, not JSON or a
  browser database. Export a fresh session if login has expired. Cookie files can
  contain reusable account credentials; keep them out of screenshots, issue
  attachments and shared folders.
  [Official cookie instructions](https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp)

VideoNinja does not silently discard selected cookies and retry anonymously.
Use **Retry with options** after changing cookie settings; an ordinary retry
retains the job's original options.

## Other services and reporting

The [supported-site list](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md)
lists extractors, not a guarantee that every URL currently works. Services change,
and access can depend on the account, region, source format and current extractor.
Test one permitted URL before adding a large batch. ffmpeg/ffprobe are needed for
merging, conversion and stronger completed-file checks; they do not fix login or
extractor errors. The local media smoke tests exercise owned fixtures, not all
live services.

When reporting a failure, include VideoNinja and yt-dlp versions, OS, selected
channel, error category and whether the same content plays in your browser.
Review error details before sharing and remove private links or account data.
See [Troubleshooting](TROUBLESHOOTING.md#reproduce-and-report) for the report route.

Other yt-dlp frontends address the same integration needs:
[Parabolic](https://github.com/NickvisionApps/Parabolic/releases) provides in-app Deno updates and cookie-file guidance for unsupported Windows browsers;
[Seal](https://github.com/JunkFood02/Seal/releases/tag/v1.12.1) documents yt-dlp update intervals and blocks downloads while updating the downloader.
