/**
 * Forensia's own real-behavior TDD: detectors run against synthetic poison
 * trees and must report exactly the poison pattern planted — no more, no less.
 * Every test documents which pattern element (from the 2026-10-30 hosted-
 * platform dossier) it corresponds to.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { detectLogFlood, detectOrphanArtifacts, detectPointerSplitBrain } from "./bin/forensia";
import { setExperimentEnabled, loadConfig, EXPERIMENTS, runWithControl } from "./experiments/experiments";

function tmpTree(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "forensia-test-"));
}

describe("orphan-artifacts detector", () => {
	test("references with existing neighbors = critical orphan (had a spill store)", async () => {
		const dir = tmpTree();
		try {
			const session = path.join(dir, "sess1");
			fs.mkdirSync(path.join(session, "artifacts"), { recursive: true });
			fs.writeFileSync(path.join(session, "artifacts", "8"), "x"); // neighbor exists
			fs.writeFileSync(path.join(session, "8.async.log"), JSON.stringify({ text: "see artifact://7" }));
			const { findings } = await detectOrphanArtifacts(dir);
			expect(findings).toHaveLength(1);
			expect(findings[0]!.severity).toBe("critical");
			expect(findings[0]!.detail).toContain("artifact://7");
			expect(findings[0]!.detail).toContain("neighbors exist");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("resolvable references are clean", async () => {
		const dir = tmpTree();
		try {
			const session = path.join(dir, "sess1");
			fs.mkdirSync(path.join(session, "artifacts"), { recursive: true });
			fs.writeFileSync(path.join(session, "artifacts", "7"), "payload");
			fs.writeFileSync(path.join(session, "8.async.log"), JSON.stringify({ text: "see artifact://7" }));
			const { findings, checked, referenced } = await detectOrphanArtifacts(dir);
			expect(findings).toHaveLength(0);
			expect(checked).toBe(1);
			expect(referenced).toBe(1);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("warning when the session has no spill store at all", async () => {
		const dir = tmpTree();
		try {
			fs.writeFileSync(path.join(dir, "s.jsonl"), JSON.stringify({ text: "artifact://3" }));
			const { findings } = await detectOrphanArtifacts(dir);
			expect(findings).toHaveLength(1);
			expect(findings[0]!.severity).toBe("warning");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("log-flood detector", () => {
	test("large GC-less families escalate to critical; small to warning; clean passes", async () => {
		const clean = tmpTree();
		const warn = tmpTree();
		const crit = tmpTree();
		try {
			expect((await detectLogFlood(clean)).findings).toHaveLength(0);

			for (let i = 0; i < 600; i++) fs.writeFileSync(path.join(warn, `native-panic-${i}.log`), "x");
			const warnResult = await detectLogFlood(warn);
			expect(warnResult.findings).toHaveLength(1);
			expect(warnResult.findings[0]!.severity).toBe("warning");

			for (let i = 0; i < 5010; i++) fs.writeFileSync(path.join(crit, `http-400-requests-${i}.json`), "{}");
			const critResult = await detectLogFlood(crit);
			expect(critResult.findings).toHaveLength(1);
			expect(critResult.findings[0]!.severity).toBe("critical");
		} finally {
			for (const dir of [clean, warn, crit]) fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("split-brain pointer detector", () => {
	test("pointer frozen 2h behind advancing shards is flagged", async () => {
		const dir = tmpTree();
		try {
			const session = path.join(dir, "sess1");
			fs.mkdirSync(session, { recursive: true });
			const pointer = path.join(session, "latest.json");
			fs.writeFileSync(pointer, "{}");
			const stale = new Date(Date.now() - 7_200_000);
			fs.utimesSync(pointer, stale, stale);
			// Sibling shard advanced AFTER the pointer froze.
			fs.writeFileSync(path.join(session, "1793387877614-i3-container-python_execution.json"), "{}");
			const { } = { };
			const findings = await detectPointerSplitBrain(dir);
			expect(findings.some(f => f.detector === "split-brain-pointer")).toBe(true);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("fresh pointers are clean", async () => {
		const dir = tmpTree();
		try {
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, "latest.json"), "{}");
			fs.writeFileSync(path.join(dir, "1793387877614-i3-container-python_execution.json"), "{}");
			expect(await detectPointerSplitBrain(dir)).toHaveLength(0);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("epoch fork: timestamp jumps forward while iteration resets", async () => {
		const dir = tmpTree();
		try {
			const now = Date.now();
			fs.mkdirSync(dir, { recursive: true });
			// Epoch A: old shards at high iteration...
			const oldA = new Date(now - 7_200_000);
			const shardA = path.join(dir, String(now - 7_200_000) + "-i12-container-python_execution.json");
			fs.writeFileSync(shardA, "{}");
			fs.utimesSync(shardA, oldA, oldA);
			// Epoch B: 3M ms later, iteration back at 1 (lineage fork).
			const shardB = path.join(dir, String(now) + "-i1-container-python_execution.json");
			fs.writeFileSync(shardB, "{}");
			const findings = await detectPointerSplitBrain(dir);
			const forks = findings.filter(f => f.detector === "epoch-fork");
			expect(forks).toHaveLength(1);
			expect(forks[0]!.detail).toContain("iteration reset 12→1");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("experiments array — enable/disable is a tested difference", () => {
	test("registry knows its experiments; enable/disable persists and validates", () => {
		const productDir = fs.mkdtempSync(path.join(os.tmpdir(), "forensia-cfg-"));
		try {
			expect(EXPERIMENTS.map(e => e.id)).toContain("hetero-fingerprint");
			expect(EXPERIMENTS.map(e => e.id)).toContain("agent-dir-split-brain");

			setExperimentEnabled("hetero-fingerprint", false, productDir);
			expect(loadConfig(productDir).enabledExperiments).not.toContain("hetero-fingerprint");
			setExperimentEnabled("hetero-fingerprint", true, productDir);
			expect(loadConfig(productDir).enabledExperiments).toContain("hetero-fingerprint");
			expect(() => setExperimentEnabled("bogus", true, productDir)).toThrow(/unknown experiment/);
		} finally {
			fs.rmSync(productDir, { recursive: true, force: true });
		}
	});

	test("agent-dir-split-brain experiment detects the live relative override poison", async () => {
		const saved = process.env.PI_CODING_AGENT_DIR;
		try {
			process.env.PI_CODING_AGENT_DIR = ".tau/agent";
			const result = await runWithControl(EXPERIMENTS.find(e => e.id === "agent-dir-split-brain")!);
			expect(result.metrics.overrideRelative).toBe(true);
			expect(result.routing?.some(r => r.startsWith("POISON"))).toBe(true);
		} finally {
			if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = saved;
		}
	});

	test("clean absolute override produces no poison routing", async () => {
		const saved = process.env.PI_CODING_AGENT_DIR;
		try {
			process.env.PI_CODING_AGENT_DIR = "/home/toxic/.tau/agent";
			const result = await runWithControl(EXPERIMENTS.find(e => e.id === "agent-dir-split-brain")!);
			expect(result.metrics.overrideRelative).toBe(false);
			expect(result.routing ?? []).toHaveLength(0);
		} finally {
			if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = saved;
		}
	});
});
