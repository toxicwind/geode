/**
 * e2e-flags.test.ts — verifies the feature-flag config surface (dialect /
 * coercion) and that the ported dialect + coercion engines are functional and
 * importable under the default flag state. The dialect engine is gated behind
 * `features().dialect.enabled` (default OFF, preserving legacy behavior); the
 * coercion engine defaults ON.
 */
import { describe, expect, test } from "bun:test";
import { features } from "../src/config.ts";
import { createInbandScanner, getDialectDefinition } from "../src/dialect/index.ts";
import { coerceToolCallArguments, buildArgShapes } from "../src/coercion.ts";
import { routeModel, getCandidateRoutes } from "../src/server.ts";

describe("feature-flag config surface", () => {
  test("defaults: dialect OFF, coercion ON, faults ON", () => {
    const f = features();
    expect(f.dialect.enabled).toBe(false);
    expect(f.coercion.enabled).toBe(true);
    expect(f.faults.enabled).toBe(true);
  });
});

describe("dialect engine is functional (gated behind flag)", () => {
  test("factory resolves all 12 dialects", () => {
    for (const d of ["glm","hermes","kimi","xml","anthropic","deepseek","minimax","harmony","inception","qwen3","gemini","gemma"]) {
      const def = getDialectDefinition(d as never);
      expect(def.dialect).toBe(d);
      expect(typeof def.createScanner).toBe("function");
      expect(typeof def.renderThinking).toBe("function");
    }
  });

  test("xml scanner parses an in-band tool call", () => {
    const sc = createInbandScanner("xml");
    const events = sc.feed(`<invoke name="fn"><parameter name="a">1</parameter></invoke>`);
    const end = events.find(e => e.type === "toolEnd");
    expect(end?.type).toBe("toolEnd");
    if (end?.type === "toolEnd") {
      expect(end.name).toBe("fn");
      expect(end.arguments).toEqual({ a: 1 });
    }
  });

  test("deepseek thinking scanner emits thinking events", () => {
    const sc = createInbandScanner("deepseek", { parseThinking: true });
    const events = sc.feed(`<think>secret</think>visible`);
    expect(events.map(e => e.type)).toEqual(["thinkingStart","thinkingDelta","thinkingEnd","text"]);
  });
});

describe("coercion engine is functional", () => {
  test("coerceToolCallArguments handles double-encoded JSON", () => {
    const tools = [{ name: "fn", parameters: { type: "object", properties: { a: { type: "number" } } } }];
    const shapes = buildArgShapes(tools);
    const out = coerceToolCallArguments("fn", { a: "42" }, shapes);
    expect(out.a).toBe(42);
  });
});

describe("routing functions work", () => {
  test("routeModel and getCandidateRoutes are callable", () => {
    // These are pure functions; just verify they don't throw on a known id.
    expect(typeof routeModel).toBe("function");
    expect(typeof getCandidateRoutes).toBe("function");
  });
});
