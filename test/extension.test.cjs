/**
 * Registration-surface tests: what the extension publishes to Pi, and how the
 * /subagent-agents command behaves with and without a trusted project.
 *
 * Run: node test/extension.test.cjs
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { loadExtension, AGENT_DIR, callArgs } = require("./_harness.cjs");

const { tool, commands, listeners, tools } = loadExtension();

const PROJECT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-test-cmd-"));
fs.mkdirSync(path.join(PROJECT_DIR, ".pi", "agents"), { recursive: true });
fs.writeFileSync(
	path.join(PROJECT_DIR, ".pi", "agents", "proj.md"),
	"---\nname: proj-agent\ndescription: repository-controlled agent\n---\n\nRepo prompt.\n",
);
fs.mkdirSync(path.join(AGENT_DIR, "agents"), { recursive: true });
fs.writeFileSync(
	path.join(AGENT_DIR, "agents", "mine.md"),
	"---\nname: my-agent\ndescription: personal agent\n---\n\nPersonal prompt.\n",
);
process.on("exit", () => fs.rmSync(PROJECT_DIR, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------
assert.deepEqual([...tools.keys()], ["subagent"], "exactly one tool is registered");
assert.equal(tool.name, "subagent");
assert.equal(tool.label, "Subagent");
assert.equal(typeof tool.execute, "function");
assert.equal(typeof tool.renderCall, "function");
assert.equal(typeof tool.renderResult, "function");

assert.ok(tool.description.includes("isolated context"), tool.description);
assert.ok(tool.description.includes("parallel"), tool.description);
assert.ok(tool.description.includes("chain"), tool.description);
assert.ok(tool.description.includes("builtin agents"), tool.description);
for (const name of ["scout", "planner", "reviewer", "worker"]) {
	assert.ok(tool.promptSnippet.includes(name), `promptSnippet names ${name}: ${tool.promptSnippet}`);
}

// prompt integration: the tool must appear in the system prompt tool list and
// the snippet must not repeat the tool name (Pi renders "- <name>: <snippet>").
assert.equal(typeof tool.promptSnippet, "string");
assert.ok(tool.promptSnippet.length > 0);
assert.ok(!tool.promptSnippet.startsWith("subagent:"), tool.promptSnippet);
assert.ok(Array.isArray(tool.promptGuidelines) && tool.promptGuidelines.length >= 2);

const props = tool.parameters.properties;
for (const key of ["agent", "task", "tasks", "chain", "agentScope", "confirmProjectAgents", "cwd"]) {
	assert.ok(props[key], `parameter ${key} is exposed`);
}
assert.equal(props.agent.type, "string");
assert.equal(props.task.type, "string");
assert.equal(props.tasks.type, "array");
assert.equal(props.chain.type, "array");
assert.deepEqual(props.tasks.items.required, ["agent", "task"]);
assert.deepEqual(props.chain.items.required, ["agent", "task"]);
assert.deepEqual(props.agentScope.enum, ["user", "project", "both"]);
assert.equal(props.agentScope.default, "user");
assert.equal(props.confirmProjectAgents.type, "boolean");
assert.equal(props.confirmProjectAgents.default, true);
// Everything is optional: mode selection happens in execute(), not in the schema.
assert.equal(tool.parameters.required, undefined, "no parameter is required");

// The renderer must tolerate a call with no arguments at all.
assert.ok(Array.isArray(tool.renderCall(callArgs({}), require("./_harness.cjs").THEME, {}).render(80)));

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------
assert.deepEqual([...commands.keys()], ["subagent-agents"]);
const command = commands.get("subagent-agents");
assert.equal(typeof command.handler, "function");
assert.ok(command.description.length > 0);

async function runCommand({ trusted, cwd = PROJECT_DIR }) {
	const notifications = [];
	await command.handler("", {
		cwd,
		isProjectTrusted: () => trusted,
		ui: { notify: (message, type) => notifications.push({ message, type }) },
	});
	assert.equal(notifications.length, 1, "the command notifies exactly once");
	return notifications[0];
}

async function main() {
	const trusted = await runCommand({ trusted: true });
	assert.equal(trusted.type, "info");
	assert.ok(trusted.message.includes("my-agent"), "personal agents are listed");
	assert.ok(trusted.message.includes("proj-agent"), "project agents are listed when trusted");
	assert.ok(trusted.message.includes("Builtin"), "builtin agents are listed");

	const untrusted = await runCommand({ trusted: false });
	assert.ok(untrusted.message.includes("my-agent"), "personal agents are still listed");
	assert.ok(!untrusted.message.includes("proj-agent"), "project agents are hidden when untrusted");
	assert.ok(!untrusted.message.includes("repository-controlled"), "no repository-controlled text leaks");

	const elsewhere = await runCommand({ trusted: true, cwd: os.tmpdir() });
	assert.ok(!elsewhere.message.includes("proj-agent"), "agents outside the cwd tree are not listed");

	// The extension must not subscribe to lifecycle events or start anything in
	// its factory (Pi loads extensions in modes that never run a session).
	assert.equal(listeners.size, 0, `unexpected event subscriptions: ${[...listeners.keys()]}`);

	console.log("extension test passed");
}

main().catch((error) => {
	console.error("extension test failed:", error.message);
	process.exit(1);
});
