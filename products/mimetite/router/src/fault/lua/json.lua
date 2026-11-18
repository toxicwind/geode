-- json.lua — minimal JSON encode/decode for the breaker worker protocol.
-- Only needs to handle the shapes we actually exchange:
--   query:  {"id":<int>,"status":<int>,"body":"<str>","provider":"<str>","model":"<str>"}
--   reply:  {"id":<int>,"matched":"<str|null>","policy":{...}|null}
local json = {}

local function skipws(s, pos)
  while pos <= #s and s:sub(pos, pos):match("%s") do pos = pos + 1 end
  return pos
end

local function parseValue(s, pos)
  pos = skipws(s, pos)
  local c = s:sub(pos, pos)
  if c == "{" then
    pos = pos + 1
    local t = {}
    pos = skipws(s, pos)
    if s:sub(pos, pos) == "}" then return t, pos + 1 end
    while true do
      local k, np = parseValue(s, pos)
      pos = skipws(s, np)
      if s:sub(pos, pos) ~= ":" then error("json: expected ':'") end
      pos = pos + 1
      local v, np2 = parseValue(s, pos)
      t[k] = v
      pos = skipws(s, np2)
      local sep = s:sub(pos, pos)
      if sep == "," then pos = pos + 1
      elseif sep == "}" then return t, pos + 1
      else error("json: expected ',' or '}'") end
    end
  elseif c == "[" then
    pos = pos + 1
    local t = {}
    pos = skipws(s, pos)
    if s:sub(pos, pos) == "]" then return t, pos + 1 end
    while true do
      local v, np = parseValue(s, pos)
      t[#t + 1] = v
      pos = skipws(s, np)
      local sep = s:sub(pos, pos)
      if sep == "," then pos = pos + 1
      elseif sep == "]" then return t, pos + 1
      else error("json: expected ',' or ']'") end
    end
  elseif c == '"' then
    pos = pos + 1
    local out = {}
    while true do
      local ch = s:sub(pos, pos)
      if ch == "" then error("json: unterminated string") end
      if ch == '"' then return table.concat(out), pos + 1 end
      if ch == "\\" then
        local e = s:sub(pos + 1, pos + 1)
        if e == "n" then out[#out + 1] = "\n"
        elseif e == "t" then out[#out + 1] = "\t"
        elseif e == "r" then out[#out + 1] = "\r"
        elseif e == "u" then
          local hex = s:sub(pos + 2, pos + 5)
          out[#out + 1] = utf8.char(tonumber(hex, 16))
          pos = pos + 4
        else out[#out + 1] = e end
        pos = pos + 2
      else
        out[#out + 1] = ch
        pos = pos + 1
      end
    end
  elseif c == "t" then return true, pos + 4
  elseif c == "f" then return false, pos + 5
  elseif c == "n" then return nil, pos + 4
  else
    local num = s:match("^-?%d+%.?%d*[eE]?[-+]?%d*", pos)
    if not num then error("json: unexpected char at " .. pos) end
    return tonumber(num), pos + #num
  end
end

function json.decode(s)
  local v = parseValue(s, 1)
  return v
end

local function encodeString(str)
  return '"' .. str:gsub('[%c"]', function(c)
    if c == '"' then return '\\"' end
    if c == "\n" then return "\\n" end
    if c == "\t" then return "\\t" end
    if c == "\r" then return "\\r" end
    return string.format("\\u%04x", c:byte())
  end) .. '"'
end

local function encodeValue(v)
  local t = type(v)
  if t == "table" then
    local isArr = #v > 0
    local parts = {}
    if isArr then
      for i = 1, #v do parts[i] = encodeValue(v[i]) end
      return "[" .. table.concat(parts, ",") .. "]"
    else
      for k, val in pairs(v) do parts[#parts + 1] = encodeString(k) .. ":" .. encodeValue(val) end
      return "{" .. table.concat(parts, ",") .. "}"
    end
  elseif t == "string" then
    return encodeString(v)
  elseif t == "number" then
    return tostring(v)
  elseif t == "boolean" then
    return tostring(v)
  else
    return "null"
  end
end

function json.encode(v)
  return encodeValue(v)
end

return json
