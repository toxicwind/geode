#!/usr/bin/env bash
# infusion — the bash autoloader leg (mirrors the kairos BASH_ENV pattern).
# Sourced via BASH_ENV (every non-interactive bash on the estate) or manually.
# Never fails loudly: a missing product must degrade to a no-op, not break
# every bash spawn on the box (the kairos lesson — BASH_ENV is hot path).
INFUSION_ROOT="${INFUSION_ROOT:-/home/toxic/pens/geode/products/infusion}"

# cleavage helpers — schema knowledge in every bash, zero cost when absent.
if [ -x "$INFUSION_ROOT/../cleavage/bin/cleavage.ts" ]; then
  cleavage() { /home/toxic/.bun/bin/bun "$INFUSION_ROOT/../cleavage/bin/cleavage.ts" "$@"; }
fi

# scintillator helpers — run a proof without remembering its path.
if [ -d "$INFUSION_ROOT/../scintillator/proofs" ]; then
  scintillate() {
    local proof="$1"; shift
    /usr/bin/bash "$INFUSION_ROOT/../scintillator/proofs/$proof.sh" "$@"
  }
fi

# lapidary — renames without the full path.
if [ -x "$INFUSION_ROOT/../lapidary/bin/lapidary.ts" ]; then
  lapidary() { /home/toxic/.bun/bin/bun "$INFUSION_ROOT/../lapidary/bin/lapidary.ts" "$@"; }
fi

# GUARD: never let infusion recurse (kairos RUN_FAST_ACTIVE doctrine).
export INFUSION_ACTIVE=1
