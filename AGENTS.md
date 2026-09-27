# Working in this repository

Conventions for agents and contributors. Read this before changing the extension.

## Distribution: GitHub only

Releases are cut here as a tag on `main` plus a GitHub Release. The project is
**deliberately not published to npm** — do not add npm publishing steps, a
`prepublishOnly` hook, or `pi install npm:...` instructions. Users install with:

```bash
pi install git:github.com/LvGitHub-9/pi-subagent@v0.1.0
```

## Non-negotiables

- **Tests stay offline.** No test may call a model or need a terminal. Extend
  `test/fake-pi.cjs` (a stub child process) or the headless renderer harness instead of
  adding a live integration test.
- **The model never decides the trust gate.** Project-local agents are
  repository-controlled input, so the confirmation is not a tool parameter and the waiver
  lives only in the user's environment.
- **`isError: true` on a returned tool result is ignored by Pi.** Only throwing from
  `execute()` produces a failed tool result; do not rely on the field.
- **Everything must work headless** (`pi -p`, `--mode json`, `ctx.hasUI === false`).
- **Both READMEs are maintained.** `README.md` (English) and `README.zh-CN.md` (Chinese)
  are translations of each other; update both.

## Workflow

- `npm test` before every commit; CI runs it on Ubuntu and Windows, Node 22 and 24.
- User-visible changes get a `CHANGELOG.md` entry under `Unreleased`.
- Release from a clean `main`: `GH=/path/to/gh scripts/release.sh <version>` — add the
  changelog section first, the script uses it as the release body.
- Prefer a regression test over a paragraph documenting behaviour you verified by hand.
