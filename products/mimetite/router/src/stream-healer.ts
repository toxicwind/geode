import { getDialectDefinition } from "./dialect/factory";
import type { Dialect } from "./dialect/identity";
import type { InbandScanner } from "./dialect/types";

/**
 * stream-healer.ts — stateful SSE egress markup healer for mimetite.
 *
 * Upstream model grammars (DeepSeek DSML, Kimi chat templates, and generic
 * XML-thinking dialects) occasionally leak raw, half-formed markup into the
 * `delta.content` / `reasoning_content` text of an SSE stream:
 *
 *   - Stuttered closing tags: `</ </think>` instead of `</think>`
 *   - Full-width DeepSeek DSML markers: `<｜DSML｜function_calls>` and friends
 *   - XML tool tags split across chunk boundaries (`<` + `/tool_call>`)
 *
 * Clients (kilo, omp, tau, openfang) used to each re-implement healing of
 * these dialects, and lost it when switching clients. This module is the
 * invariant #2 fix: mimetite runs a stateful healer on outbound
 * `text/event-stream` bodies before they leave :25193, so no client ever sees
 * `</ </` or raw DSML.
 *
 * The healer is transport-agnostic (works on plain text chunks — the unit
 * surface) plus an SSE-aware wrapper that preserves `data:`/`event:` framing.
 */

export interface HealOptions {
  /** Heal stuttered closing tags (`</ </think>` -> `</think>`). Default true. */
  healStutteredClosings?: boolean;
  /** Normalize DeepSeek full-width DSML markers into standard XML tool tags. Default true. */
  healDsml?: boolean;
}

const DEFAULT_OPTIONS: Required<HealOptions> = {
  healStutteredClosings: true,
  healDsml: true,
};

function resolveOptions(options: HealOptions): Required<HealOptions> {
  return { ...DEFAULT_OPTIONS, ...options };
}

/** Pure per-chunk healing (no cross-chunk state). */
export function healMarkup(text: string, options: HealOptions = {}): string {
  const opts = resolveOptions(options);
  let out = text;
  if (opts.healStutteredClosings) {
    out = out.replace(/<\/\s*<\//g, "</");
  }
  if (opts.healDsml) {
    out = out
      .replace(/<｜DSML｜function_calls>/g, "<tool_calls>")
      .replace(/<\/｜DSML｜function_calls>/g, "</tool_calls>")
      .replace(/<｜DSML｜invoke\s+name="([^"]+)">/g, '<tool_call name="$1">')
      .replace(/<\/｜DSML｜invoke>/g, "</tool_call>")
      .replace(/<｜DSML｜parameter\s+name="([^"]+)"[^>]*>/g, '<param name="$1">')
      .replace(/<\/｜DSML｜parameter>/g, "</param>");
  }
  return out;
}

/**
 * Maximum length of a trailing partial XML-open sequence we will hold back at a
 * chunk boundary. Anything longer is a legit string, not a split tag.
 */
const MAX_CARRY_LEN = 64;

/**
 * Stateful healer. Across chunk boundaries it carries a trailing partial open
 * tag (e.g. `</`, `<｜DSML｜`) so a marker split across chunks heals to the
 * same canonical tag as one arriving whole. Mirrors omp's `StreamMarkupHealer`
 * semantics so the two engines produce byte-identical output.
 */
export class StreamMarkupHealer {
  private carry = "";
  private readonly options: Required<HealOptions>;

  constructor(options: HealOptions = {}) {
    this.options = resolveOptions(options);
  }

  pushChunk(chunk: string): string {
    const buf = this.carry + chunk;
    this.carry = "";
    const trailingOpen = buf.match(/(<\/?\s*[｜|A-Za-z0-9_-]*)$/);
    let body = buf;
    if (
      trailingOpen &&
      trailingOpen.index !== undefined &&
      trailingOpen[0].length < MAX_CARRY_LEN
    ) {
      body = buf.slice(0, trailingOpen.index);
      this.carry = trailingOpen[0];
    }
    return healMarkup(body, this.options);
  }

  flush(): string {
    const remainder = this.carry;
    this.carry = "";
    return healMarkup(remainder, this.options);
  }
}

function healSseLine(line: string, healer: StreamMarkupHealer): string {
  if (line.startsWith("data:")) {
    const payloadStart = line.startsWith("data: ") ? 6 : 5;
    const payload = line.slice(payloadStart);
    return `data: ${healer.pushChunk(payload)}`;
  }
  return healer.pushChunk(line);
}

function healSseLineDialect(line: string, normalizer: DialectEgressNormalizer): string {
  if (line.startsWith("data:")) {
    const payloadStart = line.startsWith("data: ") ? 6 : 5;
    const payload = line.slice(payloadStart);
    // Real SSE chat payloads are JSON: the tool-call markup lives inside
    // `choices[].delta.content` / `reasoning_content` string fields. Decode,
    // run those fields through the dialect scanner, and re-encode — otherwise
    // the scanner would see JSON-escaped quotes and miss the tags.
    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.choices)) {
        // Always take the JSON-aware path for valid chat-completions payloads:
        // feed each delta string field through the scanner and re-encode. We
        // must NOT fall through to raw-text processing here even when nothing
        // changed — feeding the whole JSON string to the scanner would mangle
        // the escaped quotes.
        for (const ch of parsed.choices) {
          const delta = ch?.delta;
          if (!delta || typeof delta !== "object") continue;
          for (const field of ["content", "reasoning_content"]) {
            if (typeof delta[field] === "string") {
              delta[field] = normalizer.pushChunk(delta[field]);
            }
          }
        }
        return `data: ${JSON.stringify(parsed)}`;
      }
    } catch {
      // Not JSON — fall through to raw-text processing below.
    }
    return `data: ${normalizer.pushChunk(payload)}`;
  }
  return normalizer.pushChunk(line);
}

