/**
 * Renderer tests: renderCall / renderResult for every mode, collapsed and
 * expanded, plus narrow-width robustness.
 *
 * These run headless. Pi's renderers return pi-tui Components whose only
 * requirement is `render(width): string[]`, so the custom tool UI that no
 * non-interactive run ever touches can still be asserted on.
 *
 * Run: node test/render.test.cjs
 */

const { loadExtension, THEME, rowsToText, singleResult, assistantMessage, callArgs } = require("./_harness.cjs");

const { tool } = loadExtension();
const failures = [];
let checks = 0;

function check(name, condition, detail) {
	checks += 1;
	if (!condition) failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

function renderCall(args, width = 100) {
	return rowsToText(tool.renderCall(args, THEME, {}), width);
}

function renderResult(details, { expanded = false, content = "(no output)", width = 100, isError = false } = {}) {
	return renderResultLines(details, { expanded, content, width, isError }).join("\n");
}

function renderResultLines(details, { expanded = false, content = "(no output)", width = 100 } = {}) {
	const result = { content: [{ type: "text", text: content }], details };
	return tool.renderResult(result, { expanded, isPartial: false }, THEME, {}).render(width);
}

// ---------------------------------------------------------------------------
// renderCall
// ---------------------------------------------------------------------------

const singleCall = renderCall(callArgs({ agent: "scout", task: "find the auth code" }));
check("call/single names the agent", singleCall.includes("scout"), singleCall);
check("call/single shows the scope", singleCall.includes("[user]"), singleCall);
check("call/single previews the task", singleCall.includes("find the auth code"), singleCall);
check("call/single is multi-row", singleCall.split("\n").length > 1, JSON.stringify(singleCall));

const longCall = renderCall(callArgs({ agent: "scout", task: "x".repeat(200) }));
check("call/single truncates a long task", longCall.includes("...") && !longCall.includes("x".repeat(80)), longCall);

const chainCall = renderCall(
	callArgs({ chain: [{ agent: "scout", task: "a" }, { agent: "planner", task: "plan {previous}" }] }),
);
check("call/chain shows the step count", chainCall.includes("chain (2 steps)"), chainCall);
check("call/chain numbers the steps", chainCall.includes("1.") && chainCall.includes("2."), chainCall);
check("call/chain strips the {previous} placeholder", !chainCall.includes("{previous}"), chainCall);

const parallelCall = renderCall(callArgs({ tasks: [{ agent: "scout", task: "a" }, { agent: "planner", task: "b" }] }));
check("call/parallel shows the task count", parallelCall.includes("parallel (2 tasks)"), parallelCall);
check("call/parallel names each agent", parallelCall.includes("scout") && parallelCall.includes("planner"), parallelCall);

const manyChain = renderCall(
	callArgs({ chain: Array.from({ length: 5 }, (_, i) => ({ agent: `a${i}`, task: "t" })) }),
);
check("call/chain summarises overflow", manyChain.includes("+2 more"), manyChain);

const manyTasks = renderCall(
	callArgs({ tasks: Array.from({ length: 4 }, (_, i) => ({ agent: `a${i}`, task: "t" })) }),
);
check("call/parallel summarises overflow", manyTasks.includes("+1 more"), manyTasks);

check(
	"call/empty args renders a placeholder",
	renderCall(callArgs({})).includes("..."),
	renderCall(callArgs({})),
);
check(
	"call/scoped chain shows the scope",
	renderCall(callArgs({ agentScope: "both", chain: [{ agent: "scout", task: "a" }] })).includes("[both]"),
);

// ---------------------------------------------------------------------------
// renderResult: fallback when there are no details
// ---------------------------------------------------------------------------

check(
	"result/no-details falls back to content",
	renderResult(undefined, { content: "Available subagents:\n\nBuiltin" }).includes("Builtin"),
);
check(
	"result/empty-results falls back to content",
	renderResult({ mode: "single", agentScope: "user", projectAgentsDir: null, results: [] }, { content: "boom" }).includes("boom"),
);

// ---------------------------------------------------------------------------
// renderResult: single
// ---------------------------------------------------------------------------

const singleDetails = { mode: "single", agentScope: "user", projectAgentsDir: null, results: [singleResult()] };

const singleCollapsed = renderResult(singleDetails);
check("result/single collapsed marks success", singleCollapsed.includes("✓"), singleCollapsed);
check("result/single collapsed names agent and source", singleCollapsed.includes("scout") && singleCollapsed.includes("(builtin)"), singleCollapsed);
check("result/single collapsed shows final text", singleCollapsed.includes("found it"), singleCollapsed);
check("result/single collapsed shows usage", singleCollapsed.includes("1 turn") && singleCollapsed.includes("↑100") && singleCollapsed.includes("$0.2500"), singleCollapsed);
check("result/single collapsed shows context and model", singleCollapsed.includes("ctx:135") && singleCollapsed.includes("stub/model"), singleCollapsed);
check("result/single collapsed is not expanded", !singleCollapsed.includes("─── Task ───"), singleCollapsed);

const singleExpanded = renderResult(singleDetails, { expanded: true });
check("result/single expanded has task section", singleExpanded.includes("─── Task ───"), singleExpanded);
check("result/single expanded has output section", singleExpanded.includes("─── Output ───"), singleExpanded);
check("result/single expanded shows the task text", singleExpanded.includes("find the auth code"), singleExpanded);
check("result/single expanded renders final output", singleExpanded.includes("found it"), singleExpanded);

const singleWithToolCall = renderResult({
	...singleDetails,
	results: [
		singleResult({
			messages: [assistantMessage("looked", [{ name: "bash", arguments: { command: "ls -la" } }]), assistantMessage("done")],
		}),
	],
});
check("result/single renders tool calls", singleWithToolCall.includes("$ ls -la"), singleWithToolCall);

const singleFailed = renderResult({
	...singleDetails,
	results: [singleResult({ exitCode: 1, stopReason: "error", errorMessage: "model exploded", messages: [] })],
});
check("result/single error marks failure", singleFailed.includes("✗"), singleFailed);
check("result/single error shows stopReason", singleFailed.includes("[error]"), singleFailed);
check("result/single error shows the message", singleFailed.includes("model exploded"), singleFailed);

const singleAborted = renderResult({
	...singleDetails,
	results: [singleResult({ exitCode: 1, stopReason: "aborted", messages: [] })],
});
check("result/single aborted is a failure", singleAborted.includes("✗") && singleAborted.includes("[aborted]"), singleAborted);

const singleEmpty = renderResult({ ...singleDetails, results: [singleResult({ messages: [] })] });
check("result/single with no output says so", singleEmpty.includes("(no output)"), singleEmpty);

const manyItems = renderResult({
	...singleDetails,
	results: [singleResult({ messages: Array.from({ length: 25 }, (_, i) => assistantMessage(`line ${i}`)) })],
});
check("result/single collapses long transcripts", manyItems.includes("earlier items"), manyItems);
check("result/single points at the expand key", manyItems.includes("Ctrl+O to expand"), manyItems);
check("result/single keeps the newest items", manyItems.includes("line 24"), manyItems);

// ---------------------------------------------------------------------------
// renderResult: chain
// ---------------------------------------------------------------------------

const chainDetails = {
	mode: "chain",
	agentScope: "user",
	projectAgentsDir: null,
	results: [
		singleResult({ step: 1, agent: "scout", task: "gather", messages: [assistantMessage("context")] }),
		singleResult({ step: 2, agent: "planner", task: "plan", messages: [assistantMessage("the plan")] }),
	],
};

const chainCollapsed = renderResult(chainDetails);
check("result/chain collapsed shows step count", chainCollapsed.includes("chain ") && chainCollapsed.includes("2/2 steps"), chainCollapsed);
check("result/chain collapsed labels steps", chainCollapsed.includes("Step 1:") && chainCollapsed.includes("Step 2:"), chainCollapsed);
check("result/chain collapsed aggregates usage", chainCollapsed.includes("Total:") && chainCollapsed.includes("2 turns"), chainCollapsed);
check("result/chain collapsed shows both agents", chainCollapsed.includes("scout") && chainCollapsed.includes("planner"), chainCollapsed);

const chainExpanded = renderResult(chainDetails, { expanded: true });
check("result/chain expanded shows task lines", chainExpanded.includes("Task: ") && chainExpanded.includes("gather"), chainExpanded);
check("result/chain expanded shows outputs", chainExpanded.includes("context") && chainExpanded.includes("the plan"), chainExpanded);
check("result/chain expanded totals usage", chainExpanded.includes("Total:"), chainExpanded);

const chainPartial = renderResult({
	...chainDetails,
	results: [singleResult({ step: 1, agent: "scout" }), singleResult({ step: 2, agent: "planner", exitCode: 1, stopReason: "error", errorMessage: "boom" })],
});
check("result/chain partial failure is marked", chainPartial.includes("✗") && chainPartial.includes("1/2 steps"), chainPartial);

// ---------------------------------------------------------------------------
// renderResult: parallel
// ---------------------------------------------------------------------------

const parallelDetails = {
	mode: "parallel",
	agentScope: "user",
	projectAgentsDir: null,
	results: [singleResult({ agent: "scout" }), singleResult({ agent: "planner", task: "b" })],
};

const parallelCollapsed = renderResult(parallelDetails);
check("result/parallel collapsed shows counts", parallelCollapsed.includes("parallel ") && parallelCollapsed.includes("2/2 tasks"), parallelCollapsed);
check("result/parallel collapsed lists agents", parallelCollapsed.includes("scout") && parallelCollapsed.includes("planner"), parallelCollapsed);

const parallelRunning = renderResult({
	...parallelDetails,
	results: [singleResult({ agent: "scout" }), singleResult({ agent: "planner", exitCode: -1, messages: [] })],
});
check("result/parallel running shows progress", parallelRunning.includes("⏳") && parallelRunning.includes("done") && parallelRunning.includes("running"), parallelRunning);
check("result/parallel running shows 1/2 done", parallelRunning.includes("1/2 done"), parallelRunning);

const parallelMixed = renderResult({
	...parallelDetails,
	results: [singleResult({ agent: "scout" }), singleResult({ agent: "planner", exitCode: 1, stopReason: "error", messages: [] })],
});
check("result/parallel partial failure is marked", parallelMixed.includes("◐") && parallelMixed.includes("1/2 tasks"), parallelMixed);

const parallelExpanded = renderResult(parallelDetails, { expanded: true });
check("result/parallel expanded labels agents", parallelExpanded.includes("─── ") && parallelExpanded.includes("scout"), parallelExpanded);
check("result/parallel expanded shows tasks", parallelExpanded.includes("Task: "), parallelExpanded);

// ---------------------------------------------------------------------------
// Robustness
// ---------------------------------------------------------------------------

for (const width of [20, 40, 200]) {
	for (const [name, details, expanded] of [
		["single", singleDetails, false],
		["single-expanded", singleDetails, true],
		["chain", chainDetails, false],
		["chain-expanded", chainDetails, true],
		["parallel", parallelDetails, false],
		["parallel-expanded", parallelDetails, true],
	]) {
		let threw;
		try {
			const lines = renderResultLines(details, { expanded, width });
			if (!Array.isArray(lines)) threw = "render() did not return an array";
		} catch (error) {
			threw = error.message;
		}
		check(`robustness/${name} at width ${width}`, !threw, threw);
	}
}

// Rendered rows must fit the requested width (no overflow past the shell).
const { visibleWidth } = require(require("node:path").join(require("./_harness.cjs").PKG, "node_modules/@earendil-works/pi-tui/dist/index.js"));

for (const width of [40, 80]) {
	for (const [name, details, expanded] of [
		["single", singleDetails, false],
		["single-expanded", singleDetails, true],
		["chain", chainDetails, false],
		["parallel", parallelDetails, false],
	]) {
		const rows = renderResultLines(details, { expanded, width });
		const widest = Math.max(...rows.map((row) => visibleWidth(row)));
		check(`robustness/${name} visible width ${width}`, widest <= width, `widest=${widest}`);
	}
}

if (failures.length > 0) {
	console.error(`render test FAILED: ${failures.length}/${checks} checks failed`);
	for (const failure of failures) console.error(`  ✗ ${failure}`);
	process.exit(1);
}
console.log(`render test passed (${checks} checks)`);
