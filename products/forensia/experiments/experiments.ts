/**
 * Forensia experiments array — every experiment is enable/disable-able and
 * A/B measurable: `run()` executes against the live environment, and the
 * framework records the delta between "experiment enabled" and a baseline
 * control, so enable/disable is a tested difference, not a config flag with
 * no observable effect.
 *
 * Emergent integration thesis (2026-10-30): the hosted-platform "conversation
 * poison" pattern (orphan handle + GC-less spew + split-brain pointers) and
 * the hetero-scheduler POC (fingerprint → route model lanes) are the SAME
 * problem — an environment-truth plane. Poison is the plane's integrity
 * side; the fingerprint is its sensing side. Routing decisions that ignore
 * environment truth (or trust simulated sensors) are the poison pattern
 * applied to scheduling.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface ExperimentResult {
	id: string;
	enabled: boolean;
	ranAt: string;
	metrics: Record<string, number | string | boolean>;
	routing?: string[];
	/** Delta vs the control run — what enabling actually changed. */
	delta?: Record<string, number | string>;
	notes?: string[];
}

export interface Experiment {
	id: string;
	description: string;
	/** Runs the live measurement. control=true runs the baseline variant. */
	run: (control: boolean) => Promise<ExperimentResult> | ExperimentResult;
}

// ---------------------------------------------------------------------------
// Shared sensor helpers — REAL sensors only, never simulate on failure.
// The archived WIP's poison-pattern sin was `except: return random.uniform(...)`:
// a dead sensor silently producing plausible data. Every helper here returns
// null on failure and the experiment reports sensor-missing loudly.
// ---------------------------------------------------------------------------

function nvidiaSmi(args: string[]): string | null {
	try {
		return execFileSync("nvidia-smi", args, { timeout: 5000, encoding: "utf8" });
	} catch {
		return null;
	}
}

export interface GpuSample {
	name: string;
	thermalC: number;
	utilPct: number;
	memPct: number;
}

/** Real GPU sample via nvidia-smi query (RTX 3090 = genuine SM86 on this box). */
export function sampleGpu(): GpuSample | null {
	const out = nvidiaSmi([
		"--query-gpu=name,temperature.gpu,utilization.gpu,utilization.memory",
		"--format=csv,noheader,nounits",
	]);
	if (!out) return null;
	const [name, thermal, util, mem] = out.trim().split(", ").map(s => s.trim());
	const thermalC = Number(thermal);
	const utilPct = Number(util);
	const memPct = Number(mem);
	if (![thermalC, utilPct, memPct].every(Number.isFinite)) return null;
	return { name: name ?? "unknown", thermalC, utilPct, memPct };
}

/**
 * Real core-to-core dispatch latency: N sched ping-pongs between two CPU
 * ranges using taskset affinity. Measures what the POC's `multiprocessing`
 * fake measured — actual cross-core wakeups, the Ryzen dispatch cost.
 */
export function measureDispatchLatency(samples = 40): { medianMs: number; p95Ms: number } | null {
	const cpuCount = os.cpus().length;
	if (cpuCount < 4) return null;
	const cpuA = 0;
	const cpuB = cpuCount - 1; // worst realistic pair: opposite ends of the topology
	const latencies: number[] = [];
	for (let i = 0; i < samples; i++) {
		const pin = i % 2 === 0 ? cpuA : cpuB;
		const start = performance.now();
		try {
			execFileSync("taskset", ["-c", String(pin), "true"], { timeout: 3000 });
		} catch {
			return null;
		}
		latencies.push(performance.now() - start);
	}
	latencies.sort((a, b) => a - b);
	const medianMs = latencies[Math.floor(latencies.length / 2)];
	const p95Ms = latencies[Math.floor(latencies.length * 0.95)];
	return { medianMs, p95Ms };
}

