# pi-subagent

**Delegate tasks to subagents with isolated context windows from inside [Pi](https://pi.dev).** The main session only gets the compressed result instead of the exploration noise.

**English** | [中文](README.zh-CN.md)

Built on Pi's official `examples/extensions/subagent`; every deliberate change is listed in [Differences from the official example](#differences-from-the-official-example).

## Install

As a local Pi package (recommended — keeps it under version control):

```bash
pi install ./pi-subagent
```

Or add it to `~/.pi/agent/settings.json`:

```json
{ "packages": ["/absolute/path/to/pi-subagent"] }
```

To try it for a single run:

```bash
pi -e ./pi-subagent
```

Once installed the main model gains a `subagent` tool.

## Modes

| Mode | Parameters | Notes |
|---|---|---|
| Single | `{ agent, task }` | One agent, one job |
| Parallel | `{ tasks: [...] }` | Up to 8 tasks, at most 4 concurrent |
| Chain | `{ chain: [...] }` | Sequential; later steps reference the previous output with `{previous}` |

Called with no mode parameters the tool returns the list of available agents, so the model can discover them itself.

Examples:

```
Use scout to find all authentication code
Run 2 scouts in parallel: one to find models, one to find providers
Chain: scout finds the read tool, planner suggests improvements
```

## Builtin agents

| Agent | Purpose | Tools |
|---|---|---|
| `scout` | Fast codebase recon, returns compressed structured context | read, grep, find, ls, bash |
| `planner` | Read-only analysis, produces an actionable plan | read, grep, find, ls |
| `reviewer` | Code review (quality / security), read-only bash (prompt-enforced, not enforced by tooling) | read, grep, find, ls, bash |
| `worker` | General-purpose executor, unrestricted | all |

Builtin agents do not pin a model: they **inherit the dispatching session's model and thinking level**.

## Custom agents

Drop a markdown file into `agents/`; YAML frontmatter carries the metadata:

```markdown
---
name: my-agent
description: What this agent does
tools: read, grep, find
model: deepseek/deepseek-flash   # omit to inherit the parent session
---

The system prompt goes here.
```

Three tiers, later wins (same name = higher tier takes precedence):

| Tier | Location | Loaded when |
|---|---|---|
| builtin | `<this package>/agents/*.md` | always |
| user | `~/.pi/agent/agents/*.md` | `agentScope: "user"` (default) or `"both"` |
| project | `.pi/agents/*.md` in `<cwd>` or **any ancestor**; pass `cwd` to pick the target project | only with `agentScope: "project"` or `"both"` |

`PI_SUBAGENT_AGENTS_DIR` overrides the builtin directory (for tests or unusual layouts).

## Security model

Every subagent is a separate `pi` process with its own system prompt and tool/model configuration.

- **Project agents (`.pi/agents/`) are repository-controlled** and are not loaded by default; enabling them requires an explicit `agentScope: "both"` (or `"project"`).
- Whenever a project agent is **actually requested**, interactive mode always asks first. **Pi's own project trust is useless here**: `.pi/agents/` is not one of Pi's protected resources (settings/extensions/skills/themes are), so a project holding only `.pi/agents` is reported as *trusted* and `ctx.isProjectTrusted()` is always true — relying on it makes the gate decorative. Hence: request means prompt.
- **With no UI, the request is refused** (`pi -p` / `--mode json` and other headless cases) instead of silently proceeding: if nobody can consent, it does not run. The error suggests running interactively or using `agentScope: "user"`.
- A user can waive the prompt with `PI_SUBAGENT_CONFIRM_PROJECT_AGENTS=0`, which must be **in the environment Pi starts from**. That switch **belongs to the user** — it is not a tool parameter, so the model cannot turn it off.
- `/subagent-agents` only lists project agents when the project is trusted.

## Workflow prompt templates

```
/implement <request>              scout → planner → worker
/scout-and-plan <request>         scout → planner (no implementation)
/implement-and-review <request>   worker → reviewer → worker
```

## Interface

- Collapsed view: status icon, agent name, usage stats; single mode shows the last 10 tool calls/text items, chain and parallel show the last 5 per step.
- `Ctrl+O` expands: full task, every tool call, the final output rendered as Markdown, and per-step usage.
- Parallel mode shows live progress such as `2/3 done, 1 running`; Ctrl+C propagates to the child processes.

## Testing

```bash
npm test        # 4 suites, fully offline: no model calls, no terminal, never touches your real ~/.pi/agent
```

| Suite | Coverage |
|---|---|
| `test/discovery.test.cjs` | three-tier precedence, scope isolation, the `PI_SUBAGENT_AGENTS_DIR` override, tolerance of malformed agent files |
| `test/render.test.cjs` | `renderCall` / `renderResult` across every mode × collapsed/expanded × success/failure/running (76 checks), including narrow widths and visible-width overflow |
| `test/tool.test.cjs` | the whole execution pipeline (93 checks): spawn, JSONL parsing, usage aggregation, `{previous}` substitution, the 50 KB cap, the trust gate, aborts, temp-file cleanup |
| `test/extension.test.cjs` | the registration surface: tool and parameter schema, prompt integration, `/subagent-agents` trust behaviour, no event subscriptions in the factory |

Two things make offline testing possible:

1. **Rendering needs no terminal**: `renderCall` / `renderResult` return pi-tui components whose only requirement is `render(width): string[]`.
2. **No model calls**: the child is started as `node <process.argv[1]>`, so the tests point `process.argv[1]` at `test/fake-pi.cjs`, which replays messages in the `--mode json` shape and records every argument it received for assertions.

`test/_harness.cjs` locates the Pi installation and loads the real extension through jiti. The aliases point at package **dist directories** rather than entry files — a file alias is prefix-substituted by jiti and breaks subpath imports such as `@earendil-works/pi-ai/compat`.

### Manual check of the confirmation dialog (needs a real TUI)

The suite uses a fake `ctx`, so the actual dialog can only be eyeballed. The repository ships `.pi/agents/demo.md` as a fixed fixture:

1. Open a new session in the repository directory (or pass `cwd` pointing at it from anywhere);
2. Ask it to call subagent with `agentScope: "both"` and `agent: "demo"`;
3. A confirmation dialog should appear; answering no should return `Canceled: project-local agents not approved.`.

Note: the project agent directory is found by walking **up** from the session cwd, so when the session runs in a parent directory you must pass `cwd` to name the target project, otherwise you get `Unknown agent`.

## Differences from the official example

1. **Builtin agents directory**: the official example only looks at user / project, so agent definitions have to be copied into `~/.pi/agent/agents` by hand. A `builtin` tier is added, the package ships 4 agents that work out of the box, and user / project agents can still override them.
2. **Agents inherit the model**: the official example pins `claude-*`; here they inherit the dispatching session's model by default.
3. **Discoverability**: calling with no arguments lists the agents, plus a `/subagent-agents` command.
4. **System-prompt integration**: `promptSnippet` and `promptGuidelines` are added, so the tool shows up in the default system prompt's tool list with guidance on when to use it.
5. **Tests**: a regression suite instead of manual checking.
6. **Invalid parameters throw**: the official branch merely returns ordinary text, so the model treats "you got the arguments wrong" as a successful call. This throws instead.
7. **Abort escalation fixed**: the official code uses `if (!proc.killed)` to decide whether to escalate to SIGKILL, but `proc.killed` is already true once SIGTERM has been delivered, so SIGKILL was never sent. It now tests `exitCode` / `signalCode`, `unref()`s the timer and clears it on close.
8. **Trust gate rebuilt**: the official conditions have two holes — (a) it uses `!ctx.isProjectTrusted()`, but `.pi/agents/` is not a Pi-protected resource, so a project holding only agents counts as trusted and the gate effectively never fires; (b) `confirmProjectAgents` is a tool parameter, and in a real session the model set it to `false` and bypassed the prompt silently. Now: requesting a project agent always prompts, no UI means refusal, and the waiver lives only in a user environment variable.
9. **`/subagent-agents` respects project trust**: the command does not exist upstream; as added, it only lists project agents for a trusted project.
10. **Offline test suite**: the official example is verified by hand; this one is covered by a fake child process plus headless rendering, with no model calls and no terminal.
11. **`cwd` participates in agent discovery**: the official example only searches from the session cwd, so delegating from a parent directory into a subproject cannot find that subproject's agents (in a real session the model worked around it by copying the agent file into the parent, dirtying the repo). Here `cwd` selects the discovery directory as well as the child's working directory.

## Error handling and trade-offs

Pi only marks a tool result as failed when `execute()` **throws**: an `isError: true` on the returned object is ignored (verified — both the event stream and the model-facing `toolResult.isError` were `false`; the official example's failure branches are ignored the same way).

- **Conflicting mode parameters**: throws, so the model clearly sees the failure and corrects itself. There is no completed work to display.
- **Every other failure** returns self-describing text and **deliberately does not throw** — throwing would discard `details`, and on failure the user most wants to see which tools the subagent called before dying. Prefixes per mode:
  - single: `Agent <stopReason>: <output>` (usually `Agent error:` / `Agent aborted:`, or `Agent failed:` when the process exits non-zero)
  - chain: `Chain stopped at step N (<agent>): <output>`
  - parallel: `Parallel: N/M succeeded`, with `### [<agent>] failed` per failed task
  - more than 8 parallel tasks: `Too many parallel tasks (...)`
  - project agent not approved: `Canceled: project-local agents not approved.`, or `Refused to run project-local agents: no UI is available to confirm them.` without a UI
- **Abort**: Ctrl+C sends SIGTERM, escalates to SIGKILL if the child is still running after 5 seconds, then throws `Subagent was aborted`. Note that on Windows `process.kill`'s SIGTERM terminates the process outright (it cannot be caught), so the escalation only matters on POSIX; the escalation branch is covered by tests on POSIX, while on Windows the tests only assert that the call settles and the child is really gone.

## Known limitations

- Collapsed view: the last 10 items in single mode, the last 5 per step in chain and parallel.
- In parallel mode the model-facing output is capped at 50 KB per task (the full result stays in the tool details).
- `reviewer`'s read-only nature is a prompt-level constraint; `--tools` cannot stop bash from writing. A hard guarantee needs an extra permission-gating extension.
- Agent directories are rescanned on every call, so editing an agent file takes effect mid-session.

## License

MIT — see [LICENSE](LICENSE).
