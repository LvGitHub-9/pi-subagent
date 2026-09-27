/**
 * Tool execution tests: the whole execute() pipeline, offline.
 *
 * The subagent tool resolves its child process as `node <process.argv[1]>`, so
 * this suite points process.argv[1] at test/fake-pi.cjs. That child speaks Pi's
 * --mode json protocol and reports back every argument it received, which makes
 * spawn, JSONL parsing, usage aggregation, {previous} substitution, truncation,
 * the project-agent trust gate and even SIGTERM->SIGKILL escalation testable
 * without a model call and without a terminal.
 *
 * Run: node test/tool.test.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { loadExtension, FAKE_PI, AGENT_DIR, PACKAGE_ROOT } = require("./_harness.cjs");

const { tool } = loadExtension();

// The tool spawns `node <process.argv[1]>`: make that the stub.
process.argv[1] = FAKE_PI;

const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-test-work-"));
const REPORT = path.join(WORK_DIR, "stub-report.jsonl");
const PROJECT_DIR = path.join(WORK_DIR, "project");
fs.mkdirSync(path.join(PROJECT_DIR, ".pi", "agents"), { recursive: true });
fs.writeFileSync(
	path.join(PROJECT_DIR, ".pi", "agents", "proj.md"),
	"---\nname: proj-agent\ndescription: project-local agent\ntools: read\n---\n\nProject prompt.\n",
);
fs.mkdirSync(path.join(AGENT_DIR, "agents"), { recursive: true });
fs.writeFileSync(
	path.join(AGENT_DIR, "agents", "pinned.md"),
	"---\nname: pinned-model\ndescription: user agent with a pinned model\ntools: read\nmodel: vendor/pinned-model\n---\n\nPinned prompt.\n",
);

const failures = [];
let checks = 0;
function check(name, condition, detail) {
	checks += 1;
	if (!condition) failures.push(`${name}${detail === undefined ? "" : ` — ${detail}`}`);
}

process.on("exit", () => {
	fs.rmSync(WORK_DIR, { recursive: true, force: true });
});

/** Fake ExtensionContext. */
function makeCtx({ cwd = WORK_DIR, trusted = false, confirmAnswer = true, hasUI = true } = {}) {
	const confirmCalls = [];
	return {
		confirmCalls,
		ctx: {
			mode: "tui",
			hasUI,
			cwd,
			model: { provider: "deepseek", id: "deepseek-flash" },
			thinkingLevel: "medium",
			isProjectTrusted: () => trusted,
			ui: {
				confirm: async (title, message) => {
					confirmCalls.push({ title, message });
					return confirmAnswer;
				},
			},
		},
	};
}

