// src/provider-probe.ts — chaos scaffold: autonomously understand a provider.
//
// The shape classifier answers "what IS this model id". This scaffold answers
// "what does THIS PROVIDER actually support" — by probing it, not trusting its
// docs. It discovers the live model set, classifies every shape, and probes
// which directives (:free / :off / :minimal / :xhigh / :max — the obtuse
// strategy/quality tiers) the provider actually honors on the wire.
//
// The industry is a zoo (sglang / vLLM / OpenAI-compat / NIM / google-models /
// fireworks accounts/.../models/...). Every provider disagrees about what a
// model id is and which suffixes it means. This scaffold is the future-forward
// way to learn any provider before (or after) wiring it into the catalog.
//
//   bun src/provider-probe.ts --base https://freeinference.org/v1 --key <k>
//   bun src/provider-probe.ts --base http://127.0.0.1:25196/v1 --auth none
//
// Probe is rate-limit-aware: discovery is ONE /v1/models call; directive probes
// are OPT-IN (--probe-directives) and bounded/serialized, never hammered.

import { classify, type Shape } from "./shapes";
import { classify as classifyFault } from "./fault/index.ts";

export type DirectiveProbe =
  | "free"
  | "off"
  | "minimal"
  | "xhigh"
  | "max"
  | "latest";

const DIRECTIVE_CANDIDATES: readonly DirectiveProbe[] = [
  "free", "off", "minimal", "xhigh", "max", "latest",
];

export interface ProviderProbeOptions {
  base: string;
  key?: string;
  auth?: "bearer" | "x-api-key" | "query-key" | "none";
  modelsPath?: string;
  probeDirectives?: boolean;
  /** how many directive probes to run (bounded; default 3) */
  directiveBudget?: number;
  timeoutMs?: number;
}

export interface ModelObservation {
  id: string;
  shape: Shape;
  qualifier?: string;
  segments: number;
  directive?: string;
}

export interface DirectiveResult {
  directive: DirectiveProbe;
  /** what the provider did with the suffixed id */
  verdict: "accepted" | "rejected" | "unknown" | "noop";
  status: number;
  detail?: string;
}

export interface ProviderProfile {
  base: string;
  ok: boolean;
  error?: string;
  discovery: {
    models: ModelObservation[];
    count: number;
    shapes: Record<Shape, number>;
    /** distinct org/qualifier tokens the provider serves */
    qualifiers: string[];
  };
  directives: DirectiveResult[];
  /** autonomous synthesis: what this provider is + how to address it */
  synthesis: string;
}

function headers(opts: ProviderProbeOptions): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json", connection: "close" };
  const auth = opts.auth ?? (opts.key ? "bearer" : "none");
  if (!opts.key) return h;
  if (auth === "bearer") h["authorization"] = `Bearer ${opts.key}`;
  else if (auth === "x-api-key") h["x-api-key"] = opts.key;
  return h;
}

/** Probe /v1/models (or the adapter's models path) — ONE call. */
async function discover(opts: ProviderProbeOptions): Promise<ModelObservation[]> {
  const path = opts.modelsPath ?? "/models";
  const url = `${opts.base.replace(/\/+$/, "")}${path}`;
  const res = await fetch(url, { headers: headers(opts), signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000) });
  if (!res.ok) throw new Error(`discovery ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { data?: Array<{ id: string }>; models?: Array<{ name: string }> };
  const ids: string[] = [];
  if (Array.isArray(j.data)) for (const m of j.data) if (m?.id) ids.push(m.id);
  if (Array.isArray(j.models)) for (const m of j.models) if (m?.name) ids.push(m.name.replace(/^models\//, "models/"));
  return ids.map((id) => {
    const c = classify(id);
    return { id, shape: c.shape, qualifier: c.qualifier, segments: c.segments, directive: c.directive ?? undefined };
  });
}

/**
 * Probe whether the provider honors a directive suffix. Sends a single
 * minimal /v1/chat/completions with the suffixed id and reads the verdict from
 * the status — 4xx "model not found" vs accepted vs 401 (key) are distinct.
 * Bounded + serialized to respect rate limits.
 */
/**
 * Adapter: map an upstream probe response to a directive verdict by reusing the
 * faults classifier (router/src/faults). The verdict taxonomy is:
 *   - accepted  → status < 400 (provider honored the suffixed id)
 *   - rejected  → a fault module owns it as a model/route-gone fault
 *                 (not-found 404, gone 410) — the id itself was refused
 *   - unknown   → any other fault (auth-failed 401/403, ua-blocked, quota,
 *                 shed, opencode timer) — a key/entitlement/egress/rate
 *                 issue, NOT a directive rejection
 */
async function directiveVerdict(status: number, text: string): Promise<DirectiveResult["verdict"]> {
  if (status < 400) return "accepted";
  const { matched } = await classifyFault(status, text, { provider: "probe", model: "" });
  if (matched === "not-found" || matched === "gone") return "rejected";
  return "unknown";
}

async function probeDirective(
  opts: ProviderProbeOptions,
  model: string,
  directive: DirectiveProbe,
): Promise<DirectiveResult> {
  const suffixed = `${model}:${directive}`;
  const url = `${opts.base.replace(/\/+$/, "")}/chat/completions`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: headers(opts),
      body: JSON.stringify({ model: suffixed, messages: [{ role: "user", content: "hi" }], max_tokens: 1, stream: false }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
    const text = (await res.text()).slice(0, 160);
    const verdict = await directiveVerdict(res.status, text);
    return { directive, verdict, status: res.status, detail: text };
  } catch (e) {
    return { directive, verdict: "unknown", status: 0, detail: String(e) };
  }
}

/** Autonomous synthesis of what the provider is. */
function synthesize(p: ProviderProfile): string {
  const d = p.discovery;
  if (d.count === 0) return "provider serves no models via /v1/models";
  const dominant = (Object.entries(d.shapes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown") as Shape;
  const prefixRatio = (d.shapes["provider-prefixed"] ?? 0) / d.count;
  const relRatio = (d.shapes["provider-relative"] ?? 0) / d.count;
  const qs = d.qualifiers.slice(0, 5).join(", ");
  let s = `serves ${d.count} models, ${Object.entries(d.shapes).map(([k, v]) => `${k}=${v}`).join(" ")}. `;
  s += `Dominant shape ${dominant}. `;
  if (prefixRatio > 0.7) s += `Mostly provider-prefixed (org tokens: ${qs}) — the qualifier IS the wire id; route by the model's own qualifier. `;
  else if (relRatio > 0.7) s += `Mostly provider-relative — the caller's provider qualifier is a routing config id; qualify on the wire. `;
  else s += `Mixed shapes (org tokens: ${qs}) — route by each model's own qualifier when present, else the caller default. `;
  const acc = p.directives.filter((x) => x.verdict === "accepted").map((x) => x.directive);
  s += acc.length ? `Honors directives: ${acc.join(", ")}.` : `Directive handling unprobed or unsupported.`;
  return s;
}

