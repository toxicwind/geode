/**
 * Mimetite Coercion System
 *
 * Merged from tau (packages/ai/src/dialect/coercion.ts, freeinference-coercion.ts)
 * and kappa (packages/llm/src/protocols/gemini.ts, tool-schema.ts).
 *
 * Handles:
 * - Double-encoded JSON containers (DeepSeek/GLM stringified JSON values)
 * - Markdown checklists & list items inside array parameters ("- [ ] task")
 * - Schema-directed value coercion (string preservation vs json decoding)
 * - Gemini JSON schema compatibility projection (const -> enum, clean keys)
 * - FreeInference thinking budget ratio (1/3 ceiling to prevent reasoning starvation)
 */

import { features } from "./config";

export interface ToolArgShape {
  stringArgs: Set<string>;
  properties: Record<string, unknown>;
  parameterOrder: string[];
}

export function jsonTypeOf(value: unknown): string {
  const type = typeof value;
  if (value === null) return "null";
  if (type === "number" || type === "bigint") return "number";
  if (type === "boolean") return "boolean";
  if (type === "string") return "string";
  return "object";
}

export function collectSchemaTypes(schema: unknown, out: Set<string> = new Set(), depth = 0): Set<string> {
  if (depth > 8 || !schema || typeof schema !== "object" || Array.isArray(schema)) return out;
  const node = schema as Record<string, unknown>;
  const type = node.type;
  if (typeof type === "string") out.add(type);
  else if (Array.isArray(type)) {
    for (const t of type) if (typeof t === "string") out.add(t);
  }
  if (type === undefined && Array.isArray(node.enum)) {
    for (const value of node.enum) out.add(jsonTypeOf(value));
  }
  if (type === undefined && "const" in node) out.add(jsonTypeOf(node.const));
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const branch = node[key];
    if (Array.isArray(branch)) {
      for (const sub of branch) collectSchemaTypes(sub, out, depth + 1);
    }
  }
  return out;
}

export function isStringOnlySchema(schema: unknown): boolean {
  const types = collectSchemaTypes(schema);
  types.delete("null");
  return types.size === 1 && types.has("string");
}

export function isArraySchema(schema: unknown): boolean {
  return collectSchemaTypes(schema).has("array");
}

export function isObjectSchema(schema: unknown): boolean {
  return collectSchemaTypes(schema).has("object");
}

/**
 * Detect a markdown list: lines matching "- item", "* item", "- [ ] item", "1. item".
 */
export function isMarkdownList(text: string): boolean {
  return /^\s*(?:[-*+](?:\s+\[[ x]\])?\s+|\d+\.\s+)\S/m.test(text);
}

/**
 * Parse a markdown checklist into a string array, stripping bullets,
 * checkboxes, and ordered-list prefixes.
 */
export function parseMarkdownList(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(?:[-*+](?:\s+\[[ x]\])?\s+|\d+\.\s+)(.+?)\s*$/);
    if (m) out.push(m[1]);
  }
  return out;
}

/**
 * Strip a single markdown list-item prefix from a string: "- [ ] task", "* task", "1. task".
 * DeepSeek / FreeInference models emit array-of-string items with checklist lines inside the array.
 */
export function parseMarkdownItem(item: string): string {
  const match = item.match(/^\s*(?:[-*+](?:\s+\[[ xX]\])?\s+|\d+\.\s+)(.+?)\s*$/);
  return match ? match[1] : item;
}

/**
 * Decode and unwrap double-encoded JSON values or markdown checklists.
 */
export function decodeValue(raw: string, schema?: unknown): unknown {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    // DeepSeek double-encodes JSON containers as strings containing JSON
    if (typeof parsed === "string" && schema !== undefined && !isStringOnlySchema(schema)) {
      const reparsed = decodeValue(parsed, schema);
      if (reparsed !== parsed) return reparsed;
    }
    // Clean array items if they carry markdown checklist prefixes
    if (Array.isArray(parsed)) {
      return parsed.map((item) => (typeof item === "string" ? parseMarkdownItem(item) : item));
    }
    return parsed;
  } catch {}

  // The schema wants an array and the value is a markdown list
  if (schema && isArraySchema(schema) && isMarkdownList(trimmed)) {
    return parseMarkdownList(trimmed);
  }

  return raw;
}

export function coerceValue(raw: string, schema?: unknown): unknown {
  return schema && isStringOnlySchema(schema) ? raw : decodeValue(raw, schema);
}

