/**
 * Shared offline test harness.
 *
 * Loads the real extension through jiti (the loader Pi itself uses) with a
 * stubbed extension API, so the tool's registrations, renderers and execute()
 * paths can be tested without a terminal and without a model call.
 *
 * Module resolution: the extension lives outside Pi's node_modules tree, so the
 * four peer packages are aliased. The aliases point at package *directories*,
 * not entry files: a file alias is prefix-substituted by jiti and would break
 * subpath imports such as `@earendil-works/pi-ai/compat`.
 */

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { execSync } = require("node:child_process");

function resolvePiPackage() {
	const candidates = [];
	if (process.env.PI_PACKAGE_DIR) candidates.push(process.env.PI_PACKAGE_DIR);
	try {
		const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
		candidates.push(path.join(globalRoot, "@earendil-works", "pi-coding-agent"));
	} catch {
		/* npm unavailable */
	}
	try {
		candidates.push(path.resolve(path.dirname(require.resolve("@earendil-works/pi-coding-agent")), ".."));
	} catch {
		/* not resolvable from here */
	}
	for (const candidate of candidates) {
		if (candidate && fs.existsSync(path.join(candidate, "package.json"))) return candidate;
	}
	throw new Error("Cannot locate @earendil-works/pi-coding-agent; set PI_PACKAGE_DIR");
}

const PKG = resolvePiPackage();
const PACKAGE_ROOT = path.resolve(__dirname, "..");
const EXT_ENTRY = path.join(PACKAGE_ROOT, "extensions", "subagent", "index.ts");
const AGENTS_ENTRY = path.join(PACKAGE_ROOT, "extensions", "subagent", "agents.ts");
const FAKE_PI = path.join(__dirname, "fake-pi.cjs");

// Isolate agent discovery from the developer's real ~/.pi/agent.
const AGENT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-test-agentdir-"));
process.env.PI_CODING_AGENT_DIR = AGENT_DIR;
process.on("exit", () => fs.rmSync(AGENT_DIR, { recursive: true, force: true }));

const { createJiti } = require(path.join(PKG, "node_modules", "jiti", "lib", "jiti.cjs"));
const { initTheme } = require(path.join(PKG, "dist", "index.js"));
initTheme();

function load(file) {
	return createJiti(__filename, {
		moduleCache: false,
		alias: {
			"@earendil-works/pi-coding-agent": path.join(PKG, "dist"),
			"@earendil-works/pi-tui": path.join(PKG, "node_modules", "@earendil-works", "pi-tui", "dist"),
			"@earendil-works/pi-ai": path.join(PKG, "node_modules", "@earendil-works", "pi-ai", "dist"),
			typebox: path.join(PKG, "node_modules", "typebox", "build"),
		},
	})(file);
}

/** Load the extension and capture everything it registers. */
function loadExtension() {
	const mod = load(EXT_ENTRY);
	const tools = new Map();
	const commands = new Map();
	const listeners = new Map();
	mod.default({
		registerTool: (tool) => tools.set(tool.name, tool),
		registerCommand: (name, options) => commands.set(name, options),
		on: (event, handler) => {
			if (!listeners.has(event)) listeners.set(event, []);
			listeners.get(event).push(handler);
			return () => {};
		},
	});
	return { tools, commands, listeners, tool: tools.get("subagent") };
}

/** Theme stub: renderers only need fg/bg/bold/... to pass text through. */
const THEME = {
	fg: (_color, text) => text,
	bg: (_color, text) => text,
	bold: (text) => text,
	italic: (text) => text,
	underline: (text) => text,
	inverse: (text) => text,
	strikethrough: (text) => text,
};

/** Render a pi-tui Component to plain lines. */
function renderToLines(component, width = 100) {
	return component.render(width);
}

function rowsToText(component, width = 100) {
	return renderToLines(component, width).join("\n");
}

/** Minimal assistant message in Pi's Message shape. */
function assistantMessage(text, toolCalls = []) {
	return {
		role: "assistant",
		content: [
			...(text ? [{ type: "text", text }] : []),
			...toolCalls.map((call, index) => ({ type: "toolCall", id: `c${index}`, name: call.name, arguments: call.arguments })),
		],
		api: "openai-completions",
		provider: "stub",
		model: "stub/model",
		usage: { input: 100, output: 20, cacheRead: 10, cacheWrite: 5, totalTokens: 135, cost: { total: 0.25 } },
		stopReason: "stop",
		timestamp: 0,
	};
}

/** A SingleResult with sensible defaults, as stored in tool result details. */
function singleResult(overrides = {}) {
	return {
		agent: "scout",
		agentSource: "builtin",
		task: "find the auth code",
		exitCode: 0,
		messages: [assistantMessage("found it")],
		stderr: "",
		usage: { input: 100, output: 20, cacheRead: 10, cacheWrite: 5, cost: 0.25, contextTokens: 135, turns: 1 },
		model: "stub/model",
		stopReason: "stop",
		...overrides,
	};
}

/** Tool call arguments for renderCall(). */
function callArgs(overrides = {}) {
	return { agentScope: "user", ...overrides };
}

module.exports = {
	PKG,
	PACKAGE_ROOT,
	EXT_ENTRY,
	AGENTS_ENTRY,
	FAKE_PI,
	AGENT_DIR,
	load,
	loadExtension,
	THEME,
	renderToLines,
	rowsToText,
	assistantMessage,
	singleResult,
	callArgs,
};
