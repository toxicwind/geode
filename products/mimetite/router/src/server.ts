/**
 * mimetite unified router — ONE Bun router to rule the inference plane.
 *
 * Consolidates:
 * - Aggressive circuit breaking (instant trip on 401/404/410, exponential backoff on 429/5xx)
 * - Live v1 models discovery & dynamic provider selection
 * - SSE-first streaming (/models/sse live feed + resilient chat/completions SSE proxy)
 * - Catalog integration (PROVIDER_DEFS, MODEL_ALIASES, DEAD_MODEL_IDS)
 *
 * Engine: pure Bun. Zero external binaries.
 */
import { readFileSync } from "node:fs";
import { PROVIDER_DEFS, MODEL_ALIASES, DEAD_MODEL_IDS } from "../../catalog/src/data.ts";
import { joinBaseUrl } from "../../catalog/src/adapters.ts";
import type { ProviderDef } from "../../catalog/src/types.ts";
import { providerSemaphore, retryAfterMs, isConcurrencyShed, isQuotaExhausted, acquireProviderSlot, PROVIDER_MAX_PARALLEL, recordSuccess, recordCongestion, congestionWindowsSnapshot } from "./primitives.ts";
import { qualify as routingId } from "./shapes.ts";
import { healSseResponse } from "./stream-healer.ts";
import { applyLaneIsolation } from "./lane-router.ts";

export type ProviderRoute = {
  provider: ProviderDef;
  model: string;
  isEmbeddings: boolean;
};

// ─── Model-id normalization (the double-prefix code smell) ──────────────────
// Catalog model ids ALREADY carry the provider prefix (nvidia/nemotron-…). Any
// `${provider}/${model}` interpolation then double-prefixes (nvidia/nvidia/…)
// and the upstream 403s. Two idempotent helpers kill that class of bug:
//   qualify(p, m)  — apply the provider prefix ONCE (never twice).
//   normalize(m)   — strip duplicate provider prefixes from an incoming id.
export function qualify(provider: string, model: string): string {
  return model === provider || model.startsWith(`${provider}/`) ? model : `${provider}/${model}`;
}

export function normalizeModelId(modelId: string): string {
  const parts = modelId.split("/").filter(Boolean);
  while (parts.length > 2 && parts[0] === parts[1]) parts.shift(); // nvidia/nvidia/x -> nvidia/x
  return parts.join("/");
}

/** Strip a duplicate leading provider token ONLY when one exists. Returns the
 *  original id unchanged when there is no `same/same/…` prefix — so a legit
 *  multi-segment id is never rewritten. Used to CORRECT on upstream failure,
 *  not to preemptively rewrite every request. */
export function correctDupPrefix(model: string): string {
  const parts = model.split("/").filter(Boolean);
  if (parts.length > 2 && parts[0] === parts[1]) return parts.slice(1).join("/");
  return model;
}

const EMBEDDING_MODELS = new Set([
  "bge-m3",
  "bge-m3-large",
  "text-embedding-3-small",
  "nvidia/nemotron-3.5-embed-1b",
  "nvidia/nemotron-3.5-embed-8b",
  "nvidia/llama-nemotron-embed-vl-1b-v2",
  "nemotron-3.5-embed-1b",
  "nemotron-3.5-embed-8b",
  "llama-nemotron-embed-vl-1b-v2",
]);

// ─── Circuit Breaker ──────────────────────────────────────────────────────────

// Response-headers timeout for upstream fetches. Once headers arrive the body
// streams with no deadline, so this is safe for SSE. Without it a hung upstream
// blocks the router forever (breaker never trips, callers wedge in "starting").
const UPSTREAM_HEADERS_TIMEOUT_MS = 30_000;

// Seeded "forever" EOL trips are deliberately finite: they expire and get
// re-probed, so a model that comes back online self-heals without admin action.
// Genuinely dead models re-trip on the next probe (operator: "reset on build").
const DEAD_MODEL_TRIP_MS = 24 * 60 * 60 * 1000; // 24h