function readReports() {
	if (!fs.existsSync(REPORT)) return [];
	return fs
		.readFileSync(REPORT, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

/** Run the tool once with a clean report file and fresh stub env. */
async function run(params, { ctxOptions = {}, env = {}, signal, onUpdate, resetReport = true } = {}) {
	if (resetReport) fs.rmSync(REPORT, { force: true });
	const saved = {};
	for (const [key, value] of Object.entries({ STUB_REPORT: REPORT, PI_SUBAGENT_CONFIRM_PROJECT_AGENTS: undefined, ...env })) {
		saved[key] = process.env[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = String(value);
	}
	const { ctx, confirmCalls } = makeCtx(ctxOptions);
	try {
		const result = await tool.execute("call-1", params, signal, onUpdate, ctx);
		return { result, reports: readReports(), confirmCalls, threw: undefined };
	} catch (error) {
		return { result: undefined, reports: readReports(), confirmCalls, threw: error.message };
	} finally {
		for (const key of Object.keys({ STUB_REPORT: 1, PI_SUBAGENT_CONFIRM_PROJECT_AGENTS: 1, ...env })) {
			if (saved[key] === undefined) delete process.env[key];
			else process.env[key] = saved[key];
		}
	}
}

const textOf = (result) => result.content.map((part) => part.text ?? "").join("");

async function main() {
	// ---------------------------------------------------------------------------
	// Single mode
	// ---------------------------------------------------------------------------
	{
		const { result, reports, threw } = await run({ agent: "scout", task: "hello" });
		check("single/no-throw", !threw, threw);
		check("single/returns final output", textOf(result) === "stub output for: Task: hello", textOf(result));
		check("single/mode in details", result.details.mode === "single", JSON.stringify(result.details.mode));
		check("single/not an error", !result.isError);
		const r = result.details.results[0];
		check("single/agent recorded", r.agent === "scout" && r.agentSource === "builtin", `${r.agent}/${r.agentSource}`);
		check("single/exit code recorded", r.exitCode === 0, r.exitCode);
		check("single/final message captured", r.messages.length === 1, r.messages.length);
		check(
			"single/usage aggregated",
			r.usage.input === 100 && r.usage.output === 20 && r.usage.cacheRead === 10 && r.usage.cacheWrite === 5 && r.usage.cost === 0.25 && r.usage.turns === 1 && r.usage.contextTokens === 135,
			JSON.stringify(r.usage),
		);
		// The requested model is recorded, not the one the child reports: the guard
		// `if (!currentResult.model)` keeps the dispatch/pinned value.
		check("single/records the requested model", r.model === "deepseek/deepseek-flash", r.model);
		check("single/child received the task", reports[0]?.task === "Task: hello", reports[0]?.task);
		check("single/inherits dispatcher model", reports[0]?.model === "deepseek/deepseek-flash", reports[0]?.model);
		check("single/inherits thinking level", reports[0]?.thinking === "medium", reports[0]?.thinking);
		check("single/passes the agent tool allowlist", reports[0]?.tools === "read,grep,find,ls,bash", reports[0]?.tools);
		check("single/passes the agent system prompt", (reports[0]?.systemPrompt ?? "").includes("You are a scout"), reports[0]?.systemPrompt?.slice(0, 40));
		check("single/runs in the session cwd", reports[0]?.cwd === WORK_DIR, reports[0]?.cwd);
	}

	// Agent with a pinned model: no inheritance of model, but no thinking either.
	{
		const { reports, threw } = await run({ agent: "pinned-model", task: "x" });
		check("single/pinned model overrides dispatcher", reports[0]?.model === "vendor/pinned-model", reports[0]?.model);
		check("single/pinned model does not inherit thinking", reports[0]?.thinking === undefined, reports[0]?.thinking);
		check("single/pinned agent loads from user dir", !threw, threw);
	}

	// cwd override.
	{
		const { reports } = await run({ agent: "scout", task: "x", cwd: PROJECT_DIR });
		check("single/cwd parameter is honoured", reports[0]?.cwd === PROJECT_DIR, reports[0]?.cwd);
	}

	// Streaming updates.
	{
		const updates = [];
		await run({ agent: "scout", task: "x" }, { env: { STUB_TURNS: 3 }, onUpdate: (partial) => updates.push(partial) });
		check("single/onUpdate streams partial results", updates.length >= 3, updates.length);
		check(
			"single/onUpdate carries details",
			updates[updates.length - 1]?.details?.results?.[0]?.agent === "scout",
			JSON.stringify(updates[updates.length - 1]?.details?.mode),
		);
	}

	// ---------------------------------------------------------------------------
	// Failures
	// ---------------------------------------------------------------------------
	{
		const { result } = await run({ agent: "scout", task: "FAILNOW" });
		check("fail/sets isError", result.isError === true);
		check("fail/content names the agent", textOf(result).startsWith("Agent failed:"), textOf(result));
		check("fail/exit code in details", result.details.results[0].exitCode === 3, result.details.results[0].exitCode);
		check("fail/stderr captured", result.details.results[0].stderr.includes("deliberate failure"), result.details.results[0].stderr);
	}
	{
		const { result } = await run({ agent: "scout", task: "x" }, { env: { STUB_STOP: "error", STUB_ERROR: "model exploded" } });
		check("fail/stopReason error is a failure", result.isError === true);
		check("fail/stopReason surfaces the message", textOf(result).includes("model exploded"), textOf(result));
	}
	{
		const { result } = await run({ agent: "scout", task: "x" }, { env: { STUB_EXIT: 0, STUB_STOP: "aborted" } });
		check("fail/aborted stopReason is a failure", result.isError === true);
		check("fail/aborted message names stopReason", textOf(result).startsWith("Agent aborted:"), textOf(result));
	}

	// ---------------------------------------------------------------------------
	// Agent discovery failures and argument validation (must not spawn)
	// ---------------------------------------------------------------------------
	{
		const { result, reports } = await run({ agent: "no-such-agent", task: "x" });
		check("guard/unknown agent is an error", result.isError === true);
		check("guard/unknown agent lists options", textOf(result).includes("Unknown agent") && textOf(result).includes("scout"), textOf(result));
		check("guard/unknown agent spawns nothing", reports.length === 0, reports.length);
	}
	{
		const { reports } = await run({});
		check("guard/no arguments spawns nothing", reports.length === 0, reports.length);
	}
	{
		const { result, reports } = await run({});
		check("guard/no arguments returns the catalogue", textOf(result).includes("Available subagents") && textOf(result).includes("Builtin"), textOf(result).slice(0, 80));
	}
	{
		const { threw, reports } = await run({ tasks: Array.from({ length: 9 }, () => ({ agent: "scout", task: "x" })) });
		check("guard/too many tasks throws nothing but reports", threw === undefined, threw);
		check("guard/too many tasks spawns nothing", reports.length === 0, reports.length);
	}
	{
		const { result } = await run({ tasks: Array.from({ length: 9 }, () => ({ agent: "scout", task: "x" })) });
		check("guard/too many tasks explains the cap", textOf(result).includes("Too many parallel tasks (9)"), textOf(result));
	}
	{
		const { threw, reports } = await run({ agent: "scout", task: "a", tasks: [{ agent: "scout", task: "b" }] });
		check("guard/conflicting modes throw", /exactly one mode/.test(threw ?? ""), threw);
		check("guard/conflicting modes spawn nothing", reports.length === 0, reports.length);
	}

	// ---------------------------------------------------------------------------
	// Chain
	// ---------------------------------------------------------------------------
	{
		const { result, reports } = await run({
			chain: [
				{ agent: "scout", task: "first" },
				{ agent: "planner", task: "after: {previous}" },
			],
		});
		check("chain/two children ran", reports.length === 2, reports.length);
		check("chain/records both steps", result.details.mode === "chain" && result.details.results.length === 2, JSON.stringify(result.details.results.map((r) => r.step)));
		check("chain/step numbering", result.details.results[0].step === 1 && result.details.results[1].step === 2);
		check("chain/returns the last output", textOf(result) === "stub output for: Task: after: stub output for: Task: first", textOf(result));
		check(
			"chain/substitutes {previous} into the child task",
			reports[1]?.task === "Task: after: stub output for: Task: first",
			reports[1]?.task,
		);
		check("chain/uses the second agent", reports[1]?.systemPrompt?.includes("planning specialist") === true, reports[1]?.systemPrompt?.slice(0, 60));
	}
	{
		const { result, reports } = await run({
			chain: [
				{ agent: "scout", task: "ok" },
				{ agent: "scout", task: "FAILNOW" },
				{ agent: "scout", task: "never runs" },
			],
		});
		check("chain/stops at the failing step", reports.length === 2, reports.length);
		check("chain/reports which step failed", textOf(result).includes("Chain stopped at step 2"), textOf(result));
		check("chain/is an error", result.isError === true);
		check("chain/keeps completed step in details", result.details.results.length === 2, result.details.results.length);
	}

	// ---------------------------------------------------------------------------
	// Parallel
	// ---------------------------------------------------------------------------
	{
		const { result, reports } = await run({
			tasks: [
				{ agent: "scout", task: "one" },
				{ agent: "planner", task: "two" },
			],
		});
		check("parallel/both children ran", reports.length === 2, reports.length);
		check("parallel/summary line", textOf(result).startsWith("Parallel: 2/2 succeeded"), textOf(result).slice(0, 40));
		check("parallel/includes both outputs", textOf(result).includes("Task: one") && textOf(result).includes("Task: two"), textOf(result));
		check("parallel/results indexed by task", result.details.results[1].agent === "planner", result.details.results[1].agent);
		check("parallel/usage recorded per task", result.details.results.every((r) => r.usage.input === 100), JSON.stringify(result.details.results.map((r) => r.usage.input)));
	}
	{
		const { result } = await run({
			tasks: [
				{ agent: "scout", task: "one" },
				{ agent: "scout", task: "FAILNOW" },
			],
		});
		check("parallel/partial failure count", textOf(result).startsWith("Parallel: 1/2 succeeded"), textOf(result).slice(0, 40));
		check("parallel/marks the failed task", textOf(result).includes("failed"), textOf(result).slice(0, 400));
	}
	{
		const { result } = await run(
			{ tasks: [{ agent: "scout", task: "big" }] },
			{ env: { STUB_TEXT_SIZE: 60_000 } },
		);
		const text = textOf(result);
		check("parallel/truncates huge output", text.includes("[Output truncated:"), text.slice(-120));
		check("parallel/truncation mentions omitted bytes", /omitted/.test(text), text.slice(-160));
		check("parallel/keeps model-facing output under the cap", text.length < 55_000, text.length);
		check("parallel/full output kept in details", (result.details.results[0].messages[0].content[0].text ?? "").length === 60_000);
	}
	{
		const { result } = await run({
			tasks: Array.from({ length: 6 }, (_, i) => ({ agent: "scout", task: `t${i}` })),
		});
		const order = result.details.results.map((r) => r.task);
		check("parallel/preserves task order", order.join(",") === "t0,t1,t2,t3,t4,t5", order.join(","));
	}

	// ---------------------------------------------------------------------------
	// Project-local agent trust gate
	// ---------------------------------------------------------------------------
	{
		const { result, reports, confirmCalls } = await run(
			{ agent: "proj-agent", task: "x", agentScope: "both" },
			{ ctxOptions: { cwd: PROJECT_DIR, trusted: false, confirmAnswer: false } },
		);
		check("gate/asks before running a project agent", confirmCalls.length === 1, confirmCalls.length);
		check("gate/names the agent in the prompt", (confirmCalls[0]?.message ?? "").includes("proj-agent"), confirmCalls[0]?.message);
		check("gate/cancel returns without spawning", reports.length === 0, reports.length);
		check("gate/cancel explains itself", textOf(result).includes("Canceled"), textOf(result));
	}
	{
		const { result, reports, confirmCalls } = await run(
			{ agent: "proj-agent", task: "x", agentScope: "both" },
			{ ctxOptions: { cwd: PROJECT_DIR, trusted: false, confirmAnswer: true } },
		);
		check("gate/approved run spawns", reports.length === 1, reports.length);
		check("gate/approved run uses the project prompt", reports[0]?.systemPrompt?.includes("Project prompt") === true, reports[0]?.systemPrompt);
		check("gate/approved run reports project source", result.details.results[0].agentSource === "project", result.details.results[0].agentSource);
		check("gate/asked once", confirmCalls.length === 1, confirmCalls.length);
	}
	{
		const { reports, confirmCalls } = await run(
			{ agent: "proj-agent", task: "x", agentScope: "both" },
			{ ctxOptions: { cwd: PROJECT_DIR, trusted: true } },
		);
		// A project holding only .pi/agents is reported as trusted by Pi, so trusting
		// the project must not be enough to skip the prompt.
		check("gate/a trusted project is still asked", confirmCalls.length === 1, confirmCalls.length);
		check("gate/a trusted project runs after approval", reports.length === 1, reports.length);
	}
	{
		// The gate belongs to the user: a tool parameter must not switch it off,
		// even though an older version accepted one.
		const viaParam = await run(
			{ agent: "proj-agent", task: "x", agentScope: "both", confirmProjectAgents: false },
			{ ctxOptions: { cwd: PROJECT_DIR, trusted: false } },
		);
		check("gate/a tool parameter cannot skip the prompt", viaParam.confirmCalls.length === 1, viaParam.confirmCalls.length);
		check("gate/a tool parameter still runs after approval", viaParam.reports.length === 1, viaParam.reports.length);

		const viaEnv = await run(
			{ agent: "proj-agent", task: "x", agentScope: "both" },
			{ ctxOptions: { cwd: PROJECT_DIR, trusted: false }, env: { PI_SUBAGENT_CONFIRM_PROJECT_AGENTS: "0" } },
		);
		check("gate/a user-environment waiver skips the prompt", viaEnv.confirmCalls.length === 0, viaEnv.confirmCalls.length);
		check("gate/a user-environment waiver still runs", viaEnv.reports.length === 1, viaEnv.reports.length);

		const envNoUi = await run(
			{ agent: "proj-agent", task: "x", agentScope: "both" },
			{ ctxOptions: { cwd: PROJECT_DIR, trusted: false, hasUI: false }, env: { PI_SUBAGENT_CONFIRM_PROJECT_AGENTS: "0" } },
		);
		check("gate/a user-environment waiver works without a UI", envNoUi.reports.length === 1, envNoUi.reports.length);
	}
	{
		const { result, reports } = await run({ agent: "proj-agent", task: "x" }, { ctxOptions: { cwd: PROJECT_DIR } });
		check("gate/project agent hidden in default scope", reports.length === 0, reports.length);
		check("gate/project agent hidden error", textOf(result).includes("Unknown agent"), textOf(result));
	}
	{
		const { result, reports, confirmCalls } = await run(
			{ agent: "proj-agent", task: "x", agentScope: "both" },
			{ ctxOptions: { cwd: PROJECT_DIR, trusted: true, confirmAnswer: false, hasUI: false } },
		);
		check("gate/no UI refuses project agents", reports.length === 0, reports.length);
		check("gate/no UI explains the refusal", textOf(result).includes("Refused to run project-local agents"), textOf(result));
		check("gate/no UI points at the waiver", textOf(result).includes("PI_SUBAGENT_CONFIRM_PROJECT_AGENTS"), textOf(result));
		check("gate/no UI does not suggest --approve", !textOf(result).includes("--approve"), textOf(result));
		check("gate/no UI does not ask", confirmCalls.length === 0, confirmCalls.length);
	}

	// ---------------------------------------------------------------------------
	// Abort: SIGTERM is ignored by the stub, so this exercises SIGKILL escalation
	// ---------------------------------------------------------------------------
	{
		const controller = new AbortController();
		const started = Date.now();
		const pending = run(
			{ agent: "scout", task: "x" },
			{ env: { STUB_MODE: "sleep" }, signal: controller.signal },
		);
		setTimeout(() => controller.abort(), 500);
		const outcome = await Promise.race([pending, new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 20_000))]);
		const elapsed = Date.now() - started;
		check("abort/does not hang", outcome?.timedOut !== true, `elapsed=${elapsed}ms`);
		check("abort/rejects the tool call", /aborted/.test(outcome?.threw ?? ""), outcome?.threw);
		check("abort/the child started exactly once", outcome?.reports?.length === 1, outcome?.reports?.length);
		// The rejection only happens after the child's 'close' event, so this proves
		// the child was actually terminated rather than left running.
		check("abort/settles only after the child died", outcome?.timedOut !== true && /aborted/.test(outcome?.threw ?? ""));
		if (process.platform === "win32") {
			// Windows cannot deliver a catchable SIGTERM: process.kill terminates the
			// child outright, so the SIGKILL escalation is unreachable here.
			check("abort/windows settles promptly because SIGTERM is fatal", elapsed < 5000, `elapsed=${elapsed}ms`);
		} else {
			// The stub ignores SIGTERM, so settling at all requires the escalation.
			check("abort/escalates to SIGKILL after the grace period", elapsed >= 4500 && elapsed < 20_000, `elapsed=${elapsed}ms`);
		}
	}

	// ---------------------------------------------------------------------------
	// Temp system-prompt files must not leak
	// ---------------------------------------------------------------------------
	{
		const before = fs.readdirSync(os.tmpdir()).filter((entry) => entry.startsWith("pi-subagent-"));
		await run({ agent: "scout", task: "cleanup" });
		await run({ agent: "scout", task: "FAILNOW" });
		const after = fs.readdirSync(os.tmpdir()).filter((entry) => entry.startsWith("pi-subagent-"));
		check("cleanup/no temp prompt dirs leak", after.length <= before.length, `${before.length} -> ${after.length}`);
	}

	// ---------------------------------------------------------------------------
	// Startup cost sanity: the tool must not shell out for validation failures
	// ---------------------------------------------------------------------------
	{
		const started = Date.now();
		await run({});
		check("perf/listing agents is instant", Date.now() - started < 1000, `${Date.now() - started}ms`);
	}
}

main()
	.then(() => {
		if (failures.length > 0) {
			console.error(`tool test FAILED: ${failures.length}/${checks} checks failed`);
			for (const failure of failures) console.error(`  ✗ ${failure}`);
			process.exit(1);
		}
		console.log(`tool test passed (${checks} checks)`);
	})
	.catch((error) => {
		console.error("tool test crashed:", error);
		process.exit(1);
	});