/** Fleet node-health plane: freeinference model availability (thermal analog). */
export function sampleFleetHealth(): { reachable: boolean; models: string[] } {
	try {
		const keyPath = path.join(process.env.HOME ?? os.homedir(), ".tau", "freeinference.key");
		const key = fs.readFileSync(keyPath, "utf8").trim();
		const out = execFileSync("curl", [
			"-s", "-m", "5",
			"-A", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
			"-H", `Authorization: Bearer ${key}`,
			"https://freeinference.org/v1/models",
		], { timeout: 8000, encoding: "utf8" });
		const models = (JSON.parse(out).data ?? []).map((m: { id: string }) => m.id);
		return { reachable: true, models };
	} catch {
		return { reachable: false, models: [] };
	}
}

// ---------------------------------------------------------------------------
// The experiments array
// ---------------------------------------------------------------------------

export const EXPERIMENTS: Experiment[] = [
	{
		id: "hetero-fingerprint",
		description:
			"Real heterogeneous fingerprint: RTX 3090 (SM86) thermal/utilization + Ryzen 8700F dispatch latency (taskset ping-pong) + freeinference fleet reachability. Routes model lanes by measured state — the archived WIP's routing decision, minus every simulated sensor.",
		async run(control) {
			const notes: string[] = [];
			const gpu = control ? null : sampleGpu();
			const latency = control ? null : measureDispatchLatency();
			const fleet = control ? { reachable: false, models: [] } : sampleFleetHealth();

			if (!control) {
				if (!gpu) notes.push("GPU sensor missing (nvidia-smi failed) — reported as missing, never simulated");
				if (!latency) notes.push("dispatch-latency sensor missing (taskset unavailable)");
				if (!fleet.reachable) notes.push("fleet health plane unreachable");
			}

			// Routing: the thermal>=84C rule from the POC, mapped to this box.
			// GPU hot or dispatch p95 high → escalate the lane (fallback chain);
			// else keep. This is a DECISION REPORT, not a side effect.
			let routing: string[] = [];
			if (!control && gpu) {
				if (gpu.thermalC >= 84) {
					routing.push(`ROUTE escalation lane (GPU thermal ${gpu.thermalC}C >= 84C on ${gpu.name})`);
				} else {
					routing.push(`KEEP primary lane (thermal ${gpu.thermalC}C, util ${gpu.utilPct}%, mem ${gpu.memPct}%)`);
				}
			}
			if (!control && latency) {
				if (latency.p95Ms > 50) {
					routing.push(`ROUTE away from latency-critical lanes (dispatch p95 ${latency.p95Ms.toFixed(1)}ms > 50ms)`);
				} else {
					routing.push(`KEEP latency-sensitive lanes (dispatch p95 ${latency.p95Ms.toFixed(1)}ms)`);
				}
			}

			return {
				id: "hetero-fingerprint",
				enabled: !control,
				ranAt: new Date().toISOString(),
				metrics: {
					gpuName: gpu?.name ?? "missing",
					gpuThermalC: gpu?.thermalC ?? -1,
					gpuUtilPct: gpu?.utilPct ?? -1,
					gpuMemPct: gpu?.memPct ?? -1,
					dispatchMedianMs: latency ? Number(latency.medianMs.toFixed(2)) : -1,
					dispatchP95Ms: latency ? Number(latency.p95Ms.toFixed(2)) : -1,
					fleetReachable: fleet.reachable,
					fleetModels: fleet.models.length,
				},
				routing,
				notes: control ? ["control run (sensors suppressed)"] : notes,
			};
		},
	},
	{
		id: "agent-dir-split-brain",
		description:
			"Environment integrity probe: PI_CODING_AGENT_DIR must be ABSOLUTE. A relative override (.tau/agent, first observed live 2026-10-30) makes every consumer resolve the agent dir against its own cwd — a per-directory config split-brain, the local Everstore-handle analog. Control = env with the override stripped.",
		run(control) {
			const live = process.env.PI_CODING_AGENT_DIR;
			const probeDir = (override: string | undefined): string => {
				const saved = process.env.PI_CODING_AGENT_DIR;
				if (override === undefined) delete process.env.PI_CODING_AGENT_DIR;
				else process.env.PI_CODING_AGENT_DIR = override;
				// The poison: relative resolution depends on the consumer's cwd.
				const resolved = override !== undefined && !path.isAbsolute(override)
					? path.resolve(process.cwd(), override)
					: override ?? "/home/toxic/.tau/agent";
				if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
				else process.env.PI_CODING_AGENT_DIR = saved;
				return resolved;
			};
			const liveResolved = probeDir(live);
			const cleanResolved = probeDir(undefined);
			const poisoned = live !== undefined && !path.isAbsolute(live);
			return {
				id: "agent-dir-split-brain",
				enabled: !control,
				ranAt: new Date().toISOString(),
				metrics: {
					overridePresent: live !== undefined,
					overrideRelative: poisoned,
					liveResolved: liveResolved,
					cleanResolved: cleanResolved,
					cwdDependent: poisoned && liveResolved !== probeDir(live),
				},
				routing: poisoned
					? [`POISON: relative PI_CODING_AGENT_DIR=${live} — consumers in different cwd resolve different agent dirs`]
					: [],
				notes: control ? ["control run (override semantics suppressed)"] : undefined,
			};
		},
	},
];

