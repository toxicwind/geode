-- opencode-429-free-tier-timer.lua
-- NEW module: the opencode free-tier 429. Real body (2026-11-16):
--   {"type":"error","error":{"type":"FreeUsageLimitError","message":
--    "Free usage limit reached. Free models work in OpenCode (https://opencode.ai);
--     subscribe to OpenCode Go to keep going: https://opencode.ai/go"}}
-- This is a TIMER-based limit, not a concurrency shed and not a spend-quota
-- that drains. Retrying immediately is useless — the model is locked until the
-- free-tier timer resets. Policy: TRIP the model for the timer duration so the
-- walk skips it instead of hammering it. Default 1h; override with env
-- OPENCODE_FREE_TIER_TIMER_MS.
local DEFAULT_TIMER_MS = tonumber(os.getenv("OPENCODE_FREE_TIER_TIMER_MS") or "3600000")

return {
  name = "opencode-429-free-tier-timer",
  -- Run before the generic buckets so "free usage limit reached" is not
  -- swallowed by quota-exhausted (it is not a spend-quota).
  priority = 5,
  match = function(status, body)
    if status ~= 429 then return false end
    local b = body:lower()
    return b:find("freeusagelimiterror") ~= nil
      or b:find("free usage limit reached") ~= nil
      or (b:find("free") ~= nil and b:find("opencode") ~= nil and b:find("limit") ~= nil)
  end,
  policy = function(status, body, ctx)
    return {
      action = "trip",
      scope = "model",
      retryAfterMs = DEFAULT_TIMER_MS,
      reason = "opencode free-tier timer: model locked until free-tier reset",
    }
  end,
}
