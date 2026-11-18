/**
 * SharedProviderLease — cross-process in-flight admission control, WIRE-COMPATIBLE
 * with tau's ProviderInFlight lease (packages/ai/src/stream.ts).
 *
 * The problem it solves: every routing layer (tau, kappa, hermes, this router)
 * used to enforce its OWN per-process concurrency cap. freeinference's real
 * per-key wall is 1 (`429 {"code":"concurrency_limit_exceeded","limit":1}`,
 * verified live 2026-11-13), and five processes each firing "1 in-flight"
 * still shed the upstream. The fix is ONE shared semaphore: a filesystem lease
 * directory that every process reads/writes, so the total in-flight across ALL
 * processes never exceeds the cap.
 *
 * Protocol (must match tau exactly — a lease written here is read there and
 * vice versa):
 *   ~/.tau/run/provider-inflight/<sha256-base64url(provider)>/
 *     .lock/            — exclusive create-dir lock around lease bookkeeping
 *     .wakeup           — touch file; waiters watch it and re-poll
 *     <pid>-<ts>-<uuid>/ — ONE lease per in-flight request
 *       info.json       — {"pid": <int>, "timestamp": <ms>, "token": "<uuid>"}
 *   Heartbeat: rewrite info.json every 5s while the request is in flight.
 *   Stale reap: a lease whose process is dead, or whose info.json is older
 *   than 30s, is removed by the next acquirer. The lock itself is reaped at
 *   10s if its owner died.
 *
 * The cap is read from ONE source: the catalog's per-provider maxConcurrency
 * (data.ts). The router's old in-process ProviderSemaphore stays as a fast
 * path only for providers with NO configured cap (default 4) — capped
 * providers go through the shared lease.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const LOCK_STALE_MS = 10_000;
const LEASE_STALE_MS = 30_000;
const HEARTBEAT_MS = 5_000;
const WAKEUP_POLL_MS = 250;

export interface SharedLeaseOptions {
  /** Override the lease root (tests). Default: tau's ~/.tau/run/provider-inflight. */
  root?: string;
  /** Cap override (tests). Default: resolved from the caller per provider. */
  limit?: number;
  heartbeatMs?: number;
  leaseStaleMs?: number;
  lockStaleMs?: number;
}

