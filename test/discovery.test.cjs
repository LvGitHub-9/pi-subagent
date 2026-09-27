/**
 * Agent discovery regression test.
 *
 * Loads extensions/subagent/agents.ts through the jiti instance that ships with
 * the globally installed Pi, in a throwaway PI_CODING_AGENT_DIR, and checks the
 * builtin / user / project precedence rules.
 *
 * Run: node test/discovery.test.cjs
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");

const packageRoot = path.resolve(__dirname, "..");
const npmRoot = process.env.PI_NODE_MODULES || execSync("npm root -g", { encoding: "utf8" }).trim();
const piPackage = path.join(npmRoot, "@earendil-works", "pi-coding-agent");

// Point discovery at a scratch agent dir so the real ~/.pi/agent is untouched.
const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-agentdir-"));
const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-project-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

function writeAgent(dir, file, name, description) {
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, file),
		`---\nname: ${name}\ndescription: ${description}\ntools: read\n---\n\nPrompt for ${name}.\n`,
	);
}

writeAgent(path.join(agentDir, "agents"), "scout.md", "scout", "user-level scout override");
writeAgent(path.join(agentDir, "agents"), "local.md", "local-only", "user-only agent");
writeAgent(path.join(projectDir, ".pi", "agents"), "worker.md", "worker", "project-level worker override");
writeAgent(path.join(projectDir, ".pi", "agents"), "repo.md", "repo-only", "project-only agent");

const { createJiti } = require(path.join(piPackage, "node_modules", "jiti", "lib", "jiti.cjs"));
const jiti = createJiti(__filename, {
	alias: { "@earendil-works/pi-coding-agent": piPackage },
	moduleCache: false,
});
const { discoverAgents, getBuiltinAgentsDir } = jiti(path.join(packageRoot, "extensions", "subagent", "agents.ts"));

const builtinDir = getBuiltinAgentsDir();
assert.ok(fs.existsSync(builtinDir), `builtin agents dir should exist: ${builtinDir}`);
assert.equal(path.basename(builtinDir), "agents");
assert.equal(path.basename(path.dirname(builtinDir)), path.basename(packageRoot));

const names = (scope) => discoverAgents(projectDir, scope).agents.map((a) => `${a.name}:${a.source}`);
const find = (scope, name) => discoverAgents(projectDir, scope).agents.find((a) => a.name === name);

// user scope: builtin + user, builtin agents present, user overrides builtin.
const userScope = names("user");
for (const name of ["planner", "scout", "reviewer", "worker"]) {
	assert.ok(userScope.includes(`${name}:builtin`) || userScope.includes(`${name}:user`), `missing ${name} in user scope`);
}
assert.equal(find("user", "scout").source, "user", "user agent should override builtin scout");
assert.equal(find("user", "planner").source, "builtin", "untouched builtin agent stays builtin");
assert.equal(find("user", "local-only").source, "user");
assert.equal(find("user", "repo-only"), undefined, "project agents must not load in user scope");
assert.equal(discoverAgents(projectDir, "user").projectAgentsDir !== null, true, "project dir should be detected");

// project scope: builtin + project, project overrides user.
assert.equal(find("project", "worker").source, "project", "project agent should override builtin worker");
assert.equal(find("project", "local-only"), undefined, "user agents must not load in project scope");
assert.equal(find("project", "repo-only").source, "project");

// both: builtin + user + project, project wins.
assert.equal(find("both", "scout").source, "user");
assert.equal(find("both", "worker").source, "project");
assert.equal(find("both", "repo-only").source, "project");
assert.equal(find("both", "local-only").source, "user");

// builtin scout is overridden by the user agent, so only three stay builtin here.
const builtinInUserScope = discoverAgents(projectDir, "user")
	.agents.filter((a) => a.source === "builtin")
	.map((a) => a.name)
	.sort();
assert.deepEqual(builtinInUserScope, ["planner", "reviewer", "worker"]);

fs.rmSync(agentDir, { recursive: true, force: true });
fs.rmSync(projectDir, { recursive: true, force: true });
console.log("discovery test passed (builtin dir:", builtinDir + ")");
