/**
 * lane-router.ts — foreground vs background lane isolation for mimetite.
 *
 * Invariant #5: background auxiliary tasks (`[memory]` consolidation, `smol`,
 * title generation, mnemopi) must never contend with foreground agent turns on
 * single-concurrency rate-limited upstream keys (freeinference limit=1). When
 * a request is identified as a background lane, the router routes it
 * deterministically to the local bornite engine (:25196, qwen3.5-9b-Q5_K_M)
 * instead of the cloud upstream.
 *
 * Identification sources:
 *   - `x-omp-lane: memory | smol` header (omp/tau emit this)
 *   - system-prompt fingerprint: `[memory]`, `mnemopi`, `stage1 consolidation`
 */

export type BackgroundLane = "memory" | "smol";

export interface LaneDecision {
  /** True when this request is a background auxiliary lane. */
  background: boolean;
  /** Which background lane, when `background` is true. */
  lane?: BackgroundLane;
  /** System-prompt fingerprint matched (for diagnostics). */
  matched?: string;
}

const SYSTEM_PROMPT_FINGERPRINTS: ReadonlyArray<{ lane: BackgroundLane; re: RegExp }> = [
  { lane: "memory", re: /\[memory\]|stage1 consolidation/i },
  { lane: "memory", re: /mnemopi/i },
  { lane: "smol", re: /smol/i },
];

function systemPromptOf(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const messages = (body as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return "";
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const m = message as { role?: unknown; content?: unknown };
    if (m.role !== "system") continue;
    const content = m.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const text = content
        .map((part) =>
          part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
            ? (part as { text: string }).text
            : "",
        )
        .join(" ");
      if (text) return text;
    }
  }
  return "";
}

/** Classify a request body + headers into a lane decision. */
export function classifyLane(headers: Headers, body: unknown): LaneDecision {
  const laneHeader = headers.get("x-omp-lane")?.trim().toLowerCase() ?? "";
  if (laneHeader === "memory" || laneHeader === "smol") {
    return { background: true, lane: laneHeader as BackgroundLane, matched: `x-omp-lane: ${laneHeader}` };
  }

  const systemPrompt = systemPromptOf(body);
  if (!systemPrompt) return { background: false };

  for (const { lane, re } of SYSTEM_PROMPT_FINGERPRINTS) {
    if (re.test(systemPrompt)) {
      return { background: true, lane, matched: `${lane}: system-prompt fingerprint` };
    }
  }
  return { background: false };
}

/** Local bornite target used for background-lane offload. */
export const BORNITE_BACKGROUND_ROUTE = {
  provider: "bornite",
  model: "qwen3.5-9b-Q5_K_M",
} as const;

/**
 * Decide the effective provider/model for a request. When the request is a
 * background lane AND the primary route would land on a rate-limited cloud
 * provider (freeinference), redirect to local bornite. Otherwise return the
 * caller's route unchanged.
 */
export function applyLaneIsolation(input: {
  headers: Headers;
  body: unknown;
  provider: string;
  model: string;
}): { provider: string; model: string; lane?: BackgroundLane; offloaded: boolean } {
  const decision = classifyLane(input.headers, input.body);
  if (!decision.background) {
    return { provider: input.provider, model: input.model, offloaded: false };
  }

  const rateLimitedCloud = input.provider === "freeinference";
  if (rateLimitedCloud) {
    return {
      provider: BORNITE_BACKGROUND_ROUTE.provider,
      model: BORNITE_BACKGROUND_ROUTE.model,
      lane: decision.lane,
      offloaded: true,
    };
  }

  return { provider: input.provider, model: input.model, lane: decision.lane, offloaded: false };
}