export type BreakerEntry = {
  trippedUntil: number;
  reason: string;
  failures: number;
  successes: number;
};

class CircuitBreaker {
  private entries = new Map<string, BreakerEntry>();
  private sseSubscribers = new Set<(event: string, data: unknown) => void>();

  constructor() {
    // Seed permanent dead models from catalog SSOT
    for (const deadId of DEAD_MODEL_IDS) {
      this.trip(`*`, deadId, "EOL / listed dead", DEAD_MODEL_TRIP_MS);
    }
  }

  private key(provider: string, model?: string): string {
    // routingId is idempotent — never double-prefixes a model that already
    // carries its provider qualifier (the nvidia/nvidia/… bug class).
    return model ? routingId(provider, model) : `${provider}/*`;
  }

  isTripped(provider: string, model?: string): { tripped: boolean; reason?: string } {
    const now = Date.now();
    // Check provider-wide trip
    const providerKey = this.key(provider);
    const pEntry = this.entries.get(providerKey);
    if (pEntry && pEntry.trippedUntil > now) {
      return { tripped: true, reason: `provider ${provider} tripped: ${pEntry.reason}` };
    }

    // Check specific model trip (or global model trip across all providers)
    if (model) {
      const modelKey = this.key(provider, model);
      const mEntry = this.entries.get(modelKey);
      if (mEntry && mEntry.trippedUntil > now) {
        return { tripped: true, reason: `model ${model} tripped: ${mEntry.reason}` };
      }
      const globalKey = this.key("*", model);
      const gEntry = this.entries.get(globalKey);
      if (gEntry && gEntry.trippedUntil > now) {
        return { tripped: true, reason: `model ${model} globally dead: ${gEntry.reason}` };
      }
    }
    return { tripped: false };
  }

  trip(provider: string, model: string | undefined, reason: string, durationMs = 60_000): void {
    const k = this.key(provider, model);
    const existing = this.entries.get(k);
    const failures = (existing?.failures ?? 0) + 1;
    const trippedUntil = Date.now() + durationMs;
    this.entries.set(k, {
      trippedUntil,
      reason,
      failures,
      successes: existing?.successes ?? 0,
    });
    this.notify("model_tripped", { provider, model, reason, durationMs });
  }

  recordSuccess(provider: string, model?: string): void {
    const k = this.key(provider, model);
    // Success is proof-of-life: drop the entry entirely so the route recovers
    // immediately instead of waiting for expiry (self-healing, not clock-bound).
    if (this.entries.delete(k)) {
      this.notify("model_recovered", { provider, model });
    }
  }

  // Clear one entry (or provider-wide entry) by its raw routed key, e.g.
  // "freeinference/deepseek-v4-flash" or "openai/*". Returns whether it existed.
  resetKey(key: string): boolean {
    return this.entries.delete(key);
  }

  // Clear every entry, including seeded EOL trips — effectively "reset on
  // build" at runtime so every model gets a fresh probe. Returns count cleared.
  resetAll(): number {
    const n = this.entries.size;
    this.entries.clear();
    return n;
  }

  subscribe(listener: (event: string, data: unknown) => void): () => void {
    this.sseSubscribers.add(listener);
    return () => this.sseSubscribers.delete(listener);
  }

  private notify(event: string, data: unknown): void {
    for (const listener of this.sseSubscribers) {
      try {
        listener(event, data);
      } catch {}
    }
  }

  snapshot(): Record<string, { status: "tripped" | "healthy"; reason?: string; failures: number; successes: number; remainingMs: number }> {
    const out: Record<string, { status: "tripped" | "healthy"; reason?: string; failures: number; successes: number; remainingMs: number }> = {};
    const now = Date.now();
    for (const [k, v] of this.entries.entries()) {
      const active = v.trippedUntil > now;
      out[k] = {
        status: active ? "tripped" : "healthy",
        reason: v.reason,
        failures: v.failures,
        successes: v.successes,
        remainingMs: active ? Math.max(0, v.trippedUntil - now) : 0,
      };
    }
    return out;
  }
}

