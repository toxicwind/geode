/**
 * Forensia MCP server — exposes the poison-sensor over MCP for thresher/
 * mesh-gateway federation, so any Pens agent can audit hydration integrity
 * and toggle experiments without shelling out.
 *
 * Run: bun run mcp/server.ts  (stdio transport; thresher upstream config
 * points here — see docs/mcp-setup.md)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	detectLogFlood,
	detectOrphanArtifacts,
	detectPointerSplitBrain,
} from "../bin/forensia";
import {
	EXPERIMENTS,
	loadConfig,
	runEnabledExperiments,
	runWithControl,
	setExperimentEnabled,
} from "../experiments/experiments";

const PRODUCT_DIR = path.join(import.meta.dir, "..");

function agentDir(): string {
	const home = process.env.HOME && path.isAbsolute(process.env.HOME) ? process.env.HOME : "/home/toxic";
	return process.env.PI_CODING_AGENT_DIR && path.isAbsolute(process.env.PI_CODING_AGENT_DIR)
		? process.env.PI_CODING_AGENT_DIR
		: path.join(home, ".tau", "agent");
}

const server = new McpServer({ name: "forensia", version: "0.1.0" });

server.tool(
	"forensia_audit",
	"Run the hydration-integrity audit (orphan artifacts, log flood, split-brain pointers, epoch forks) and return the poison dossier",
	{
		json: z.boolean().optional().describe("Return the raw machine dossier"),
	},
	async ({ json }) => {
		const dir = agentDir();
		const artifacts = await detectOrphanArtifacts(path.join(dir, "sessions"));
		const flood = await detectLogFlood(path.join(dir, "logs"));
		const pointers = await detectPointerSplitBrain(path.join(dir, "sessions"));
		const findings = [...artifacts.findings, ...flood.findings, ...pointers];
		if (json) {
			return { content: [{ type: "text", text: JSON.stringify({ generatedAt: new Date().toISOString(), agentDir: dir, findings, stats: flood.stats }, null, 2) }] };
		}
		const lines = findings.map(f => `[${f.severity}] ${f.detector}: ${f.detail}`);
		lines.push(`stats: ${JSON.stringify(flood.stats)}`);
		return { content: [{ type: "text", text: lines.join("\n") || "clean" }] };
	},
);

server.tool(
	"forensia_list_experiments",
	"List the forensia experiments array with enabled/disabled state",
	{},
	async () => {
		const config = loadConfig(path.join(PRODUCT_DIR, "experiments"));
		const text = EXPERIMENTS.map(
			e => `${config.enabledExperiments.includes(e.id) ? "[x]" : "[ ]"} ${e.id} — ${e.description}`,
		).join("\n");
		return { content: [{ type: "text", text }] };
	},
);

server.tool(
	"forensia_set_experiment",
	"Enable or disable a forensia experiment (persisted to forensia.config.json)",
	{
		id: z.string().describe("Experiment id"),
		enabled: z.boolean().describe("true to enable, false to disable"),
	},
	async ({ id, enabled }) => {
		const config = setExperimentEnabled(id, enabled, path.join(PRODUCT_DIR, "experiments"));
		return { content: [{ type: "text", text: `${id} ${enabled ? "enabled" : "disabled"}; active: ${config.enabledExperiments.join(", ")}` }] };
	},
);

server.tool(
	"forensia_run_experiments",
	"Run enabled experiments as A/B pairs (live variant vs control) and return measured deltas",
	{
		id: z.string().optional().describe("Run a single experiment id instead of all enabled"),
	},
	async ({ id }) => {
		const experimentsDir = path.join(PRODUCT_DIR, "experiments");
		const results = id
			? [await runWithControl(EXPERIMENTS.find(e => e.id === id) ?? (() => { throw new Error(`unknown experiment: ${id}`); })())]
			: await runEnabledExperiments(experimentsDir);
		return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
	},
);

const transport = new StdioServerTransport();
await server.connect(transport);
