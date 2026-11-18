// gen-facts.ts — generated-facts backstop for the {PEN} README.
// Derives every number from the real source (ports.env SSOT, disk, registry).
// Idempotent. Sync test: scripts/gen-facts.test.ts.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const README = join(import.meta.dir, "..", "README.md");
const PORTS_ENV = "/home/toxic/pens/pens/config/ports.env";

export function portOf(envKey: string): string {
	const m = readFileSync(PORTS_ENV, "utf8").match(new RegExp(`^${envKey}=(\\d+)`, "m"));
	if (!m) throw new Error(`ports.env SSOT missing ${envKey} — the README cannot state a port the SSOT does not own`);
	return m[1]!;
}

export function compute(): string {
	const lines: string[] = [];
		lines.push(`| rhodochrosite port | ${portOf("RHODOCHROSITE_PORT")} (ports.env, canonical router) |`);
	lines.push(`| gemini-mcp port | ${portOf("GEMINI_MCP_PORT")} (ports.env GEMINI_MCP_PORT) |`);
	return lines.join("\n");
}

export function syncFacts(path = README): "changed" | "unchanged" {
	const s = readFileSync(path, "utf8");
	const re = /<!-- FACTS:START -->\n([\s\S]*?)<!-- FACTS:END -->/;
	if (!re.test(s)) throw new Error(`no FACTS block in ${path}`);
	const next = s.replace(re, `<!-- FACTS:START -->\n${compute()}\n<!-- FACTS:END -->`);
	if (next === s) return "unchanged";
	writeFileSync(path, next);
	return "changed";
}

if (import.meta.main) {
	console.log(`[facts] README FACTS block ${syncFacts()}`);
}
