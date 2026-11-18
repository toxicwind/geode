/**
 * shared-lease.test.ts — TDD for the cross-process provider lease.
 *
 * The lease is wire-compatible with tau's ProviderInFlight lease
 * (~/.tau/run/provider-inflight/<sha256-base64url(provider)>/), so a lease
 * written here is read by tau/kappa/hermes and vice versa. These tests pin:
 *   1. The directory layout (provider → sha256 segment → lease dirs).
 *   2. The cap: N concurrent acquires across M "processes" never exceed limit.
 *   3. Heartbeat + stale reaping: a dead lease is cleaned by the next acquirer.
 *   4. Release signals waiters (wakeup file touched).
 *   5. info.json format matches tau's {pid, timestamp, token}.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSharedLeaseAcquirer, providerLeaseDir } from "../src/shared-lease.ts";

async function tempRoot(label: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `lease-${label}-`));
  return dir;
}

describe("shared lease — directory layout (tau-wire-compatible)", () => {
  test("provider dir is sha256-base64url under the root", async () => {
    const root = await tempRoot("layout");
    const dir = providerLeaseDir("freeinference", root);
    // sha256("freeinference") base64url — 43 chars, no '=' padding, no '/'
    expect(dir.startsWith(root)).toBe(true);
    const seg = dir.slice(root.length + 1);
    expect(seg).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await rm(root, { recursive: true, force: true });
  });

  test("info.json carries {pid, timestamp, token} — tau's exact shape", async () => {
    const root = await tempRoot("info");
    const lease = createSharedLeaseAcquirer({ root, limit: 1, heartbeatMs: 30 });
    const handle = await lease.acquire("freeinference", 1);
    const dir = providerLeaseDir("freeinference", root);
    const entries = await readdir(dir);
    const leaseEntry = entries.find((e) => !e.startsWith("."));
    expect(leaseEntry).toBeDefined();
    const info = JSON.parse(await readFile(join(dir, leaseEntry!, "info.json"), "utf8"));
    expect(typeof info.pid).toBe("number");
    expect(typeof info.timestamp).toBe("number");
    expect(typeof info.token).toBe("string");
    expect(info.pid).toBe(process.pid);
    await handle.release();
    await rm(root, { recursive: true, force: true });
  });
});

describe("shared lease — concurrency cap", () => {
  test("limit=1: second acquire waits until first releases", async () => {
    const root = await tempRoot("cap1");
    const lease = createSharedLeaseAcquirer({ root, limit: 1, heartbeatMs: 30 });
    const h1 = await lease.acquire("freeinference", 1);
    const dir = providerLeaseDir("freeinference", root);
    const entriesAfterFirst = (await readdir(dir)).filter((e) => !e.startsWith("."));
    expect(entriesAfterFirst.length).toBe(1);

    // Second acquire must NOT resolve until release.
    let secondResolved = false;
    const second = lease.acquire("freeinference", 1).then((h) => {
      secondResolved = true;
      return h;
    });
    await Bun.sleep(100);
    expect(secondResolved).toBe(false);

    await h1.release();
    const h2 = await second;
    expect(secondResolved).toBe(true);
    await h2.release();
    await rm(root, { recursive: true, force: true });
  }, 5000);

  test("limit=3: three concurrent acquires all succeed (cap not breached)", async () => {
    const root = await tempRoot("cap3");
    const lease = createSharedLeaseAcquirer({ root, limit: 3, heartbeatMs: 30 });
    const handles = await Promise.all([
      lease.acquire("nvidia", 3),
      lease.acquire("nvidia", 3),
      lease.acquire("nvidia", 3),
    ]);
    const dir = providerLeaseDir("nvidia", root);
    const active = (await readdir(dir)).filter((e) => !e.startsWith("."));
    expect(active.length).toBe(3);
    await Promise.all(handles.map((h) => h.release()));
    await rm(root, { recursive: true, force: true });
  }, 5000);
});

describe("shared lease — heartbeat + stale reaping", () => {
  test("a dead lease (no heartbeat, old info) is reaped by the next acquirer", async () => {
    const root = await tempRoot("stale");
    const lease = createSharedLeaseAcquirer({
      root,
      limit: 1,
      heartbeatMs: 1000,
      leaseStaleMs: 100, // short stale window for the test
    });
    const h1 = await lease.acquire("freeinference", 1);
    const dir = providerLeaseDir("freeinference", root);
    const leaseEntry = (await readdir(dir)).find((e) => !e.startsWith("."))!;
    // Simulate a dead holder: rewrite info.json with a bogus PID and old timestamp.
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(dir, leaseEntry, "info.json"),
      JSON.stringify({ pid: 999999999, timestamp: Date.now() - 60_000, token: "dead" }),
    );
    await h1.release(); // release the live handle; the dir lingers with the dead info
    // Next acquire should reap the stale lease and succeed.
    const h2 = await lease.acquire("freeinference", 1);
    const active = (await readdir(dir)).filter((e) => !e.startsWith("."));
    expect(active.length).toBe(1);
    await h2.release();
    await rm(root, { recursive: true, force: true });
  }, 5000);
});

describe("shared lease — wait-loop slot handoff (regression: double-relock deadlock)", () => {
  test("a waiter acquires the freed slot without hanging", async () => {
    const root = await tempRoot("handoff");
    const lease = createSharedLeaseAcquirer({ root, limit: 1, heartbeatMs: 30, leaseStaleMs: 5000 });
    const h1 = await lease.acquire("freeinference", 1);
    const dir = providerLeaseDir("freeinference", root);
    // Second acquire enters the wait loop (active=1 >= limit=1).
    const h2p = lease.acquire("freeinference", 1);
    await Bun.sleep(50); // let it enter the wait loop
    // Release the first — the waiter must pick up the freed slot promptly.
    const t0 = performance.now();
    await h1.release();
    const h2 = await h2p; // would hang forever on the double-relock bug
    const took = Math.round(performance.now() - t0);
    expect(took).toBeLessThan(2000);
    await h2.release();
    await rm(root, { recursive: true, force: true });
  }, 5000);
});

describe("shared lease — release signals waiters", () => {
  test("release touches .wakeup so a waiter re-polls", async () => {
    const root = await tempRoot("wakeup");
    const lease = createSharedLeaseAcquirer({ root, limit: 1, heartbeatMs: 30 });
    const h1 = await lease.acquire("freeinference", 1);
    const dir = providerLeaseDir("freeinference", root);
    expect((await readdir(dir)).includes(".wakeup")).toBe(false);
    await h1.release();
    expect((await readdir(dir)).includes(".wakeup")).toBe(true);
    await rm(root, { recursive: true, force: true });
  });
});