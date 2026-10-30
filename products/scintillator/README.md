# ✨ Scintillator

> **The proof subsystem** — orthogonal, self-bootstrapping, copy-paste-runnable proofs that VERIFY the estate's runtime claims live. Forked from forensia's experiment framework (which had no proof subsystem); lives in geode by architect choice (**scintillator**: the crystal that flashes when a particle actually hits — every proof emits a scintillation receipt).

## Doctrine

1. **Orthogonal**: each proof is a standalone script. No imports between proofs. Copy-paste any single file onto the box and run it — it bootstraps everything it needs (`sudo`, `paru`, `pacman`, `yay`, `bun` 1.4.4-canary+, `go`, `rust` are the polyglot palette; bun is main).
2. **Verify, don't trust**: every claim is checked against ACTUAL behavior. READMEs, release notes, and the SWEs who wrote the referenced software are unreliable narrators — their claims are treated as hypotheses. Cross-ref against nightly/canary reality.
3. **Scintillation score**: verified claim = +10; caught divergence (devs unaware) = +25; crash = 0 with a receipt. Score + receipts JSONL always emitted.
4. **Never simulate a missing sensor** (forensia rule, inherited).

## Framework comparison (bun/npm proof harnesses, verified 2026-10-30)

| Framework | Verdict |
|---|---|
| **bun test + JSONL receipts (chosen)** | zero extra deps, canary-native, each proof IS a script; receipts trivially emitted |
| fast-check (property testing) | great for property proofs; adds dep weight per-proof — REJECTED for standalone doctrine |
| vitest | node-flavored, slower boot; REJECTED |
| zod schemas | kept for receipt VALIDATION inside proofs that parse external JSON |
| bash + direct bun -e probes | chosen for the shell proofs (zero-install) |

## Proofs

| Proof | Verifies | Hardware sensitivity |
|---|---|---|
| `proofs/bun-runtime-proof.sh` | bun canary runtime claims: Bun.YAML, `bun -e`, replace-callback groups contract, spawnSync shell-freeness, monotonic clock, wyhash cross-process stability | CPU (clock/monotonic) |
| `proofs/ryzen-avx512-proof.sh` *(planned)* | AVX-512 presence + vectorized throughput (Ryzen 8700F) | CPU: AVX-512 |
| `proofs/sm86-cuda-proof.sh` *(planned)* | RTX 3090 24GB CUDA/Direct compute truth: SM86 features, 24GB VRAM visibility, nvml thermal | GPU: SM86 24GB |
| `proofs/kafka-dispatch-proof.sh` *(planned)* | kafka :25144 produce/consume latency + slot semantics (freeinference concurrency "queue" investigation lives here) | kafka |

## Hardware plane (for the EMR/Spark research — 2026-10-30 architect note)

- **CPU**: AMD Ryzen 7 8700F, 8C/16T, **AVX-512** — Ray/Dask CPU lanes can vectorize; the hetero-fingerprint dispatch sensor (taskset ping-pong) p95 was **0.7–1.9ms** live.
- **GPU**: **RTX 3090, SM86, 24GB** CUDA — genuine SM86 (the archived WIP's "SM86 occupancy" premise maps to THIS card).
- Consequence for the EMR-clone verdict: **Ray** fits best — native CUDA actor/tasks (`@ray.remote(num_gpus=1)`), jobs API + cluster launcher = the managed-EMR experience, and Amazon's own exabyte-scale Spark→Ray migration (91% cost-efficiency gain) is the 10x receipt. Dask = close second (Pythonic, lighter), Bytewax/Arroyo = stream-on-Kafka lane.
