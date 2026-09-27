# Changelog

Notable changes to pi-subagent. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Add the entry for a release under a new `## [x.y.z] - YYYY-MM-DD` heading **before** running
`scripts/release.sh <version>`; the script uses that section as the GitHub Release body.

## [Unreleased]

## [0.1.0] - 2026-09-27

### Added

- `subagent` tool with three modes: single (`agent` + `task`), parallel (`tasks`, max 8 tasks /
  4 concurrent) and chain (`chain`, later steps reference the previous output with `{previous}`).
- Four builtin agents — `scout`, `planner`, `reviewer`, `worker` — shipped inside the package and
  inheriting the dispatching session's model and thinking level.
- Three-tier agent discovery (builtin < user < project) with same-name override, `cwd` selecting
  the target project, and `PI_SUBAGENT_AGENTS_DIR` overriding the builtin directory.
- Calling the tool with no mode parameters lists the available agents; `/subagent-agents` prints
  the same catalogue.
- Workflow prompt templates: `/implement`, `/scout-and-plan`, `/implement-and-review`.
- Offline test suite (four files, 160+ assertions) driven by a fake `pi` child process and
  headless rendering: no model calls, no terminal, no touching the real `~/.pi/agent`.

### Changed

- Invalid mode parameters now throw instead of returning ordinary text, so the model no longer
  treats a malformed call as a success.
- Project agents always require confirmation before they run, and are refused when no UI is
  available. The waiver moved out of the tool parameters — the model used to set
  `confirmProjectAgents: false` and bypass the prompt silently — into the
  `PI_SUBAGENT_CONFIRM_PROJECT_AGENTS=0` environment variable, which only the user controls.
- The trust check no longer relies on `ctx.isProjectTrusted()`, which never gated anything:
  `.pi/agents` is not one of Pi's protected resources, so a project holding only agents is
  reported as trusted.
- `/subagent-agents` only enumerates project agents for a trusted project.

### Fixed

- A YAML syntax error in one agent file no longer aborts discovery for the whole directory;
  the malformed file is skipped. A description containing an unquoted colon used to make every
  agent disappear.
- Abort escalation now really sends SIGKILL: the old `!proc.killed` predicate is already true
  once SIGTERM has been delivered, so the escalation never ran. It now tests
  `exitCode` / `signalCode`, `unref()`s the timer and clears it on close.
