// src/shapes.ts — model-ID shape classifier + idempotent qualifier.
//
// The router's job: given a model string and a default provider, answer
//   (a) which provider config to route to, and
//   (b) what exact string to send upstream.
//
// The bug we hit (nvidia/nvidia/nemotron-...) came from conflating (a)
// and (b): the code concatenated `${provider}/${model}` for both, so a
// model whose own prefix already names the provider got doubled.
//
// The rule this module encodes: a model that is already self-qualified
// (provider-prefixed, google-models, multi-segment, modelprovider) owns
// its own qualifier. A provider-relative model inherits the caller's
// default. Nothing is ever concatenated twice.

export type Directive = "free" | "off" | "latest" | null;

export type Shape =
  | "google-models"      // models/gemini-3.8-flash
  | "modelprovider"      // mimetite.chalcopyrite, mimetite.secure-nim
  | "multi-segment"      // accounts/fireworks/models/glm-5.2-fast
  | "provider-prefixed"  // nvidia/nemotron-3.5-lightning-30b-a3b
  | "provider-relative"  // deepseek-v4-flash, qwen3.6-35b
  | "unknown";

export interface ClassifiedModel {
  readonly raw: string;
  readonly directive: Directive;
  /** raw with the :free/:off/:latest directive stripped */
  readonly base: string;
  readonly shape: Shape;
  readonly segments: readonly string[];
  /** the org/provider token the shape carries, if any */
  readonly qualifier?: string;
  /** exactly what should go upstream (directive stripped, prefix intact) */
  readonly wireModel: string;
  /** which provider config serves this model when no explicit provider given */
  routingProvider(defaultProvider: string): string;
  /** provider-qualified identifier used as the routing/cache/breaker key */
  routingId(defaultProvider: string): string;
}

const DIRECTIVES: readonly Directive[] = ["free", "off", "latest"] as const;

export function classify(modelId: string): ClassifiedModel {
  if (typeof modelId !== "string" || modelId.length === 0) {
    throw new Error("classify: empty model id");
  }

  // 1. peel the directive suffix, if any. Only the LAST colon is a directive;
  //    anything before it belongs to the model name (e.g. "foo:bar:baz").
  let directive: Directive = null;
  let base = modelId;
  const colon = modelId.lastIndexOf(":");
  if (colon > 0) {
    const suffix = modelId.slice(colon + 1);
    if ((DIRECTIVES as readonly string[]).includes(suffix)) {
      directive = suffix as Directive;
      base = modelId.slice(0, colon);
    }
  }

  const segments = base.split("/").filter(Boolean);
  const first = segments[0] ?? "";

  let shape: Shape;
  let qualifier: string | undefined;

  if (first === "models") {
    // Google EAP: the literal token "models" is part of the wire id.
    shape = "google-models";
    qualifier = "models";
  } else if (first.includes(".") && segments.length >= 2) {
    // modelprovider path: "mimetite.chalcopyrite/model" → provider "mimetite".
    // Requires a path AFTER the dotted segment — a single dotted segment is a
    // versioned bare model (llama-3.3-70b-versatile, gemini-3.8-flash), not a
    // modelProvider path.
    shape = "modelprovider";
    qualifier = first.split(".")[0];
  } else if (segments.length >= 3) {
    // org/suborg/model — Fireworks style. The first segment is the org.
    shape = "multi-segment";
    qualifier = first;
  } else if (segments.length === 2) {
    // provider/model — NIM, OpenRouter, most OpenAI-compat providers.
    shape = "provider-prefixed";
    qualifier = first;
  } else if (segments.length === 1) {
    // bare model — freeinference, some local vLLM/sglang deployments.
    shape = "provider-relative";
    qualifier = undefined;
  } else {
    shape = "unknown";
  }

  const wireModel = base;

  return {
    raw: modelId,
    directive,
    base,
    shape,
    segments,
    qualifier,
    wireModel,

    routingProvider(defaultProvider: string): string {
      // self-qualified shapes route to their own qualifier.
      // provider-relative inherits the default.
      return qualifier ?? defaultProvider;
    },

    routingId(defaultProvider: string): string {
      const prov = this.routingProvider(defaultProvider);
      // provider-relative must be qualified once for routing.
      // every other shape is already complete.
      const id =
        shape === "provider-relative" ? `${prov}/${base}` : base;
      return directive ? `${id}:${directive}` : id;
    },
  };
}

/**
 * Idempotent. The whole point: calling this twice with the same inputs
 * yields the same string, and a self-qualified model keeps its own
 * qualifier even when `provider` disagrees with it.
 *
 *   qualify("nvidia", "nemotron-x")            -> "nvidia/nemotron-x"
 *   qualify("nvidia", "nvidia/nemotron-x")     -> "nvidia/nemotron-x"   (not doubled)
 *   qualify("freeinference", "nvidia/nemotron-x") -> "nvidia/nemotron-x" (prefix wins)
 *   qualify("freeinference", "deepseek-v4-flash") -> "freeinference/deepseek-v4-flash"
 */
export function qualify(provider: string, model: string): string {
  return classify(model).routingId(provider);
}

/** The exact string to send upstream. Never includes the caller's provider. */
export function upstreamModel(model: string): string {
  return classify(model).wireModel;
}

/** Assert-style helper used by the tester and the router hot path. */
export function assertNoDoublePrefix(
  provider: string,
  model: string,
): void {
  const q = qualify(provider, model);
  const doubled = `${provider}/${provider}/`;
  if (q.includes(doubled)) {
    throw new Error(
      `double-prefix: qualify(${JSON.stringify(provider)}, ${JSON.stringify(model)}) = ${JSON.stringify(q)}`,
    );
  }
}