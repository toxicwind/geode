/**
 * shapes.test.ts — unit fixtures for the model-id shape classifier.
 *
 * The catalog-wide gate lives in src/shapes.tester.ts (I1–I5 over every model);
 * this file pins the classifier's shape taxonomy with explicit fixtures so a
 * regression in classification fails fast here.
 */
import { describe, expect, test } from "bun:test";
import { classify, qualify, upstreamModel, assertNoDoublePrefix, type Shape } from "../src/shapes.ts";

const SHAPE_FIXTURES: Array<[string, Shape]> = [
  // provider-prefixed (org/model)
  ["nvidia/nemotron-3.5-lightning-30b-a3b", "provider-prefixed"],
  ["meta/llama-3.2-90b-vision-instruct", "provider-prefixed"],
  ["qwen/qwen3.8-27b", "provider-prefixed"],
  ["openai/gpt-oss-20b", "provider-prefixed"],
  ["z-ai/glm-5.2", "provider-prefixed"],
  // multi-segment (org/suborg/model)
  ["accounts/fireworks/models/glm-5.2-fast", "multi-segment"],
  // provider-relative (bare, incl. version-dotted single segments)
  ["deepseek-v4-flash", "provider-relative"],
  ["qwen3.6-35b", "provider-relative"],
  ["bge-m3", "provider-relative"],
  ["llama-3.3-70b-versatile", "provider-relative"],   // dot = version, not modelprovider
  ["gemini-3.8-flash", "provider-relative"],          // dot = version
  ["nim-llama-3.1-70b", "provider-relative"],         // alias-ish bare, dot = version
  ["nemotron-3.5-lightning-free", "provider-relative"], // -free is PART of name
  // google-models
  ["models/gemini-3.8-flash", "google-models"],
  ["models/gemini-flash-tool-retrieval", "google-models"],
  // modelprovider path (dotted first segment + a path after)
  ["mimetite.chalcopyrite/nvidia/nemotron-3.5-lightning-30b-a3b", "modelprovider"],
  // directives
  ["openai/gpt-oss-20b:free", "provider-prefixed"],
  ["qwen/qwen3.8-27b:free", "provider-prefixed"],
  ["nvidia/nemotron-3-super-120b-a12b:free", "provider-prefixed"],
];

describe("classifyModelId", () => {
  for (const [id, shape] of SHAPE_FIXTURES) {
    test(`classifies ${id} as ${shape}`, () => {
      expect(classify(id).shape).toBe(shape);
    });
  }
  test("strips :free directive", () => {
    expect(classify("openai/gpt-oss-20b:free").directive).toBe("free");
    expect(classify("deepseek-v4-flash").directive).toBeNull();
  });
  test("qualifier from provider-prefixed", () => {
    expect(classify("nvidia/nemotron-3.5-lightning-30b-a3b").qualifier).toBe("nvidia");
  });
});

describe("qualify — idempotent, prefix wins, never doubles", () => {
  test("provider-prefixed keeps its own qualifier even under a hostile provider", () => {
    expect(qualify("freeinference", "nvidia/nemotron-3.5-lightning-30b-a3b"))
      .toBe("nvidia/nemotron-3.5-lightning-30b-a3b");
  });
  test("provider-relative gets the caller provider once", () => {
    expect(qualify("freeinference", "deepseek-v4-flash")).toBe("freeinference/deepseek-v4-flash");
  });
  test("already-qualified never doubles", () => {
    expect(qualify("nvidia", "nvidia/nemotron-3.5-lightning-30b-a3b"))
      .toBe("nvidia/nemotron-3.5-lightning-30b-a3b");
  });
  test("version-dotted bare model qualifies with the caller provider", () => {
    expect(qualify("nvidia", "llama-3.3-70b-versatile")).toBe("nvidia/llama-3.3-70b-versatile");
  });
  test("google-models unchanged", () => {
    expect(qualify("google", "models/gemini-3.8-flash")).toBe("models/gemini-3.8-flash");
  });
  test("idempotent: qualify(p, qualify(p, m)) === qualify(p, m)", () => {
    for (const [id] of SHAPE_FIXTURES) {
      const once = qualify("nvidia", id);
      expect(qualify("nvidia", once)).toBe(once);
    }
  });
});

describe("upstreamModel — exact wire id, directive-stripped", () => {
  test("provider-prefixed sent as-is", () => {
    expect(upstreamModel("nvidia/nemotron-3.5-lightning-30b-a3b")).toBe("nvidia/nemotron-3.5-lightning-30b-a3b");
  });
  test("provider-relative sent bare", () => {
    expect(upstreamModel("freeinference/deepseek-v4-flash")).toBe("freeinference/deepseek-v4-flash");
    expect(upstreamModel("deepseek-v4-flash")).toBe("deepseek-v4-flash");
  });
  test("directive stripped from wire", () => {
    expect(upstreamModel("openai/gpt-oss-20b:free")).toBe("openai/gpt-oss-20b");
  });
});

describe("assertNoDoublePrefix", () => {
  test("does not throw for clean ids", () => {
    expect(() => assertNoDoublePrefix("nvidia", "nvidia/nemotron-3.5-lightning-30b-a3b")).not.toThrow();
    expect(() => assertNoDoublePrefix("freeinference", "deepseek-v4-flash")).not.toThrow();
  });
  test("throws for a genuinely doubled id", () => {
    expect(() => assertNoDoublePrefix("nvidia", "nvidia/nvidia/nemotron-3.5-lightning-30b-a3b")).toThrow();
  });
});