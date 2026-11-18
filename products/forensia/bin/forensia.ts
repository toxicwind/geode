#!/usr/bin/env bun
/**
 * Forensia (Φορενσία) — hydration-integrity auditor for the pens Pens.
 *
 * Productizes the "conversation poison" pattern observed on hosted agent
 * platforms (2026-10-30 dossier): GC-less indirection + eager hydration +
 * conversation-scoped propagation turn one orphaned handle into a permanent
 * brick. The pattern is platform-independent; this tool audits OUR Pens for
 * its local analogs and emits a poison dossier.
 *
 * Detectors (each maps 1:1 to a pattern element):
 *   orphan-artifacts  — session JSONLs reference artifact://N that no longer
 *                       resolves in the session's artifacts dir (orphan handle)
 *   log-flood         — GC-less failure logs (http-400-requests,
 *                       native-panic-*) with per-day growth (bulletin board
 *                       that never erases tickets)
 *   split-brain       — mutable latest-* indirection pointers frozen while
 *                       sibling shards kept advancing (failed-writer epoch)
 *   epoch-fork        — monotonic epoch breaks in shard naming (timestamp up,
 *                       iteration reset = lineage fork)
 *
 * Exit codes: 0 = clean, 1 = poison found (GOAL-able: usable as a sensor).
 * --json emits the machine dossier for health-audit / MCP integration.
 */
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { EXPERIMENTS, runEnabledExperiments, setExperimentEnabled } from "../experiments/experiments";

// Standalone product (no workspace dependency): resolve the agent dir the
// same way tau-utils does — TAU/PI override, else ~/.tau/agent. Never trust
// HOME alone: some daemon contexts run with it unset, and a relative agent
// dir silently scans nothing (first live run found 0 sessions this way).
//
// POISON GUARD (2026-10-30, live): the ambient env carries the RELATIVE
// override PI_CODING_AGENT_DIR=.tau/agent. Honoring it makes this scanner
// audit `<cwd>/.tau/agent` — nothing, quietly. A relative agent-dir override
// is always poison (cwd-dependent split-brain), so it is rejected loudly and
// the honest default is used instead.
function getAgentDir(): { dir: string; poisoned: boolean; override: string | undefined } {
	const home = process.env.HOME && path.isAbsolute(process.env.HOME) ? process.env.HOME : os.homedir();
	const override = process.env.PI_CODING_AGENT_DIR;
	if (override !== undefined && !path.isAbsolute(override)) {
		return { dir: path.join(home, ".tau", "agent"), poisoned: true, override };
	}
	return { dir: override ?? path.join(home, ".tau", "agent"), poisoned: false, override };
}

interface Finding {
	detector: string;
	severity: "critical" | "warning" | "info";
	session?: string;
	detail: string;
	evidence?: string;
}

interface Dossier {
	generatedAt: string;
	agentDir: string;
	findings: Finding[];
	stats: Record<string, number>;
}

const AGENT_DIR = getAgentDir();
if (AGENT_DIR.poisoned) {
	console.error(`forensia: REJECTED relative PI_CODING_AGENT_DIR=${AGENT_DIR.override} (cwd-dependent poison); auditing ${AGENT_DIR.dir}`);
}
const SESSIONS_DIR = path.join(AGENT_DIR.dir, "sessions");
const LOGS_DIR = path.join(AGENT_DIR.dir, "logs");

// ---------------------------------------------------------------------------
// Detector 1: orphan artifact references (orphan-handle analog)
// ---------------------------------------------------------------------------

const ARTIFACT_REF_RE = /artifact:\/\/(\d+)/g;

