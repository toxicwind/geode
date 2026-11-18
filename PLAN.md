# Geode — pens Pens Consolidation Plan

**Date:** 2026-10-25 · **Status:** decided, executing
**Objective:** five uniform pens, one shape, no symlinks, no recursion — and
one honest inference plane inside them.

---

## 0. The pens becomes five uniform pens

```
/home/toxic/pens/
  pens/     the CONTROL PLANE — config, pitchfork, services, state, docs
  geode/      the INFERENCE PLANE — catalog, routers, local engine, auditors
  barn/       OPS TOOLING — thresher, weave, secretsmith, pens-ops
  ranch/      FLEET & MODEL COMPONENTS
  olympus/    GREEK-NAMED PRODUCTS — tau, kappa, sigma, keryx, muse, …
```

Every pen has **exactly** this shape (the scaffold contract):

```
pens/<pen>/
  .gitignore    kitchen-sink `*` + whitelist (submoduleless doctrine)
  README.md     generated — role, member table, ports, languages
  LICENSE
  package.json
  mise.toml
  AGENTS.md
  bin/          entrypoint symlink surface -> ~/.local/bin
  products/     peer standalone checkouts (auto-ignored, never tracked)
  docs/         pen-owned documentation
```

### Why this solves the recursion

Today `pens/` is the control plane **and** holds git-tracked symlinks
(mode `120000`) into the thing it governs:

```
pens/ranch    -> /home/toxic/pens/ranch
pens/olympus  -> /home/toxic/pens/olympus
pens/ops/bin  -> /home/toxic/pens/ranch/forge/ops/bin
```

191 live references depend on that. After the refactor there is **no mirror
at all**: the control plane is `pens/pens/`, its products are
`pens/*/products/*/`, and every reference is a **real path**. The recursion is
gone because the pen *is* the thing — not a mirror of it.

### Why product code moves out of `pens/`

`pens/AGENTS.md` already says *"Nothing stores product code under
`pens/`, ever."* It is **not true today**: `pens/` holds `src/`,
`packages/`, `services/`, `stack/`, `lib/`, `bridge/`, `ops/`, `engines/`,
and `grasp-hub/`. Those become products under the right pen.

### The placement rule

> **A thing belongs in the pen whose *theme* it serves.**
> - inference (catalog, routers, local engine, auditors, EAP engine) → **geode**
> - ops tooling (thresher, weave, secretsmith, nativelink, pens-ops) → **barn**
> - fleet/model components, agents, dashboards, research → **ranch**
> - Greek-named products → **olympus**
> - the control plane itself (config, pitchfork, service state) → **pens**

### History is not sacred

The priority is the **final GitHub product** — five clean pens, each product
a standalone repo with a sensible layout. Where preserving history would
prevent organisation, history is dropped. Each product ships as a **new
standalone repo** under `toxicwind/`; superseded repos and checkouts are
archived and deleted.

---

## 1. Why the inference plane is broken (verified findings)

- **one service is registered under several names** — in the *catalog*:
  `hodos` (`:25193`) owns a nested modelProvider `flock` pointing at **the
  same URL as its own parent**; in *cuttinggate's separate provider map*:
  `"flock"`, `"hodos"`, and `"custom/bodybuilder"` all → `:25193`.
- **two registered names point at dead ports** — `omniroute` (`:20130`),
  `vans` (`:20128`).
- **one live service is absent from the catalog** — herd/bornite at `:25100`
  is not in `mimetite/src/data.ts` at all.
- **the canonical front door is stopped** — cuttinggate (`:25200`) is down
  while `hodos` (`:25193`) serves 555 models.
- **the strategy engine exists in three divergent copies** — 1832 / 1320 / 934
  lines, only one with tests.
- **the target language was never adopted** — Rust (hodos proxy) and Go
  (herd, agele) are unfinished WIP conversions shadowing the Bun originals.
- **product code lives outside the pens** — `pens/grasp-hub`, plus the
  `pens/ranch` and `pens/olympus` mirrors.

