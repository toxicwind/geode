/**
 * Minimal shim for the subset of `@oh-my-pi/omptype` that the schema wire
 * pipeline consumes: the `Type` interface (used only as a type guard target —
 * `isArkSchema` checks the runtime shape) and the local `$ref` pointer
 * parse/format helpers (RFC 6901). Kept local so the router does not depend on
 * the omptype package.
 */

/** Structural shape of a live ArkType schema instance (type-only; runtime checks are in `isArkSchema`). */
export interface Type<out t = unknown> {
	(data: unknown): t;
	readonly toJsonSchema: (opts?: Record<string, unknown>) => unknown;
	readonly assert: (data: unknown) => t;
	readonly expression: string;
	readonly json: unknown;
	readonly infer: t;
}

/**
 * Parse a local `$ref` URI fragment into decoded JSON Pointer tokens:
 * percent-decode the fragment, split on `/`, then unescape `~1`/`~0` per
 * token. Returns `[]` for the root ref `#`, and `undefined` for non-local
 * refs or fragments that do not percent-decode.
 */
export function parseLocalRefPointer(ref: string): string[] | undefined {
	if (!ref.startsWith("#")) return undefined;
	let pointer: string;
	try {
		pointer = decodeURIComponent(ref.slice(1));
	} catch {
		return undefined;
	}
	if (pointer.length > 0 && !pointer.startsWith("/")) return undefined;
	return pointer
		.split("/")
		.slice(1)
		.map(token => token.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/**
 * Encode JSON Pointer tokens back into a local `$ref` URI fragment — the
 * inverse of {@link parseLocalRefPointer}.
 */
export function formatLocalRefPointer(tokens: readonly string[]): string {
	if (tokens.length === 0) return "#";
	const encoded = tokens
		.map(token => encodeURIComponent(token.replace(/~/g, "~0").replace(/\//g, "~1")))
		.map(token => token.replace(/%24/g, "$"));
	return `#/${encoded.join("/")}`;
}
