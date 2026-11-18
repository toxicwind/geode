/**
 * circuit-breaker/types.ts — contract for modular upstream-fault classification.
 *
 * The old model had inline, hardcoded fault handling scattered through
 * server.ts and primitives.ts: two 429 regex buckets (isConcurrencyShed /
 * isQuotaExhausted), plus inline branches for auth 401/403, 404, UA-blocked
 * (cf-1010), and network errors. Every fault type was a bespoke `if` in the
 * request loop, and anything that matched none of the buckets fell through
 * unclassified.
 *
 * This module system replaces that: each fault type is a self-contained `.lua`
 * module under `modules/`. The Lua worker classifies every upstream response
 * (status + body) in priority order and returns a policy action. The system is
 * NOT 429-specific — it covers any retryable fault the router can see.
 */

/** What a matched fault module tells the router to do. */
export type BreakerAction = "shed" | "quota" | "trip" | "none";

/** The policy a module returns for a matched upstream response. */
export interface BreakerPolicy {
  action: BreakerAction;
  /** Explicit wait before retry (ms). Overrides the generic retryAfterMs floor. */
  retryAfterMs?: number;
  /** Trip scope: "provider" trips the whole provider; "model" trips just the model. */
  scope?: "provider" | "model";
  /** Human/summary reason, surfaced in the breaker stats / error body. */
  reason?: string;
}

/** Context passed to a module's policy() so it can act per provider/model. */
export interface BreakerContext {
  provider: string;
  model: string;
}

/** Result of classifying one upstream response. */
export interface BreakerClassifyResult {
  /** Name of the module that matched, or null if none did. */
  matched: string | null;
  /** The module's policy, or null if no module matched. */
  policy: BreakerPolicy | null;
}

/**
 * The contract a Lua module must satisfy. Implemented in Lua, mirrored here for
 * the TS side's benefit (the actual logic lives in the .lua files).
 */
export interface BreakerModule {
  name: string;
  /** Lower runs first. Ties break by name. */
  priority: number;
  /** True when this module owns the given upstream response. */
  match(status: number, body: string): boolean;
  /** The action to take for a matched response. */
  policy(status: number, body: string, ctx: BreakerContext): BreakerPolicy;
}
