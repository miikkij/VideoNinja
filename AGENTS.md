# Repository workflow

This is a solo-maintainer repository. For authorized project changes, work on
`main`, run the relevant checks, commit exact paths and push directly to
`origin/main`. Do not create a separate branch or pull request unless the owner
explicitly requests one. Preserve unrelated changes and never force-push.

Use pnpm and the Node version in `.nvmrc`. Keep documentation current and verify
the pushed commit's CI result. Tags and public releases follow the owner's
release instructions; a source update alone does not request a release.
