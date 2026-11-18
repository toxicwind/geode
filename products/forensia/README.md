# 🔮 Forensia

> **Hydration-integrity auditor** — poison-as-sensor for the pens Pens.

Forensia productizes the **conversation-poison pattern** documented on hosted
agent platforms (2026-10-30 dossier): a GC-less indirection layer + eager
hydration + conversation-scoped propagation turns one orphaned handle into a
permanent brick. The pattern is platform-independent. This product audits OUR
Pens for its local analogs and emits a **poison dossier**.

## The pattern ↔ our environment (the correlation)

| Pattern element (hosted platform) | Our environment's analog | Detector |
|---|---|---|
| Orphaned Everstore handle in conversation manifest | `artifact://N` refs in session JSONLs that no longer resolve in the session's `artifacts/` dir | `orphan-artifacts` |
| "Bulletin board never erases tickets" | `~/.tau/logs/http-400-requests/` (10.5k files) + `native-panic-*` (976 files), zero GC | `log-flood` |
| `latest-*` pointer frozen while sibling shards advance (failed-writer epoch) | mutable `latest*` indirection files stale vs shard mtimes | `split-brain-pointer` |
| Epoch fork (timestamp ↑, iteration reset = lineage fork) | `*-iN-*` shard naming with monotonic break | `epoch-fork` |
| Relative/hand-rolled config pointers | `PI_CODING_AGENT_DIR=.tau/agent` (relative!) in ambient env — cwd-dependent agent-dir split-brain | `agent-dir-split-brain` experiment |

## Usage

```bash
forensia                       # audit + human dossier (+ experiments)
forensia --json                # machine dossier (health-audit/MCP integration)
forensia --list-experiments    # show the experiments array with [x]/[ ]
forensia --enable <id>         # enable an experiment (persisted config)
forensia --disable <id>        # disable an experiment
```

Exit code: `0` clean, `1` poison found — GOAL-able, usable as a sensor.

## Experiments array

Every experiment is enable/disable-able and **A/B measurable**: `run(false)` is
the live variant, `run(true)` the control; numeric deltas are recorded in the
dossier, so enable/disable is a *tested difference*, never a flag with no
observable effect.

- **hetero-fingerprint** — real heterogeneous fingerprint, refactored from the
  archived WIP (`pens/wip/hetero-scheduler-poc`). Honest sensors only:
  RTX 3090 (genuine SM86) thermal/util/mem via nvidia-smi, Ryzen 8700F
  dispatch latency via taskset ping-pong (not the WIP's fake
  multiprocessing-spawn cost), freeinference fleet reachability as the
  node-health plane. Thermal ≥84 C or dispatch p95 >50 ms → escalate-lane
  routing report (the WIP's qwen3.6-35b→glm-5.3-flash rule, mapped to real
  lanes). **Never simulates a dead sensor** — the WIP's
  `except: return random.uniform(...)` was the poison pattern applied to
  sensing.
- **agent-dir-split-brain** — asserts `PI_CODING_AGENT_DIR` is absolute; the
  live relative override is reported as POISON.

## Layout

```
forensia/
  bin/forensia.ts        CLI: detectors + experiment wiring + dossier emit
  experiments/experiments.ts   the experiments array + config + A/B runner
  forensia.test.ts       real-behavior TDD: synthetic poison trees
  reports/               emitted dossiers (JSON, timestamped)
```

## Design rules (learned the hard way)

1. **Never simulate a missing sensor.** Report it missing. Plausible-looking
   garbage is worse than a gap.
2. **Reject relative config pointers loudly.** A relative override resolves
   per-cwd — every consumer sees a different world (split-brain).
3. **Audit yourself first.** Forensia's first live run was itself poisoned by
   the relative env var (scanned 0 sessions) — the auditor must refuse poisoned
   inputs, not adopt them.
4. **A/B or it didn't happen.** An experiment without a control is a claim.
