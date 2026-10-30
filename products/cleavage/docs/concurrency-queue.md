# FreeInference concurrency: queue vs lease — decision input (2026-10-30)

## The live evidence (this session)
- Single-key 429s = per-model CONCURRENCY gate (~2 slots), not quota:
  glm-5.3-flash answered 200 all session while one advisor 429'd mid-flight
  (observer effect, tau.2026-10-30.398989.log 06:23).
- The platform exposes a GLOBAL "queue" (retry-after up to 5.3 days claimed
  in stale config comments — FABRICATED from one 429; contradicted by live
  200s minutes later).

## Options for the emergent stack
1. **Queue-backed dispatch (kafka :25144)** — a dispatch topic per model lane;
   consumer groups enforce the ~2-slot gate exactly-once. Con: queuing
   latency on the hot path; the architect's verdict: "queuing is shit".
2. **Queue-free lease scheduler (RECOMMENDED)** — LeaseScheduler pattern
   (proven in the estate: LeaseScheduler serialized probes per
   anomaly-dossier #4): in-flight lease per (provider, model), lease =
   kafka compacted topic entry with TTL heartbeat, not a queue position.
   Dispatchers TRY lease-acquire, get busy/fast-deny, rotate chain — never
   wait in line. Kafka keeps the durable record; nothing queues.
3. Hybrid: lease for the hot path, kafka log for receipts/audit.

## Receipt
- kafka broker :25144 LISTEN verified (ss + /dev/tcp twice, 2026-10-30).
- The "weekly exhaustion" narrative was fabricated from 429s — live logs
  refute; the cleavage product now learns this failure class.
