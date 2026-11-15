/**
 * lane-router.test.ts — TDD for foreground/background lane isolation.
 *
 * Pins invariant #5: `[memory]`/`smol`/mnemopi background requests must be
 * offloaded to local bornite when the primary route would land on the
 * single-concurrency freeinference key.
 */
import { describe, expect, test } from "bun:test";
import {
  applyLaneIsolation,
  BORNITE_BACKGROUND_ROUTE,
  classifyLane,
} from "../src/lane-router.ts";

const freeInferenceChat = (systemPrompt: string): unknown => ({
  model: "deepseek-v4-flash",
  messages: [{ role: "system", content: systemPrompt }],
});

describe("classifyLane", () => {
  test("x-omp-lane: memory header identifies a background lane", () => {
    const headers = new Headers({ "x-omp-lane": "memory" });
    const decision = classifyLane(headers, freeInferenceChat("you are an agent"));
    expect(decision.background).toBe(true);
    expect(decision.lane).toBe("memory");
  });

  test("x-omp-lane: smol header identifies a background lane", () => {
    const headers = new Headers({ "x-omp-lane": "smol" });
    const decision = classifyLane(headers, freeInferenceChat("you are an agent"));
    expect(decision.lane).toBe("smol");
  });

  test("[memory] stage1 system prompt fingerprint matches", () => {
    const decision = classifyLane(
      new Headers(),
      freeInferenceChat("You are [memory] stage1 consolidation worker for mnemopi."),
    );
    expect(decision.background).toBe(true);
    expect(decision.lane).toBe("memory");
  });

  test("mnemopi system prompt fingerprint matches", () => {
    const decision = classifyLane(new Headers(), freeInferenceChat("mnemopi consolidate now"));
    expect(decision.background).toBe(true);
  });

  test("ordinary foreground prompt is not a background lane", () => {
    const decision = classifyLane(new Headers(), freeInferenceChat("You are Kilo coding agent."));
    expect(decision.background).toBe(false);
  });

  test("non-chat body (embeddings) is not a background lane", () => {
    const decision = classifyLane(
      new Headers(),
      { model: "bge-m3", input: ["hello"] },
    );
    expect(decision.background).toBe(false);
  });
});

describe("applyLaneIsolation", () => {
  test("memory lane on freeinference offloads to bornite", () => {
    const result = applyLaneIsolation({
      headers: new Headers({ "x-omp-lane": "memory" }),
      body: freeInferenceChat("you are an agent"),
      provider: "freeinference",
      model: "deepseek-v4-flash",
    });
    expect(result.offloaded).toBe(true);
    expect(result.provider).toBe(BORNITE_BACKGROUND_ROUTE.provider);
    expect(result.model).toBe(BORNITE_BACKGROUND_ROUTE.model);
    expect(result.lane).toBe("memory");
  });

  test("background lane on a non-rate-limited provider stays put", () => {
    const result = applyLaneIsolation({
      headers: new Headers({ "x-omp-lane": "memory" }),
      body: freeInferenceChat("you are an agent"),
      provider: "nvidia",
      model: "nvidia/nemotron-3.5-lightning-30b-a3b",
    });
    expect(result.offloaded).toBe(false);
    expect(result.provider).toBe("nvidia");
    expect(result.model).toBe("nvidia/nemotron-3.5-lightning-30b-a3b");
  });

  test("foreground lane on freeinference is untouched", () => {
    const result = applyLaneIsolation({
      headers: new Headers(),
      body: freeInferenceChat("You are Kilo coding agent."),
      provider: "freeinference",
      model: "deepseek-v4-flash",
    });
    expect(result.offloaded).toBe(false);
    expect(result.provider).toBe("freeinference");
  });
});
