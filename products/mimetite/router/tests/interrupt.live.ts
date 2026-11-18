/**
 * interrupt.live.ts — REAL-WORLD proof that a client interrupt cancels the
 * upstream generation, not just the client's local stream.
 *
 * No mocks. It talks to the real router on :25193 and the real freeinference
 * upstream (per-key concurrency = 1 via the shared lease).
 *
 * Logic (the observable):
 *   1. Fire a LONG generation (deepseek-v4-flash, max_tokens high) so the slot
 *      is held for many seconds.
 *   2. Abort the client request after a short read.
 *   3. IMMEDIATELY fire a second, small request on the same provider and time it.
 *      - If the abort cancelled the upstream: the lease is released promptly and
 *        the follow-up completes fast (<< the first generation's duration).
 *      - If the router kept the generation running: the follow-up waits for the
 *        whole first generation to finish before it gets the slot.
 *
 * This distinguishes "interrupt works" from "the model keeps running the
 * previous task", which is exactly the reported bug.
 */
import { afterAll, describe, expect, test } from "bun:test";

const ROUTER = "http://127.0.0.1:25193/v1/chat/completions";
const MODEL = "deepseek-v4-flash";

// The prompt+max_tokens are sized so a single generation runs ~8-20s, giving a
// clear window to interrupt and a clear gap vs. the follow-up.
const LONG_PROMPT = "Write a very detailed, 2500-word essay about the history of computing hardware from vacuum tubes to quantum computers.";
const LONG_MAX_TOKENS = 24000;

const LONG_MIN_MS = 3000; // if the generation finishes faster than this, the test can't prove cancellation
const FOLLOWUP_BUDGET_MS = 8000; // pass if follow-up acquires the slot within this

async function chatOnce(model: string, prompt: string, maxTokens: number, signal?: AbortSignal): Promise<{ ok: boolean; status: number; elapsedMs: number; bytes: number }> {
  const started = Date.now();
  const res = await fetch(ROUTER, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: maxTokens }),
    signal,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, elapsedMs: Date.now() - started, bytes: text.length };
}

let firstFullMs = 0;

describe("client interrupt cancels upstream generation (live)", () => {
  // Step 1: measure the FULL duration of one long generation (reference + to
  // ensure it is long enough to interrupt).
  test("baseline: long generation lasts long enough to interrupt", async () => {
    const r = await chatOnce(MODEL, LONG_PROMPT, LONG_MAX_TOKENS);
    expect(r.ok).toBe(true);
    firstFullMs = r.elapsedMs;
    console.log(`  baseline long generation took ${firstFullMs}ms (${r.bytes} bytes)`);
    expect(firstFullMs).toBeGreaterThan(LONG_MIN_MS);
  }, { timeout: 120_000 });

  // Step 2+3: interrupt a long generation, then time the follow-up.
  test("after client abort, a follow-up acquires the slot fast (upstream cancelled)", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const longReq = fetch(ROUTER, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: LONG_PROMPT }], max_tokens: LONG_MAX_TOKENS }),
      signal: controller.signal,
    });

    const res = await longReq;
    expect(res.ok).toBe(true);
    const reader = res.body!.getReader();
    // Read one chunk to confirm the stream is live, then abort.
    await reader.read().catch(() => {});
    const abortedAt = Date.now() - started;
    controller.abort();
    console.log(`  aborted client-side after ${abortedAt}ms of streaming`);

    // Give the router a moment to propagate the abort + release the lease.
    await Bun.sleep(400);

    // Follow-up on the same provider (same single-slot lease).
    const follow = await chatOnce(MODEL, "Reply with the single word: ready", 8);
    console.log(`  follow-up completed in ${follow.elapsedMs}ms (status ${follow.status})`);
    console.log(`  reference full generation was ${firstFullMs}ms`);
    expect(follow.ok).toBe(true);
    // If the previous generation was truly cancelled, the follow-up gets the
    // slot almost immediately — far under the full-generation time.
    expect(follow.elapsedMs).toBeLessThan(FOLLOWUP_BUDGET_MS);
    // And it must be much smaller than the cancelled generation's full duration.
    expect(follow.elapsedMs).toBeLessThan(firstFullMs * 0.6);
  }, { timeout: 120_000 });
});

afterAll(async () => {
  // Small settle so the lease drains before the suite exits.
  await Bun.sleep(300);
});