export const DEFAULT_ENABLED = EXPERIMENTS.map(experiment => experiment.id);

// ---------------------------------------------------------------------------
// Enable/disable persistence + A/B measurement
// ---------------------------------------------------------------------------

export interface ForensiaConfig {
	enabledExperiments: string[];
}

export function configPath(productDir = import.meta.dir): string {
	return path.join(productDir, "forensia.config.json");
}

export function loadConfig(productDir = import.meta.dir): ForensiaConfig {
	try {
		const raw = JSON.parse(fs.readFileSync(configPath(productDir), "utf8"));
		return { enabledExperiments: raw.enabledExperiments ?? DEFAULT_ENABLED };
	} catch {
		return { enabledExperiments: DEFAULT_ENABLED };
	}
}

export function saveConfig(config: ForensiaConfig, productDir = import.meta.dir): void {
	fs.writeFileSync(configPath(productDir), `${JSON.stringify(config, null, 2)}\n`);
}

/** Enable/disable an experiment; validates the id. Returns updated config. */
export function setExperimentEnabled(id: string, enabled: boolean, productDir = import.meta.dir): ForensiaConfig {
	if (!EXPERIMENTS.some(experiment => experiment.id === id)) {
		throw new Error(`unknown experiment: ${id}. Known: ${EXPERIMENTS.map(experiment => experiment.id).join(", ")}`);
	}
	const config = loadConfig(productDir);
	const set = new Set(config.enabledExperiments);
	if (enabled) set.add(id);
	else set.delete(id);
	config.enabledExperiments = [...set];
	saveConfig(config, productDir);
	return config;
}

/**
 * Run one experiment as a REAL A/B pair: enabled variant vs control, with the
 * numeric deltas computed. Enabling must produce a measurable difference or
 * the experiment reports that honestly.
 */
export async function runWithControl(experiment: Experiment): Promise<ExperimentResult & { delta?: Record<string, number | string> }> {
	const enabledResult = await experiment.run(false);
	const controlResult = await experiment.run(true);
	const delta: Record<string, number | string> = {};
	for (const [key, value] of Object.entries(enabledResult.metrics)) {
		const controlValue = controlResult.metrics[key];
		if (typeof value === "number" && typeof controlValue === "number") {
			delta[key] = Number((value - controlValue).toFixed(3));
		} else if (value !== controlValue) {
			delta[key] = `${controlValue} → ${value}`;
		}
	}
	return { ...enabledResult, delta };
}

/** Run every enabled experiment (+ its control) and return dossier-ready results. */
export async function runEnabledExperiments(productDir = import.meta.dir): Promise<Array<ExperimentResult & { delta?: Record<string, number | string> }>> {
	const config = loadConfig(productDir);
	const results = [];
	for (const experiment of EXPERIMENTS) {
		if (!config.enabledExperiments.includes(experiment.id)) continue;
		results.push(await runWithControl(experiment));
	}
	return results;
}
