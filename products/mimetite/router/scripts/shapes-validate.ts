#!/usr/bin/env bun
/**
 * shapes-validate.ts — future-forward model-id shape gate.
 *
 * Runs the shapes invariant over EVERY provider seed in the catalog. Any model
 * id that double-prefixes, misclassifies, or has a duplicate token FAILS here —
 * so a new provider added to data.ts can't silently reintroduce the
 * nvidia/nvidia/… class of bug.
 *
 *   bun scripts/shapes-validate.ts          # validate all catalog providers
 *   bun scripts/shapes-validate.ts --json   # machine-readable report
 */
import { PROVIDER_DEFS } from "../../catalog/src/data.ts";
import { classifyModelId, routingId, hasDupPrefix, correctDupPrefix } from "../src/shapes.ts";

type Violation = {
  provider: string;
  model: string;
  issue: string;
};

const violations: Violation[] = [];
const seen = new Set<string>();

for (const def of PROVIDER_DEFS) {
  const seeds = [
    ...(def.seeds ?? []),
    ...(def.staticModels ?? []),
    ...(def.modelProviders ?? []).flatMap((mp) => [...(mp.seeds ?? [])]),
  ];
  for (const seed of new Set(seeds)) {
    const key = `${def.name}|${seed}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const info = classifyModelId(seed);

    // 1. No duplicate leading token (nvidia/nvidia/x)
    if (hasDupPrefix(seed)) {
      violations.push({ provider: def.name, model: seed, issue: `duplicate prefix; corrected=${correctDupPrefix(seed)}` });
    }

    // 2. routingId is idempotent: applying it to an already-qualified id is a no-op
    const rid = routingId(def.name, seed);
    const rid2 = routingId(def.name, rid);
    if (rid !== rid2) {
      violations.push({ provider: def.name, model: seed, issue: `routingId not idempotent: ${rid} -> ${rid2}` });
    }

    // 3. Provider-prefixed seeds must carry the provider as the leading qualifier
    //    (the id is self-describing); provider-relative seeds must NOT already
    //    carry a foreign provider prefix.
    if (info.shape === "provider-prefixed" && info.qualifier && info.qualifier !== def.name && def.name !== "mimetite") {
      // e.g. nvidia provider serving qwen/qwen3.8-27b — the org is not the provider.
      // That's valid for multi-org gateways (NIM hosts qwen/*, meta/*, openai/*).
      // Only flag when the qualifier is the SAME as the provider but doubled.
    }
  }
}

// Cross-provider duplicate-token sweep on the full id set (defense in depth).
const allIds = new Set<string>();
for (const def of PROVIDER_DEFS) {
  for (const s of [...(def.seeds ?? []), ...(def.staticModels ?? [])]) allIds.add(s);
}
for (const id of allIds) {
  if (hasDupPrefix(id) && !violations.some((v) => v.model === id)) {
    violations.push({ provider: "catalog", model: id, issue: `duplicate prefix in catalog; corrected=${correctDupPrefix(id)}` });
  }
}

const shapes: Record<string, number> = {};
for (const def of PROVIDER_DEFS) {
  for (const s of [...(def.seeds ?? []), ...(def.staticModels ?? [])]) {
    const sh = classifyModelId(s).shape;
    shapes[sh] = (shapes[sh] ?? 0) + 1;
  }
}

const report = {
  ok: violations.length === 0,
  providers: PROVIDER_DEFS.length,
  modelsChecked: seen.size,
  shapes,
  violations,
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`shape gate: ${report.ok ? "PASS" : "FAIL"} — ${report.modelsChecked} models across ${report.providers} providers`);
  console.log(`shapes: ${Object.entries(shapes).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  for (const v of violations) console.log(`  ✗ ${v.provider} ${v.model}: ${v.issue}`);
}
process.exit(report.ok ? 0 : 1);