export const circuitBreaker = new CircuitBreaker();

// ─── Key & Network Utilities ─────────────────────────────────────────────────

export function isLoopback(addr: string): boolean {
  return addr === "127.0.0.1" || addr === "::1" || addr === "localhost" || addr.startsWith("127.");
}

export function resolveProviderKey(provider: ProviderDef): string | undefined {
  const envNames = [provider.keyEnv, provider.keyEnvAlt ?? ""].filter(Boolean);
  for (const name of envNames) {
    const v = process.env[name];
    if (v && v.trim()) return v.trim();
  }
  if (provider.name) {
    const slug = provider.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    try {
      const v = readFileSync(`/home/toxic/.tau/${slug}.key`, "utf8").trim();
      if (v) return v;
    } catch {}
  }
  return undefined;
}

// ─── Live v1 Discovery Cache ─────────────────────────────────────────────────

type LiveDiscoveryCache = {
  models: Set<string>;
  updatedAt: number;
};

const liveDiscovery = new Map<string, LiveDiscoveryCache>();
const DISCOVERY_TTL_MS = 300_000; // 5 minutes

export async function refreshLiveModels(provider: ProviderDef): Promise<Set<string>> {
  const key = resolveProviderKey(provider);
  if (!key && provider.auth !== "none") return new Set();

  const existing = liveDiscovery.get(provider.name);
  if (existing && Date.now() - existing.updatedAt < DISCOVERY_TTL_MS) {
    return existing.models;
  }

  const path = provider.modelsPath ?? "/models";
  const url = joinBaseUrl(provider.baseUrl, path);
  const headers: Record<string, string> = {
    ...(provider.extraHeaders ?? {}),
    // connection: close on EVERY upstream fetch — discovery included. Without it
    // Bun pools keep-alives; NIM (and others) silently close pooled sockets and
    // the next fetch reuses a poisoned connection, hanging until TCP timeout.
    // The 30s AbortSignal bounds it, but close-on-every-request prevents the
    // stale pool in the first place.
    connection: "close",
  };
  // Discovery must use the provider's pinned identity when declared — the
  // upstream /v1/models list is UA-gated (a claude-cli/1.0.0 UA hides
  // bge-m3), so a bare Bun default or a forwarded client UA can silently drop
  // models from the discovered set.
  const discoveryUA = provider.userAgent?.trim();
  if (discoveryUA) headers["user-agent"] = discoveryUA;
  if (key) {
    headers["authorization"] = `Bearer ${key}`;
  }

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        circuitBreaker.trip(provider.name, undefined, `live discovery auth failed (${res.status})`, 1_800_000);
      }
      return existing?.models ?? new Set();
    }
    const json = (await res.json()) as { data?: Array<{ id: string }> };
    const set = new Set<string>();
    if (Array.isArray(json?.data)) {
      for (const m of json.data) {
        if (m.id && typeof m.id === "string") set.add(m.id);
      }
    }
    liveDiscovery.set(provider.name, { models: set, updatedAt: Date.now() });
    return set;
  } catch (err: unknown) {
    return existing?.models ?? new Set();
  }
}

// ─── Routing & Dynamic Deciding ──────────────────────────────────────────────

export function routeModel(modelId: string): ProviderRoute | undefined {
  const candidates = getCandidateRoutes(modelId);
  // Dynamically select the first non-tripped candidate with key access
  for (const c of candidates) {
    const trip = circuitBreaker.isTripped(c.provider.name, c.model);
    if (trip.tripped) continue;

    const key = resolveProviderKey(c.provider);
    if (!key && c.provider.auth !== "none") continue;

    return c;
  }

  // If all are tripped, return the highest-priority candidate anyway so proxy can surface detailed 503
  return candidates[0];
}

