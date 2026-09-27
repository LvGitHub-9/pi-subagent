# Security policy

## Reporting a vulnerability

Please report it privately through GitHub's
[security advisories](https://github.com/LvGitHub-9/pi-subagent/security/advisories/new) instead of
a public issue. If that is not possible, open an issue that says only that you have a report and
how to reach you.

## Threat model: project-local agents

A `.pi/agents/*.md` file is a repository-controlled system prompt. Running one hands it the tools
and permissions of a `pi` process, so a cloned repository can attempt to influence an agent that
the user never inspected.

The extension therefore:

- never loads project agents by default (`agentScope: "user"` is the default),
- always asks before running one that was actually requested,
- refuses the request when no UI is available to ask,
- and lets only the **user** waive the prompt, through `PI_SUBAGENT_CONFIRM_PROJECT_AGENTS=0` in
  the environment Pi starts from. The gate is deliberately not a tool parameter: when it was, a
  model set it to `false` and bypassed the prompt silently.

Note that Pi's own project trust does not cover this. `.pi/agents` is not one of Pi's protected
resources, so a repository containing only agent files is reported as trusted.

Review project agents the way you would review an extension before granting trust.

## Scope

- The extension runs inside the Pi process with the user's permissions.
- Subagents are separate `pi` processes with the same operating-system permissions.
- Subagent output is model output derived from repository content. Treat it as untrusted input,
  not as instructions.
