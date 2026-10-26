/**
 * realworld.test.ts — geode live-contract suite (REAL-WORLD TDD).
 *
 * Unit tests prove code paths; this suite proves DEPLOYED CONTRACTS. Every
 * test drives a real daemon over real HTTP and asserts the observable
 * contract the estate depends on. A green unit suite with red here means the
 * estate is lying about working.
 *
 * Credentials resolve from the secretsmith keyring (SSOT) — never hardcoded.
 * Ports resolve from estate/config/ports.env (names drift; SSOT is truth).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const ESTATE = join(homedir(), "estate");
const TIMEOUT = 20_000;

function portEnv(): Map<string, string> {
  const m = new Map<string, string>();
  try {
    for (const line of readFileSync(
      join(ESTATE, "config/ports.env"),
      "utf8",
    ).split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i > 0)
        m.set(
          t.slice(0, i).trim(),
          t
            .slice(i + 1)
            .trim()
            .replace(/\s+#.*$/, "")
            .trim(),
        );
    }
  } catch {}
  return m;
}
const PORTS = portEnv();
const p = (...keys: string[]) => {
  for (const k of keys) if (PORTS.get(k)) return PORTS.get(k);
  return undefined;
};

function key(label: string): string {
  try {
    const r = Bun.spawnSync(
      ["secretsmith", "get", "--label", label, "--show"],
      {
        env: {
          ...process.env,
          PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}`,
        },
        timeout: 15_000,
      },
    );
    const out = (r.stdout?.toString() ?? "") + (r.stderr?.toString() ?? "");
    const m = out.match(/secret\s*:\s*(\S+)/);
    if (m) return m[1] ?? "";
    const j = JSON.parse(out);
    return (j.secret as string) ?? "";
  } catch {
    return "";
  }
}

type Lane = { name: string; base: string; auth?: () => string | undefined };

function lanes(): Lane[] {
  const out: Lane[] = [];
  const born = p("BORNITE_PORT", "HERD_PORT", "LLAMA_SWAP_PORT");
  if (born) out.push({ name: "bornite", base: `http://127.0.0.1:${born}` });
  const rhodo = p("RHODOCHROSITE_PORT", "NIM_PROXY_PORT", "ROUTER_PORT");
  if (rhodo)
    out.push({
      name: "rhodochrosite",
      base: `http://127.0.0.1:${rhodo}`,
      auth: () => process.env.RHODOCHROSITE_TOKEN,
    });
  const chal = p("CHALCOPYRITE_PORT", "ATLAS_GATEWAY_PORT");
  if (chal)
    out.push({
      name: "chalcopyrite",
      base: `http://127.0.0.1:${chal}`,
      auth: () => key("CHALCOPYRITE_CLIENT_KEY"),
    });
  const thresher = p("THRESHER_PORT", "MCPPROXY_GO_PORT");
  if (thresher)
    out.push({ name: "thresher", base: `http://127.0.0.1:${thresher}` });
  const chat = p("SQUAWK_CHAT_PORT", "ESTATE_CHAT_PORT");
  if (chat)
    out.push({
      name: "estate-chat",
      base: `http://127.0.0.1:${chat}`,
      auth: () => readTokenFile("estate-chat-token"),
    });
  return out;
}

function readTokenFile(name: string): string | undefined {
  try {
    return (
      readFileSync(join(homedir(), ".config", name), "utf8").trim() || undefined
    );
  } catch {
    return undefined;
  }
}

async function probeModels(
  lane: Lane,
): Promise<{ status: number; count: number; body: string }> {
  const headers: Record<string, string> = { accept: "application/json" };
  const a = lane.auth?.();
  if (a) headers.Authorization = `Bearer ${a}`;
  const r = await fetch(`${lane.base}/v1/models`, {
    headers,
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const body = await r.text();
  let count = 0;
  try {
    count = (JSON.parse(body.slice(body.indexOf("{"))).data ?? []).length;
  } catch {}
  return { status: r.status, count, body: body.slice(0, 300) };
}

describe("geode live contracts", () => {
  for (const lane of lanes()) {
    describe(lane.name, () => {
      test(`answers its health contract`, async () => {
        // Lanes expose different contracts: OpenAI-shaped lanes answer
        // /v1/models with a roster; infra planes (thresher MCP proxy,
        // estate-chat) answer their own health/status endpoints.
        const openaiLanes = new Set([
          "bornite",
          "rhodochrosite",
          "chalcopyrite",
        ]);
        if (openaiLanes.has(lane.name)) {
          const r = await probeModels(lane);
          expect({
            status: r.status,
            count: r.count,
            name: lane.name,
          }).toMatchObject({ status: 200 });
          expect(
            r.count,
            `${lane.name}/v1/models roster empty: ${r.body}`,
          ).toBeGreaterThan(0);
          return;
        }
        const path = lane.name === "thresher" ? "/api/v1/status" : "/health";
        const headers: Record<string, string> = {};
        const a = lane.auth?.();
        if (a) headers.Authorization = `Bearer ${a}`;
        const r = await fetch(`${lane.base}${path}`, {
          headers,
          signal: AbortSignal.timeout(TIMEOUT),
        });
        expect({ name: lane.name, status: r.status }).toMatchObject({
          status: 200,
        });
      });
    });
  }

  // The keypool is the lane-key SSOT. Contract: a pool whose keys are valid
  // upstream must not be mass-down — a key marked down while a direct probe
  // succeeds is the parser/probe trap regression (401-on-valid-key from
  // quote-corrupted Bearer headers, or the /api/v1/key false-negative).
  // Genuinely dead keys (gemini EAP 401 upstream-side) are allowed to be
  // down, but "EVERY pool down" is always a bug.
  test("keypool is not mass-down and openrouter-paid resolves a live key", async () => {
    const kpPort = p("KEYPOOL_PORT", "KRYPTOS_KEYPOOL_PORT") ?? "25109";
    const r = await fetch(`http://127.0.0.1:${kpPort}/status`, {
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const pools = (await r.json()) as Record<
      string,
      { keys?: Array<{ state?: string }> }
    >;
    const total = Object.values(pools).flatMap((v) => v.keys ?? []);
    const down = total.filter((k) => k.state === "down").length;
    expect(
      down,
      `mass-down: ${down}/${total.length} keys — parser/probe bug, not key reality`,
    ).toBeLessThan(total.length);
    const paid = pools["openrouter-paid"]?.keys ?? [];
    expect(
      paid.some((k) => k.state === "healthy"),
      "openrouter-paid has no healthy key",
    ).toBe(true);
  });
});
