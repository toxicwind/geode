/**
 * Minimal shim for the subset of `@oh-my-pi/pi-utils` that the schema wire
 * pipeline consumes: `isRecord` and `structuredCloneJSON`. Kept local so the
 * router does not depend on the pi-utils package.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function isPlainObject(value: object): boolean {
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

/** Deep-clone a JSON-shaped value; falls back to JSON round-trip for non-plain objects. */
export function structuredCloneJSON<T>(value: T): T {
	if (!value || typeof value !== "object") {
		return value;
	}
	if (isPlainObject(value)) {
		try {
			return structuredClone(value);
		} catch {
			// fall through to JSON round-trip
		}
	}
	return JSON.parse(JSON.stringify(value)) as T;
}