---

## 2. Members and names

| Mineral | Was | Role | Port | Lang |
|---|---|---|---|---|
| **mimetite** | `pinax` | provider-catalog SSOT (47 defs) | — | Bun/TS |
| **chalcopyrite** | `cuttinggate` | front door — strategy, breakers, keypools, ledger | `:25200` | Bun/TS |
| **rhodochrosite** | `hodos` | multi-provider gateway (555 models / 14 flocks) | `:25193` | Rust→Bun |
| **bornite** | `herd` + `agele` | local VRAM engine | `:25100` | Go→Bun |
| **galena** | `atlas` | catalog auditor (is the catalog true?) | — | Bun/TS |
| **azurite** | `grasp-hub` | GraSP skills engine (147 skills, DAG compiler, MCP) | — | Node→Bun |
| **danburite** | `theta` | **PRIVATE** EAP provider engine (the `google` provider's engine) | — | Bun/TS |

### Why each name
- **mimetite** — from Greek *mimētēs*, "imitator"; named for its near-identity
  with pyromorphite. The catalog records what providers *imitate* (claim to
  serve); only lab-grade testing tells the truth. A derived record of
  something primary.
- **chalcopyrite** — CuFeS₂, the primary copper ore; Greek *chalkos* (copper)
  + *pyros* (fire). The gate that sorts and reduces ore by fire.
- **rhodochrosite** — MnCO₃, rose-red, Greek *rhodón* (rose) + *chrōsis*
  (coloring). A **hydrothermal vein mineral** — it forms in the vein/channel
  where the ore runs, which is exactly a gateway's job. Colorado state
  mineral (2002); Argentina's national gemstone.
- **bornite** — Cu₅FeS₄, *born inside* the ore body. The one engine that came
  out of both lineages (herd ∪ agele) rather than one of them.
- **galena** — PbS, the classic reference ore, dense and metallic: the
  yardstick everything else is assayed against.
- **azurite** — Cu₃(CO₃)₂(OH)₂, the intense blue copper carbonate; the deep
  azure of the blueprint from which a capability is built.
- **danburite** — BaCa(SO₄)₂, a rare barium calcium sulfate prized for its
  gemmy brilliance, found in only a handful of places. The rare, precious,
  deliberately-kept-rare capability.

### Explicitly OUT of the pen (untouched)
`tau`, `kappa`, `sigma` (stays Greek), `keryx`, `muse`, `stoat` (holds the one
true TS strategy engine), `drover` (VS Code client).

**`theta` → `danburite` enters the pen while staying private.**
`@pens/theta` is a **private, UNLICENSED** package holding the pens's
confidential EAP (Gemini Tool Retrieval) integration — the engine behind the
`google` provider. It is a **library**, not a service: no daemon, no port, no
catalog entry of its own; consumers reach it *through* the router and the
keypool (`:25109`).

**Privacy rules for danburite (binding):**
- Its repo stays **private** — `toxicwind/theta` is confirmed
  `"isPrivate": true` on GitHub. The rename is a **rename + relocation only**:
  the repo keeps its private visibility, its full contents, and its integrity.
  It is **never** made public, **never** pushed to a public remote, and
  **never** mirrored into a public pen's tracked files.
- The geode pen's `.gitignore` (kitchen-sink `*`) means danburite's checkout
  is **not tracked** by the pen — the pen cannot leak it even accidentally.
- **Its README stays exactly as it is — non-obfuscated, full-grade.** The
  confidentiality is carried by the **private repo**, not by hiding the
  content. The README keeps its full detail, its deeplinks, and its
  `## Confidentiality` section verbatim. Only the package/product name changes
  and its paths move under the pen. **No redaction, no euphemism, no
  "cute obfuscation"** — that would degrade a private doc for no security
  benefit and would break its own deeplinks.
- The **geode pen's** README is a different document and stays public-facing:
  it lists danburite by **name and role only**. It does **not** copy
  danburite's internals.
- The catalog entry `google-eap` (`:25109`) points at the **keypool**, not at
  danburite. The rename does not change the catalog's `google-eap` entry.
- Because the package is `private: true` + `UNLICENSED`, its LICENSE stays
  UNLICENSED and is **not** replaced by the pen's LICENSE.

### Danburite's real integration surface

`@pens/theta` exists as **two checkouts of the same private repo**:
- `pens/packages/theta/` — the **control-plane copy**, which is what
  `pens/services/keygate/package.json` depends on
  (`"@pens/theta": "file:../../packages/theta"`).
- `olympus/products/theta/` — the **olympus checkout**.

The consumer chain is **keygate → `@pens/theta`**, and keygate is the
`:25109` wire bridge. The rename must cover **both** checkouts and keygate's
dependency entry.

**New configs and feature flags are expected**: the rename moves product code
to new paths, so any config naming the old path (pitchfork stanzas,
`ports.env`, keygate's `package.json`, tau/kappa model configs) needs a new
entry, and a feature flag is warranted so the old path is retired only after
the new one is verified live.

---

## 3. Tooling (house-sanctioned — do not hand-roll)

| Tool | Where | Used for |
|---|---|---|
| **rename-roundup** | `sovereign/skills/rename-roundup/rename.ts` (Bun) | **Every** rename. Pairs-file driven (`substr:` / `word:` / `prefix:` / `exclude:`), rewrites contents **and** filenames via `git mv`, touches only `git ls-files` tracked files, skips lockfiles/build outputs, `--dry-run` previews, `--commit` wraps one atomic commit. Pairs files live at `pens/docs/<name>-rename.pairs` (precedent: `hodos-rename.pairs`, `feedlot-rename.pairs`). |
| **weave** | `pens/barn/weave` (**stays where it is**) | Entity-level semantic merge (Ataraxy Labs). Used for the **bornite union merge** and for **re-syncing geode products against upstream** — it merges functions/classes, not lines. Rust workspace; `bin/check` is the no-compile self-test. |
| **readme-maximal** | `sovereign/skills/readme/SKILL.md` | Every product README: badges first, hero, feature bullets, diagram, 3-command quick start, architecture, license+security. |
| **readme-audit-first** | `sovereign/skills/readme-audit-first/SKILL.md` | Audit every factual claim against source **before** editing prose; log mismatches; never invent. |
| **nativelink** | `pens/barn/nativelink` + `pens/config/nativelink/nativelink.json5` | The pens's **content-addressed store (CAS)** — the build lane. Geode products build through the existing pens lanes, **never a bespoke per-product build system**. |
| **forge release lane** | `pens/ranch/forge` (`forge-deploy`, release lane) | The pens's deploy/release path. New geode repos must be wired into it, not around it. |

### The scaffold generators (built for this refactor)

| Tool | Where | Purpose |
|---|---|---|
| `make-pen.ts` | `pens/barn/pens-ops/scaffold/bin/` | Instantiate a pen from the template. **`--force` rewrites METADATA only — there is no code path that deletes a pen** (the first version had `rm -rf` and destroyed `pens/barn`; that is now impossible by construction). |
| `manifest-gen.ts` | `pens/barn/pens-ops/scaffold/bin/` | Regenerate `pens-ops/bin/manifest.yaml` from the pens' actual filesystem. Only writes the manifest; `--apply` additionally installs `~/.local/bin` links. |
| `readme-gen.ts` | `pens/barn/pens-ops/scaffold/bin/` | Regenerate each pen's README from that pen's actual product set. |

### The pens control plane (what a daemon rename actually touches)

`/home/toxic/pens/pens` is the control plane — **not** a product home.
- **197 daemons** in `pitchfork.toml`, grouped `[groups.mesh|core|agents]`.
- `pitchfork.d/*.toml` — the **per-daemon fragments**; `pitchfork.toml` is the
  **monolith and the live truth** (two truths is a bug).
- `config/ports.env` — the **numeric port SSOT** (`UPPER_SNAKE_*_PORT=25xxx`).
- Daemon ids use **dashes, never underscores**; `config/naming-audit.py`
  checks it.
- **mise** lives at `pens/.mise.toml` (jj+git colocated verbs) plus
  `pens/mise/conf.d/*.toml` and `pens/mise/tasks/` (`status`, `health`,
  `doctor`, `svc-check`, `pens-gate`, `mesh-config`, `models`, …).
- **pitchfork does NOT hot-reload** `pitchfork.toml` — a daemon edit changes
  nothing until the daemon is re-registered/restarted. Stale-definition
  symptom: `pitchfork` shows `errored` while the old orphan still answers
  `/health` 200.
- The retired `bun run scripts/generate.ts` must **never** be run.

---

## 4. The duplicate cleanup (the actual bug)

### 4.1 Catalog identity — `mimetite/src/data.ts`

**Measured by importing the module, not by regex:** the catalog has **47
top-level providers with ZERO top-level baseUrl collisions**. The "four names
for one service" claim was wrong — it conflated the catalog with cuttinggate's
*separate* provider map. The real defects:

| # | Entry | baseUrl | Defect |
|---|---|---|---|
| 1 | `omniroute` (top-level) | `:20130` | **dead port** — service renamed to hodos |
| 2 | `hodos` → modelProvider `flock` | `:25193` | **same URL as its own parent** — self-referential |
| 3 | `hodos` → modelProvider `cuttinggate` | `:25200` | **stopped daemon** (the future front door) |
| 4 | — | `:25100` | **live local engine, MISSING from the catalog entirely** |

`flock` is a **nested modelProvider**, not a top-level provider, and
`bodybuilder` is not in the catalog at all — it lives in cuttinggate's own
`src/config.ts` provider map (`"flock"`, `"hodos"`, `"custom/bodybuilder"`
all → `:25193`). Both surfaces need cleanup; they are different files.

The four LOCAL top-level providers today:
`kimi-auto :25153`, `omniroute :20130` (dead), `hodos :25193`,
`google :25109` (the keypool EAP bridge).

**Target state:** one service = one registered identity.

- remove `omniroute` (`:20130`, dead)
- **add `bornite` (`:25100`)** — the live local engine, currently absent
- keep `hodos` (`:25193`) and `cuttinggate` (`:25200`)
- `google-eap` (`:25109`) is **not** renamed: `:25109` is the **keypool** —
  the EAP wire bridge. The engine behind it is the private package
  `@pens/theta`, a library, not a service and not a catalog entry.
- the `hodos.cuttinggate` **modelProvider** stays — it is a declared child of
  one provider, disambiguated by path, which the
  `provider → modelProvider → model` hierarchy is designed for.
- the `hodos.flock` modelProvider (same URL as its parent) is the one to
  collapse — it is a self-referential duplicate.

**Guard:** a dup-check script groups every registered name by `baseUrl` and
**fails** if any URL carries >1 identity (modelProviders of one provider
excepted), and asserts the expected present/absent names. Wired into the
existing `generated/` sync-test pattern so drift fails the suite.

### 4.2 Cuttinggate's provider map — `chalcopyrite/src/config.ts`

`"flock"`, `"hodos"`, and `"custom/bodybuilder"` all point at
`http://127.0.0.1:25193/v1` — one service, three names. Collapse to one.

### 4.3 Strategy engine — one copy

| Copy | Lines | Has tests | Verdict |
|---|---|---|---|
| `stoat/pens-router-ts/router_strategy.ts` | 1832 | ✅ | **canonical** (source of truth) |
| `cuttinggate/src/strategy/router_strategy.ts` | 1320 | (vendored) | cut over → delete |
| `hodos/routers/strategies/router_strategy.ts` | 934 | ❌ | cut over → delete |

Exactly one `router_strategy.ts` pens-wide, md5-equal to the stoat original.
`stoat/` itself is **not moved** — it keeps the original (denylist).

### 4.4 Bornite union — lose nothing

`herd` (Go, running) ∪ `agele` (Go, parked). Neither is a superset.

**From herd:**
- `internal/flock` (the Oct 19 roost→pinax work)
- `internal/astmatrix/live_catalog.go`, `providers_generated.go`,
  `ratelimit.go`, `registry.go`
- `cmd/herd-validate`
- the **live** config `pens/config/herd.yaml` (60 KB) and the real engines
  `pens/engines/herd/{beellama,ik_llama,llama-cpp-turboquant}` (binaries present)

**From agele:**
- `cmd/agele-launcher`, `cmd/agele-plane`
- `internal/astmatrix/astmatrix_config.yaml`, `circuit.go`, `coalescer.go`,
  `metrics.go`
- the `modelMap` alias system
- **all 19 agele-only remote aliases**: gemini-eap, gemini-eap-openai, kimi,
  kimi-code, kimi-k2, kimi-k3-nim, nim-kimi, openrouter-free, openrouter-ling,
  openrouter-pool, oracle-judge-a/b/c, pollinations-free, hf-free, mistral,
  long, medium, small

**Dead paths to kill:** agele's config points at
`/home/toxic/sovereign/{config,engines,data}` — a husk containing only
`skills/`. Every one of those paths is rewritten to the live `pens/` locations.

The union merge uses **weave** (entity-level), so upstream llama-swap/herd
re-syncs do not produce line-level conflicts.

---

## 5. External surfaces this plan must not break

| Surface | Detail | Impact |
|---|---|---|
| **Tailscale serve** | `pens.tailc9ac71.ts.net:8443` → `http://127.0.0.1:25193` (**rhodochrosite** exposed on the tailnet); `:8444` → `:25218`; `:443` → `:25217` | serve state is keyed by **port**, so it survives the rename — but `pens-tailscale/serve-config.json` + `funnel.sh` + `reconcile-funnel.sh` must reference the new paths/ports where they name products |
| **Control-plane UI** | `range/apps/delendai-control-plane/src/data/services.ts` — a **fixtures** grid listing `herd :25100` ("model gateway / llama-swap alias shims"), `model-guard :25101` | the fixtures + `surface-registry` packages read `ports.env`; names become the minerals, `kind: 'inference'` rows re-labelled |
| **`config/ports.env`** | `HERD_PORT=25100`, `HODOS_PORT=25193`, `CUTTINGGATE_PORT=25200` | the **numeric SSOT**. New names get new vars (`BORNITE_PORT`, `RHODOCHROSITE_PORT`, `CHALCOPYRITE_PORT`); old vars are **retired**, not aliased |
| **`pitchfork.toml`** | the **monolith is live truth**. Daemons: `herd`, `hodos`, `cuttinggate`, `vansrouter`, plus group membership | daemon ids use dashes. Renamed ids + `depends` + group membership updated in the monolith, kept consistent in `pitchfork.d/` |
| **`~/.local/bin`** | the **PATH surface** — every product link is a symlink straight into `pens/`; `pens/barn/pens-ops/bin-verify.sh` (generated manifest) is the canary; a broken link is **FAIL, never WARN** | manifest regenerated first, then links repointed, then `bin-verify.sh` must exit 0 |
| **kimi-auto-shim** | `pitchfork.toml:636` runs `pens/config/herd.d/alias-shim.py` — a *herd* config dir with alias shims | moves with bornite; the alias-shim script and `herd.d/` dir get the mineral name |
| **Zed / VS Code / OpenFang** | clients follow `:25100` SSOT via `/v1/models` + `/models/sse` | **port-stable**: clients bind to ports, not product names. Every port stays identical → client-side breakage is zero |
| **`pens/herd.d` / `pens/config/herd.yaml`** | canonical live configs for the local engine | move to the bornite names, paths rewritten |

**Port stability is the invariant.** Every port stays exactly where it is
(`:25100`, `:25193`, `:25200`). Only *names, paths, and identities* change.

---

## 6. The `pens/` symlink problem (separate, real)

`/home/toxic/pens/pens/AGENTS.md` says the mirrors are **"GONE (deleted in the
reorg; they were symlinks into `pens/`)"** — and *"Nothing stores product code
under `pens/`, ever."* The first is **false** (they exist, git-tracked as
mode `120000`); the second is **false** (product code lives there). After the
refactor both become true.

