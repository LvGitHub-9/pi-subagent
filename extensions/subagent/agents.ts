/**
 * Agent discovery and configuration.
 *
 * Agents are markdown files with YAML frontmatter. Three tiers are searched,
 * in increasing precedence:
 *
 *   builtin  — <package>/agents/*.md          (shipped with this extension)
 *   user     — ~/.pi/agent/agents/*.md        (personal, always loaded)
 *   project  — <cwd>/.pi/agents/*.md          (repo-controlled, opt-in)
 *
 * A later tier overrides an earlier tier with the same agent name.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export type AgentScope = "user" | "project" | "both";
export type AgentSource = "builtin" | "user" | "project";

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	systemPrompt: string;
	source: AgentSource;
	filePath: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
	builtinAgentsDir: string;
}

/**
 * Raw agent frontmatter. Values are `unknown` because `parseFrontmatter` runs a
 * real YAML parser, so any scalar or collection can appear here.
 *
 * A type alias rather than an interface: `parseFrontmatter` constrains its
 * parameter to `Record<string, unknown>`, and only an alias picks up the
 * implicit index signature that satisfies it.
 */
type AgentFrontmatter = {
	name?: unknown;
	description?: unknown;
	tools?: unknown;
	model?: unknown;
};

/**
 * Normalize a frontmatter `tools` value to a list of tool names.
 *
 * Both spellings are valid YAML and both are in use:
 *
 *     tools: read, bash        # string
 *     tools: [read, bash]      # array
 *
 * so accept either. Anything else (a number, a map, a nested list) yields no
 * tools rather than throwing: this runs inside agent discovery, where a single
 * bad file must not take down every other agent in the same directory.
 */
function parseToolList(value: unknown): string[] | undefined {
	const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
	const tools = raw
		.filter((t): t is string => typeof t === "string")
		.map((t) => t.trim())
		.filter(Boolean);
	return tools.length > 0 ? tools : undefined;
}

function loadAgentsFromDir(dir: string, source: AgentSource): AgentConfig[] {
	const agents: AgentConfig[] = [];

	if (!fs.existsSync(dir)) {
		return agents;
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(content);

		if (typeof frontmatter.name !== "string" || typeof frontmatter.description !== "string") {
			continue;
		}

		agents.push({
			name: frontmatter.name,
			description: frontmatter.description,
			tools: parseToolList(frontmatter.tools),
			model: typeof frontmatter.model === "string" ? frontmatter.model : undefined,
			systemPrompt: body,
			source,
			filePath,
		});
	}

	return agents;
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, CONFIG_DIR_NAME, "agents");
		if (isDirectory(candidate)) return candidate;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

/**
 * Directory holding the agents shipped with this extension.
 *
 * Resolved relative to this module (extensions/subagent/agents.ts), so it works
 * whether the package is loaded from a local path or an installed location.
 * `PI_SUBAGENT_AGENTS_DIR` overrides it for tests and unusual layouts.
 */
export function getBuiltinAgentsDir(): string {
	const override = process.env.PI_SUBAGENT_AGENTS_DIR;
	if (override && override.trim()) return path.resolve(override);

	const here = (() => {
		try {
			return path.dirname(fileURLToPath(import.meta.url));
		} catch {
			// jiti/CJS fallback: `import.meta.url` may be unavailable.
			return typeof __dirname === "string" ? __dirname : process.cwd();
		}
	})();

	return path.resolve(here, "..", "..", "agents");
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	const builtinAgentsDir = getBuiltinAgentsDir();
	const userDir = path.join(getAgentDir(), "agents");
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);

	const builtinAgents = loadAgentsFromDir(builtinAgentsDir, "builtin");
	const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
	const projectAgents = scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");

	// Insertion order is precedence order: later assignments win on name clashes.
	const agentMap = new Map<string, AgentConfig>();
	for (const agent of builtinAgents) agentMap.set(agent.name, agent);
	for (const agent of userAgents) agentMap.set(agent.name, agent);
	for (const agent of projectAgents) agentMap.set(agent.name, agent);

	return { agents: Array.from(agentMap.values()), projectAgentsDir, builtinAgentsDir };
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed.map((a) => `${a.name} (${a.source}): ${a.description}`).join("; "),
		remaining,
	};
}

/** Multi-line agent catalog used in tool output and the `/subagent-agents` command. */
export function formatAgentCatalog(agents: AgentConfig[]): string {
	if (agents.length === 0) return "No agents found.";
	const bySource: Record<AgentSource, AgentConfig[]> = { builtin: [], user: [], project: [] };
	for (const agent of agents) bySource[agent.source].push(agent);

	const sections: string[] = [];
	const titles: Record<AgentSource, string> = {
		builtin: "Builtin",
		user: `User (${path.join(getAgentDir(), "agents")})`,
		project: `Project (${CONFIG_DIR_NAME}/agents)`,
	};
	for (const source of ["builtin", "user", "project"] as const) {
		const group = bySource[source];
		if (group.length === 0) continue;
		const lines = group.map((a) => {
			const tools = a.tools?.length ? `tools: ${a.tools.join(", ")}` : "tools: (all)";
			const model = a.model ? `, model: ${a.model}` : ", model: (inherited)";
			return `- ${a.name}: ${a.description} [${tools}${model}]`;
		});
		sections.push(`${titles[source]}\n${lines.join("\n")}`);
	}
	return sections.join("\n\n");
}
