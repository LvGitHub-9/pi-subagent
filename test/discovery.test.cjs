/**
 * Agent discovery tests: the three-tier precedence, scope isolation, the
 * builtin-dir override and tolerance of malformed agent files.
 *
 * Uses the shared harness, so it runs against the same jiti/alias setup as the
 * other suites and never touches the developer's real ~/.pi/agent.
 *
 * Run: node test/discovery.test.cjs
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { load, AGENT_DIR, AGENTS_ENTRY, PACKAGE_ROOT } = require("./_harness.cjs");

const { discoverAgents, getBuiltinAgentsDir, formatAgentCatalog } = load(AGENTS_ENTRY);

const PROJECT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-test-project-"));
process.on("exit", () => fs.rmSync(PROJECT_DIR, { recursive: true, force: true }));

function writeAgent(dir, file, frontmatter, body = "Prompt body.") {
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, file), `---\n${frontmatter}\n---\n\n${body}\n`);
}

// user level: overrides builtin scout, adds a user-only agent
writeAgent(path.join(AGENT_DIR, "agents"), "scout.md", "name: scout\ndescription: user-level scout override\ntools: read");
writeAgent(path.join(AGENT_DIR, "agents"), "local.md", "name: local-only\ndescription: user-only agent\ntools: read, grep");
// project level: overrides builtin worker, adds a project-only agent
writeAgent(path.join(PROJECT_DIR, ".pi", "agents"), "worker.md", "name: worker\ndescription: project-level worker override");
writeAgent(path.join(PROJECT_DIR, ".pi", "agents"), "repo.md", "name: repo-only\ndescription: project-only agent");
// malformed and odd-but-valid files
writeAgent(path.join(PROJECT_DIR, ".pi", "agents"), "no-frontmatter.md", "", "");
fs.writeFileSync(path.join(PROJECT_DIR, ".pi", "agents", "no-frontmatter.md"), "Just a body, no frontmatter.\n");
writeAgent(path.join(PROJECT_DIR, ".pi", "agents"), "incomplete.md", "name: incomplete");
writeAgent(path.join(PROJECT_DIR, ".pi", "agents"), "bad-tools.md", "name: bad-tools\ndescription: tools is a number\ntools: 42");
fs.writeFileSync(path.join(PROJECT_DIR, ".pi", "agents", "notes.txt"), "not markdown");
fs.mkdirSync(path.join(PROJECT_DIR, ".pi", "agents", "subdir"), { recursive: true });

const find = (scope, name) => discoverAgents(PROJECT_DIR, scope).agents.find((a) => a.name === name);
const namesOf = (scope) => discoverAgents(PROJECT_DIR, scope).agents.map((a) => `${a.name}:${a.source}`);

// ---------------------------------------------------------------------------
// builtin directory resolution
// ---------------------------------------------------------------------------
const builtinDir = getBuiltinAgentsDir();
assert.ok(fs.existsSync(builtinDir), `builtin agents dir should exist: ${builtinDir}`);
assert.equal(path.basename(builtinDir), "agents");
assert.equal(path.basename(path.dirname(builtinDir)), path.basename(PACKAGE_ROOT));
assert.equal(discoverAgents(PROJECT_DIR, "user").builtinAgentsDir, builtinDir);

// ---------------------------------------------------------------------------
// user scope: builtin + user; project agents must stay out
// ---------------------------------------------------------------------------
assert.equal(find("user", "scout").source, "user", "user agent overrides builtin scout");
assert.equal(find("user", "planner").source, "builtin", "untouched builtin stays builtin");
assert.equal(find("user", "local-only").source, "user");
assert.equal(find("user", "repo-only"), undefined, "project agents must not load in user scope");
assert.equal(find("user", "proj-agent"), undefined);
assert.notEqual(discoverAgents(PROJECT_DIR, "user").projectAgentsDir, null, "project dir should be detected");
for (const name of ["planner", "scout", "reviewer", "worker"]) {
	assert.ok(namesOf("user").some((entry) => entry.startsWith(`${name}:`)), `missing ${name} in user scope`);
}
assert.deepEqual(
	discoverAgents(PROJECT_DIR, "user")
		.agents.filter((a) => a.source === "builtin")
		.map((a) => a.name)
		.sort(),
	["planner", "reviewer", "worker"],
	"builtin scout is shadowed by the user agent",
);

// ---------------------------------------------------------------------------
// project scope: builtin + project; user agents must stay out
// ---------------------------------------------------------------------------
assert.equal(find("project", "worker").source, "project", "project agent overrides builtin worker");
assert.equal(find("project", "local-only"), undefined, "user agents must not load in project scope");
assert.equal(find("project", "repo-only").source, "project");
assert.equal(find("project", "scout").source, "builtin", "builtin survives project scope");

// ---------------------------------------------------------------------------
// both: builtin + user + project, project wins
// ---------------------------------------------------------------------------
assert.equal(find("both", "scout").source, "user");
assert.equal(find("both", "worker").source, "project");
assert.equal(find("both", "repo-only").source, "project");
assert.equal(find("both", "local-only").source, "user");
assert.equal(find("both", "planner").source, "builtin");

// ---------------------------------------------------------------------------
// malformed input tolerance
// ---------------------------------------------------------------------------
assert.equal(find("both", "incomplete"), undefined, "agent without a description is skipped");
assert.equal(find("both", "no-frontmatter"), undefined, "file without frontmatter is skipped");
assert.equal(find("both", "notes"), undefined, "non-markdown files are ignored");
assert.equal(find("both", "subdir"), undefined, "directories are ignored");
assert.equal(find("both", "bad-tools").tools, undefined, "a non-string/non-array tools value yields no tools");
assert.deepEqual(find("both", "local-only").tools, ["read", "grep"], "comma-separated tools are split");
assert.deepEqual(find("both", "repo-only").tools, undefined, "missing tools means all tools");

// ---------------------------------------------------------------------------
// override env var
// ---------------------------------------------------------------------------
const overrideDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-test-override-"));
writeAgent(overrideDir, "only.md", "name: only-env\ndescription: builtin override dir");
process.env.PI_SUBAGENT_AGENTS_DIR = overrideDir;
assert.equal(getBuiltinAgentsDir(), path.resolve(overrideDir));
assert.deepEqual(
	discoverAgents(PROJECT_DIR, "user").agents.map((a) => a.name).sort(),
	["local-only", "only-env", "scout"],
	"override replaces the builtin tier only",
);
assert.ok(formatAgentCatalog(discoverAgents(PROJECT_DIR, "both").agents).includes("Project (.pi/agents)"));
delete process.env.PI_SUBAGENT_AGENTS_DIR;
assert.equal(getBuiltinAgentsDir(), builtinDir, "override is not sticky");
fs.rmSync(overrideDir, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// catalogue formatting
// ---------------------------------------------------------------------------
const catalogue = formatAgentCatalog(discoverAgents(PROJECT_DIR, "both").agents);
assert.ok(catalogue.includes("Builtin"));
assert.ok(catalogue.includes("User ("));
assert.ok(catalogue.includes("local-only"));
assert.ok(catalogue.includes("model: (inherited)"));
assert.equal(formatAgentCatalog([]), "No agents found.");

console.log("discovery test passed");
