/**
 * model-sse.ts — model-list SSE snapshot primitive for the mimetite router.
 *
 * Pattern borrowed from products/pens-ops/sse-forward.ts (the pens-wide SSE
 * forward-view primitive): a ring buffer of recent events + a subscriber set
 * with fan-out. Subscribers replay history first, then receive live pushes.
 * A dead subscriber is dropped, never blocks the publisher.
 *
 * This replaces the earlier ad-hoc `discoveryListeners` Set in server.ts with
 * the proven ring-buffer + replay design, so /v1/models/sse clients see the
 * current snapshot immediately and every subsequent discovery refresh.
 */

export interface ModelSnapshotEvent {
  type: "models_snapshot";
  data: unknown;
  t: number;
}

const RING_CAP = 20;
const ring: ModelSnapshotEvent[] = [];
const subs = new Set<(e: ModelSnapshotEvent) => void>();
let seq = 0;

/** Record a fresh model-list snapshot and fan it out to live subscribers. */
export function pushModelSnapshot(data: unknown): number {
  const id = ++seq;
  const ev: ModelSnapshotEvent = { type: "models_snapshot", data, t: Date.now() };
  ring.push(ev);
  if (ring.length > RING_CAP) ring.splice(0, ring.length - RING_CAP);
  for (const listener of subs) {
    try {
      listener(ev);
    } catch {
      subs.delete(listener);
    }
  }
  return id;
}

/**
 * Subscribe to model snapshots. Replays buffered history first (so a fresh
 * client immediately gets the current state), then delivers live pushes.
 * Returns an unsubscribe function.
 */
export function subscribeModelSnapshots(
  listener: (e: ModelSnapshotEvent) => void,
): () => void {
  for (const ev of ring) {
    try {
      listener(ev);
    } catch {}
  }
  subs.add(listener);
  return () => subs.delete(listener);
}