async function detectOrphanArtifacts(sessionsDir: string = SESSIONS_DIR): Promise<{ findings: Finding[]; checked: number; referenced: number }> {
	const findings: Finding[] = [];
	let checked = 0;
	let referenced = 0;

	async function walk(dir: string): Promise<void> {
		let entries;
		try {
			entries = await fsp.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(full);
				continue;
			}
			if (!entry.name.endsWith(".jsonl") && !entry.name.endsWith(".async.log") && !entry.name.endsWith(".log")) continue;
			let content: string;
			try {
				content = await fsp.readFile(full, "utf8");
			} catch {
				continue;
			}
			const seen = new Set<string>();
			for (const match of content.matchAll(ARTIFACT_REF_RE)) {
				seen.add(match[1]);
			}
			if (seen.size === 0) continue;
			checked++;
			referenced += seen.size;
			// artifact://N resolves against the session's artifacts dir
			// (artifact-protocol.ts: pinned to the calling session's dir).
			const sessionDir = path.dirname(full);
			for (const id of seen) {
				const candidate = path.join(sessionDir, "artifacts", id);
				if (!fs.existsSync(candidate)) {
					// Neighboring artifact ids existing (id±1) proves the session
					// HAD a spill store — this id is an orphan, not an empty dir.
					const neighbor = fs.existsSync(path.join(sessionDir, "artifacts", String(Number(id) + 1)))
						|| fs.existsSync(path.join(sessionDir, "artifacts", String(Number(id) - 1)));
					findings.push({
						detector: "orphan-artifacts",
						severity: neighbor ? "critical" : "warning",
						session: sessionDir,
						detail: `artifact://${id} referenced but not resolvable in session artifacts dir${neighbor ? " (neighbors exist — orphaned handle, replay of this session's history 404s)" : ""}`,
						evidence: path.join(sessionDir, "artifacts"),
					});
				}
			}
		}
	}

	await walk(sessionsDir);
	return { findings: findings.slice(0, 200), checked, referenced };
}

// ---------------------------------------------------------------------------
// Detector 2: GC-less failure log flood (bulletin-board analog)
// ---------------------------------------------------------------------------

async function detectLogFlood(logsDir: string = LOGS_DIR): Promise<{ findings: Finding[]; stats: Record<string, number> }> {
	const findings: Finding[] = [];
	const stats: Record<string, number> = {};
	for (const family of ["http-400-requests", "native-panic"]) {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(logsDir, { withFileTypes: true });
		} catch {
			continue;
		}
		const files = entries.filter(e => e.isFile() && e.name.startsWith(family));
		let totalBytes = 0;
		const perDay = new Map<string, number>();
		for (const file of files) {
			const full = path.join(LOGS_DIR, file.name);
			try {
				const stat = fs.statSync(full);
				totalBytes += stat.size;
				const day = new Date(stat.mtimeMs).toISOString().slice(0, 10);
				perDay.set(day, (perDay.get(day) ?? 0) + 1);
			} catch {}
		}
		const days = [...perDay.entries()].sort();
		const newest = days.at(-1)?.[0] ?? "unknown";
		stats[`${family}.count`] = files.length;
		stats[`${family}.bytes`] = totalBytes;
		stats[`${family}.newestDay`] = perDay.get(newest) ?? 0;
		if (files.length > 500) {
			findings.push({
				detector: "log-flood",
				severity: files.length > 5000 ? "critical" : "warning",
				detail: `${family}: ${files.length} files (${(totalBytes / 1048576).toFixed(1)} MiB) never garbage-collected; newest day added ${perDay.get(newest)}. The bulletin board never erases tickets — every retry replays the full failure surface.`,
			});
		}
	}
	return { findings, stats };
}

// ---------------------------------------------------------------------------
// Detector 3: split-brain mutable indirection (latest-* frozen while siblings
// advanced) and Detector 4: epoch forks
// ---------------------------------------------------------------------------

interface Shard {
	path: string;
	mtime: number;
	// shard naming like 1793387877614-i3-container-python_execution.json
	timestamp?: number;
	iteration?: number;
}

function parseShardName(name: string): { timestamp?: number; iteration?: number } {
	const m = /(\d{13,})-i(\d+)-/.exec(name);
	if (!m) return {};
	return { timestamp: Number(m[1]), iteration: Number(m[2]) };
}

