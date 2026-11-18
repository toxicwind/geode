/**
 * faults.test.ts — modular fault-classification fixtures.
 *
 * Each fault type is a `.lua` module under fault/modules/. The Lua
 * worker classifies (status + body) → policy. These fixtures pin the taxonomy
 * so a regression in any module fails fast here.
 */
import { describe, expect, test } from "bun:test";
import { classify } from "../src/fault/index.ts";

const CTX = { provider: "zen", model: "deepseek-v4.1-flash-free" };

const OPENCODE_429 = JSON.stringify({
  type: "error",
  error: {
    type: "FreeUsageLimitError",
    message:
      "Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going: https://opencode.ai/go",
  },
});

describe("opencode-429-free-tier-timer", () => {
  test("matches FreeUsageLimitError and trips the model for the timer", async () => {
    const r = await classify(429, OPENCODE_429, CTX);
    expect(r.matched).toBe("opencode-429-free-tier-timer");
    expect(r.policy?.action).toBe("trip");
    expect(r.policy?.scope).toBe("model");
    expect(r.policy?.retryAfterMs).toBe(3600000);
  });
});

describe("concurrency-shed", () => {
  test("429 concurrency body → shed", async () => {
    const r = await classify(429, '{"error":{"type":"concurrency","message":"too many concurrent requests"}}', CTX);
    expect(r.matched).toBe("concurrency-shed");
    expect(r.policy?.action).toBe("shed");
  });

  test("503 with concurrency keyword still sheds (retryable gate preserved)", async () => {
    const r = await classify(503, '{"error":"too many concurrent"}', CTX);
    expect(r.matched).toBe("concurrency-shed");
    expect(r.policy?.action).toBe("shed");
  });
});

describe("quota-exhausted", () => {
  test("429 budget_exceeded → quota", async () => {
    const r = await classify(429, '{"error":{"code":"budget_exceeded","retry-after-ms":593784}}', CTX);
    expect(r.matched).toBe("quota-exhausted");
    expect(r.policy?.action).toBe("quota");
  });
});

describe("auth-failed", () => {
  test("401 → trip provider 30min", async () => {
    const r = await classify(401, '{"error":"unauthorized"}', CTX);
    expect(r.matched).toBe("auth-failed");
    expect(r.policy?.action).toBe("trip");
    expect(r.policy?.scope).toBe("provider");
    expect(r.policy?.retryAfterMs).toBe(1800000);
  });

  test("403 without cf-1010 → auth-failed (not ua-blocked)", async () => {
    const r = await classify(403, '{"error":"api_key_expired"}', CTX);
    expect(r.matched).toBe("auth-failed");
  });
});

describe("ua-blocked", () => {
  test("403 cf-1010 → trip provider 5min, wins over auth-failed", async () => {
    const r = await classify(403, '{"error":"error 1010 blocked based on your browser signature"}', CTX);
    expect(r.matched).toBe("ua-blocked");
    expect(r.policy?.action).toBe("trip");
    expect(r.policy?.scope).toBe("provider");
    expect(r.policy?.retryAfterMs).toBe(300000);
  });
});

describe("not-found", () => {
  test("404 → trip model 1h", async () => {
    const r = await classify(404, '{"error":"model not found"}', CTX);
    expect(r.matched).toBe("not-found");
    expect(r.policy?.action).toBe("trip");
    expect(r.policy?.scope).toBe("model");
    expect(r.policy?.retryAfterMs).toBe(3600000);
  });
});

describe("gone", () => {
  test("410 → trip model forever", async () => {
    const r = await classify(410, '{"error":"gone"}', CTX);
    expect(r.matched).toBe("gone");
    expect(r.policy?.action).toBe("trip");
    expect(r.policy?.scope).toBe("model");
    expect(r.policy?.retryAfterMs).toBe(9007199254740991);
  });
});

describe("unclassified", () => {
  test("500 with no keyword → no module matches", async () => {
    const r = await classify(500, '{"error":"internal"}', CTX);
    expect(r.matched).toBeNull();
    expect(r.policy).toBeNull();
  });
});