export function buildArgShapes(tools: Array<{ name: string; parameters?: unknown }> = []): Map<string, ToolArgShape> {
  const shapes = new Map<string, ToolArgShape>();
  for (const tool of tools) {
    const params = tool.parameters as Record<string, unknown> | undefined;
    const props = params?.properties;
    const properties =
      props && typeof props === "object" && !Array.isArray(props) ? (props as Record<string, unknown>) : {};
    const stringArgs = new Set<string>();
    const parameterOrder: string[] = [];
    for (const key in properties) {
      parameterOrder.push(key);
      if (isStringOnlySchema(properties[key])) stringArgs.add(key);
    }
    shapes.set(tool.name, { stringArgs, properties, parameterOrder });
  }
  return shapes;
}

/**
 * Coerce an entire tool call arguments object or JSON string against tool schema.
 */
export function coerceToolCallArguments(
  toolName: string,
  rawArguments: unknown,
  shapes?: Map<string, ToolArgShape>
): unknown {
  let argsObj: Record<string, unknown> = {};
  if (typeof rawArguments === "string") {
    try {
      argsObj = JSON.parse(rawArguments) as Record<string, unknown>;
    } catch {
      return rawArguments;
    }
  } else if (rawArguments && typeof rawArguments === "object" && !Array.isArray(rawArguments)) {
    argsObj = { ...(rawArguments as Record<string, unknown>) };
  } else {
    return rawArguments;
  }

  const shape = shapes?.get(toolName);
  const coerced: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(argsObj)) {
    const propSchema = shape?.properties?.[key];
    if (typeof val === "string") {
      coerced[key] = coerceValue(val, propSchema);
    } else if (Array.isArray(val)) {
      coerced[key] = val.map((item) => (typeof item === "string" ? parseMarkdownItem(item) : item));
    } else {
      coerced[key] = val;
    }
  }

  return typeof rawArguments === "string" ? JSON.stringify(coerced) : coerced;
}

/**
 * Gemini schema projection (from Kappa tool-schema.ts):
 * Projects standard JSON Schema onto Gemini-compatible schema:
 * - Coerce `const` to single-element `enum: [val]`
 * - Strip unsupported keywords: `$schema`, `additionalProperties`
 */
export function projectGeminiSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(projectGeminiSchema);

  const out: Record<string, unknown> = {};
  const s = schema as Record<string, unknown>;

  for (const [k, v] of Object.entries(s)) {
    if (k === "$schema" || k === "additionalProperties") continue;
    if (k === "const") {
      out.enum = [v];
      continue;
    }
    if (k === "properties" && v && typeof v === "object" && !Array.isArray(v)) {
      const props: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) {
        props[pk] = projectGeminiSchema(pv);
      }
      out.properties = props;
      continue;
    }
    if (k === "items") {
      out.items = projectGeminiSchema(v);
      continue;
    }
    out[k] = v;
  }
  return out;
}

/**
 * FreeInference Thinking Budget Ratio (tau doctrine):
 * Prevents reasoning from consuming all available completion tokens.
 */
export const FREEINFERENCE_THINKING_BUDGET_RATIO = 1 / 3;

export function resolveFreeInferenceThinkingBudget(
  maxTokens: number | null,
  explicitBudget?: number,
  floor = 1024
): number {
  if (explicitBudget !== undefined && explicitBudget > 0) return explicitBudget;
  const cap = maxTokens === null ? floor : Math.floor(maxTokens * FREEINFERENCE_THINKING_BUDGET_RATIO);
  return Math.max(cap, floor);
}

/**
 * Feature flag: Enable coercion system (defaults to true; disabled via config.yaml features.coercion.enabled).
 */
export const COERCION_ENABLED = features().coercion.enabled;
// ─── Tau dialect/coercion.ts additions (ported) ──────────────────────────────
// These functions were merged from tau packages/ai/src/dialect/coercion.ts.
// `InbandTool` here is the minimal tool shape (name + parameters); the full
// dialect types land in Phase 3.

import { toolWireSchema } from "./utils/schema/wire";

/** Minimal in-band tool shape consumed by the coercion helpers. */
export interface InbandTool {
  name: string;
  description?: string;
  parameters?: unknown;
  [key: string]: unknown;
}

export function buildStringArgsResolver(
  tools: readonly InbandTool[] = []
): (toolName: string) => ReadonlySet<string> {
  const shapes = buildArgShapes(tools);
  const empty = new Set<string>();
  return (toolName: string) => shapes.get(toolName)?.stringArgs ?? empty;
}