export function getCandidateRoutes(modelId: string): ProviderRoute[] {
  const parts = modelId.split("/");
  let qualifier = parts.length === 2 ? parts[0] : undefined;
  let model = qualifier ? parts[1] : modelId;

  if (qualifier === "mimetite" || qualifier === "flock") {
    qualifier = undefined;
  }

  const out: ProviderRoute[] = [];
  const seen = new Set<string>();

  const pushCandidate = (provider: ProviderDef, targetModel: string) => {
    if (provider.routerLocal || provider.enabled === false) return;
    const tag = routingId(provider.name, targetModel);
    if (seen.has(tag)) return;
    seen.add(tag);

    const isEmb = EMBEDDING_MODELS.has(targetModel);
    const seedMatch = provider.seeds?.find(
      (s) => s === targetModel || s === `${provider.name}/${targetModel}` || s.endsWith(`/${targetModel}`)
    );
    out.push({
      provider,
      model: seedMatch ?? targetModel,
      isEmbeddings: isEmb,
    });
  };

  // 1. Check MODEL_ALIASES
  const aliasMatch = MODEL_ALIASES[model] ?? MODEL_ALIASES[modelId];
  if (aliasMatch && aliasMatch.length >= 2) {
    const [pName, targetModel] = aliasMatch;
    const provider = PROVIDER_DEFS.find((p) => p.name === pName);
    if (provider) {
      pushCandidate(provider, targetModel);
    }
  }

  // 2. Exact qualifier
  if (qualifier) {
    const provider = PROVIDER_DEFS.find((p) => p.name === qualifier);
    if (provider) {
      pushCandidate(provider, model);
    }
  }

  // 3. Match across all providers by seeds / staticModels / live discovery
  for (const provider of PROVIDER_DEFS) {
    if (qualifier && provider.name === qualifier) continue;
    // Seeds may carry an upstream provider prefix distinct from the owning
    // provider (openrouter hosts `x-ai/grok-4.5`, `nvidia/nemotron-*`, ...), so
    // a request using the seed's full id must match the seed verbatim — not just
    // the qualifier-stripped `model` (that misses fully-qualified seeds).
    const seeds = provider.seeds ?? [];
    const serves =
      seeds.includes(model) ||
      seeds.includes(`${provider.name}/${model}`) ||
      seeds.includes(modelId) ||
      (provider.staticModels ?? []).includes(model) ||
      liveDiscovery.get(provider.name)?.models.has(model);

    if (serves) {
      pushCandidate(provider, model);
    }
  }

  // 4. Failovers from failoverCandidates
  for (const f of failoverCandidates(modelId)) {
    pushCandidate(f.provider, f.model);
  }

  return out;
}

export function failoverCandidates(modelId: string): Array<{ provider: ProviderDef; model: string }> {
  const parts = modelId.split("/");
  const qualifier = parts.length === 2 ? parts[0] : undefined;
  const model = qualifier ? parts[1] : modelId;
  const out: Array<{ provider: ProviderDef; model: string }> = [];
  const seen = new Set<string>();

  const push = (provider: ProviderDef, upstreamModel: string) => {
    if (provider.routerLocal || provider.enabled === false) return;
    const key = routingId(provider.name, upstreamModel);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ provider, model: upstreamModel });
  };

  for (const [aliasKey, target] of Object.entries(MODEL_ALIASES)) {
    if (!target || target.length < 2) continue;
    const [providerName, upstreamModel] = target;
    if (qualifier && providerName === qualifier) continue;
    const aliasModel = aliasKey.split("/").pop() ?? aliasKey;
    if (aliasModel === model || upstreamModel === model || upstreamModel.endsWith(`/${model}`)) {
      const provider = PROVIDER_DEFS.find((p) => p.name === providerName);
      if (provider) push(provider, upstreamModel);
    }
  }

  for (const provider of PROVIDER_DEFS) {
    if (qualifier && provider.name === qualifier) continue;
    const serves = (provider.seeds ?? []).some(
      (s) => s === model || s === `${provider.name}/${model}`
    );
    if (serves) push(provider, model);
  }

  return out;
}