---

## 7. Execution order

Each step is independently verifiable; the pens stays live throughout.

| # | Step | Verification |
|---|---|---|
| **1** | **Tooling** — `make-pen.ts`, `manifest-gen.ts`, `readme-gen.ts` in `pens-ops/scaffold/bin/` | each runs; `make-pen --force` provably does not delete a pen |
| **2** | **Pen skeletons** — 5 pens, each `products/` + `docs/` + metadata | `ls pens/*/products` |
| **3** | **Control plane** — move `pens/` state into `pens/pens/`; remove the `pens/ranch` + `pens/olympus` mirrors; rewrite 191 refs | `find pens -maxdepth 1 -type l` → no mirrors; no live ref to `pens/ranch` |
| **4** | **Product moves** — pens `packages/`+`services/` → `pens/pens/products/`; ranch → `pens/ranch/products/`; barn → `pens/barn/products/`; olympus → `pens/olympus/products/`; grasp-hub → `pens/geode/products/azurite` | each pen's `products/` populated; daemons still healthy |
| **5** | **mimetite** — new repo from pinax; catalog identity cleanup (§4.1); dup-check guard; regenerate `generated/`; push | `bun test` green; dup-check passes; `bun run build` leaves `generated/` clean |
| **6** | **Strategy engine** — adopt stoat's copy as canonical; cut over + delete the other two | exactly one `router_strategy.ts` pens-wide; md5 matches stoat |
| **7** | **bornite** — union merge of herd ∪ agele with weave (§4.4); repoint dead `sovereign/` paths; keep `:25100` + live config + engines | `bun test` green; `:25100/health` 200; all 19 agele aliases present |
| **8** | **chalcopyrite** — new repo from cuttinggate; provider-map collapse (§4.2); start `:25200` as the front door | `:25200/health` 200; `GET /v1/models` non-empty |
| **9** | **rhodochrosite** — new repo from hodos; **port the Rust proxy runtime to Bun/TS** against the canonical strategy engine | `:25193/health` 200; parity vs. the Rust behaviour on the same request |
| **10** | **galena** — turn the 2 orphan atlas scripts into a real auditor product | runs; audits the live catalog against what the gateways serve |
| **11** | **azurite** — new repo from grasp-hub; **port GraSP + skill corpus to Bun/TS** | runs on Bun; skill count preserved (147); MCP surface preserved |
| **12** | **danburite** — rename theta; **repo stays private and full-grade**; update both checkouts + keygate's dependency | `isPrivate: true`; README/deeplinks intact |
| **13** | **Wiring** — `ports.env` (new vars, old retired), `pitchfork.toml` daemon ids + groups + `depends`, `config/herd.d` → `config/bornite.d`, `~/.local/bin` links + manifest, control-plane UI fixtures | `bin-verify.sh` exits 0; `pitchfork status` shows all; all three ports 200 |
| **14** | **Docs** — update `pens/AGENTS.md` (naming section), `docs/CONTROL_PLANE.md`, `docs/ARCHITECTURE.md`, `docs/config-naming-conventions.md`, `docs/daemons.md` | every doc claim traces to live code (audit-first) |
| **15** | **Archive + delete** — archive old repos (keep refs), delete old checkouts, remove retired bin links + manifest entries | old dirs gone; no dangling links; `bin-verify.sh` still 0 |
| **16** | **Verification** — run every command in §9 | all pass |

