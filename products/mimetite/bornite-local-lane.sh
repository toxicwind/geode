#!/usr/bin/env bash
# bornite-local-lane.sh — bornite/llama-swap first-class LOCAL lane.
# Serves qwen2.5-3b (GPU, RTX 3090) on :25196 for local-first routing.
# Replaces the hand-started llama-server with a managed, recoverable daemon.
set -euo pipefail
BIN=/home/toxic/pens/llama/bin/beellama
MODEL=/home/toxic/pens/ranch/products/models/qwen3.5-9b-Q5_K_M.gguf
PORT="${LOCAL_LANE_PORT:-25196}"

# clean stale listener
fuser -k "${PORT}/tcp" 2>/dev/null || true

exec env LD_LIBRARY_PATH="$BIN" "$BIN/llama-server" \
  -m "$MODEL" --host 127.0.0.1 --port "$PORT" \
  -ngl 99 -c 32768 --parallel 2 --no-mmap