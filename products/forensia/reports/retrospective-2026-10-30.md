# Session retrospective dossier — 2026-10-30 (tau @ awrawr-pc)

## 1. Poison-pattern correlation table (hosted-platform → our estate)

| Pattern element | Our analog | Detector/product |
|---|---|---|
| Orphaned Everstore handle | `artifact://N` refs unresolvable in session artifacts dir | forensia `orphan-artifacts` |
| Bulletin board never erases tickets | `http-400-requests` (10.5k) + `native-panic-*` (976), zero GC | forensia `log-flood` |
| latest-* frozen pointer (failed-writer epoch) | stale `latest*` vs advancing shards | forensia `split-brain-pointer` |
| Epoch fork (timestamp↑, iteration↓) | shard-name lineage breaks | forensia `epoch-fork` |
| Relative config pointer | `PI_CODING_AGENT_DIR=.tau/agent` ambient — cwd split-brain | forensia experiment + poison guard |
| Fabricated sensor data | "weekly-exhausted" config comment vs live 200s | forensia rule: never simulate; scintillator proofs |
| Schema failures as poison | ask/squawk/gh/YAML/bun arity failures | **cleavage** (learn/goniometer/payload) |

## 2. Brush-core divergences (fork acceptance criteria, tau test.failing)

EXIT traps dropped; `exec N>file` unsupported; `history -c` errors into output;
nested `$()` error rc swallowed; extglob `+(…)` ignored after shopt; fake
BASH_VERSION. Fork target: `crates/vendor/brush-core`. Parity suite:
`packages/coding-agent/src/tools/brush-bash-parity.test.ts`.

## 3. Cutover receipts

- Fork storm fixed: auto-join TAU_DAEMON_CHILD guard (90+ procs/min → 0). Commit 30dca32d1c.
- Bun 1.4.4: literal virtual-module import required (non-literal dynamic imports no longer statically replaced). Same commit.
- Deny gate: identity-resolved (PATH-escape dead) + routed messages (no config-stripping advice). bdfaf1cc72.
- Pens: +dedicated, +forge, +nomenclator (make-pen.ts fixed: await-in-sync, PENS_ROOT walk-up).
- lapidary cutover: pairs→lapidary complete (.pairs→.lapidary, 0 leftovers; peers' faceter fork folded forward). 4667d4d.
- spine MVP: squawk-ws watch + kafka durable receipts (:25144 verified) + estate-chat relay; emit seq 80; WS-frame≠HTTP-send learned. a346da3.
- EMR verdict: Ray (10x receipt: Amazon exabyte Spark→Ray, 91% cost gain); hardware plane 3090 SM86 24GB + Ryzen 8700F AVX-512, dispatch p95 0.7–1.9ms live.

## 4. Pages audit

200 repos, exactly 2 Pages-enabled (agentic-moment-2026 legacy/built;
codeflux-patchling workflow/no build). github.io opt-in ONLY — doctrine in root AGENTS.md.

## 5. Meta-lessons (KB-bound)

1. Probe, don't guess — and probe YOUR OWN harness (bash double-interpretation, wrong ports 9092≠25144, WS≠HTTP send shape each cost a cycle).
2. Pseudo-subagents write concurrently: fold forward, never overwrite; re-read before re-edit (violated twice, cost two cycles).
3. Error messages are context: never advise agents to strip guards.
4. Vacuous assertions (un-awaited promises, blanket table rules) are fake-green — the worst failure mode; caught twice.
5. gh credential: keyring GH_TOKEN works; gh auth default token INVALID.

## New pens topology (post-session)

pens/{estate,geode,barn,ranch,olympus,dedicated,forge,nomenclator,ergasterion,...}
- dedicated: dedicated-server-ops (deploy plane)
- forge: router/flock-proxy, codeflux-patchling, anvil (mutation plane)
- nomenclator: names/aliases/injection master (4 products to seed)
- geode: +lapidary, +forensia, +scintillator, +cleavage, +infusion, +spine
