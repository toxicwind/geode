/**
 * cleavage MCP server — federates the schema-knowledge surface.
 * Tools: cleavage_learn, cleavage_payload, cleavage_goniometer.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const mod = await import("../bin/cleavage.ts");
const server = new McpServer({ name: "cleavage", version: "0.1.0" });

server.tool(
	"cleavage_learn",
	"Ingest a validation failure and learn the schema fragment (the goniometer's measurement)",
	{ tool: z.string(), error: z.string(), payload: z.string().optional() },
	async ({ tool, error, payload }) => {
		let parsed: unknown;
		try { parsed = payload ? JSON.parse(payload) : undefined; } catch { parsed = undefined; }
		const fragment = mod.learn(tool, error, parsed);
		return { content: [{ type: "text", text: JSON.stringify(fragment, null, 2) }] };
	},
);
server.tool(
	"cleavage_payload",
	"Known-good payload skeleton for a tool from learned failures",
	{ tool: z.string() },
	async ({ tool }) => ({ content: [{ type: "text", text: mod.payloadFor(tool) }] }),
);
server.tool(
	"cleavage_goniometer",
	"Measure a tool's learned schema: fragment counts, kinds, paths",
	{ tool: z.string() },
	async ({ tool }) => ({ content: [{ type: "text", text: mod.goniometer(tool) }] }),
);

await server.connect(new StdioServerTransport());