---

## 8. Success criteria (binary, evaluator-verifiable)

1. `pens/geode/` exists with `products/{mimetite,chalcopyrite,rhodochrosite,bornite,galena,azurite,danburite}/`
   — each a **real standalone checkout** with its own git repo and a README
   stating role, port, and language. **No top-level aliases** in `pens/geode/`
   beyond `products/`; no product symlinked to another location.
2. Each of the seven is a **new standalone repo** under `toxicwind/`. The old
   repos/checkouts are **archived and deleted**; every live reference is rewritten.
3. **No symlinks** in the geode layout: no `pens/geode/<mineral>` aliases, no
   `products/<mineral> ->` links, no `pens/olympus` / `pens/ranch`
   mirrors. The control plane references pens by **real path**.
4. **Exactly one** `router_strategy.ts` pens-wide, byte-identical (md5) to
   the stoat original. The other two copies are **deleted**.
5. `mimetite/src/data.ts`: `omniroute` is gone; `bornite` (`:25100`) is
   present; the self-referential `hodos.flock` modelProvider is collapsed;
   `google-eap` (`:25109`, the keypool) is unchanged. A dup-check script
   groups identities by `baseUrl` and **fails** if one URL carries >1
   identity.
6. All routers live under their mineral names as pitchfork daemons with
   **unchanged ports** — `:25100` bornite, `:25193` rhodochrosite,
   `:25200` chalcopyrite — each answering **HTTP 200** on `/health`;
   `pitchfork status` shows them running; `ports.env` carries the new
   `*_PORT` vars; `bin-verify.sh` **exits 0**.
