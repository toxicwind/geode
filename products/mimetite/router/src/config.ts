/**
 * config.ts — mimetite router configuration loader.
 *
 * Feature flags and router settings live in the mimetite `config.yaml`
 * (or `config.local.yaml` when present), NOT env vars — env gets lost across
 * daemon restarts and is invisible in the config surface. This module loads
 * the YAML config once, merges it over sane defaults, and exposes typed
 * accessors.
 *
 * Resolution order (first existing wins):
 *   1. `config.local.yaml` in the repo root (local overrides)
 *   2. `config.yaml` in the repo root
 * Defaults are used when neither exists.
 */

import { readFileSync } from "node:fs";
import { parse } from "yaml";

export interface FeaturesConfig {
  /** Tool-argument coercion (ported from tau). Default true. */
  coercion: { enabled: boolean };
  /** Provider dialect engine (ported from tau). Default false — preserves old behavior until enabled. */
  dialect: { enabled: boolean };
  /** Upstream fault classification (fault/ Lua modules). Default true. */
  faults: { enabled: boolean };
}

export interface RouterConfig {
  features: FeaturesConfig;
}

const DEFAULT_CONFIG: RouterConfig = {
  features: {
    coercion: { enabled: true },
    dialect: { enabled: false },
    faults: { enabled: true },
  },
};

/** Repo-root config candidates, in precedence order. */
function configCandidates(): string[] {
  const here = new URL("../", import.meta.url).pathname;
  return [`${here}config.local.yaml`, `${here}config.yaml`];
}

function deepMerge<T>(base: T, override: Partial<T>): T {
  if (override === undefined || override === null) return base;
  if (typeof base !== "object" || Array.isArray(base) || typeof override !== "object") {
    return (override as T) ?? base;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    if (v === undefined) continue;
    const baseV = (base as Record<string, unknown>)[k];
    out[k] = typeof v === "object" && v !== null && !Array.isArray(v) && typeof baseV === "object" && baseV !== null
      ? deepMerge(baseV, v)
      : v;
  }
  return out as T;
}

let cached: RouterConfig | undefined;

/** Load the router config once (memoized). Falls back to defaults on any read/parse error. */
export function loadConfig(): RouterConfig {
  if (cached) return cached;
  for (const path of configCandidates()) {
    try {
      const raw = readFileSync(path, "utf8");
      const parsed = parse(raw) as Partial<RouterConfig>;
      cached = deepMerge(DEFAULT_CONFIG, parsed);
      return cached;
    } catch {
      // try next candidate
    }
  }
  cached = DEFAULT_CONFIG;
  return cached;
}

/** Convenience accessor for the feature-flag block. */
export function features(): FeaturesConfig {
  return loadConfig().features;
}
