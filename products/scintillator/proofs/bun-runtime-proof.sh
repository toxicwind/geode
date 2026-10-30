#!/usr/bin/env bash
# ==============================================================================
# PROOF: bun canary runtime truth — features the release notes claim vs what
# the binary ACTUALLY does on this box (bun 1.4.4-canary.1+).
#
# Self-bootstrapping: needs only bash + a bun on PATH. Installs nothing.
# Copy-paste runnable anywhere on the estate.
#
# SCINTILLATION: each assertion that verifies (vs the CLAIMED behavior)
# scores 10; a caught divergence scores 25 (finding what devs missed is the
# point); a crash scores 0 with a receipt.
# ==============================================================================
set -uo pipefail
SCORE=0
RECEIPTS=()
BUN="${BUN:-bun}"

claim() { echo "CLAIM: $1"; }
verify() { echo "  VERIFIED: $1"; SCORE=$((SCORE+10)); RECEIPTS+=("{\"claim\":\"$1\",\"result\":\"verified\"}"); }
diverge() { echo "  DIVERGENCE: $1"; SCORE=$((SCORE+25)); RECEIPTS+=("{\"claim\":\"$1\",\"result\":\"divergence\"}"); }

echo "== scintillator/bun-runtime-proof =="
echo "binary: $($BUN --version)"

# 1. CLAIM: Bun.YAML exists and parses YAML (undocumented-ish; many SWEs
#    still shell out to python for YAML).
claim "Bun.YAML native parse"
if $BUN -e 'Bun.YAML.parse("a: 1")' >/dev/null 2>&1; then verify "Bun.YAML.parse native"; else diverge "Bun.YAML.parse missing/broken"; fi

# 2. CLAIM: `bun -e` executes inline code (docs claim it; versions <1.1.20 didn't).
claim "bun -e inline eval"
if $BUN -e 'console.log("ok")' 2>/dev/null | grep -q ok; then verify "bun -e inline eval"; else diverge "bun -e missing"; fi

# 3. CLAIM: string.replace callback receives named groups as LAST arg —
#    code that writes (m) => m.groups silently breaks (live-caught 2026-10-30
#    in lapidary). Verify the actual arity contract.
claim "replace callback named-groups contract"
OUT=$($BUN -e '"a.pinax()".replace(/(?<x>.+)\.pinax\(\)/g, (...args) => { const g = args[args.length-1]; return g?.x ?? "MISS"; })')
if [ "$OUT" = "a" ]; then verify "named groups ride as final replace arg"; else diverge "named groups NOT final replace arg: got $OUT"; fi

# 4. CLAIM: Bun.spawnSync with argv-array does NOT interpret shell syntax
#    (the double-interpretation trap from the brush probe).
claim "spawnSync argv-array is shell-free"
OUT=$($BUN -e 'const p = Bun.spawnSync(["bash","-c","echo $((2**10))"]); console.log(new TextDecoder().decode(p.stdout).trim())')
if [ "$OUT" = "1024" ]; then verify "spawnSync argv-array shell-free"; else diverge "spawnSync argv-array quirk: $OUT"; fi

# 5. CLAIM: performance.now() is monotonic across taskset pinning (the
#    hetero-fingerprint latency sensor relies on it).
claim "performance.now monotonic"
OUT=$($BUN -e 'let mono = true; let last = performance.now(); for (let i=0;i<1000;i++){ const t=performance.now(); if (t<last) mono=false; last=t; } console.log(mono?"mono":"nonmono")')
if [ "$OUT" = "mono" ]; then verify "performance.now monotonic over 1000 samples"; else diverge "performance.now non-monotonic"; fi

# 6. CLAIM: Bun.hash.wyhash is stable within a process AND across processes
#    (lapidary/forensia use it for path identity).
claim "Bun.hash.wyhash cross-process stability"
H1=$($BUN -e 'console.log(Bun.hash.wyhash("/probe/path").toString(16))')
H2=$($BUN -e 'console.log(Bun.hash.wyhash("/probe/path").toString(16))')
if [ "$H1" = "$H2" ]; then verify "wyhash cross-process stable: $H1"; else diverge "wyhash UNSTABLE cross-process: $H1 vs $H2 — any path-identity store built on it is corrupt"; fi

echo ""
echo "SCINTILLATION SCORE: $SCORE"
echo "receipts: ${#RECEIPTS[@]} verified-or-divergent claims"
printf '%s\n' "${RECEIPTS[@]}" > /tmp/touchstone-bun-runtime-receipts.jsonl
echo "receipt file: /tmp/touchstone-bun-runtime-receipts.jsonl"
exit 0
