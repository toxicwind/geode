/**
 * FreeInference coercion shim — the tau `freeinference-coercion.ts` module was
 * merged into `../coercion` during the Phase 2 migration. This module
 * re-exports its public surface so the dialect barrel (`index.ts`) keeps the
 * same shape.
 */
export {
	FREEINFERENCE_TOOL_MODELS,
	FREEINFERENCE_THINKING_BUDGET_RATIO,
	coerceFreeInferenceValue,
	decodeValue,
	parseMarkdownItem,
	parseMarkdownList,
	resolveFreeInferenceThinkingBudget,
} from "../coercion";
export type { FreeInferenceModel } from "../coercion";
