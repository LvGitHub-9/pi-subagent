#!/usr/bin/env node
/**
 * Fake `pi` child process for test/tool.test.cjs.
 *
 * Emits JSONL in the shape of `pi --mode json`, so the subagent tool's whole
 * spawn -> JSONL parse -> usage aggregation -> output extraction pipeline can be
 * tested without a single model call.
 *
 * The subagent tool resolves its child as `node <process.argv[1]> ...`, so the
 * test points process.argv[1] at this file. Everything the child was asked to do
 * is reported to STUB_REPORT so the test can assert on the arguments.
 *
 * Knobs (env):
 *   STUB_REPORT      file to write the received-args report to
 *   STUB_TEXT        final assistant text (default: "stub output for: <task>")
 *   STUB_TEXT_SIZE   emit this many characters instead of STUB_TEXT
 *   STUB_TURNS       number of assistant turns to emit (default 1)
 *   STUB_TOOLCALL    "1" to emit a tool call + tool result
 *   STUB_MODEL       model id reported in messages
 *   STUB_STOP        stopReason for the final assistant message (e.g. "error")
 *   STUB_ERROR       errorMessage for the final assistant message
 *   STUB_MODE        "ok" (default), "fail" (exit 3 with stderr), "sleep" (wait)
 *   STUB_EXIT        explicit exit code override
 */

const fs = require("node:fs");

const argv = process.argv.slice(2);

function flagValue(name) {
	const index = argv.indexOf(name);
	return index >= 0 ? argv[index + 1] : undefined;
}

const task = argv.find((arg) => arg.startsWith("Task: ")) ?? "";
const promptFile = flagValue("--append-system-prompt");

const report = {
	argv,
	cwd: process.cwd(),
	task,
	model: flagValue("--model"),
	thinking: flagValue("--thinking"),
	tools: flagValue("--tools"),
	appendSystemPrompt: promptFile,
	systemPrompt: undefined,
};
if (promptFile) {
	try {
		report.systemPrompt = fs.readFileSync(promptFile, "utf8");
	} catch (error) {
		report.systemPrompt = `<<unreadable: ${error.message}>>`;
	}
}
if (process.env.STUB_REPORT) fs.appendFileSync(process.env.STUB_REPORT, `${JSON.stringify(report)}\n`);

const mode = process.env.STUB_MODE ?? "ok";
// Task-driven failure keeps per-step control inside a single run (chains/parallel).
if (mode === "fail" || task.includes("FAILNOW")) {
	process.stderr.write("stub stderr: deliberate failure\n");
	process.exit(Number(process.env.STUB_EXIT ?? 3));
}
if (mode === "sleep") {
	// Ignore SIGTERM so the caller's escalation logic is observable, and stay
	// alive until killed. Stop here: a CommonJS module may return at top level.
	process.on("SIGTERM", () => {});
	setInterval(() => {}, 1000);
	return;
}

const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);

function assistantMessage(text, stopReason, errorMessage) {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-completions",
		provider: "stub",
		model: process.env.STUB_MODEL ?? "stub/model",
		usage: {
			input: 100,
			output: 20,
			cacheRead: 10,
			cacheWrite: 5,
			totalTokens: 135,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.25 },
		},
		stopReason,
		...(errorMessage ? { errorMessage } : {}),
		timestamp: Date.now(),
	};
}

const turns = Number(process.env.STUB_TURNS ?? 1);
const finalStop = process.env.STUB_STOP ?? "stop";

for (let turn = 1; turn <= turns; turn++) {
	const isLast = turn === turns;
	const text = process.env.STUB_TEXT_SIZE
		? "x".repeat(Number(process.env.STUB_TEXT_SIZE))
		: isLast
			? (process.env.STUB_TEXT ?? `stub output for: ${task}`)
			: `thinking ${turn}`;

	if (process.env.STUB_TOOLCALL === "1" && turn === 1) {
		emit({
			type: "message_end",
			message: {
				...assistantMessage("", "toolUse"),
				content: [{ type: "toolCall", id: `call-${turn}`, name: "read", arguments: { path: "AGENTS.md" } }],
			},
		});
		emit({
			type: "tool_result_end",
			message: { role: "toolResult", toolCallId: `call-${turn}`, toolName: "read", content: [{ type: "text", text: "file" }], isError: false, timestamp: Date.now() },
		});
	}

	emit({
		type: "message_end",
		message: assistantMessage(text, isLast ? finalStop : "stop", isLast ? process.env.STUB_ERROR : undefined),
	});
}

process.exit(Number(process.env.STUB_EXIT ?? 0));