export function resolveToolSchema(tool: InbandTool): Record<string, unknown> {
  try {
    return toolWireSchema(tool as { name: string; description: string; parameters: unknown });
  } catch {
    const params = tool.parameters;
    return params && typeof params === "object" && !Array.isArray(params)
      ? (params as Record<string, unknown>)
      : {};
  }
}

export function getObjectProperties(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return {};
  const props = (schema as Record<string, unknown>).properties;
  return props && typeof props === "object" && !Array.isArray(props)
    ? (props as Record<string, unknown>)
    : {};
}

export function getArrayItemSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return undefined;
  return (schema as Record<string, unknown>).items;
}

let idCounter = 0;
export function mintToolCallId(): string {
  idCounter = (idCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `ptc_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

export function partialSuffixOverlap(text: string, tag: string): number {
  const max = Math.min(text.length, tag.length - 1);
  for (let k = max; k > 0; k--) {
    if (text.endsWith(tag.slice(0, k))) return k;
  }
  return 0;
}

export function partialSuffixOverlapAny(text: string, tags: readonly string[]): number {
  let best = 0;
  for (const tag of tags) best = Math.max(best, partialSuffixOverlap(text, tag));
  return best;
}

export function normalizeKimiFunctionName(rawId: string): string {
  const beforeIndex = rawId.split(":", 1)[0] ?? rawId;
  const parts = beforeIndex.split(".");
  return parts[parts.length - 1]?.trim() ?? beforeIndex.trim();
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Extract a COMPLETE tool name from a partial in-band JSON body.
 * Returns undefined until the name string is fully closed, so streaming
 * scanners never start a tool call under a truncated name.
 */
export function parseCompleteToolName(body: string): string | undefined {
  const match = /^\s*\{\s*"name"\s*:\s*("(?:\\.|[^"\\])*")/.exec(body);
  if (!match) return undefined;
  try {
    const name: unknown = JSON.parse(match[1]!);
    return typeof name === "string" && name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}


// ─── Tau freeinference-coercion.ts additions (ported) ────────────────────────
// The FreeInference text models emit per-item markdown checklist lines inside
// JSON array tool args; the base coercion module already provides the
// recoverers (parseMarkdownItem/List, coerceValue, decodeValue). This registry
// pins the model set and the per-model coercion surface.

/** The three current FreeInference text models that emit tool calls. */
export const FREEINFERENCE_TOOL_MODELS = ["deepseek-v4-flash", "glm-5.3-flash", "qwen3.6-35b"] as const;

export type FreeInferenceModel = (typeof FREEINFERENCE_TOOL_MODELS)[number];

/** Coerce a FreeInference tool-argument value against its JSON schema. */
export function coerceFreeInferenceValue(raw: string, schema: unknown): unknown {
  return coerceValue(raw, schema);
}

/**
 * Coerce malformed tool-call arguments in an OpenAI chat-completions request
 * body (double-encoded JSON, markdown-list strings) against the request's own
 * tool schemas. Returns true if any argument changed. Used by the router's
 * request-shaping path (gated by the `coercion.enabled` feature flag).
 */
export function coerceRequestToolCalls(parsed: Record<string, unknown>): boolean {
  const tools = Array.isArray(parsed.tools) ? (parsed.tools as Array<{ name: string; parameters?: unknown }>) : [];
  const shapes = buildArgShapes(tools);
  if (shapes.size === 0) return false;
  const messages = Array.isArray(parsed.messages) ? (parsed.messages as unknown[]) : [];
  let changed = false;
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const m = msg as Record<string, unknown>;
    const tcs = m.tool_calls;
    if (!Array.isArray(tcs)) continue;
    for (const tc of tcs) {
      if (!tc || typeof tc !== "object") continue;
      const fn = (tc as Record<string, unknown>).function as Record<string, unknown> | undefined;
      if (!fn || typeof fn.name !== "string" || fn.arguments === undefined) continue;
      const coerced = coerceToolCallArguments(fn.name, fn.arguments, shapes);
      // Compare by value: coerceToolCallArguments always returns a fresh object,
      // so reference inequality is meaningless. Only flag a real change.
      if (JSON.stringify(coerced) !== JSON.stringify(fn.arguments)) {
        fn.arguments = coerced;
        changed = true;
      }
    }
  }
  return changed;
}
