/**
 * Stepping-in-front primitives for the inference plane.
 *
 * These are the "mutated" admission controls the upstreams (sglang behind
 * freeinference, NIM, Vercel) do NOT give us. They live in front, in this
 * router, so every consumer (tau/kappa/hermes) inherits them:
 *
 * 1. SharedProviderLease — CROSS-PROCESS per-provider in-flight cap, wire-
 *    compatible with tau's ProviderInFlight lease (~/.tau/run/provider-inflight).
 *    freeinference's REAL per-key wall is 1 (`429 {"limit":1,"role":"pro"}`,
 *    verified live 2026-11-13). Every process (tau, kappa, hermes, this router)
 *    queues against the SAME lease, so the total in-flight across all of them
 *    never exceeds the cap and the 429 never surfaces. The old per-process
 *    ProviderSemaphore is kept ONLY for providers with no configured cap
 *    (uncapped → DEFAULT_MAX_PARALLEL fast path, no cross-process coordination).
 *
 * 2. retryAfterFloor — parse `retry-after-ms` (body) / `Retry-After` (header)
 *    and use it as the backoff FLOOR. Never `min()` a server-stated wait away:
 *    the server priced that delay (e.g. 593,784ms budget reset). Honoring it
 *    is what lets a QUOTA_EXHAUSTED 429 actually drain instead of failing fast.
 *
 * 3. Fallback diversity — a CONCURRENT_LIMIT shed means "this provider's slots
 *    are full". Falling back to the SAME provider (diversity=1) is a circle.
 *    The router skips same-provider candidates after a concurrency shed so the
 *    chain actually reaches a different lane.
 */
import type { ProviderDef } from "../../catalog/src/types.ts";
import { createSharedLeaseAcquirer } from "./shared-lease.ts";

// ─── 1. Per-provider concurrency cap (CROSS-PROCESS shared lease) ────────────

/**
 * Max in-flight requests per provider, shared across ALL processes via the
 * filesystem lease (tau-compatible). These are OUR side of the upstream's slot
 * cap. Verified 2026-11-13: freeinference limit=1 per key (NOT 2 as older docs
 * claimed). Providers with no entry fall back to DEFAULT_MAX_PARALLEL via the
 * fast in-process semaphore (no cross-process coordination needed — they have
 * no hard wall).
 */
export const PROVIDER_MAX_PARALLEL: Record<string, number> = {
  freeinference: 1, // verified live: `429 {"limit":1,"role":"pro"}`
  nvidia: 2, // NIM: 40 RPM/key, but long generations hold slots
  "vercel-gateway": 1, // free tier ~20 RPM effective; 1 keeps pacing sane
  google: 2,
  "google-antigravity": 1,
  groq: 2,
};

const DEFAULT_MAX_PARALLEL = 4;

/** The shared cross-process lease for providers with a configured cap. */
export const sharedLease = createSharedLeaseAcquirer();

// ─── Route A: AIMD congestion window (auto-discover the wall) ───────────────
// CONCUR (ICML 2026): agentic batch inference is a congestion-control problem.
// Fixed caps are wrong (they either 429 or underutilize). The 429 body carries
// a price (`retry-after-ms`) — that's the congestion signal. Start at the
// catalog cap, additively increase on success, multiplicatively decrease on
// 429. The learned window feeds the shared lease so ALL processes queue
// against the TRUE wall, which changes per key/role over time.
const WINDOW_START = 1;
const WINDOW_MIN = 1;
const WINDOW_MAX = 8;
const AIMD_INCREASE = 1; // +1 per success (additive)
const AIMD_DECREASE = 0.5; // ×0.5 on 429 (multiplicative)

const congestionWindow = new Map<string, number>();

export function currentWindow(provider: string): number {
  return congestionWindow.get(provider) ?? WINDOW_START;
}

/** Call after a successful upstream response: grow the window additively. */
export function recordSuccess(provider: string): void {
  const w = currentWindow(provider);
  // Never grow past a provider's catalog cap: the cap IS the upstream wall
  // (e.g. freeinference limit=1). Growing past it makes the shared lease
  // admit concurrent requests the upstream will 429 (verified live
  // 2026-11-15: after 2 successes the window hit 3 and 429s returned).
  const cap = PROVIDER_MAX_PARALLEL[provider];
  const max = cap !== undefined ? cap : WINDOW_MAX;
  congestionWindow.set(provider, Math.min(max, w + AIMD_INCREASE));
}

/** Call on a 429 concurrency shed: shrink the window multiplicatively. */
export function recordCongestion(provider: string): void {
  const w = currentWindow(provider);
  congestionWindow.set(provider, Math.max(WINDOW_MIN, Math.floor(w * AIMD_DECREASE)));
}

export function congestionWindowsSnapshot(): Record<string, number> {
  return Object.fromEntries(congestionWindow);
}

class ProviderSemaphore {
  private inflight = new Map<string, number>();
  private waiters = new Map<string, Array<() => void>>();

  private cap(provider: string): number {
    return PROVIDER_MAX_PARALLEL[provider] ?? DEFAULT_MAX_PARALLEL;
  }

