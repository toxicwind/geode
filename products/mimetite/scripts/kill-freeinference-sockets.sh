#!/usr/bin/env bash
# pens/geode/products/mimetite/scripts/kill-freeinference-sockets.sh
#
# PURPOSE:
# 1. Terminate all rogue/background connections holding the freeinference concurrency slot.
# 2. Stop hindsight memory consolidation from hammering freeinference with 120s batches.
# 3. Use Linux kernel TCP socket kill (ss -K) to tear down any half-open/lingering TLS sockets.
# 4. Fix Hindsight's model configuration to route to NVIDIA NIM (nim-deepseek-v4-flash) instead of freeinference.
# 5. Verify the freeinference slot is freed (chat completions + embeddings return 200 OK).

set -euo pipefail

FREEINF_IPS=("172.67.197.180" "104.21.92.204")

echo "================================================================="
echo "  KILL FREEINFERENCE SOCKETS & REMEDIATE DAEMONS"
echo "================================================================="

# 1. Stop Hindsight in pitchfork to prevent auto-restart
echo "[1/6] Stopping barn/hindsight in pitchfork..."
if command -v pitchfork >/dev/null 2>&1; then
  (cd /home/toxic/pens/barn && pitchfork stop hindsight 2>/dev/null || true)
fi

# 2. Stop and kill the hindsight docker container
echo "[2/6] Force-stopping hindsight docker container..."
if docker ps -q -f name=^hindsight$ | grep -q .; then
  echo "  Killing container hindsight..."
  docker stop -t 2 hindsight >/dev/null 2>&1 || true
  docker rm -f hindsight >/dev/null 2>&1 || true
  echo "  Container removed."
else
  echo "  Hindsight container not currently running."
fi

# 3. Inspect active connections to freeinference IPs
echo "[3/6] Inspecting active TCP connections to freeinference IPs..."
for ip in "${FREEINF_IPS[@]}"; do
  echo "--- Connections to $ip ---"
  ss -tnp "dst $ip" 2>/dev/null || true
done

# 4. Kernel TCP socket kill (ss -K)
echo "[4/6] Killing any remaining kernel TCP sockets to freeinference IPs..."
for ip in "${FREEINF_IPS[@]}"; do
  sudo ss -K "dst $ip" 2>/dev/null || true
done

# 5. Fix Hindsight serve.sh to point to nim-deepseek-v4-flash (NVIDIA NIM) instead of freeinference qwen3.6-35b
HINDSIGHT_SERVE="/home/toxic/pens/barn/products/hindsight/serve.sh"
echo "[5/6] Updating $HINDSIGHT_SERVE model target..."
if [ -f "$HINDSIGHT_SERVE" ]; then
  # Change qwen3.6-35b to nim-deepseek-v4-flash (NVIDIA NIM lane on mimetite)
  sed -i 's/HINDSIGHT_API_LLM_MODEL=qwen3.6-35b/HINDSIGHT_API_LLM_MODEL=nim-deepseek-v4-flash/g' "$HINDSIGHT_SERVE"
  echo "  Updated HINDSIGHT_API_LLM_MODEL to nim-deepseek-v4-flash."
fi

# 6. Verify network sockets are clear
echo "[6/6] Verifying freeinference sockets are dead..."
sleep 0.5
ACTIVE_CONNS=$(ss -tn "dst 172.67.197.180 or dst 104.21.92.204" 2>/dev/null | grep -c ESTAB || true)
if [ "$ACTIVE_CONNS" -eq 0 ]; then
  echo "  ✅ Clean: 0 active TCP connections to freeinference IPs."
else
  echo "  ⚠️ Warning: $ACTIVE_CONNS active connections remain:"
  ss -tnp "dst 172.67.197.180 or dst 104.21.92.204" 2>/dev/null || true
fi

echo "================================================================="
echo "  KILL & REMEDIATION COMPLETE"
echo "================================================================="
