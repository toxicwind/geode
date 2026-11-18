/**
 * Minimal error shim for the ported dialect event-stream. The full tau error
 * module (flags/classes/provider) is intentionally NOT absorbed — mimetite
 * routes error classification through its own `./faults` system (Phase 1).
 * This provides just the two symbols `utils/event-stream.ts` needs.
 */

/** Which part of a provider exchange produced a non-HTTP error. */
export type ProviderResponseErrorKind =
	| "incomplete-stream"
	| "output"
	| "empty-body"
	| "empty-output"
	| "envelope"
	| "content-blocked"
	| "runtime";

export interface ProviderResponseErrorOptions {
	provider?: string;
	kind?: ProviderResponseErrorKind;
	cause?: unknown;
}

/** A non-HTTP provider failure (truncated stream, error stop reason, empty body, malformed envelope, runtime fault). */
export class ProviderResponseError extends Error {
	readonly provider: string | undefined;
	readonly kind: ProviderResponseErrorKind;

	constructor(message: string, options: ProviderResponseErrorOptions = {}) {
		super(message, options.cause === undefined ? undefined : { cause: options.cause });
		this.name = "ProviderResponseError";
		this.provider = options.provider;
		this.kind = options.kind ?? "output";
	}
}

/**
 * Minimal classification hook. The tau implementation attaches a rich flag
 * bitmask; mimetite defers to `./faults` for classification, so this returns
 * the HTTP status when present and 0 otherwise.
 */
export function classifyMessage(message: { errorMessage?: string; errorStatus?: number }): number {
	return message.errorStatus ?? 0;
}
