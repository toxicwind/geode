#!/usr/bin/env bash
# unified-router serve wrapper (mimetite/router).
# Pulls live keyring env from kryptos (SSOT for API keys), then execs the router.
# Daemon contexts run with a minimal PATH — kryptos and bun both live outside it.
set -uo pipefail
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"

if command -v kryptos >/dev/null 2>&1; then
  eval "$(kryptos env)" || echo "warn: kryptos env failed; using ambient env" >&2
else
  echo "warn: kryptos not found; using ambient env" >&2
fi

cd "$(dirname "$0")"
exec bun src/server.ts
