-- not-found.lua
-- Converted from the inline 404 branch in server.ts (trip 1h).
-- A 404 means the model/route is gone (renamed, EOL, or wrong id). Trip just
-- that model for a long window — retrying won't resurrect it.
return {
  name = "not-found",
  priority = 10,
  match = function(status, body)
    return status == 404
  end,
  policy = function(status, body, ctx)
    return {
      action = "trip",
      scope = "model",
      retryAfterMs = 3600000, -- 1h
      reason = "404 Not Found: model/route gone",
    }
  end,
}
