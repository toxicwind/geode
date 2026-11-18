-- ua-blocked.lua
-- Converted from catalog/src/ua.ts isUaBlocked() (UA_BLOCK_PATTERNS):
--   /error[\s_-]?1010/i · /browser'?s? signature/i ·
--   /cloudflare-1xxx-errors/i · /cf-error-details/i
-- Cloudflare 1010 = the upstream rejected the client fingerprint even as a
-- browser. This is an egress/IP-reputation problem, not a credential fault.
-- Short cooldown, then retry. Must run BEFORE auth-failed (both see 403) so
-- the specific reason wins.
return {
  name = "ua-blocked",
  priority = 9,
  match = function(status, body)
    if status ~= 403 then return false end
    local b = body:lower()
    return b:find("error%s?[_-]?1010") ~= nil
      or b:find("browser'?s? signature") ~= nil
      or b:find("cloudflare%-1xxx%-errors") ~= nil
      or b:find("cf%-error%-details") ~= nil
  end,
  policy = function(status, body, ctx)
    return {
      action = "trip",
      scope = "provider",
      retryAfterMs = 300000, -- 5 min
      reason = "ua_blocked: egress IP reputation, not a credential fault",
    }
  end,
}
