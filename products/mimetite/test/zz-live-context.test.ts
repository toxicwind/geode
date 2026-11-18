/**
 * LIVE TDD (NOT part of `bun test` — needs the daemons running):
 *
 *   bun test/zz-live-context.test.ts
 *
 * Two independent systems, two regressions:
 *
 *  1. BORNITE (local llama.cpp, :25196)
 *     The launcher passes `-c 32768 --parallel 2`. llama.cpp splits the pool
 *     across slots, so each request gets 16384. Three catalog sites advertised
 *     32768, so clients packed 61k-token prompts and ate
 *     `request (61156 tokens) exceeds the available context size (16384 tokens)`.
 *
 *  2. FREEINFERENCE (remote, :25193 → freeinference.org)
 *     `glm-5.3-flash` was delisted upstream 2026-10-28 and must not be served.
 *     `deepseek-v4-flash` really has 393216 max output, not 8192.
 *     `bge-m3` is UA-gated: a `claude-cli` UA drops it from /v1/models.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const BORNITE = "http://127.0.0.1:25196";
const ROUTER = "http://127.0.0.1:25193";
const ROUTER_KEY = (await Bun.file("/home/toxic/.tau/router.key").text().catch(() => "")).trim();
const FI_KEY = (await Bun.file("/home/toxic/.tau/freeinference.key").text().catch(() => "")).trim();

const BORNITE_CTX = 16384;

async function get(url: string, headers: Record<string, string> = {}): Promise<Response> {
	return await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
}

async function json<T = any>(res: Response): Promise<T> {
	const text = await res.text();
	try {
		return JSON.parse(text) as T;
	} catch {
		throw new Error(`non-JSON (${res.status}): ${text.slice(0, 200)}`);
	}
}

// ── 1. BORNITE ──────────────────────────────────────────────────────────────

describe("bornite local llama-server", () => {
	test("daemon is reachable", async () => {
		const res = await get(`${BORNITE}/props`);
		expect(res.status).toBe(200);
	});

	test("/props reports 16384 per slot, not 32768", async () => {
		const props = await json(await get(`${BORNITE}/props`));
		const settings = props.default_generation_settings ?? {};
		expect(settings.n_ctx).toBe(BORNITE_CTX);
	});

	test("only one slot's worth is usable per request", async () => {
		const props = await json(await get(`${BORNITE}/props`));
		// total_slots must be 2 for the -c 32768 / --parallel 2 split to yield 16384.
		expect(props.total_slots).toBe(2);
		expect(props.default_generation_settings.n_ctx * props.total_slots).toBe(32768);
	});

	test("an over-context prompt is rejected, proving the limit is real", async () => {
		// 17k tokens of filler must exceed 16384 and fail loudly.
		const filler = "word ".repeat(17_000);
		const chat = await fetch(`${BORNITE}/v1/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: "qwen3.5-9b-Q5_K_M",
				messages: [{ role: "user", content: filler }],
				max_tokens: 4,
			}),
			signal: AbortSignal.timeout(60_000),
		});
		expect(chat.status).toBe(400);
		const body = await chat.text();
		expect(body).toContain("exceeds the available context size");
		expect(body).toContain(String(BORNITE_CTX));
	});
});

// ── 2. FREEINFERENCE via the router ─────────────────────────────────────────

describe("freeinference catalog through the router", () => {
	test("router is reachable with the router key", async () => {
		expect(ROUTER_KEY.length).toBeGreaterThan(0);
		const res = await get(`${ROUTER}/v1/models`, { Authorization: `Bearer ${ROUTER_KEY}` });
		expect(res.status).toBe(200);
	});

	test("glm-5.3-flash is NOT served (delisted upstream)", async () => {
		const res = await get(`${ROUTER}/v1/models`, { Authorization: `Bearer ${ROUTER_KEY}` });
		const ids = (await json(res)).data.map((m: any) => m.id as string);
		expect(ids).not.toContain("glm-5.3-flash");
	});

	test("requesting glm-5.3-flash returns unknown_model, not a silent 200", async () => {
		const res = await fetch(`${ROUTER}/v1/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${ROUTER_KEY}` },
			body: JSON.stringify({
				model: "glm-5.3-flash",
				messages: [{ role: "user", content: "hi" }],
				max_tokens: 4,
			}),
			signal: AbortSignal.timeout(20_000),
		});
		expect(res.status).toBe(400);
		expect(await res.text()).toContain("unknown_model");
	});

	test("the three real freeinference models are served", async () => {
		const res = await get(`${ROUTER}/v1/models`, { Authorization: `Bearer ${ROUTER_KEY}` });
		const ids = (await json(res)).data.map((m: any) => m.id as string);
		for (const id of ["qwen3.6-35b", "deepseek-v4-flash", "bge-m3"]) {
			expect(ids, `${id} missing from catalog`).toContain(id);
		}
	});
});

// ── 3. UA GATING (freeinference direct) ─────────────────────────────────────

describe("freeinference UA-gated model list", () => {
	test("browser UA sees bge-m3", async () => {
		expect(FI_KEY.length).toBeGreaterThan(0);
		const res = await get("https://freeinference.org/v1/models", {
			Authorization: `Bearer ${FI_KEY}`,
			"User-Agent":
				"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
		});
		const ids = (await json(res)).data.map((m: any) => m.id as string);
		expect(ids).toContain("bge-m3");
	});

	test("claude-cli UA has bge-m3 hidden", async () => {
		const res = await get("https://freeinference.org/v1/models", {
			Authorization: `Bearer ${FI_KEY}`,
			"User-Agent": "claude-cli/1.0.0",
		});
		const ids = (await json(res)).data.map((m: any) => m.id as string);
		expect(ids).not.toContain("bge-m3");
	});

	test("deepseek-v4-flash really allows 393216 output tokens", async () => {
		const res = await get("https://freeinference.org/v1/models", {
			Authorization: `Bearer ${FI_KEY}`,
			"User-Agent": "Mozilla/5.0",
		});
		const model = (await json(res)).data.find((m: any) => m.id === "deepseek-v4-flash");
		expect(model).toBeDefined();
		expect(model.max_output_length).toBe(393216);
	});
});