/**
 * circuit-breaker/index.ts — registry + persistent Lua worker for modular
 * upstream-fault classification.
 *
 * Spawns one long-lived `lua worker.lua` process at startup, loads every
 * `.lua` module under `modules/`, and classifies each upstream response
 * (status + body) in priority order. The worker is respawned if it exits.
 *
 * Usage: `await breakerModules.classify(status, body, { provider, model })`
 * → BreakerClassifyResult.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import type { BreakerClassifyResult, BreakerContext } from "./types.ts";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const LUA_DIR = path.join(HERE, "lua");
const MODULES_DIR = path.join(HERE, "modules");

interface Pending {
  resolve: (r: BreakerClassifyResult) => void;
  reject: (e: Error) => void;
}

class LuaBreakerWorker {
  private proc: ChildProcess | null = null;
  private pending = new Map<number, Pending>();
  private seq = 0;
  private buf = "";
  private dead = false;

  constructor() {
    const mods = readdirSync(MODULES_DIR).filter((f) => f.endsWith(".lua"));
    if (mods.length === 0) {
      throw new Error("circuit-breaker: no .lua modules found in " + MODULES_DIR);
    }
    this.spawn();
  }

  private spawn() {
    try {
      this.proc = spawn("lua", [path.join(LUA_DIR, "worker.lua"), LUA_DIR, MODULES_DIR], {
        stdio: ["pipe", "pipe", "inherit"],
      });
    } catch (err) {
      console.error("[circuit-breaker] failed to spawn lua worker:", err);
      this.dead = true;
      return;
    }
    this.dead = false;
    this.buf = "";
    this.proc.stdout!.on("data", (d: Buffer) => this.onData(d));
    this.proc.on("error", (err) => {
      console.error("[circuit-breaker] lua worker error:", err);
      this.dead = true;
    });
    this.proc.on("exit", () => {
      for (const [, p] of this.pending) p.reject(new Error("breaker worker exited"));
      this.pending.clear();
      setTimeout(() => this.spawn(), 500);
    });
  }

  private onData(d: Buffer) {
    this.buf += d.toString();
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      try {
        const msg = JSON.parse(line);
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          p.resolve({ matched: msg.matched ?? null, policy: msg.policy ?? null });
        }
      } catch {
        /* skip malformed line */
      }
    }
  }

  classify(status: number, body: string, ctx: BreakerContext): Promise<BreakerClassifyResult> {
    if (this.dead || !this.proc || !this.proc.stdin?.writable) {
      return Promise.resolve({ matched: null, policy: null });
    }
    const id = ++this.seq;
    const { promise, resolve, reject } = Promise.withResolvers<BreakerClassifyResult>();
    this.pending.set(id, { resolve, reject });
    this.proc!.stdin!.write(JSON.stringify({ id, status, body, ...ctx }) + "\n");
    return promise;
  }
}

/** Singleton worker — one Lua process for the whole router. */
export const breakerModules = new LuaBreakerWorker();

/**
 * Classify an upstream response into a breaker policy. Public API seam used by
 * server.ts and tests. Returns `{ matched: null, policy: null }` when no
 * module owns the response (caller falls back to generic retryable handling).
 */
export function classify(
  status: number,
  body: string,
  ctx: BreakerContext,
): Promise<BreakerClassifyResult> {
  return breakerModules.classify(status, body, ctx);
}