// ─── HTTP Utilities ──────────────────────────────────────────────────────────

const PORT = Number(process.env.UNIFIED_ROUTER_PORT ?? process.env.MIMETITE_PORT ?? 8080);
const CLIENT_KEYS = (process.env.MIMETITE_CLIENT_KEYS ?? "").split(",").map((k) => k.trim()).filter(Boolean);

function loopback(r: Request): boolean {
  const host = new URL(r.url).hostname;
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function authorized(r: Request): boolean {
  if (loopback(r)) return true;
  const header = r.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  return CLIENT_KEYS.length === 0 || CLIENT_KEYS.includes(m[1].trim());
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function buildModelList() {
  const now = Math.floor(new Date("2026-11-02T08:51:42.000Z").getTime() / 1000);
  const deadSet = new Set(DEAD_MODEL_IDS);
  const aliasSet = new Set(Object.keys(MODEL_ALIASES));
  const ids = new Set<string>();
  const ownedBy: Record<string, string> = {};

  for (const provider of PROVIDER_DEFS) {
    if (provider.routerLocal || provider.enabled === false) continue;
    // Don't advertise providers that have active auth failure trips
    if (circuitBreaker.isTripped(provider.name).tripped) continue;

    for (const seed of provider.seeds ?? []) {
      if (deadSet.has(seed)) continue;
      if (circuitBreaker.isTripped(provider.name, seed).tripped) continue;
      ids.add(seed);
      ownedBy[seed] = provider.name;
    }
  }
  for (const alias of aliasSet) {
    if (deadSet.has(alias)) continue;
    const target = MODEL_ALIASES[alias];
    if (target && circuitBreaker.isTripped(target[0], target[1]).tripped) continue;
    ids.add(alias);
    ownedBy[alias] = target ? target[0] : "pens-catalog";
  }

  return {
    object: "list" as const,
    data: [...ids].map((id) => ({
      id,
      object: "model" as const,
      created: now,
      owned_by: ownedBy[id] ?? "pens-catalog",
    })),
  };
}

function isRetryableSaturation(status: number, bodyText: string): boolean {
  return (
    status === 429 ||
    status === 503 ||
    status === 409 ||
    (status >= 500 && /(concurrency|too many|rate.?limit|busy|overload|temporarily)/i.test(bodyText))
  );
}

// ─── Proxy Upstream Engine ───────────────────────────────────────────────────

async function proxyUpstream(initialRoute: ProviderRoute, r: Request, path: string): Promise<Response> {
  const allCandidates = getCandidateRoutes(initialRoute.model);
  let requestBody = await r.text();

  // Stepping-in-front state: providers tried this request, and providers that
  // shed us with a concurrency 429 (diversity: skip them in the walk).
  const triedProviders = new Set<string>();
  const shedProviders = new Set<string>();

  // Try candidates in order
  for (let cIdx = 0; cIdx < allCandidates.length; cIdx++) {
    const route = allCandidates[cIdx];
    const tripStatus = circuitBreaker.isTripped(route.provider.name, route.model);
    // ALWAYS skip tripped candidates. The old guard `cIdx < allCandidates.length - 1`
    // let the LAST candidate through even when tripped, so a dead model (e.g. a
    // phantom id that 404s) was hammered on every request AND re-tripped for the
    // full duration each time — the lockout never expired ("does not let go").
    // If every candidate is tripped we fall through to the 503 below WITHOUT
    // touching the upstream, so the breaker can actually cool down.
    if (tripStatus.tripped) {
      continue;
    }

    // Fallback diversity: after a concurrency shed, do not circle back to the
    // same provider — its slots are full; a different lane is the only exit.
    if (shedProviders.has(route.provider.name) && triedProviders.has(route.provider.name)) {
      continue;
    }

    const key = resolveProviderKey(route.provider);
    if (!key && route.provider.auth !== "none") {
      circuitBreaker.trip(route.provider.name, undefined, "missing API key", 3_600_000);
      continue;
    }

    // Rewrite model field to matched upstream model ID
    let body = requestBody;
    try {
      const parsed = JSON.parse(requestBody);
      if (parsed && typeof parsed === "object") {
        parsed.model = route.model;
        if (path === "/v1/embeddings" && parsed?.model?.includes("embed") && !parsed.input_type) {
          parsed.input_type = "query";
          parsed.truncate = parsed.truncate ?? "END";
        }
        body = JSON.stringify(parsed);
      }
    } catch {}

    const url = joinBaseUrl(route.provider.baseUrl, path);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      connection: "close",
      // Never negotiate zstd upstream: Bun/undici cannot auto-decompress zstd,
      // so a Cloudflare-backed provider that obliges an `accept-encoding: zstd`
      // request would ship an undecodable body to every client (kilo/tau/hf).
      // Identity keeps the wire plain; gzip/deflate are still handled by the
      // client stack if a provider ignores this.
      "accept-encoding": "identity",
      ...(route.provider.extraHeaders ?? {}),
    };
    if (key) {
      headers["authorization"] = `Bearer ${key}`;
    }
    // Forward the client's gateway-contract headers verbatim. freeinference
    // uses X-Session-ID for sticky SGLang routing (radix-cache hit rate) and
    // X-Reasoning-Passthrough to strip reasoning_content; losing them here
    // made every request a cold cache miss and billed reasoning tokens.
    for (const h of ["x-session-id", "x-reasoning-passthrough", "x-request-id", "x-owntv-key", "x-owntv-version"]) {
      const v = r.headers.get(h);
      if (v) headers[h] = v;
    }

    // Pin the provider's configured identity when it declares one (freeinference
    // requires its browser UA — a claude-cli/1.0.0 client UA flips the upstream
    // /v1/models catalog and hides bge-m3). Otherwise forward the client's real
    // agent identity, falling back to an explicit mimetite identity. We NEVER
    // send a spoofed browser UA except where the provider config explicitly
    // pins one.
    const configuredUA = route.provider.userAgent?.trim();
    const viaUA = r.headers.get("user-agent")?.trim();
    headers["user-agent"] = configuredUA || (viaUA?.length ? viaUA : `mimetite/${(process.env.PI_VERSION ?? "unified-router").trim()}`);

    // Per-provider concurrency gate: never fire more than the provider's cap
    // ACROSS ALL PROCESSES (shared lease, tau-compatible). Waits for a slot
    // instead of 429ing the client — the 429 must never surface.
    const release = await acquireProviderSlot(route.provider.name);
    triedProviders.add(route.provider.name);
    try {
      const upstream = await fetch(url, {
        method: "POST",
        headers,
        body,
        // Response-HEADERS timeout (streaming-safe: once headers arrive the body
        // streams with no deadline). Without this a hung upstream (NIM cold
        // start, dead keep-alive, silent blackhole) blocks the router forever —
        // the breaker never trips because the fetch never errors, and every
        // caller (hermes gateway warm-up, tau) wedges in "starting".
        signal: AbortSignal.timeout(UPSTREAM_HEADERS_TIMEOUT_MS),
      });

      if (upstream.status < 400) {
        circuitBreaker.recordSuccess(route.provider.name, route.model);
        recordSuccess(route.provider.name); // AIMD: grow the learned window
        // Empty-body guard: a 2xx embeddings response MUST carry a JSON body
        // with a data array. freeinference can 200 with an empty/blank body
        // when upstream bge-m3 drops the payload; surfacing a bare 200-"" to
        // argos silently poisons the embedding lane (empty vector set). Return
        // 502 so clients see a real error and the breaker can cycle.
        if (path === "/v1/embeddings") {
          const text = await upstream.clone().text();
          if (!text.trim()) {
            recordCongestion(route.provider.name);
            return json(502, {
              error: {
                code: "empty_embeddings_body",
                message: `embedding upstream (${route.provider.name}/${route.model}) returned 2xx with an empty body`,
              },
            });
          }
          let parsed: { data?: unknown[] } | null = null;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = null;
          }
          if (!parsed || !Array.isArray(parsed.data) || parsed.data.length === 0) {
            return json(502, {
              error: {
                code: "empty_embeddings_result",
                message: `embedding upstream (${route.provider.name}/${route.model}) returned no embedding data`,
              },
            });
          }
          return new Response(text, {
            status: upstream.status,
            headers: { "content-type": "application/json" },
          });
        }
        return healSseResponse(upstream); // SSE streams pass through with egress markup healing
      }

      const bodyText = await upstream.clone().text();

      // Permanent failure checks: trip aggressively
      if (upstream.status === 410) {
        circuitBreaker.trip(route.provider.name, route.model, `410 Gone: ${bodyText.slice(0, 100)}`, Number.MAX_SAFE_INTEGER);
        continue;
      }
      if (upstream.status === 401 || upstream.status === 403) {
        circuitBreaker.trip(route.provider.name, undefined, `auth failed (${upstream.status}): ${bodyText.slice(0, 100)}`, 1_800_000);
        continue;
      }
      if (upstream.status === 404) {
        circuitBreaker.trip(route.provider.name, route.model, `404 Not Found: ${bodyText.slice(0, 100)}`, 3_600_000);
        continue;
      }

      // Retryable saturation: 429 concurrency / rate limit
      if (isRetryableSaturation(upstream.status, bodyText)) {
        const serverWaitMs = retryAfterMs(upstream.status, bodyText, upstream.headers);
        const shed = isConcurrencyShed(bodyText);
        const quota = isQuotaExhausted(bodyText);
        // A quota/budget 429 is NOT a slot shed: the provider may still have a
        // free slot, so diversity keeps it eligible. Only a concurrency shed
        // marks the provider as "slots full — do not circle back".
        if (shed) {
          shedProviders.add(route.provider.name);
          recordCongestion(route.provider.name); // AIMD: shrink the learned window
        }

        // NEVER trip the breaker on a 429 — it is congestion, not a dead model.
        // The shared lease serializes router-internal traffic; a 429 here means
        // an external holder (a direct tau/kappa/hermes lane) has the slot.
        // Hold and retry with the server's stated wait as the FLOOR, then
        // diversify to the next candidate. Tripping the breaker here is what
        // caused the 503 storm: every subagent request 503'd instantly for
        // 5-15s, retried with 15-70s backoff, collided again, re-tripped.
        if (shed) {
          const retryCeiling = Math.max(route.provider.retryCeiling ?? 1, 2);
          for (let attempt = 1; attempt <= retryCeiling; attempt++) {
            // Server-stated wait is the floor; exponential backoff only adds to it.
            const baseWait = serverWaitMs > 0 ? serverWaitMs : Math.min(500 * Math.pow(2, attempt - 1), 2000);
            await new Promise((resolve) => setTimeout(resolve, baseWait));
            const retry = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(UPSTREAM_HEADERS_TIMEOUT_MS) });
            if (retry.status < 400) {
              circuitBreaker.recordSuccess(route.provider.name, route.model);
              return healSseResponse(retry);
            }
            if (quota) break; // budget reset: one honored wait, then diversify
          }
          continue; // still saturated → next candidate; NO breaker trip
        }

        // Quota/budget 429: honor the stated wait once (bounded), then let the
        // walk continue to a different provider. Also no breaker trip.
        if (quota && serverWaitMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(serverWaitMs, 30_000)));
        }
      }
    } catch (err: unknown) {
      circuitBreaker.trip(route.provider.name, route.model, `network error: ${String(err)}`, 30_000);
    } finally {
      release();
    }
  }

  return json(503, {
    error: {
      code: "circuit_breaker_open",
      message: `All candidates for model ${initialRoute.model} are currently circuit-broken or unavailable`,
      breaker_status: circuitBreaker.snapshot(),
      semaphore: providerSemaphore.snapshot(),
      congestion_windows: congestionWindowsSnapshot(),
    },
  });
}

