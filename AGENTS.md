# Repository workflow

This is a solo-maintainer repository. For authorized project changes, work on
`main`, run the relevant checks, commit exact paths and push directly to
`origin/main`. Do not create a separate branch or pull request unless the owner
explicitly requests one. Preserve unrelated changes and never force-push.

Use pnpm and the Node version in `.nvmrc`. Keep documentation current and verify
the pushed commit's CI result. Tags and public releases follow the owner's
release instructions; a source update alone does not request a release.

The existing ninja personality, quotes and playful interactions are product
features. Preserve them unless the owner explicitly requests their removal.

Before delivering a changed application or installing it locally, advance the
application version with `pnpm version:next patch` (or `minor` / `major` as
appropriate). Add that version's dated English and Finnish notes to
`src/shared/releaseNotes.json` first and update `CHANGELOG.md`. The version in
`package.json` is canonical for the UI, window title and installers. Never reuse
an already delivered application version for changed application code; test-only
or documentation-only follow-ups do not require a version bump. Run
`pnpm release:verify` before packaging. Versioning does not itself authorize a
public release or tag.
