/**
 * ingest-queue.ts — work-conserving admission queue for mimetite ("ingest mode").
 *
 * The problem: the router's per-provider concurrency gate (shared-lease.ts) is
 * correct, but it is blind to anyone holding a slot OUTSIDE the lease — a direct
 * tau/kappa/hermes lane, another machine, or a generation that simply has not
 * finished. The upstream answers those with `429 concurrency_limit_exceeded`,
 * and proxyUpstream's retry budget is an ATTEMPT count (~3 tries, ~1.5s
 * cumulative) against a holder that can run 20-30s. The 429 surfaces.
 *
 * Ingest mode fixes the shape, not the wall:
 *   - every accepted request is admitted to a queue instead of being shed
 *   - the queue is work-conserving: the moment a slot frees, SOME waiter gets
 *     it. Selection is deliberately unordered (random victim) — no FIFO, no
 *     priority lane. Completion order is whatever the upstreams allow.
 *   - the retry budget becomes a TIME budget (maxTotalMs) rather than an attempt
 *     count, so a 30s holder is waited out instead of out-run.
 *
 * The per-provider wall is still enforced by the shared lease; this queue adds
 * backpressure, observability and a deadline in front of it. It never admits
 * more concurrency than the lease would.
 */
import { randomUUID } from "node:crypto";

export interface IngestQueueOptions {
  /**
   * Max concurrent `run()` invocations. 0 (default) = unlimited: the shared
   * lease is the real gate and the queue only orders admission.
   */
  maxInflight?: number;
  /** Max waiters before new submissions are rejected. Default 1000. */
  maxQueued?: number;
  /** Max time a submission may sit in the queue before rejection. Default 120s. */
  maxWaitMs?: number;
  /** Clock + RNG injection points (tests). */
  now?: () => number;
  random?: () => number;
}

export interface IngestSnapshot {
  inflight: number;
  queued: number;
  maxInflight: number;
  maxQueued: number;
  accepted: number;
  completed: number;
  failed: number;
  rejected: number;
  timedOut: number;
  inflightPeak: number;
  queuedPeak: number;
  avgWaitMs: number;
  avgRunMs: number;
  oldestWaitMs: number;
}

/** Raised when the queue is at capacity — real backpressure, not a shed. */
export class IngestQueueFullError extends Error {
  readonly code = "ingest_queue_full";
  constructor(message = "ingest queue is full") {
    super(message);
    this.name = "IngestQueueFullError";
  }
}

/** Raised when a submission waited longer than maxWaitMs. */
export class IngestTimeoutError extends Error {
  readonly code = "ingest_wait_timeout";
  constructor(message = "ingest queue wait timed out") {
    super(message);
    this.name = "IngestTimeoutError";
  }
}

interface Waiter {
  id: string;
  enqueuedAt: number;
  timer?: ReturnType<typeof setTimeout>;
  start: () => void;
}

export interface IngestQueue {
  /** Submit work; resolves with the task result, rejects on timeout/full. */
  submit<T>(run: () => Promise<T>, label?: string): Promise<T>;
  /** Current counters. */
  snapshot(): IngestSnapshot;
  /** Cheap queue depth probe (diagnostics). */
  describe(): { queued: number; inflight: number; maxInflight: number };
}

export function createIngestQueue(opts: IngestQueueOptions = {}): IngestQueue {
  const now = opts.now ?? Date.now;
  const rand = opts.random ?? Math.random;
  const maxInflight = Math.max(0, opts.maxInflight ?? 0);
  const maxQueued = Math.max(1, opts.maxQueued ?? 1000);
  const maxWaitMs = Math.max(0, opts.maxWaitMs ?? 120_000);

  let inflight = 0;
  let inflightPeak = 0;
  let queuedPeak = 0;
  let accepted = 0;
  let completed = 0;
  let failed = 0;
  let rejected = 0;
  let timedOut = 0;
  let waitMsTotal = 0;
  let waitSamples = 0;
  let runMsTotal = 0;

  const waiters: Waiter[] = [];

  function pickWaiter(): Waiter | undefined {
    if (waiters.length === 0) return undefined;
    // Deliberately unordered: random victim, no FIFO / priority guarantee.
    const idx = Math.min(waiters.length - 1, Math.floor(rand() * waiters.length));
    return waiters.splice(idx, 1)[0];
  }

  function pump(): void {
    if (maxInflight > 0 && inflight >= maxInflight) return;
    const w = pickWaiter();
    if (!w) return;
    if (w.timer) {
      clearTimeout(w.timer);
      w.timer = undefined;
    }
    inflight++;
    if (inflight > inflightPeak) inflightPeak = inflight;
    waitMsTotal += now() - w.enqueuedAt;
    waitSamples++;
    w.start();
  }

  function submit<T>(run: () => Promise<T>, label?: string): Promise<T> {
    void label;
    if (waiters.length >= maxQueued) {
      rejected++;
      return Promise.reject(new IngestQueueFullError());
    }
    accepted++;
    if (waiters.length + 1 > queuedPeak) queuedPeak = waiters.length + 1;

    return new Promise<T>((resolve, reject) => {
      let settled = false;

      const waiter: Waiter = {
        id: randomUUID(),
        enqueuedAt: now(),
        start: () => {
          const runStarted = now();
          void (async () => {
            try {
              const value = await run();
              if (settled) return;
              settled = true;
              runMsTotal += now() - runStarted;
              completed++;
              resolve(value);
            } catch (err) {
              if (settled) return;
              settled = true;
              runMsTotal += now() - runStarted;
              failed++;
              reject(err);
            } finally {
              inflight--;
              // Work-conserving: hand the freed slot to another waiter.
              pump();
            }
          })();
        },
      };

      if (maxWaitMs > 0) {
        waiter.timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          const idx = waiters.indexOf(waiter);
          if (idx >= 0) waiters.splice(idx, 1);
          timedOut++;
          reject(new IngestTimeoutError());
        }, maxWaitMs);
        waiter.timer.unref?.();
      }

      waiters.push(waiter);
      pump();
    });
  }

  function snapshot(): IngestSnapshot {
    let oldest = 0;
    for (const w of waiters) {
      const age = now() - w.enqueuedAt;
      if (age > oldest) oldest = age;
    }
    return {
      inflight,
      queued: waiters.length,
      maxInflight,
      maxQueued,
      accepted,
      completed,
      failed,
      rejected,
      timedOut,
      inflightPeak,
      queuedPeak,
      avgWaitMs: waitSamples > 0 ? Math.round(waitMsTotal / waitSamples) : 0,
      avgRunMs: completed + failed > 0 ? Math.round(runMsTotal / (completed + failed)) : 0,
      oldestWaitMs: oldest,
    };
  }

  return {
    submit,
    snapshot,
    describe: () => ({ queued: waiters.length, inflight, maxInflight }),
  };
}