// ─── SSE Model Events Streamer ────────────────────────────────────────────────

function handleModelsSse(_r: Request): Response {
  let unsub: (() => void) | undefined;
  const stream = new ReadableStream({
    start(controller) {
      // Send initial models snapshot
      const initial = buildModelList();
      controller.enqueue(new TextEncoder().encode(`: keep-alive\n\n`));
      controller.enqueue(
        new TextEncoder().encode(`event: models_snapshot\ndata: ${JSON.stringify(initial)}\n\n`)
      );

      // Subscribe to circuit breaker updates
      unsub = circuitBreaker.subscribe((event, data) => {
        try {
          controller.enqueue(
            new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {}
      });

      // Keep alive heartbeat every 15s
      const timer = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(`: keep-alive\n\n`));
        } catch {
          clearInterval(timer);
        }
      }, 15_000);
    },
    cancel() {
      unsub?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ─── Server Bootstrap ────────────────────────────────────────────────────────

function healthCheck(): boolean {
  try {
    const models = buildModelList();
    return Array.isArray(models.data);
  } catch {
    return false;
  }
}

if (import.meta.main) {
  Bun.serve({
    port: PORT,
    idleTimeout: 60,
    async fetch(r: Request): Promise<Response> {
      const url = new URL(r.url);
      if (!authorized(r)) {
        return json(401, { error: { code: "unauthorized", message: "missing or invalid client key" } });
      }
      if (r.method === "GET" && url.pathname === "/health") {
        const ok = healthCheck();
        return json(200, { ok, service: "unified-router", port: PORT, catalog: true, breaker: circuitBreaker.snapshot() });
      }
      if (r.method === "GET" && url.pathname === "/v1/models") {
        return json(200, buildModelList());
      }
      if (r.method === "POST" && url.pathname === "/admin/breaker/reset") {
        return json(200, { ok: true, reset: circuitBreaker.resetAll() });
      }
      if (r.method === "POST" && url.pathname.startsWith("/admin/breaker/reset/")) {
        const key = decodeURIComponent(url.pathname.slice("/admin/breaker/reset/".length));
        return json(200, { ok: true, done: circuitBreaker.resetKey(key) });
      }
      if (r.method === "GET" && (url.pathname === "/models/sse" || url.pathname === "/v1/models/sse")) {
        return handleModelsSse(r);
      }
      if (r.method === "POST" && (url.pathname === "/v1/chat/completions" || url.pathname === "/v1/embeddings")) {
        const raw = await r.clone().json().catch(() => null);
        const modelId = raw?.model as string | undefined;
        if (!modelId) return json(400, { error: { code: "bad_request", message: "missing model" } });
        let route = routeModel(modelId);
        if (!route) return json(400, { error: { code: "unknown_model", message: modelId } });
        // Invariant #5: background [memory]/smol consolidation must never contend
        // with foreground turns on single-concurrency freeinference keys. When the
        // request is a background lane and the primary route lands on freeinference,
        // offload deterministically to local bornite (:25196).
        const lane = applyLaneIsolation({
          headers: r.headers,
          body: raw,
          provider: route.provider.name,
          model: route.model,
        });
        if (lane.offloaded) {
          const borniteRoute = routeModel(`${lane.provider}/${lane.model}`);
          if (borniteRoute) route = borniteRoute;
        }
        const response = await proxyUpstream(route, r, url.pathname);
        return response;
      }
      return json(404, { error: { code: "not_found", message: url.pathname } });
    },
  });
  console.log(`unified-router listening on 127.0.0.1:${PORT}`);
}
