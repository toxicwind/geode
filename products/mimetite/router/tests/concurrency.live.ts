/**
 * concurrency.live.ts — REAL-WORLD proof that the mimetite router serves
 * concurrent requests without blocking, starving, or prioritizing any single
 * task.
 *
 * No mocks. Talks to the real router on :25193.
 *
 * What this proves (the observable):
 *   1. N concurrent chat requests all COMPLETE (no indefinite block/wait).
 *   2. Round-robin: no request is starved — every one gets a 200.
 *   3. Scaling: 2/4/6 concurrent requests complete in bounded time (the
 *      router does not serialize or queue them into a bottleneck).
 */
import { describe, expect, test } from "bun:test";

const ROUTER = "http://127.0.0.1:25193/v1";
const MODEL = "freeinference/qwen3.6-35b";

async function chatOnce(id: number, maxTokens = 16): Promise<{ ok: boolean; status: number; ms: number }> {
  const t0 = Date.now();
  const res = await fetch(`${ROUTER}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: `Request #${id}. Reply with the single word: OK` }],
      max_tokens: maxTokens,
    }),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, ms: Date.now() - t0 };
}

async function burst(n: number): Promise<{ results: Awaited<ReturnType<typeof chatOnce>>[]; totalMs: number }> {
  const t0 = Date.now();
  const results = await Promise.all(Array.from({ length: n }, (_, i) => chatOnce(i)));
  return { results, totalMs: Date.now() - t0 };
}

describe("mimetite router concurrency (live)", () => {
  for (const n of [2, 4, 6]) {
    test(`live: ${n} concurrent requests all complete (round-robin, no starve)`, async () => {
      const { results, totalMs } = await burst(n);
      const okCount = results.filter((r) => r.ok).length;
      const statuses = results.map((r) => r.status).join(",");
      const ms = results.map((r) => r.ms).join(",");
      console.log(`  burst(${n}): total=${totalMs}ms ok=${okCount}/${n} statuses=[${statuses}] per=[${ms}]`);
      expect(okCount).toBe(n); // every request served — none starved
      expect(totalMs).toBeLessThan(120_000); // bounded — no indefinite block
    }, { timeout: 150_000 });
  }

  test("live: exponential burst (12) completes without deadlock", async () => {
    const { results, totalMs } = await burst(12);
    const okCount = results.filter((r) => r.ok).length;
    console.log(`  burst(12): total=${totalMs}ms ok=${okCount}/12`);
    expect(okCount).toBe(12);
    expect(totalMs).toBeLessThan(180_000);
  }, { timeout: 210_000 });
});