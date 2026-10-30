#!/usr/bin/env bash
# ==============================================================================
# PROOF: Ryzen 8700F AVX-512 — presence + real vectorized throughput delta.
# Self-bootstrapping: needs gcc (pacman -S gcc if missing). Copy-paste runnable.
# SCINTILLATION: verified claim +10, divergence +25.
#
# HONEST-BASELINE LESSON (caught live on first run): a single .c compiled twice
# proves nothing — gcc -O2 auto-vectorizes the "scalar" loop and the speedup
# reads 1.00x. The scalar baseline is a SEPARATE translation unit WITHOUT
# immintrin.h and WITHOUT -mavx512f; the vector build uses intrinsics.
# ==============================================================================
set -uo pipefail
SCORE=0
say() { echo "$1"; }
good() { say "  VERIFIED: $1"; SCORE=$((SCORE+10)); }
odd()  { say "  DIVERGENCE: $1"; SCORE=$((SCORE+25)); }

command -v gcc >/dev/null 2>&1 || { echo "bootstrapping gcc…"; sudo pacman -S --noconfirm gcc >/dev/null 2>&1; }

say "== scintillator/ryzen-avx512-proof =="
if /usr/bin/grep -qo avx512f /proc/cpuinfo; then good "avx512f in /proc/cpuinfo (Ryzen 8700F / Zen4)"; else odd "NO avx512f — the AVX-512 premise is false on this box"; fi

# ---- scalar translation unit (NO immintrin, NO avx512) ----
cat > /tmp/lap-scalar.c <<'EOF'
#include <stdio.h>
#include <time.h>
static float a[8192], b[8192], c[8192];
int main(void) {
    for (int i = 0; i < 8192; i++) { a[i] = 1.0f; b[i] = 2.0f; }
    struct timespec t0, t1;
    clock_gettime(CLOCK_MONOTONIC, &t0);
    for (int iter = 0; iter < 20000; iter++)
        for (int i = 0; i < 8192; i++) c[i] = a[i] + b[i];
    clock_gettime(CLOCK_MONOTONIC, &t1);
    // checksum sink: without consuming c[], gcc DCEs the whole loop and the
    // baseline reads 0.00ms (live-caught)
    float sum = 0; for (int i = 0; i < 8192; i++) sum += c[i];
    printf("%.2f %f\n", (t1.tv_sec - t0.tv_sec) * 1e3 + (t1.tv_nsec - t0.tv_nsec) / 1e6, sum);
    return 0;
}
EOF
# ---- vector translation unit (explicit AVX-512 intrinsics) ----
cat > /tmp/lap-vec.c <<'EOF'
#include <immintrin.h>
#include <stdio.h>
#include <time.h>
static float a[8192], b[8192], c[8192];
int main(void) {
    for (int i = 0; i < 8192; i++) { a[i] = 1.0f; b[i] = 2.0f; }
    struct timespec t0, t1;
    clock_gettime(CLOCK_MONOTONIC, &t0);
    for (int iter = 0; iter < 20000; iter++)
        for (int i = 0; i < 8192; i += 16) {
            __m512 va = _mm512_loadu_ps(&a[i]);
            __m512 vb = _mm512_loadu_ps(&b[i]);
            _mm512_storeu_ps(&c[i], _mm512_add_ps(va, vb));
        }
    clock_gettime(CLOCK_MONOTONIC, &t1);
    float sum = 0; for (int i = 0; i < 8192; i++) sum += c[i];
    printf("%.2f %f\n", (t1.tv_sec - t0.tv_sec) * 1e3 + (t1.tv_nsec - t0.tv_nsec) / 1e6, sum);
    return 0;
}
EOF

if gcc -O2 -fno-tree-vectorize -o /tmp/lap-scalar /tmp/lap-scalar.c 2>/dev/null &&
   gcc -O2 -mavx512f -o /tmp/lap-vec /tmp/lap-vec.c 2>/dev/null; then
  SCALAR=$(/tmp/lap-scalar); VEC=$(/tmp/lap-vec)
  SPEEDUP=$(/usr/bin/awk -v s="$SCALAR" -v v="$VEC" 'BEGIN{printf "%.2f", s/v}')
  say "  scalar(baseline)=${SCALAR}ms vec512=${VEC}ms speedup=${SPEEDUP}x"
  if /usr/bin/awk -v s="$SPEEDUP" 'BEGIN { exit !(s >= 2) }'; then
    good "AVX-512 real speedup ${SPEEDUP}x (>=2x)"
  else
    odd "AVX-512 speedup only ${SPEEDUP}x (<2x — throttling or miscompilation)"
  fi
else
  odd "gcc builds failed"
fi

echo ""
echo "SCINTILLATION SCORE: $SCORE"
exit 0
