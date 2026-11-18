-- concurrency-shed.lua
-- Converted from primitives.ts isConcurrencyShed() under the
-- isRetryableSaturation() gate:
--   gate:  status==429|503|409, or (status>=500 and body has
--          concurrency|too many|rate.limit|busy|overload|temporarily)
--   match:  /concurrent|too many concurrent|concurrency_limit|slot/i
-- A concurrency shed means the provider's slots are full (an external holder
-- has the shared lease). Policy: mark the provider slots-full, wait + resend
-- for a bounded budget, then diversify. NEVER trip the breaker.
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
  name = "concurrency-shed",
  priority = 20,
  match = function(status, body)
    if not retryableSaturation(status, body) then return false end
    local b = body:lower()
    return b:find("concurrent") ~= nil
      or b:find("concurrency_limit") ~= nil
      or b:find("slot") ~= nil
  end,
  policy = function(status, body, ctx)
    return {
      action = "shed",
      reason = "concurrency shed: slots full, wait+resend then diversify",
    }
  end,
}
