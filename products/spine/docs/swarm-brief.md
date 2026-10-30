# Swarm brief — the October-2026 emergent stack (fast-timeout swarm doctrine)

**Goal**: name + build the kafka(✓ :25144 live)+Ray(EMR-clone verdict landed)
emergent stack pen for the estate, with the reactive event spine (✓ MVP:
`spine watch|emit|log`) as its first tenant.

## Swarm contract (fast timeout = model rotation = refinement)

- **Timeout discipline**: every subagent run gets a FAST timeout (≤120s hard).
  A timeout is NOT failure — it is a MODEL signal: the run store records which
  model timed out, and the next iteration rotates the lane (the estate's
  per-model credit-strike doctrine applied to TIME instead of credits).
- **Run store**: `runs/<timestamp>-<agent>-<slug>/` — every subagent writes
  `receipt.json` (schema: {task, model, outcome: done|timeout|error,
  artifacts[], notes}) BEFORE touching anything else. A run without a receipt
  never happened (will-use-then-stop is forbidden).
- **Refinement loop**: after each batch, the coordinator reads all receipts,
  prunes dead lanes, re-briefs with the receipts INLINE (no re-explaining),
  and re-spawns only the unfinished slice. The swarm WIP is the board —
  `tau todo` ops are the single progress truth (tau-todo-shim), never
  parallel todo files.

## Work slices (each is one subagent, one timeout window)

1. NAME: harvest the squawk #fleet debate replies; if dead-silent, the
   coordinator picks from the posted candidates ([1] oceanus … [7] poseidon).
2. PEN: `make-pen.ts --pen <winner>` via the fixed scaffold conversion.
3. TENANT: move `spine` (geode → new pen/products), re-point the bin symlink.
4. RAY: scaffold `ray-ops` (cluster launcher config for 3090 SM86 24GB +
   AVX-512 CPU lanes; num_gpus=1 actor template).
5. DOCS: emergent-stack README with the Ray-vs-Dask-vs-Bytewax verdict +
   lease-not-queue concurrency receipt (cleavage/docs/concurrency-queue.md).

## Coordination channel

All swarm chatter rides the spine (squawk-ws watch + kafka receipts), NOT
polling: `spine emit fleet <progress>` per receipt; the coordinator reads the
kafka log (`spine log N`) as the durable run history.
