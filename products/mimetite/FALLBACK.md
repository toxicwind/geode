# Mimetite (mimetite) Edge-Case Fallback

**Status:** Active as of 2026-09-30. Blessed binary sha256:
`e1d70dd074bf6c1218ce45be5e2cf9ebb609cf7439d279989d2429c2f08e2e4e`
Immutable copy: `/home/toxic/pens/pens/projects/mimetite/mimetite.20260930-052800`

## If mimetite fails to start or dies

Mimetite serves on `:25100`. The pens router (`:25104`) depends on it via
`LLM_BASE_URL` (default `http://127.0.0.1:25100/v1`).

### Immediate fallback (no restart needed)

Set the env override to bypass mimetite and hit providers directly:

```bash
# On yote, for the router process environment:
export LLM_BASE_URL="https://openrouter.ai/api/v1"
# or
export MIMETITE_V1="https://openrouter.ai/api/v1"
```

The router reads `LLM_BASE_URL` first, then `MIMETITE_V1`, then defaults to
mimetite `:25100`. Setting either env var reroutes around a dead mimetite instantly.
Restart the router (`pens/router`) to pick up the change.

### Restore the binary (warden path)

Do NOT roll back to a stale backup. The warden (`bin/pens-reconcile`)
follows **fallback, not rollback**:

- `pens-reconcile check` — read-only drift report (exit 1 on drift)
- `pens-reconcile --apply` — HARD-DISABLED (refuses, exit 2).
  Restoration is dead on every path (the Architect 2026-09-30); the warden only
  alerts. Rebuild from a trusted source and redeploy by hand.

If the immutable copy itself is corrupt, rebuild from source:
`toxicwind/pens-swap` @ `7fc25280816fa7f98764ac46d1435d55ac9dc3c3`
(or newer upstream — prefer cutting edge per the Architect).

### Verify after recovery

```bash
curl -sf http://127.0.0.1:25100/health        # expect: OK
curl -sf http://127.0.0.1:25100/v1/models     # expect: model list JSON
/home/toxic/pens/pens/bin/pens-reconcile check  # expect: exit 0
```

## Why fallback, not rollback (the Architect 2026-09-30)

"A fallback is not a rollback." Rolling back to the Sep 21 binary would
discard the Sep 29 rebuild (three iterations: 23MB → 36MB → 37.5MB, the
current one verified serving). The warden reports STALE (manifest needs
refresh) when live sha != manifest but live is healthy — it never reverts
files. Build forward.
