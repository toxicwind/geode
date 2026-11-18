-- quota-exhausted.lua
-- Converted from primitives.ts isQuotaExhausted() under the
-- isRetryableSaturation() gate:
--   gate:  status==429|503|409, or (status>=500 and body has
--          concurrency|too many|rate.limit|busy|overload|temporarily)
--   match:  /quota|budget|daily cost|exhausted|spend caps?|rate.limit|exceeded/i
-- A quota/budget 429 is NOT a slot shed: the provider may still have a free
-- slot, so diversity keeps it eligible. Policy: honor the stated wait once
-- (bounded), then let the walk continue to a different provider. No trip.
local function retryableSaturation(status, body)
  if status == 429 or status == 503 or status == 409 then return true end
  if status >= 500 then
    local b = body:lower()
    return b:find("concurrency") ~= nil or b:find("too many") ~= nil
      or b:find("rate.limit") ~= nil or b:find("busy") ~= nil
      or b:find("overload") ~= nil or b:find("temporarily") ~= nil
  end
  return false
end

return {
  name = "quota-exhausted",
  priority = 30,
  match = function(status, body)
    if not retryableSaturation(status, body) then return false end
    local b = body:lower()
    return b:find("quota") ~= nil
      or b:find("budget") ~= nil
      or b:find("daily cost") ~= nil
      or b:find("exhausted") ~= nil
      or b:find("spend cap") ~= nil
      or b:find("rate.limit") ~= nil
      or b:find("exceeded") ~= nil
  end,
  policy = function(status, body, ctx)
    return {
      action = "quota",
      reason = "quota/budget exhausted: honor wait once, then diversify",
    }
  end,
}
