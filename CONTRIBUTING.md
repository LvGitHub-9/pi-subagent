# Contributing

## Development setup

There is no build step: Pi loads the TypeScript extension through jiti, so the
package works straight from a checkout.

```bash
git clone https://github.com/LvGitHub-9/pi-subagent.git
cd pi-subagent
pi install ./            # or: pi -e ./extensions/subagent/index.ts
```

To try the tool without installing it, run a single session with the extension
loaded explicitly:

```bash
pi -e ./extensions/subagent/index.ts
```

## Tests

```bash
npm test
```

Four suites, all offline: no model calls, no terminal, and the real
`~/.pi/agent` is never touched. See the "Testing" section of the README for what
each suite covers.

Requirements: Node >= 22.19 and a Pi installation (`npm install -g
@earendil-works/pi-coding-agent`). The harness locates Pi via `PI_PACKAGE_DIR`
first, then `npm root -g`, so pointing it at any checkout works:

```bash
PI_PACKAGE_DIR=/path/to/pi-coding-agent npm test
```

### Adding a regression test

Most behaviour can be covered without a model:

- **Discovery / parsing** — `test/discovery.test.cjs`, fixtures written into a temp dir.
- **Rendering** — `test/render.test.cjs`, calls `renderCall` / `renderResult` and asserts on
  `render(width)` rows. No terminal is involved.
- **Execution** — `test/tool.test.cjs`, drives `execute()` against `test/fake-pi.cjs`. The tool
  starts its child as `node <process.argv[1]>`, and the suite points `process.argv[1]` at the
  stub, so spawn behaviour, JSONL parsing, usage aggregation, truncation, aborts and the trust
  gate are all testable deterministically. The stub reports every argument it received to a
  JSONL file for assertions.
- **Registration surface** — `test/extension.test.cjs`.

## Layout

```
extensions/subagent/index.ts   the tool: schema, execute(), renderCall/renderResult
extensions/subagent/agents.ts  agent discovery and precedence
agents/*.md                    builtin agents shipped with the package
prompts/*.md                   workflow prompt templates
test/                          offline suites and their harness
```

## Guidelines

- Keep the extension independent of rendering: everything must work in `-p` / `--mode json`
  where `ctx.hasUI` is false.
- A tool result is only marked as failed when `execute()` throws. Returning
  `isError: true` on the result object is ignored by Pi, so do not rely on it.
- Project-local agents are repository-controlled input. Never let the model decide whether the
  user is asked about them.
- Prefer adding a test over documenting a behaviour you just verified by hand.

## Releasing

1. Add a `## [x.y.z] - YYYY-MM-DD` section to `CHANGELOG.md` (it becomes the release body) and
   commit it.
2. Run the release script from `main` with a clean tree:

   ```bash
   scripts/release.sh 0.2.0          # GH=/path/to/gh if gh is not on PATH
   ```

   It runs the test suite, bumps `package.json`, commits `chore(release): vX.Y.Z`, tags, pushes
   `main` and the tag, then creates the GitHub Release from the changelog section.

CI runs the suite on Ubuntu and Windows with Node 22 and 24 against a pinned Pi version, plus an
advisory job against the newest Pi.

## Distribution

Releases are **GitHub-only**: a tag on `main` plus a GitHub Release. The package is
deliberately not published to npm, so users install it straight from the repository:

```bash
pi install git:github.com/LvGitHub-9/pi-subagent@v0.1.0
```

Please do not add npm publishing steps back in.
