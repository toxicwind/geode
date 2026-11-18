/**
 * wiring-flags.test.ts — verifies the runtime wiring of the ported dialect +
 * coercion engines into the router's HTTP path.
 *
 *   - Coercion: `coerceRequestToolCalls` shapes malformed tool-call arguments
 *     in a chat-completions body against its own tool schemas (request side).
 *   - Dialect: `DialectEgressNormalizer` + `healSseResponse(response, {dialect})`
 *     normalize tool-call markup in the SSE egress when a dialect is supplied,
 *     and fall back to the legacy generic healer (byte-identical) when not.
 */
import { describe, expect, test } from "bun:test";
import { coerceRequestToolCalls } from "../src/coercion.ts";
import { DialectEgressNormalizer, healSseResponse } from "../src/stream-healer.ts";

describe("coercion request-shaping wiring", () => {
  test("coerces double-encoded JSON tool arguments against tool schemas", () => {
    const body = {
      model: "glm-5.3-flash",
      tools: [{ type: "function", name: "fn", parameters: { type: "object", properties: { a: { type: "number" } } } }],
      messages: [{ role: "assistant", content: "", tool_calls: [{ id: "1", type: "function", function: { name: "fn", arguments: { a: "42" } } }] }],
    };
    const changed = coerceRequestToolCalls(body as Record<string, unknown>);
    expect(changed).toBe(true);
    const tc = (body.messages[0] as any).tool_calls[0];
    expect(tc.function.arguments.a).toBe(42);
  });

  test("leaves well-formed arguments untouched (returns false)", () => {
    const body = {
      model: "glm-5.3-flash",
      tools: [{ type: "function", name: "fn", parameters: { type: "object", properties: { a: { type: "number" } } } }],
      messages: [{ role: "assistant", content: "", tool_calls: [{ id: "1", type: "function", function: { name: "fn", arguments: { a: 42 } } }] }],
    };
    const changed = coerceRequestToolCalls(body as Record<string, unknown>);
    expect(changed).toBe(false);
    const tc = (body.messages[0] as any).tool_calls[0];
    expect(tc.function.arguments.a).toBe(42);
  });

  test("no-op when no tools are declared", () => {
    const body = { model: "x", messages: [{ role: "assistant", tool_calls: [{ function: { name: "fn", arguments: { a: "42" } } }] }] };
    expect(coerceRequestToolCalls(body as Record<string, unknown>)).toBe(false);
  });
});

describe("dialect egress normalizer", () => {
  test("canonicalizes an in-band tool call to <invoke>/<parameter>", () => {
    const n = new DialectEgressNormalizer("xml");
    const out = n.pushChunk(`<invoke name="fn"><parameter name="a">1</parameter></invoke>`);
    expect(out).toContain(`<invoke name="fn">`);
    expect(out).toContain(`<parameter name="a">1</parameter>`);
    expect(out).toContain(`</invoke>`);
  });

  test("passes plain text through unchanged", () => {
    const n = new DialectEgressNormalizer("xml");
    expect(n.pushChunk("hello world")).toBe("hello world");
  });

  test("handles a tool call split across chunks", () => {
    const n = new DialectEgressNormalizer("xml");
    n.pushChunk(`<invoke name="fn"><parameter name="a">1</parameter>`);
    const out = n.pushChunk(`</invoke>`);
    expect(out).toContain(`</invoke>`);
  });
});

describe("healSseResponse dialect gating", () => {
  function sseResponse(body: string): Response {
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  }

  async function readText(res: Response): Promise<string> {
    return await res.text();
  }

  test("without dialect: legacy generic healing preserved (passthrough)", async () => {
    const res = healSseResponse(sseResponse(`data: {"delta":{"content":"hi"}}\n\n`));
    const text = await readText(res);
    expect(text).toContain(`data: {"delta":{"content":"hi"}}`);
  });

  test("with dialect: tool-call markup normalized in JSON SSE payload", async () => {
    const payload = JSON.stringify({
      choices: [{ delta: { content: `<invoke name="fn"><parameter name="a">1</parameter></invoke>` } }],
    });
    const res = healSseResponse(sseResponse(`data: ${payload}\n\n`), { dialect: "xml" });
    const text = await readText(res);
    const dataLine = text.split("\n").find((l) => l.startsWith("data: "))!;
    const decoded = JSON.parse(dataLine.slice(6));
    expect(decoded.choices[0].delta.content).toContain(`<invoke name="fn">`);
    expect(decoded.choices[0].delta.content).toContain(`<parameter name="a">1</parameter>`);
  });

  test("with dialect: plain-text SSE payload also normalized", async () => {
    const res = healSseResponse(
      sseResponse(`data: <invoke name="fn"><parameter name="a">1</parameter></invoke>\n\n`),
      { dialect: "xml" },
    );
    const text = await readText(res);
    expect(text).toContain(`<invoke name="fn">`);
    expect(text).toContain(`<parameter name="a">1</parameter>`);
  });

  test("non-SSE responses pass through untouched even with dialect", async () => {
    const res = healSseResponse(new Response("plain", { headers: { "content-type": "text/plain" } }), { dialect: "xml" });
    expect(await readText(res)).toBe("plain");
  });
});
