-- auth-failed.lua
-- Converted from the inline 401/403 branch in server.ts (trip 30min).
-- A 401/403 is a credential/entitlement fault, not congestion. Trip the whole
-- provider so every model on it stops being tried until the credential is
-- rotated or the entitlement is restored.
return {
  name = "auth-failed",
  priority = 10,
  match = function(status, body)
    return status == 401 or status == 403
  end,
  policy = function(status, body, ctx)
    return {
      action = "trip",
      scope = "provider",
      retryAfterMs = 1800000, -- 30 min
      reason = "auth failed (401/403): credential or entitlement fault",
    }
  end,
}