async function detectPointerSplitBrain(sessionsDir: string = SESSIONS_DIR): Promise<Finding[]> {
	const findings: Finding[] = [];
	const shards: Shard[] = [];
	let pointerFiles: Shard[] = [];

	async function walk(dir: string): Promise<void> {
		let entries;
		try {
			entries = await fsp.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(full);
				continue;
			}
			const stat = fs.statSync(full);
			if (entry.name.startsWith("latest")) pointerFiles.push({ path: full, mtime: stat.mtimeMs });
			const parsed = parseShardName(entry.name);
			if (parsed.timestamp !== undefined) shards.push({ path: full, mtime: stat.mtimeMs, ...parsed });
		}
	}

	await walk(sessionsDir);

	// A pointer frozen >= 1h old while the newest shard in its directory
	// advanced after it = the failed-writer epoch (Python can't update the
	// pointer; Node keeps advancing) — the split-brain signature.
	for (const pointer of pointerFiles) {
		const siblings = shards.filter(shard => path.dirname(shard.path) === path.dirname(pointer.path));
		const newestSibling = siblings.reduce((newest, shard) => (shard.mtime > newest.mtime ? shard : newest), siblings[0]);
		if (newestSibling && pointer.mtime < newestSibling.mtime - 3_600_000) {
			const staleHours = ((newestSibling.mtime - pointer.mtime) / 3_600_000).toFixed(1);
			findings.push({
				detector: "split-brain-pointer",
				severity: "warning",
				session: path.dirname(pointer.path),
				detail: `indirection pointer ${path.basename(pointer.path)} frozen ${staleHours}h behind newest shard ${path.basename(newestSibling.path)} — the writer that owns this pointer stopped committing while siblings advanced (failed-writer epoch)`,
			});
		}
	}

	// Epoch forks: within one directory, shard timestamps jumping > 1h forward
	// while iteration resets to a low number = lineage fork (restart reusing
	// per-call counters instead of a global monotonic).
	const byDir = new Map<string, Shard[]>();
	for (const shard of shards) {
		const dir = path.dirname(shard.path);
		if (!byDir.has(dir)) byDir.set(dir, []);
		byDir.get(dir)!.push(shard);
	}
	for (const [dir, list] of byDir) {
		const sorted = list.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
		for (let i = 1; i < sorted.length; i++) {
			const prev = sorted[i - 1]!;
			const cur = sorted[i]!;
			if (
				cur.timestamp !== undefined && prev.timestamp !== undefined &&
				cur.timestamp - prev.timestamp > 3_600_000 &&
				cur.iteration !== undefined && prev.iteration !== undefined &&
				cur.iteration < prev.iteration
			) {
				findings.push({
					detector: "epoch-fork",
					severity: "info",
					session: dir,
					detail: `lineage fork: timestamp advanced ${(cur.timestamp - prev.timestamp) / 3_600_000 | 0}h while iteration reset ${prev.iteration}→${cur.iteration} at ${path.basename(cur.path)} — iteration counters are per-lineage, not global; poison bisect must key on timestamp+call_id, never iteration`,
				});
				break; // one finding per directory
			}
		}
	}
	return findings;
}

// ---------------------------------------------------------------------------

export { detectOrphanArtifacts, detectLogFlood, detectPointerSplitBrain, parseShardName };

