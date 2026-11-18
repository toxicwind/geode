-- gone.lua
-- Converted from the inline 410 branch in server.ts (trip model permanently).
-- A 410 Gone means the model/route is permanently removed. Trip the model for
-- effectively forever — retrying will never resurrect it.
local FOREVER = 9007199254740991 -- Number.MAX_SAFE_INTEGER

return {
  name = "gone",
  priority = 10,
  match = function(status, body)
    return status == 410
  end,
  policy = function(status, body, ctx)
    return {
      action = "trip",
      scope = "model",
      retryAfterMs = FOREVER,
      reason = "410 Gone: model permanently removed",
    }
  end,
}
