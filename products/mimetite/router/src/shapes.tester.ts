// src/shapes.tester.ts — the shapes tester.
//
// What it proves, for every model in the catalog and for any provider you
// hand it, including a provider that does not exist yet:
//
//   I1  idempotence          qualify(p, qualify(p, m)) === qualify(p, m)
//   I2  no double-prefix     qualify(p, m) never contains "${p}/${p}/"
//   I3  qualifier respect    a self-qualified model keeps its own qualifier
//   I4  wire correctness     upstreamModel(m) is non-empty and directive-stripped
//   I5  routing coherence    routingProvider(default) is never empty
//
// A failure on any invariant is a routing bug that will 403 or 404 in prod.
//
// Run against the live catalog:
//   bun src/shapes.tester.ts --catalog ../../catalog/src/data.ts
//
// Validate a NEW provider before adding it:
//   bun src/shapes.tester.ts --catalog ... --provider-new nvidia --shape provider-prefixed
//
// Exit code is 0 only if every invariant holds for every model.

import { classify, qualify, upstreamModel, assertNoDoublePrefix } from "./shapes";

export interface Failure {
  invariant: "I1" | "I2" | "I3" | "I4" | "I5";
  model: string;
  provider: string;
  detail: string;
}

export interface Report {
  models: number;
  providers: number;
  shapes: Record<string, number>;
  failures: Failure[];
  ok: boolean;
}

function checkOne(model: string, provider: string): Failure[] {
  const out: Failure[] = [];
  const c = classify(model);

  // I1 idempotence
  const once = qualify(provider, model);
  const twice = qualify(provider, once);
  if (once !== twice) {
    out.push({ invariant: "I1", model, provider, detail: `qualify not idempotent: "${once}" -> "${twice}"` });
  }

  // I2 no double-prefix
  try {
    assertNoDoublePrefix(provider, model);
  } catch (e) {
    out.push({ invariant: "I2", model, provider, detail: (e as Error).message });
  }

  // I3 qualifier respect — if the model is self-qualified, it must survive
  //    a provider that disagrees with it.
  if (c.qualifier !== undefined) {
    const hostileProvider = c.qualifier === "nvidia" ? "freeinference" : "nvidia";
    const hostile = qualify(hostileProvider, model);
    if (!hostile.startsWith(`${c.qualifier}/`) && !hostile.startsWith("models/")) {
      out.push({ invariant: "I3", model, provider: hostileProvider, detail: `qualifier "${c.qualifier}" was lost; got "${hostile}"` });
    }
  }

  // I4 wire correctness
  const wire = upstreamModel(model);
  if (wire.length === 0) {
    out.push({ invariant: "I4", model, provider, detail: "upstreamModel empty" });
  }
  if (c.directive && wire.endsWith(`:${c.directive}`)) {
    out.push({ invariant: "I4", model, provider, detail: `wire model kept directive suffix: "${wire}"` });
  }

  // I5 routing coherence
  const routed = c.routingProvider(provider);
  if (!routed || routed.length === 0) {
    out.push({ invariant: "I5", model, provider, detail: "routingProvider empty" });
  }

  return out;
}

export function runTester(models: readonly string[], providers: readonly string[], defaultProvider: string): Report {
  const failures: Failure[] = [];
  const shapes: Record<string, number> = {};

  for (const m of models) {
    const s = classify(m).shape;
    shapes[s] = (shapes[s] ?? 0) + 1;
    for (const p of providers) failures.push(...checkOne(m, p));
    if (!providers.includes(defaultProvider)) failures.push(...checkOne(m, defaultProvider));
  }

  return { models: models.length, providers: new Set([...providers, defaultProvider]).size, shapes, failures, ok: failures.length === 0 };
}

/** Future-forward: validate a brand-new provider before it is merged. */
export function validateNewProvider(catalog: readonly string[], newProvider: string, declaredShape: string): Failure[] {
  const out: Failure[] = [];
  for (const m of catalog) {
    const c = classify(m);
    if (c.shape !== declaredShape) continue;
    if (declaredShape === "provider-prefixed" && c.qualifier !== newProvider) continue;
    out.push(...checkOne(m, newProvider));
  }
  return out;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

async function loadCatalogModelIds(path: string): Promise<string[]> {
  const mod = await import(path);
  const ids = new Set<string>();
  const push = (v: unknown) => { if (typeof v === "string" && v.length > 0) ids.add(v); };
  const walk = (v: unknown, depth = 0): void => {
    if (depth > 6 || v == null) return;
    if (typeof v === "string") { push(v); return; }
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (v instanceof Set) { for (const x of v) walk(x, depth + 1); return; }
    if (typeof v === "object") {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) { push(k); walk(val, depth + 1); }
    }
  };
  walk(mod);
  return [...ids].filter((s) => !s.startsWith("http") && !s.includes("://") && !s.endsWith(".ts"));
}

function reportOut(r: Report): void {
  console.log(`models: ${r.models}  providers: ${r.providers}`);
  console.log("shapes:");
  for (const [s, n] of Object.entries(r.shapes).sort((a, b) => b[1] - a[1])) console.log(`  ${s.padEnd(18)} ${n}`);
  if (r.ok) { console.log("\nall invariants hold."); return; }
  console.log(`\n${r.failures.length} failures:`);
  for (const f of r.failures.slice(0, 50)) console.log(`  [${f.invariant}] ${f.provider} × ${f.model}\n      ${f.detail}`);
  if (r.failures.length > 50) console.log(`  … and ${r.failures.length - 50} more`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let catalog = "";
  let providerNew: string | undefined;
  let shapeNew = "provider-prefixed";
  let defaultProvider = "freeinference";
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--catalog" && v) { catalog = v; i++; }
    else if (k === "--provider-new" && v) { providerNew = v; i++; }
    else if (k === "--shape" && v) { shapeNew = v; i++; }
    else if (k === "--default" && v) { defaultProvider = v; i++; }
  }
  if (!catalog) { console.error("usage: shapes.tester --catalog <data.ts> [--provider-new <p> --shape <shape>]"); process.exit(2); }

  const models = await loadCatalogModelIds(catalog);
  const providers = ["freeinference", "nvidia", "openrouter", "groq", "vercel-gateway", "google-eap"];

  if (providerNew) {
    const failures = validateNewProvider(models, providerNew, shapeNew);
    reportOut({ models: models.length, providers: 1, shapes: {}, failures, ok: failures.length === 0 });
    process.exit(failures.length === 0 ? 0 : 1);
  }

  const r = runTester(models, providers, defaultProvider);
  reportOut(r);
  process.exit(r.ok ? 0 : 1);
}

if (import.meta.main) { await main(); }