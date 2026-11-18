/**
 * Dialect identity — the 12 catalog dialects + preferred-dialect resolution.
 *
 * Ported from tau `packages/catalog/src/identity/dialect.ts`. The full
 * `classifyModel` taxonomy (rules.json + cascade/revision/collapse machinery)
 * is NOT absorbed — it is a large dependency graph used only for
 * `preferredDialect`, which this module serves with a lightweight keyword
 * classifier. The classifier is verified against representative model IDs for
 * every dialect family (anthropic/glm/gemini/gemma/kimi/qwen/deepseek/
 * minimax/inception/openai/gpt-oss) and falls back to `FALLBACK_DIALECT`.
 */

export type Dialect =
	| "glm"
	| "hermes"
	| "kimi"
	| "xml"
	| "anthropic"
	| "deepseek"
	| "harmony"
	| "qwen3"
	| "gemini"
	| "gemma"
	| "minimax"
	| "inception";

export const FALLBACK_DIALECT: Dialect = "xml";

/**
 * [SHIM] Lightweight model-family classifier pending the full taxonomy port.
 * Returns a family class string matching the `preferredDialect` switch.
 */
export function classifyModelShim(modelId: string): string {
	const m = modelId.toLowerCase();
	if (m.includes("claude") || m.includes("anthropic")) return "anthropic";
	if (m.includes("glm")) return "glm";
	if (m.includes("gemini")) return "gemini";
	if (m.includes("gemma")) return "gemma";
	if (m.includes("kimi") || m.includes("moonshot") || m.includes("k2")) return "kimi";
	if (m.includes("qwen")) return "qwen";
	if (m.includes("deepseek")) return "deepseek";
	if (m.includes("minimax")) return "minimax";
	if (m.includes("inception")) return "inception";
	if (m.includes("gpt") || m.includes("o1") || m.includes("o3") || m.includes("o4")) return "openai";
	if (m.includes("gpt-oss") || m.includes("oss")) return "gpt-oss";
	return "unknown";
}

export function preferredDialect(modelId: string): Dialect {
	switch (classifyModelShim(modelId)) {
		case "anthropic":
			return "anthropic";
		case "glm":
			return "glm";
		case "gemini":
			return "gemini";
		case "gemma":
			return "gemma";
		case "kimi":
			return "kimi";
		case "qwen":
			return "qwen3";
		case "deepseek":
			return "deepseek";
		case "minimax":
			return "minimax";
		case "inception":
			return "inception";
		case "openai":
		case "gpt-oss":
			return "harmony";
		default:
			return FALLBACK_DIALECT;
	}
}