interface LeaseInfo {
  pid: number;
  timestamp: number;
  token: string;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function providerSegment(provider: string): string {
  return createHash("sha256").update(provider).digest("base64url");
}

function defaultRoot(): string {
  return process.env.TAU_PROVIDER_INFLIGHT_ROOT ?? join(process.env.HOME ?? "/tmp", ".tau", "run", "provider-inflight");
}

async function isEnoent(e: unknown): Promise<boolean> {
  return (e as NodeJS.ErrnoException)?.code === "ENOENT";
}

async function readInfo(infoPath: string): Promise<LeaseInfo | null> {
  try {
    const parsed = JSON.parse(await readFile(infoPath, "utf8")) as Partial<LeaseInfo>;
    if (typeof parsed.pid !== "number" || typeof parsed.timestamp !== "number" || typeof parsed.token !== "string") {
      return null;
    }
    return { pid: parsed.pid, timestamp: parsed.timestamp, token: parsed.token };
  } catch {
    return null;
  }
}

async function writeInfo(dir: string, token: string): Promise<void> {
  const info: LeaseInfo = { pid: process.pid, timestamp: Date.now(), token };
  const infoPath = join(dir, "info.json");
  const tmp = join(dir, `.info-${process.pid}-${randomUUID()}.tmp`);
  await writeFile(tmp, JSON.stringify(info), "utf8");
  await rename(tmp, infoPath);
}

async function dirStale(dir: string, staleMs: number): Promise<boolean> {
  const info = await readInfo(join(dir, "info.json"));
  if (info) {
    if (!isProcessAlive(info.pid)) return true;
    return Date.now() - info.timestamp > staleMs;
  }
  try {
    const st = await stat(join(dir, "info.json"));
    return Date.now() - st.mtimeMs > staleMs;
  } catch (e) {
    if (!(await isEnoent(e))) throw e;
  }
  try {
    const st = await stat(dir);
    return Date.now() - st.mtimeMs > staleMs;
  } catch (e) {
    if (await isEnoent(e)) return false;
    throw e;
  }
}

async function cleanupLeases(dir: string, leaseStaleMs: number): Promise<number> {
  let active = 0;
  let entries: string[] = [];
  try {
    entries = await import("node:fs/promises").then((fs) => fs.readdir(dir));
  } catch (e) {
    if (!(await isEnoent(e))) throw e;
    return 0;
  }
  for (const entry of entries) {
    if (entry === ".wakeup" || entry === ".lock" || entry.startsWith(".")) continue;
    const leaseDir = join(dir, entry);
    let st;
    try {
      st = await stat(leaseDir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    if (await dirStale(leaseDir, leaseStaleMs)) {
      await rm(leaseDir, { recursive: true, force: true }).catch(() => {});
      continue;
    }
    active++;
  }
  return active;
}

/** Exclusive create-dir lock. Returns release. */
async function acquireLock(lockDir: string, lockStaleMs: number): Promise<() => Promise<void>> {
  for (;;) {
    try {
      await mkdir(lockDir);
      await writeInfo(lockDir, randomUUID());
      return async () => {
        await rm(lockDir, { recursive: true, force: true }).catch(() => {});
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") throw e;
    }
    // Someone holds it. Reap if stale.
    if (await dirStale(lockDir, lockStaleMs)) {
      await rm(lockDir, { recursive: true, force: true }).catch(() => {});
      continue;
    }
    await Bun.sleep(25);
  }
}

async function signalWaiters(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, ".wakeup"), String(Date.now()), "utf8");
  } catch {}
}

export interface SharedLeaseHandle {
  /** Release the lease; idempotent. */
  release(): Promise<void>;
}

export interface SharedLeaseAcquirer {
  /**
   * Acquire one in-flight slot for [provider] with [limit] total across ALL
   * processes. Resolves when under the cap; rejects on abort.
   */
  acquire(provider: string, limit: number, signal?: AbortSignal): Promise<SharedLeaseHandle>;
}

export function createSharedLeaseAcquirer(opts: SharedLeaseOptions = {}): SharedLeaseAcquirer {
  const root = opts.root ?? defaultRoot();
  const limitOverride = opts.limit;
  const heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;
  const leaseStaleMs = opts.leaseStaleMs ?? LEASE_STALE_MS;
  const lockStaleMs = opts.lockStaleMs ?? LOCK_STALE_MS;

  return {
    async acquire(provider, limit, signal) {
      const effectiveLimit = limitOverride ?? limit;
      await mkdir(root, { recursive: true }); // ensure lease root exists before lock/lease mkdir
      const dir = join(root, providerSegment(provider));
      const lockDir = `${dir}.lock`;
      const releaseLock = await acquireLock(lockDir, lockStaleMs);
      let leaseDir: string | undefined;
      try {
        await mkdir(dir, { recursive: true });
        const active = await cleanupLeases(dir, leaseStaleMs);
        if (active >= effectiveLimit) {
          // Release the lock and wait for a wakeup, then retry.
          await releaseLock();
          for (;;) {
            if (signal?.aborted) throw signal.reason ?? new Error("aborted");
            try {
              await mkdir(dir, { recursive: true });
              await writeFile(join(dir, ".wakeup"), String(Date.now()), "utf8");
            } catch {}
            await Bun.sleep(WAKEUP_POLL_MS);
            const relock = await acquireLock(lockDir, lockStaleMs);
            const activeNow = await cleanupLeases(dir, leaseStaleMs);
            if (activeNow < effectiveLimit) {
              leaseDir = join(dir, `${process.pid}-${Date.now()}-${randomUUID()}`);
              await mkdir(leaseDir);
              await writeInfo(leaseDir, randomUUID());
              break; // lock already held by `relock`; finally releases it
            }
            await relock();
          }
        } else {
          leaseDir = join(dir, `${process.pid}-${Date.now()}-${randomUUID()}`);
          await mkdir(leaseDir);
          await writeInfo(leaseDir, randomUUID());
        }
      } finally {
        await releaseLock();
      }

      // Heartbeat while the request is in flight.
      const token = randomUUID();
      let heartbeatActive = true;
      const interval = setInterval(() => {
        if (!heartbeatActive || !leaseDir) return;
        writeInfo(leaseDir, token).catch(() => {});
      }, heartbeatMs);
      interval.unref?.();

      let released = false;
      let releasePromise: Promise<void> | undefined;
      const release = async () => {
        if (released) return;
        released = true;
        heartbeatActive = false;
        clearInterval(interval);
        releasePromise ??= (async () => {
          if (leaseDir) await rm(leaseDir, { recursive: true, force: true }).catch(() => {});
          await signalWaiters(dir);
        })();
        await releasePromise;
      };

      return { release };
    },
  };
}

/** The directory tau uses (exported for tests / diagnostics). */
export function providerLeaseDir(provider: string, root?: string): string {
  return join(root ?? defaultRoot(), providerSegment(provider));
}