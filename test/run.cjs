#!/usr/bin/env node
/**
 * Run every offline test suite and summarise.
 *
 * Run: node test/run.cjs   (or npm test)
 */

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SUITES = ["discovery.test.cjs", "render.test.cjs", "tool.test.cjs", "extension.test.cjs"];

let failed = 0;
let ran = 0;

for (const suite of SUITES) {
	const file = path.join(__dirname, suite);
	process.stdout.write(`\n=== ${suite} ===\n`);
	const result = spawnSync(process.execPath, [file], { stdio: "inherit" });
	ran += 1;
	if (result.status !== 0) {
		failed += 1;
		process.stdout.write(`--- ${suite} FAILED (exit ${result.status ?? "signal"})\n`);
	}
}

process.stdout.write(`\n${ran - failed}/${ran} suites passed\n`);
process.exit(failed === 0 ? 0 : 1);