7. The **bornite union preserves the union**: herd's `internal/flock`,
   `live_catalog.go`, `providers_generated.go`, `ratelimit.go`, `registry.go`
   **and** agele's `cmd/agele-launcher`, `cmd/agele-plane`,
   `astmatrix_config.yaml`, `circuit.go`, `coalescer.go`, `metrics.go`,
   `modelMap` alias system, and **all 19** agele-only remote aliases are
   present in the merged tree.
8. **No dead `sovereign/` path** remains in any geode product.
9. **Bun/TypeScript is the implementation language** for every geode
   product's runtime; the Rust and Go WIP conversions are ported back to Bun
   and pass their tests.
10. **Every affected test suite passes** and `bun run build` regenerates
    `generated/` with **no diff**.
11. **danburite's repo remains private** (`isPrivate: true` at every step),
    full-grade and unredacted.
12. Everything **committed and pushed**; no dirty tree in any geode product;
    no leftover tmp workspaces.

---

## 9. Verification (binary, executable)

```bash
# pen shape
ls -d /home/toxic/pens/geode/products/{mimetite,chalcopyrite,rhodochrosite,bornite,galena,azurite,danburite}
ls /home/toxic/pens/geode/                      # metadata + products/ only, no aliases
git -C /home/toxic/pens/geode ls-files          # metadata only — no products tracked

# no mirrors
find /home/toxic/pens/pens -maxdepth 1 -type l     # no pens/ranch, no pens/olympus
grep -rn '/home/toxic/pens/pens/ranch' /home/toxic/pens/pens/pitchfork.toml /home/toxic/pens/pens/config/ 2>/dev/null \
  | grep -vE '\.bak|\.off-|/logs/'                                  # → no live refs

# bin surface
bash /home/toxic/pens/barn/pens-ops/bin/bin-verify.sh            # → 0 FAIL
for l in /home/toxic/.local/bin/*; do [ -L "$l" ] && [ ! -e "$l" ] && echo BROKEN; done   # → none

# live routers
curl -sf http://127.0.0.1:25100/health && echo ok  # bornite
curl -sf http://127.0.0.1:25193/health && echo ok  # rhodochrosite
curl -sf http://127.0.0.1:25200/health && echo ok  # chalcopyrite
pitchfork status | grep -E 'bornite|rhodochrosite|chalcopyrite'

# one strategy engine
find /home/toxic/pens -name 'router_strategy.ts' -not -path '*/node_modules/*'   # → exactly one

# no dead paths
grep -rn 'sovereign/' /home/toxic/pens/geode                                      # → no matches

# per product
cd /home/toxic/pens/geode/products/<m> && bun test && bun run build && git status --short  # → clean
```

