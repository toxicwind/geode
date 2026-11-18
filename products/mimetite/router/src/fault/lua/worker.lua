-- worker.lua — persistent Lua classifier process for the circuit-breaker module
-- system.
--
-- Usage: lua worker.lua <lua_dir> <modules_dir>
--   lua_dir    dir containing json.lua (this file's sibling)
--   modules_dir dir containing the *.lua fault modules
--
-- Protocol (JSON lines over stdio):
--   in:  {"id":1,"status":429,"body":"...","provider":"p","model":"m"}
--   out: {"id":1,"matched":"opencode-429-free-tier-timer","policy":{...}}
-- `matched` is null when no module matched; `policy` is null then too.
--
-- The process is long-lived: it loads all modules once at startup, then loops
-- reading queries. The TS side respawns it if it exits.

local luaDir = arg[1]
local modulesDir = arg[2]
local json = dofile(luaDir .. "/json.lua")

-- Load all modules, sort by priority (lower first), ties by name.
local modules = {}
local files = io.popen("ls " .. modulesDir .. "/*.lua 2>/dev/null"):read("*a")
for file in files:gmatch("[^\n]+") do
  local ok, mod = pcall(dofile, file)
  if ok and type(mod) == "table" and type(mod.match) == "function" then
    table.insert(modules, {
      name = mod.name or file,
      priority = mod.priority or 100,
      match = mod.match,
      policy = mod.policy,
    })
  else
    io.stderr:write("breaker: failed to load " .. file .. "\n")
  end
end
table.sort(modules, function(a, b)
  if a.priority ~= b.priority then return a.priority < b.priority end
  return a.name < b.name
end)

for line in io.stdin:lines() do
  local q = json.decode(line)
  if q and q.id then
    local matched = nil
    local policy = nil
    for _, m in ipairs(modules) do
      local ok, hit = pcall(m.match, q.status, q.body or "")
      if ok and hit then
        matched = m.name
        local ok2, pol = pcall(m.policy, q.status, q.body or "", {
          provider = q.provider or "",
          model = q.model or "",
        })
        if ok2 then policy = pol end
        break
      end
    end
    io.write(json.encode({ id = q.id, matched = matched, policy = policy }), "\n")
    io.flush()
  end
end