/**
 * Wrap an upstream `text/event-stream` Response so every outbound chunk is
 * healed before it leaves the router. SSE framing (`data:`/`event:`/`id:`/
 * blank lines) is preserved verbatim; only payload text passes through the
 * stateful healer, so `content-length` no longer applies and is dropped.
 *
 * Non-SSE responses pass through untouched.
 */
/**
 * DialectEgressNormalizer — opt-in, dialect-aware SSE egress normalizer.
 *
 * When the router's `dialect.enabled` feature flag is on, the egress path
 * resolves the routed model's dialect and runs the upstream stream through its
 * in-band scanner. Tool-call markup is intercepted and re-rendered in the
 * dialect's canonical form (`<invoke>`/`<parameter>` for XML-family dialects);
 * all other text (including delimited thinking) passes through untouched.
 *
 * This is a deliberate, gated transformation: the router is a transparent
 * proxy, so it defaults OFF and preserves the legacy passthrough + generic
 * markup healing exactly. It exists to give the ported dialect engine a real
 * runtime seam without changing default behavior.
 */
export class DialectEgressNormalizer {
  private readonly scanner: InbandScanner;
  private readonly dialect: Dialect;
  private pendingTool: { name: string; args: Record<string, unknown> } | null = null;

  constructor(dialect: Dialect) {
    this.dialect = dialect;
    this.scanner = getDialectDefinition(dialect).createScanner({});
  }

  /** Feed a chunk; returns the normalized text to emit. */
  pushChunk(chunk: string): string {
    const events = this.scanner.feed(chunk);
    let out = "";
    for (const ev of events) {
      switch (ev.type) {
        case "text":
          out += ev.text;
          break;
        case "toolStart":
          this.pendingTool = { name: ev.name, args: {} };
          break;
        case "toolArgDelta":
          if (this.pendingTool) {
            const key = ev.key;
            const prev = this.pendingTool.args[key];
            this.pendingTool.args[key] = (typeof prev === "string" ? prev : "") + ev.delta;
          }
          break;
        case "toolEnd":
          if (this.pendingTool) {
            const def = getDialectDefinition(this.dialect);
            out += def.renderToolCall(
              { id: ev.id, name: ev.name, arguments: ev.arguments ?? this.pendingTool.args },
              {},
            );
            this.pendingTool = null;
          }
          break;
        default:
          // thinkingStart/Delta/End, impliedThinkingEnd: leave as-is (the raw
          // text already flowed through as `text` when parseThinking is off).
          break;
      }
    }
    return out;
  }

  flush(): string {
    const events = this.scanner.flush();
    let out = "";
    for (const ev of events) {
      if (ev.type === "text") out += ev.text;
      else if (ev.type === "toolEnd" && this.pendingTool) {
        const def = getDialectDefinition(this.dialect);
        out += def.renderToolCall(
          { id: ev.id, name: ev.name, arguments: ev.arguments ?? this.pendingTool.args },
          {},
        );
        this.pendingTool = null;
      }
    }
    return out;
  }
}

export function healSseResponse(response: Response, opts: { dialect?: Dialect } = {}): Response {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream") || !response.body) {
    return response;
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let pending = "";
  // When a dialect is supplied (router `dialect.enabled` on), normalize the
  // stream through the dialect scanner. Otherwise use the legacy generic
  // markup healer — byte-identical to prior behavior.
  const dialectNormalizer = opts.dialect ? new DialectEgressNormalizer(opts.dialect) : null;
  const healer = dialectNormalizer ? null : new StreamMarkupHealer();

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, nl);
        pending = pending.slice(nl + 1);
        // Preserve blank lines: they are the SSE event separators. Dropping
        // them merges every `data:` frame into one event (data joined by \n),
        // which breaks JSON.parse on the client side (verified live
        // 2026-11-15: tau postOpenAIStream decoded 0 events from the router).
        if (line.length === 0) {
          controller.enqueue(encoder.encode("\n"));
          continue;
        }
        const healed = dialectNormalizer
          ? healSseLineDialect(line, dialectNormalizer)
          : healSseLine(line, healer!);
        if (healed.length > 0) {
          controller.enqueue(encoder.encode(`${healed}\n`));
        }
      }
    },
    flush(controller) {
      if (pending.length > 0) {
        const healed = dialectNormalizer
          ? healSseLineDialect(pending, dialectNormalizer)
          : healSseLine(pending, healer!);
        if (healed.length > 0) {
          controller.enqueue(encoder.encode(healed));
        }
      }
      const tail = dialectNormalizer ? dialectNormalizer.flush() : healer!.flush();
      if (tail.length > 0) {
        controller.enqueue(encoder.encode(tail));
      }
    },
  });

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(response.body.pipeThrough(transform), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