---

## 10. Boundaries

**ALLOWED** — creating `pens/*/` and moving products into them; editing the
seven geode products; editing `pens/pitchfork.toml`, `pens/pitchfork.d/*`,
`pens/config/ports.env`, `pens/config/*.yaml` for geode members;
`~/.local/bin` symlinks + the pens-ops manifest; `pens/AGENTS.md` and
pens docs; creating and deleting fast tmp workspaces under `/tmp`.

**DENYLIST** — `tau`, `kappa`, `sigma`, `keryx`, `muse`, `stoat`, `drover`
product trees; `olympus` products other than `hodos`/`pinax`/`theta`; `ranch`
products other than `herd`; `barn` products other than `pens-ops`;
`awrawr-mcp.service`; secrets/keys content (never committed, never echoed);
the retired `bun run scripts/generate.ts`; client-side config for Zed,
OpenFang, VS Code, or the MCP clients.

**danburite (ex-theta) — confidentiality rules within an allowed rename:** its
repo must **remain private** at every step and must never be pushed to a
public remote. Its README, deeplinks, and `## Confidentiality` section stay
**intact and unredacted** — confidentiality comes from the private repo, not
from obfuscation. This is a **rename and relocation only** — no behavioural
change, no feature work, no doc rewrite beyond the package name and paths.

