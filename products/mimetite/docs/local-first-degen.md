# Local-First + Degen Router Doctrine (2026-11-12)

## Thesis
A router is an exchange. Leverage = offered load / capacity. Margin call = FIN.
Liquidation = CLOSE-WAIT. Forced selling = retry amplification.
`cost = slot_price * wait_time`; wait_time explodes when everyone holds.

**Local silicon is the default; cloud is the exception.**

## Rules
1. **Shed don't hold** — never hold a socket while waiting for a semaphore.
   Queue = ticket, not held conn. Shed <5ms if lane full/broken.
2. **Embeddings = spot, completions = margin** — embeddings NEVER through the
   completions 429 lane. bge-m3 direct to freeinference.org/v1 (200 in 0.157s,
   unlimited). mimetite /v1/embeddings returns 400 unknown_model.
3. **Pool <= downstream semaphore**; client idle < server idle; PEEK for FIN
   before reuse; close on recv()==b''.
4. **Race for first fill** — 8-way async race, first valid fill wins, never
   hold the losing lane.
5. **Exit early** — shed at waiting=1, not at circuit trip. Exit at $450, not $238.

## What changed (this session)
| Surface | Before | After |
|---|---|---|
| **kappa** (kappa.jsonc) | no local provider; freeinference/nvidia via :25193 | `bornite-local` provider (:25196, qwen2.5-3b, tool-call verified) |
| **tau** (config.yml, symlinked live) | default `freeinference/qwen3.6-35b` (cloud); no local | default `bornite-local/qwen2.5-3b`; `bornite-local/*` fallback chain → freeinference/qwen3.6-35b → nvidia → vc-lightning |
| **catalog** (data.ts → models.yml) | `bornite` empty shell @ :25100 (dead Go plane) | `bornite` → :25196, seed `qwen2.5-3b`, 16k ctx; regenerated all slices |
| **hermes** (config.yaml) | default `nim-lightning` (NVIDIA cloud) | default `bornite-local/qwen2.5-3b` (staged; restart to apply) |
| **hindsight** (prior) | cloud 429 semaphore | local lane (:25196), 0 conns to cloud |

## Live verification (all direct)
- kappa bornite-local/qwen2.5-3b → `KAPPA_OK` (114 tok/s)
- tau bornite-local/qwen2.5-3b → `TAU_OK`
- hermes bornite-local/qwen2.5-3b → `HERMES_OK`
- local lane tool-call: `finish_reason: tool_calls`, correct args
- hindsight: mcp 200, 0 conns to cloud :25193
- bornite catalog: `"bornite": ["qwen2.5-3b"]` @ :25196

## Notes
- tau config is the SSOT, symlinked as live (`~/.tau/agent/config.yml`).
- hermes default change is staged in config.yaml; hermes loads config at
  startup (restart via serve.sh to apply).
- The bornite Go plane (:25100, full model-swap fleet) remains gated on the
  chalcopyrite dependency + missing models — separate follow-up. The working
  raw lane (:25196) is the reachable local silicon today.