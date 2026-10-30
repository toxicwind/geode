#!/usr/bin/env bun
/**
 * cleavage — auto schema detection from failure surfaces.
 *
 * Thesis (2026-10-30, live): EVERY schema this session was learned the hard
 * way — ask (`question` required), squawk (`from_agent` then `body`), gh
 * (`hasPagesEnabled` unknown field), YAML (quoted-scalar + `=>`), bun
 * (replace-callback groups arity). Each failure is the schema CLEAVING —
 * how a schema breaks reveals its structure. This tool ingests failures,
 * infers schema fragments, caches them, and emits corrected payloads with
 * zod schemas so no agent fails the same way twice.
 *
 *   cleavage learn --tool ask --error 'questions/0/question must be a string' --payload '{"questions":[{"id":"x"}]}'
 *   cleavage payload ask            → known-good payload skeleton from cache
 *   cleavage goniometer squawk      → measure the learned schema's angles (report)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";

const SCHEMA_DIR = path.join(import.meta.dir, "..", "schemas");
const CACHE = path.join(SCHEMA_DIR, "learned.json");

// --- learned-schema fragment model ----------------------------------------
const Fragment = z.object({
	tool: z.string(),
	path: z.string().describe("JSON path of the violating field, e.g. questions/0/question"),
	kind: z.enum(["required", "type", "unknown-field", "enum", "arity", "parse"]),
	detail: z.string(),
	learnedAt: z.string(),
});
export const FragmentSchema = Fragment;
type Fragment = z.infer<typeof Fragment>;

function loadCache(): Fragment[] {
	try {
		return JSON.parse(fs.readFileSync(CACHE, "utf8"));
	} catch {
		return [];
	}
}

function saveCache(fragments: Fragment[]): void {
	fs.mkdirSync(SCHEMA_DIR, { recursive: true });
	fs.writeFileSync(CACHE, JSON.stringify(fragments, null, 2));
}

// --- the goniometer: failure-text -> schema fragment measurement -----------
const PATTERNS: Array<{ re: RegExp; kind: Fragment["kind"]; extract: (m: RegExpMatchArray) => Partial<Fragment> }> = [
	{
		// tau ask tool: "questions/0/question must be a string (was missing)"
		re: /Validation failed for tool "(\w+)":\s*-?\s*([\w/[\]]+) must be (?:a )?(\w+)/,
		kind: "required",
		extract: m => ({ tool: m[1] ?? "", path: m[2] ?? "", detail: `must be ${m[3]}` }),
	},
	{
		// squawk: {"ok":false,"error":"from_agent is required"}
		re: /"error":"(\w+) is required"/,
		kind: "required",
		extract: m => ({ tool: "squawk", path: m[1] ?? "", detail: "required field" }),
	},
	{
		// gh: Unknown JSON field: "hasPagesEnabled"
		re: /Unknown JSON field: "(\w+)"/,
		kind: "unknown-field",
		extract: m => ({ tool: "gh", path: m[1] ?? "", detail: "field does not exist in this API surface" }),
	},
	{
		// YAML: Unexpected token (quoted scalar + trailing content)
		re: /YAML Parse error: Unexpected token/,
		kind: "parse",
		extract: () => ({ tool: "yaml", path: "$", detail: "quoted scalar followed by content is invalid; use plain or block scalars" }),
	},
	{
		// bun replace arity: (m) => m.groups silently undefined
		re: /named groups.*not final|\.groups is undefined/,
		kind: "arity",
		extract: () => ({ tool: "bun.replace", path: "$callback", detail: "rest-args required: groups rides as LAST callback arg" }),
	},
];

/** Measure one failure message into a fragment (the goniometer's angle). */
export function measure(toolHint: string, errorText: string, payload?: unknown): Fragment | null {
	for (const p of PATTERNS) {
		const m = p.re.exec(errorText);
		if (m) {
			const fragment = Fragment.parse({
				kind: p.kind, // MUST ride with the extraction — zod requires it and
							  // the extract() shape intentionally omits it
				...p.extract(m),
				tool: p.extract(m).tool || toolHint,
				learnedAt: new Date().toISOString(),
			});
			return fragment;
		}
	}
	// No pattern matched: record as raw unknown so the goniometer grows.
	return Fragment.parse({
		tool: toolHint,
		path: "$",
		kind: "parse",
		detail: errorText.slice(0, 200),
		learnedAt: new Date().toISOString(),
	});
}

export function learn(toolHint: string, errorText: string, payload?: unknown): Fragment {
	const fragment = measure(toolHint, errorText, payload);
	const cache = loadCache();
	cache.push(fragment!);
	saveCache(cache);
	return fragment!;
}

/** Payload skeleton from learned fragments: what a GOOD call must include. */
export function payloadFor(tool: string): string {
	const cache = loadCache().filter(f => f.tool === tool);
	if (cache.length === 0) return `(no learned schema for ${tool} — feed it a failure with 'cleavage learn')`;
	const required = [...new Set(cache.filter(f => f.kind === "required").map(f => f.path))];
	const warnings = cache.filter(f => f.kind === "unknown-field" || f.kind === "arity" || f.kind === "parse");
	const lines = [
		`# known-good ${tool} payload skeleton (from ${cache.length} learned failures)`,
		...required.map(p => `  REQUIRED: ${p} (${cache.find(f => f.path === p)!.detail})`),
		...warnings.map(w => `  AVOID: ${w.path} — ${w.detail}`),
	];
	return lines.join("\n");
}

/** Goniometer report: measure the learned schema's angles. */
export function goniometer(tool: string): string {
	const cache = loadCache().filter(f => f.tool === tool);
	const angles = {
		fragments: cache.length,
		kinds: Object.fromEntries([...new Set(cache.map(f => f.kind))].map(k => [k, cache.filter(f => f.kind === k).length])),
		paths: [...new Set(cache.map(f => f.path))],
		firstLearned: cache[0]?.learnedAt ?? null,
	};
	return `goniometer(${tool}): ${JSON.stringify(angles, null, 2)}\n${payloadFor(tool)}`;
}

// --- CLI -------------------------------------------------------------------
function main(): void {
	const argv = process.argv.slice(2);
	const cmd = argv[0];
	if (!cmd || cmd === "--help") {
		console.log(`usage: cleavage learn --tool <tool> --error <text> [--payload <json>]
       cleavage payload <tool>
       cleavage goniometer <tool>`);
		process.exit(cmd === "--help" ? 0 : 2);
	}
	if (cmd === "learn") {
		const get = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
		const fragment = learn(get("--tool") ?? "unknown", get("--error") ?? "", get("--payload"));
		console.log(JSON.stringify(fragment, null, 2));
	} else if (cmd === "payload") {
		console.log(payloadFor(argv[1] ?? "unknown"));
	} else if (cmd === "goniometer") {
		console.log(goniometer(argv[1] ?? "unknown"));
	}
}

if (import.meta.main) main();