**PORT/DAEMON policy** — additive-only; never remove or disable a peer daemon
without an explicit order. **Every port keeps its number.** During cutover the
incoming daemon must be healthy before the outgoing alias is retired.
Supervised services are restarted after any binary swap.

---

## 11. Stop conditions

HALT and surface to the human if: (a) a rename would break a live
client-facing endpoint that cannot be aliased safely; (b) the bornite union
surfaces a genuine semantic conflict between herd and agele code that cannot
be resolved by keeping both under distinct names; (c) porting a Rust/Go module
to Bun would require redesigning its behaviour rather than translating it;
(d) any operation would require force-pushing a shared branch or discarding
uncommitted work belonging to another lane; (e) a required credential or
upstream private repo is unreachable.

No time/turn cap: keep going until the criteria are met. Work in fast tmp
workspaces; commit and push per product as each lands, forward-only, never
force-push main without a backup ref.

---

## 12. Incident log

**2026-10-25 — `make-pen --force` destroyed `pens/barn`.** The first version
of the pen generator did `rm -rf <pen>` under `--force`. It was run against
`pens/barn`, deleting 13 products (archguard, chute, corral, flatbread,
thresher, gemini-mcp, lookout, nativelink, rosec, thresher, weave, weave-sub,
scripts) and the 127-file `pens-ops` bin surface — which broke 53
`~/.local/bin` symlinks. barn's products were never git-tracked (kitchen-sink
ignore), so git could not restore them.

**Recovery that worked:**
- products → `pens/ranch/barn/<product>/` (tracked in the ranch repo);
  `corral`/`fanout`/`thresher` actually live at `pens/ranch/<product>/`.
- pens-ops bin surface → `pens/.cache/delendai/.worktrees/kappa-pens-reorg-tau-phase5-tau-linux-x64/bin/`
  (127 files: delend-quick, delend-code-race, run-fast, bash-2s-shim.sh,
  manifest.yaml, bin-verify.sh, …).
- compiled binaries (`ffs`, `hashline`) → `archive/home-dirs-2026/.local/bin/`.
- `pens-projects/` carries `bin/manifest.yaml` + `bin-verify.sh` + most ops scripts.
- `bin-verify.sh` resolves manifest `dir:` relative to `SOV=/home/toxic`, so
  sovereign-era `dir: bin` must become `dir: pens/barn/pens-ops`; manifest
  link names must NOT carry a `~/.local/bin/` or `bin/` prefix (double-resolves).
- 11 links whose targets were dead everywhere were **removed** (retired
  products are deleted, not relinked).

Result: 53 broken → 0 broken; `bin-verify.sh` → 30 ok, 0 FAIL. The generator
was rewritten so no code path can delete a pen.