  /** Acquire a slot for [provider]; resolves when under the cap. Returns release. */
  acquire(provider: string): Promise<() => void> {
    const current = this.inflight.get(provider) ?? 0;
    if (current < this.cap(provider)) {
      this.inflight.set(provider, current + 1);
      return Promise.resolve(() => this.release(provider));
    }
    return new Promise((resolve) => {
      const list = this.waiters.get(provider) ?? [];
      list.push(() => {
        this.inflight.set(provider, (this.inflight.get(provider) ?? 0) + 1);
        resolve(() => this.release(provider));
      });
      this.waiters.set(provider, list);
    });
  }

  private release(provider: string): void {
    const current = (this.inflight.get(provider) ?? 1) - 1;
    if (current <= 0) this.inflight.delete(provider);
    else this.inflight.set(provider, current);
    const list = this.waiters.get(provider);
    const next = list?.shift();
    if (next) next();
    else if (list && list.length === 0) this.waiters.delete(provider);
  }

  snapshot(): Record<string, { inflight: number; max: number; waiting: number }> {
    const out: Record<string, { inflight: number; max: number; waiting: number }> = {};
    const providers = new Set([...this.inflight.keys(), ...this.waiters.keys()]);
    for (const p of providers) {
      out[p] = {
        inflight: this.inflight.get(p) ?? 0,
        max: this.cap(p),
        waiting: this.waiters.get(p)?.length ?? 0,
      };
    }
    return out;
  }
}

export const providerSemaphore = new ProviderSemaphore();

/**
 * Acquire a provider slot, preferring the SHARED cross-process lease for capped
 * providers (so tau/kappa/hermes/this-router all queue against the same wall),
 * falling back to the in-process semaphore for uncapped lanes.
 */
export async function acquireProviderSlot(
  provider: string,
  signal?: AbortSignal,
): Promise<() => Promise<void>> {
  // Route A: use the LEARNED congestion window (AIMD) when we have one — the
  // auto-discovered wall beats the hardcoded catalog cap. Fall back to the
  // catalog cap for providers we haven't learned yet, and the in-process
  // semaphore for uncapped lanes.
  const learned = currentWindow(provider);
  const cap = PROVIDER_MAX_PARALLEL[provider];
  if (cap !== undefined || learned > 0) {
    // A known catalog cap is the upstream wall — never admit more than it,
    // even if the AIMD window learned a higher value (defensive).
    const limit = cap !== undefined ? Math.min(learned, cap) : learned;
    const lease = await sharedLease.acquire(provider, limit, signal);
    return lease.release;
  }
  return providerSemaphore.acquire(provider);
}

// ─── 2. Retry-after as floor ─────────────────────────────────────────────────

/**
 * Extract the server-stated retry wait from a 429 response. FreeInference puts
 * `retry-after-ms` in the JSON body; the HTTP `Retry-After` header is the
 * standard fallback. Returns 0 when the server said nothing.
 */
export function retryAfterMs(status: number, bodyText: string, headers: Headers): number {
  if (status !== 429) return 0;

  // Body forms: {"error":{"retry_after_ms":593784}} / {"retry_after_ms":...} /
  // {"error":{"code":"budget_exceeded","retry-after-ms":593784}}
  try {
    const m = bodyText.match(/"retry[_-]?after[_-]?ms"\s*:\s*(\d+)/i);
    if (m) return Number(m[1]);
    const s = bodyText.match(/"retry[_-]?after"\s*:\s*(\d+)/i);
    if (s) return Number(s[1]) * 1000;
  } catch {}

  // Header: Retry-After: 120 (seconds) or Retry-After: <http-date>
  const header = headers.get("retry-after");
  if (header) {
    const secs = Number(header);
    if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return 0;
}

/** True when the 429 body names a concurrency shed (vs quota/budget). */
export function isConcurrencyShed(bodyText: string): boolean {
  return /concurrent|too many concurrent|concurrency_limit|slot/i.test(bodyText);
}

/** True when the 429 body names quota/budget exhaustion (walks fallback chain). */
export function isQuotaExhausted(bodyText: string): boolean {
  return /quota|budget|daily cost|exhausted|spend caps?|rate.limit|exceeded/i.test(bodyText);
}

// ─── 3. Fallback diversity ───────────────────────────────────────────────────

/**
 * Build the candidate walk for [modelId] with diversity enforced: after a
 * CONCURRENT_LIMIT shed on [triedProviders], skip candidates whose provider is
 * already in that set — a same-provider retry after a slot shed is a circle.
 * Quota/budget sheds still allow same-provider retries (a slot may free), but
 * the router prefers a different provider when one exists.
 */
export function diverseCandidates(
  candidates: Array<{ provider: ProviderDef; model: string; isEmbeddings: boolean }>,
  triedProviders: ReadonlySet<string>,
  shedProviders: ReadonlySet<string>,
): Array<{ provider: ProviderDef; model: string; isEmbeddings: boolean }> {
  if (shedProviders.size === 0) return candidates;
  return candidates.filter((c) => !shedProviders.has(c.provider.name) || !triedProviders.has(c.provider.name));
}