async function main(): Promise<void> {
	const json = process.argv.includes("--json");

	// Experiment management subcommands: --enable/--disable mutate the config
	// and exit; --list shows the array. Every flag accepts an experiment id.
	for (let i = 2; i < process.argv.length; i++) {
		const arg = process.argv[i];
		const id = process.argv[i + 1];
		if (arg === "--list-experiments") {
			for (const experiment of EXPERIMENTS) {
				const config = await import("../experiments/experiments").then(m => m.loadConfig());
				console.log(`${config.enabledExperiments.includes(experiment.id) ? "[x]" : "[ ]"} ${experiment.id} — ${experiment.description}`);
			}
			return;
		}
		if ((arg === "--enable" || arg === "--disable") && id) {
			const config = setExperimentEnabled(id, arg === "--enable");
			console.log(`${arg === "--enable" ? "enabled" : "disabled"}: ${id}`);
			console.log(`enabled experiments: ${config.enabledExperiments.join(", ") || "(none)"}`);
			return;
		}
	}

	const artifacts = await detectOrphanArtifacts();
	const flood = await detectLogFlood();
	const pointers = await detectPointerSplitBrain();

	// Experiments: enabled ones run as real A/B pairs; deltas join the dossier.
	const experimentResults = await runEnabledExperiments(path.join(import.meta.dir, "..", "experiments"));
	for (const result of experimentResults) {
		for (const route of result.routing ?? []) {
			pointers.push({
				detector: `experiment:${result.id}`,
				severity: route.startsWith("POISON") ? "critical" : "info",
				detail: route,
			});
		}
	}

	const findings: Finding[] = [...artifacts.findings, ...flood.findings, ...pointers];
	const dossier: Dossier = {
		generatedAt: new Date().toISOString(),
		agentDir: AGENT_DIR.dir,
		findings: [
			...(AGENT_DIR.poisoned
				? [{
						detector: "agent-dir-poison",
						severity: "critical" as const,
						detail: `ambient env carries RELATIVE PI_CODING_AGENT_DIR=${AGENT_DIR.override} — every consumer honoring it resolves the agent dir against its own cwd (per-directory config split-brain; the local Everstore-handle analog). Fixed upstream: .profile and Pens/config/dots export it absolute; something between re-exports it relative.`,
					}]
				: []),
			...findings,
		],
		stats: {
			...flood.stats,
			"sessions.checkedForArtifacts": artifacts.checked,
			"sessions.artifactRefs": artifacts.referenced,
			"findings.total": findings.length,
			"findings.critical": findings.filter(f => f.severity === "critical").length,
			"findings.warning": findings.filter(f => f.severity === "warning").length,
			"experiments.ran": experimentResults.length,
			// Experiment metrics flatten into stats so the dossier carries the
			// measured A/B deltas, not just "ran ok".
			...Object.fromEntries(
				experimentResults.flatMap(result => [
					[`experiment.${result.id}.delta`, result.delta ? JSON.stringify(result.delta) : "{}"],
					...Object.entries(result.metrics).map(([metric, value]) => [`experiment.${result.id}.${metric}`, value]),
				]),
			),
		},
	};

	const reportsDir = path.join(import.meta.dir, "..", "reports");
	fs.mkdirSync(reportsDir, { recursive: true });
	const stamp = dossier.generatedAt.replace(/[:.]/g, "-").slice(0, 19);
	const outPath = path.join(reportsDir, `dossier-${stamp}.json`);
	fs.writeFileSync(outPath, JSON.stringify(dossier, null, 2));

	if (json) {
		console.log(JSON.stringify(dossier, null, 2));
	} else {
		console.log(`Forensia dossier — ${dossier.generatedAt}`);
		console.log(`agent dir: ${dossier.agentDir}`);
		console.log("");
		for (const finding of findings) {
			const badge = finding.severity === "critical" ? "🔴" : finding.severity === "warning" ? "🟡" : "🔵";
			console.log(`${badge} [${finding.detector}] ${finding.detail}`);
			if (finding.session) console.log(`    at ${finding.session}`);
		}
		if (findings.length === 0) console.log("✅ no poison detected");
		for (const result of experimentResults) {
			console.log(`\n⚗️ experiment ${result.id}:`);
			for (const [metric, value] of Object.entries(result.metrics)) console.log(`    ${metric}: ${value}`);
			if (result.delta && Object.keys(result.delta).length > 0) console.log(`    delta: ${JSON.stringify(result.delta)}`);
			for (const note of result.notes ?? []) console.log(`    note: ${note}`);
		}
		console.log("");
		for (const [key, value] of Object.entries(dossier.stats)) console.log(`${key}: ${value}`);
		console.log(`\ndossier written: ${outPath}`);
	}
	process.exitCode = findings.some(f => f.severity !== "info") ? 1 : 0;
}

if (import.meta.main) await main();
