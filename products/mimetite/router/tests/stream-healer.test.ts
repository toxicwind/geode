/**
 * stream-healer.test.ts — TDD for the SSE egress markup healer.
 *
 * Pins invariant #2: `</ </` stutters, full-width DSML markers, and XML tool
 * tags split across chunk boundaries all heal to canonical tags so no client
 * ever sees raw dialect leakage in `delta.content`.
 */
import { describe, expect, test } from "bun:test";
import { healMarkup, healSseResponse, StreamMarkupHealer, type HealOptions } from "../src/stream-healer.ts";

describe("healMarkup — pure healing", () => {
  test("heals stuttered closing tags", () => {
    expect(healMarkup("</ </think>")).toBe("</think>");
    expect(healMarkup("</ </tool_call>")).toBe("</tool_call>");
    expect(healMarkup("a</ </b>")).toBe("a</b>");
  });

  test("normalizes DSML function_calls markers", () => {
    expect(healMarkup("<｜DSML｜function_calls>")).toBe("<tool_calls>");
    expect(healMarkup("</｜DSML｜function_calls>")).toBe("</tool_calls>");
  });

  test("normalizes DSML invoke/parameter markers", () => {
    expect(healMarkup('<｜DSML｜invoke name="bash">')).toBe('<tool_call name="bash">');
    expect(healMarkup("</｜DSML｜invoke>")).toBe("</tool_call>");
    expect(healMarkup('<｜DSML｜parameter name="cmd">')).toBe('<param name="cmd">');
    expect(healMarkup("</｜DSML｜parameter>")).toBe("</param>");
  });

  test("can disable a healing mode", () => {
    const opts: HealOptions = { healDsml: false };
    expect(healMarkup("<｜DSML｜function_calls>", opts)).toBe("<｜DSML｜function_calls>");
    expect(healMarkup("</ </think>", opts)).toBe("</think>");
  });
});

describe("StreamMarkupHealer — stateful chunk-boundary healing", () => {
  test("heals `</ </think>` split across chunk boundary", () => {
    const healer = new StreamMarkupHealer();
    const out1 = healer.pushChunk("Thinking complete </");
    const out2 = healer.pushChunk(" </think>\n");
    const final = out1 + out2 + healer.flush();
    expect(final).toBe("Thinking complete </think>\n");
    expect(final).not.toContain("</ </");
  });

  test("heals a full DSML call split across multiple chunks", () => {
    const healer = new StreamMarkupHealer();
    const out1 = healer.pushChunk("<｜DSML｜function_calls><｜DSML｜invoke name=\"bash\">");
    const out2 = healer.pushChunk("</ </｜DSML｜invoke></｜DSML｜function_calls>");
    const final = out1 + out2 + healer.flush();
    expect(final).toBe('<tool_calls><tool_call name="bash"></tool_call></tool_calls>');
    expect(final).not.toContain("DSML");
    expect(final).not.toContain("</ </");
  });

  test("leaves ordinary text untouched", () => {
    const healer = new StreamMarkupHealer();
    expect(healer.pushChunk("hello world")).toBe("hello world");
    expect(healer.flush()).toBe("");
  });
});

describe("healSseResponse — SSE framing preserved, payloads healed", () => {
  async function collect(response: Response): Promise<string> {
    const text = await response.text();
    return text;
  }

  test("non-SSE responses pass through untouched", async () => {
    const json = new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
    const out = await collect(healSseResponse(json));
    expect(out).toBe(JSON.stringify({ ok: true }));
  });

  test("SSE data payloads are healed while framing survives", async () => {
    const sse = [
      'event: delta',
      'data: {"choices":[{"delta":{"content":"foo </ </think>"}}]}',
      "",
      'data: [DONE]',
      "",
    ].join("\n");
    const response = new Response(sse, {
      headers: { "content-type": "text/event-stream" },
    });
    const out = await collect(healSseResponse(response));
    expect(out).toContain('"content":"foo </think>"');
    expect(out).not.toContain("</ </");
    expect(out).toContain("event: delta");
    expect(out).toContain("data: [DONE]");
  });

  test("DSML inside SSE data payload is healed", async () => {
    const sse = [
      'data: <｜DSML｜function_calls><｜DSML｜invoke name="bash"></｜DSML｜invoke></｜DSML｜function_calls>',
      "",
    ].join("\n");
    const response = new Response(sse, {
      headers: { "content-type": "text/event-stream" },
    });
    const out = await collect(healSseResponse(response));
    expect(out).toContain('<tool_calls><tool_call name="bash"></tool_call></tool_calls>');
    expect(out).not.toContain("DSML");
  });

  test("content-length is dropped on healed SSE", async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"</ </think>"}}]}\n\n';
    const response = new Response(sse, {
      headers: { "content-type": "text/event-stream", "content-length": String(sse.length) },
    });
    const healed = healSseResponse(response);
    expect(healed.headers.has("content-length")).toBe(false);
  });
});