export async function probeProvider(opts: ProviderProbeOptions): Promise<ProviderProfile> {
  const profile: ProviderProfile = {
    base: opts.base,
    ok: true,
    discovery: { models: [], count: 0, shapes: {}, qualifiers: [] },
    directives: [],
    synthesis: "",
  };
  try {
    const models = await discover(opts);
    profile.discovery.models = models;
    profile.discovery.count = models.length;
    const shapes: Record<Shape, number> = { "google-models": 0, modelprovider: 0, "multi-segment": 0, "provider-prefixed": 0, "provider-relative": 0, unknown: 0 };
    const quals = new Set<string>();
    for (const m of models) {
      shapes[m.shape] = (shapes[m.shape] ?? 0) + 1;
      if (m.qualifier) quals.add(m.qualifier);
    }
    profile.discovery.shapes = shapes;
    profile.discovery.qualifiers = [...quals].sort();

    if (opts.probeDirectives && models.length > 0) {
      // pick a representative model per dominant shape, bounded
      const budget = opts.directiveBudget ?? 3;
      const reps = [
        models.find((m) => m.shape === "provider-prefixed"),
        models.find((m) => m.shape === "provider-relative"),
      ].filter(Boolean).slice(0, Math.min(budget, 2));
      const model = (reps[0] ?? models[0])!.id;
      for (const d of DIRECTIVE_CANDIDATES.slice(0, budget)) {
        profile.directives.push(await probeDirective(opts, model, d));
      }
    }
  } catch (e) {
    profile.ok = false;
    profile.error = (e as Error).message;
  }
  profile.synthesis = synthesize(profile);
  return profile;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const base = get("--base");
  if (!base) { console.error("usage: provider-probe --base <url> [--key <k>] [--auth bearer|x-api-key|none] [--probe-directives] [--json]"); process.exit(2); }
  const opts: ProviderProbeOptions = {
    base,
    key: get("--key"),
    auth: (get("--auth") as ProviderProbeOptions["auth"]) ?? undefined,
    modelsPath: get("--models-path"),
    probeDirectives: argv.includes("--probe-directives"),
    directiveBudget: get("--budget") ? Number(get("--budget")) : undefined,
  };
  const profile = await probeProvider(opts);
  if (argv.includes("--json")) { console.log(JSON.stringify(profile, null, 2)); }
  else {
    console.log(`provider ${profile.base}: ${profile.ok ? "OK" : "FAIL " + profile.error}`);
    if (profile.ok) {
      console.log(`  models=${profile.discovery.count}  shapes=${Object.entries(profile.discovery.shapes).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join(" ")}`);
      console.log(`  qualifiers: ${profile.discovery.qualifiers.join(", ")}`);
      if (profile.directives.length) {
        console.log("  directives:");
        for (const d of profile.directives) console.log(`    :${d.directive} -> ${d.verdict} (${d.status})`);
      }
      console.log(`\n  synthesis: ${profile.synthesis}`);
    }
  }
  process.exit(profile.ok ? 0 : 1);
}

if (import.meta.main) { await main(); }