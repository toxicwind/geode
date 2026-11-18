/**
 * ernie-coercion.ts — ERNIE model-specific tool-argument coercion recovery
 * and request shaping for the ERNIE 5.5 family (baidu/ernie-5.5-flash-preview:free).
 */
import { coerceValue, decodeValue, parseMarkdownItem, parseMarkdownList } from "../coercion";
import {
	applyOpenRouterRequestShaping,
	normalizeOpenRouterMessages,
	applyOpenRouterStrictToolSchemas,
} from "./openrouter-coercion";
import type { OpenRouterCoercionGate, OpenRouterRequestShapingOptions } from "./openrouter-coercion";

export const ERNIE_MODEL_ID = "baidu/ernie-5.5-flash-preview:free" as const;
export const ERNIE_TOOL_MODELS = [ERNIE_MODEL_ID] as const;
export type ErnieModel = (typeof ERNIE_TOOL_MODELS)[number];

export function isErnieModel(modelId: string | undefined | null): boolean {
	if (!modelId) return false;
	return (ERNIE_TOOL_MODELS as readonly string[]).includes(modelId);
}

export function coerceErnieValue(raw: string, schema: unknown): unknown {
	return coerceValue(raw, schema);
}

export const ERNIE_THINKING_BUDGET_RATIO = 1 / 3;

export function resolveErnieThinkingBudget(
	modelMaxTokens: number | null,
	explicitBudget?: number,
	platformFloor = 1024,
): number {
	if (explicitBudget !== undefined && explicitBudget > 0) return explicitBudget;
	const cap = modelMaxTokens === null ? platformFloor : Math.floor(modelMaxTokens * ERNIE_THINKING_BUDGET_RATIO);
	return Math.max(cap, platformFloor);
}

export function applyErnieRequestShaping(
	params: Record<string, unknown>,
	gate: OpenRouterCoercionGate,
	options: OpenRouterRequestShapingOptions = {},
): void {
	applyOpenRouterRequestShaping(params, gate, { reasoning: false, ...options });
}

export function normalizeErnieMessages<T extends { role?: string; content?: unknown }>(messages: T[]): T[] {
	return normalizeOpenRouterMessages(messages);
}

export function applyErnieStrictToolSchemas(tools: unknown[]): unknown[] {
	return applyOpenRouterStrictToolSchemas(tools);
}

export { parseMarkdownItem, parseMarkdownList, decodeValue };
