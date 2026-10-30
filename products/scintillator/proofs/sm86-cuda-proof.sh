#!/usr/bin/env bash
# ==============================================================================
# PROOF: RTX 3090 (SM86, 24GB) — CUDA compute truth, not nvidia-smi theater.
# Self-bootstrapping: needs nvidia-smi; nvcc optional (falls back to
# nvidia-smi dmon/occupancy probes). Copy-paste runnable.
# SCINTILLATION: verified +10, divergence +25, missing sensor = score 0.
# ==============================================================================
set -uo pipefail
SCORE=0
say() { echo "$1"; }
good() { say "  VERIFIED: $1"; SCORE=$((SCORE+10)); }
odd()  { say "  DIVERGENCE: $1"; SCORE=$((SCORE+25)); }

command -v nvidia-smi >/dev/null 2>&1 || { echo "NO nvidia-smi — sensor missing, proof cannot run honestly"; echo "SCINTILLATION SCORE: 0"; exit 1; }

say "== scintillator/sm86-cuda-proof =="
Q() { nvidia-smi --query-gpu="$1" --format=csv,noheader,nounits 2>/dev/null; }

NAME=$(Q name); TEMP=$(Q temperature.gpu); UTIL=$(Q utilization.gpu); MEMTOTAL=$(Q memory.total)
# CLAIM 1: the card IS an SM86 with 24GB (the estate's hardware premise)
[[ "$NAME" == *"3090"* ]] && good "GPU is $NAME" || odd "GPU is '$NAME' — not the SM86 3090 premise"
[[ "$MEMTOTAL" == 24576 || "$MEMTOTAL" == 24* ]] && good "24GB VRAM visible (${MEMTOTAL}MiB)" || odd "VRAM ${MEMTOTAL}MiB — premise mismatch"

# CLAIM 2: thermal below the 84C routing threshold (the hetero-fingerprint rule)
if [ -n "$TEMP" ] && [ "$TEMP" -lt 84 ] 2>/dev/null; then good "thermal ${TEMP}C < 84C routing threshold"; else odd "thermal ${TEMP:-missing} — routing threshold breached or sensor dead"; fi

# CLAIM 3: a REAL CUDA kernel runs (not just the driver): nvcc if present, else torch
if command -v nvcc >/dev/null 2>&1; then
  cat > /tmp/lap-cuda.cu <<'EOF'
#include <cstdio>
__global__ void add(const float* a, const float* b, float* c, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) c[i] = a[i] + b[i];
}
int main() {
    int n = 1 << 20; size_t sz = n * sizeof(float);
    float *a, *b, *c, *da, *db, *dc;
    a = (float*)malloc(sz); b = (float*)malloc(sz); c = (float*)malloc(sz);
    for (int i = 0; i < n; i++) { a[i] = 1; b[i] = 2; }
    cudaMalloc(&da, sz); cudaMalloc(&db, sz); cudaMalloc(&dc, sz);
    cudaMemcpy(da, a, sz, cudaMemcpyHostToDevice); cudaMemcpy(db, b, sz, cudaMemcpyHostToDevice);
    add<<<n/256, 256>>>(da, db, dc, n);
    cudaError_t err = cudaDeviceSynchronize();
    cudaMemcpy(c, dc, sz, cudaMemcpyDeviceToHost);
    printf("%s sum=%f\n", cudaGetErrorString(err), c[0] + c[n-1]);
    return 0;
}
EOF
  if nvcc -arch=sm_86 -o /tmp/lap-cuda /tmp/lap-cuda.cu 2>/dev/null && OUT=$(/tmp/lap-cuda); then
    [[ "$OUT" == *"no error"* ]] && good "real CUDA kernel ran on SM86: $OUT" || odd "CUDA kernel output: $OUT"
  else
    odd "nvcc build/run failed — driver OK but toolchain cannot target sm_86"
  fi
else
  # torch fallback: the python stack proves CUDA without nvcc
  if python3 -c "import torch; assert torch.cuda.is_available(); x=torch.randn(1000,1000,device='cuda'); y=(x@x).sum().item(); print('cuda-ok', y!=0)" 2>/dev/null | grep -q cuda-ok; then
    good "CUDA compute via torch (nvcc absent)"
  else
    odd "no nvcc AND no torch CUDA — driver alive but NO compute path (theater)"
  fi
fi

echo ""
echo "SCINTILLATION SCORE: $SCORE"
exit 0
