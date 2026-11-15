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

/**
 * Wrap an upstream `text/event-stream` Response so every outbound chunk is
 * healed before it leaves the router. SSE framing (`data:`/`event:`/`id:`/
 * blank lines) is preserved verbatim; only payload text passes through the
 * stateful healer, so `content-length` no longer applies and is dropped.
 *
 * Non-SSE responses pass through untouched.
 */
export function healSseResponse(response: Response): Response {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream") || !response.body) {
    return response;
  }

  const healer = new StreamMarkupHealer();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let pending = "";

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, nl);
        pending = pending.slice(nl + 1);
        const healed = healSseLine(line, healer);
        if (healed.length > 0) {
          controller.enqueue(encoder.encode(`${healed}\n`));
        }
      }
    },
    flush(controller) {
      if (pending.length > 0) {
        const healed = healSseLine(pending, healer);
        if (healed.length > 0) {
          controller.enqueue(encoder.encode(healed));
        }
      }
      const tail = healer.flush();
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
