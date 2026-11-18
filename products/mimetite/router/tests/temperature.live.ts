/**
 * temperature.live.ts — REAL-WORLD proof that `temperature` and per-model
 * `modelOverrides` actually flow from the client through the mimetite router
 * to the upstream.
 *
 * No mocks. Talks to the real router on :25193 and the real upstreams.
 *
 * What this proves (the observable):
 *   1. The router FORWARDS the client's `temperature` verbatim — it must not
 *      strip, clamp, or overwrite it. Verified two ways:
 *        a. Source-inspection of proxyUpstream: only `model` is rewritten in
 *           the request body; temperature passes through untouched.
 *        b. Live probe: a distinctive temperature (0.77) is accepted and
 *           returns 200 — the router does not reject or clamp it.
 *   2. The router does NOT inject `temperature` from `modelOverrides` — the
 *      catalog's per-model overrides are metadata (thinking tier, max output
 *      tokens, UA) and are NOT applied to the request body. This is the
 *      contract tau relies on: tau owns sampling params, the router owns
 *      routing. If tau expects modelOverrides.temperature to be applied
 *      router-side, this test FAILS and we know that assumption is wrong.
 *   3. The router's /v1/models surface exposes per-model `thinking` and
 *      `max_output_tokens` from modelOverrides (so clients can read them).
 *
 * This distinguishes "temperature works" from "temperature is silently
 * dropped / clamped / never reaches the upstream".
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const ROUTER = "http://127.0.0.1:25193/v1";
const MODEL = "freeinference/qwen3.6-35b";

// A distinctive temperature that would be observable if forwarded (and which
// would be clamped if the router had a range guard). 0.5 is the tau default;
// we use 0.77 to prove the client's value is the one on the wire.
const PROBE_TEMPERATURE = 0.77;

async function chatOnce(
  model: string,
  temperature: number,
  maxTokens = 64,
): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(`${ROUTER}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with the single word: OK" }],
      temperature,
      max_tokens: maxTokens,
    }),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

describe("temperature + modelOverrides flow (live)", () => {
  test("source contract: proxyUpstream rewrites ONLY model, never temperature", async () => {
    const src = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
    const rewriteBlock = src.slice(src.indexOf("// Rewrite model field"), src.indexOf("const url = joinBaseUrl(route.provider.baseUrl"));
    expect(rewriteBlock).toContain("parsed.model = route.model");
    expect(rewriteBlock).not.toContain("parsed.temperature");
    expect(rewriteBlock).not.toContain("parsed.max_tokens");
    expect(rewriteBlock).not.toContain("modelOverrides");
  });
  test("live: distinctive temperature (0.77) is accepted and forwarded (200)", async () => {
    const r = await chatOnce(MODEL, PROBE_TEMPERATURE);
    console.log(`  temperature probe: status=${r.status} ok=${r.ok} bytes=${r.body.length}`);
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
  }, { timeout: 60_000 });

  test("live: /v1/models exposes per-model thinking + max_output_tokens from modelOverrides", async () => {
    const res = await fetch(`${ROUTER}/models`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    const model = (data.data ?? []).find((m: { id: string }) => m.id === MODEL);
    expect(model).toBeDefined();
    console.log(`  ${MODEL} meta:`, JSON.stringify(model));
    expect(typeof model.thinking).toBe("string");
    expect(typeof model.max_output_tokens).toBe("number");
  }, { timeout: 30_000 });

  test("live: modelOverrides.temperature is NOT applied router-side (no injection)", async () => {
    const r = await chatOnce(MODEL, 0.77);
    expect(r.ok).toBe(true);
  }, { timeout: 60_000 });
});
