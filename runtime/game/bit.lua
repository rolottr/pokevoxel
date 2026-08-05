-- LuaBitOp-compatible subset for browser LÖVE builds that do not expose the
-- native `bit` module.  Keep return values signed 32-bit, matching LuaJIT.
local native = rawget(_G, "bit")
if native and native.band and native.bor and native.bxor and native.bnot
    and native.lshift and native.rshift and native.arshift then
  return native
end

local TWO_31 = 2147483648
local TWO_32 = 4294967296

local function unsigned(value)
  value = tonumber(value) or 0
  value = value % TWO_32
  if value < 0 then value = value + TWO_32 end
  return value
end

local function signed(value)
  value = unsigned(value)
  if value >= TWO_31 then return value - TWO_32 end
  return value
end

-- Three 16x16 nibble lookup tables keep the no-native fallback compact and
-- avoid doing 32 arithmetic bit tests for every extraction byte operation.
local function nibbleTable(mode)
  local out = {}
  for left = 0, 15 do
    for right = 0, 15 do
      local a, b, value, place = left, right, 0, 1
      for _ = 1, 4 do
        local x, y = a % 2, b % 2
        local include = (mode == "and" and x == 1 and y == 1)
          or (mode == "or" and (x == 1 or y == 1))
          or (mode == "xor" and x ~= y)
        if include then value = value + place end
        a, b, place = math.floor(a / 2), math.floor(b / 2), place * 2
      end
      out[left * 16 + right + 1] = value
    end
  end
  return out
end

local NIBBLE = { ["and"] = nibbleTable("and"), ["or"] = nibbleTable("or"), ["xor"] = nibbleTable("xor") }

local function binary(left, right, mode)
  left, right = unsigned(left), unsigned(right)
  local tableForMode, value, place = NIBBLE[mode], 0, 1
  for _ = 1, 8 do
    value = value + tableForMode[(left % 16) * 16 + (right % 16) + 1] * place
    left, right, place = math.floor(left / 16), math.floor(right / 16), place * 16
  end
  return value
end

local function fold(mode, identity, ...)
  local count, value = select("#", ...), identity
  for index = 1, count do value = binary(value, select(index, ...), mode) end
  return signed(value)
end

local bit = {}
function bit.band(...) return fold("and", TWO_32 - 1, ...) end
function bit.bor(...) return fold("or", 0, ...) end
function bit.bxor(...) return fold("xor", 0, ...) end
function bit.bnot(value) return signed(TWO_32 - 1 - unsigned(value)) end
function bit.lshift(value, shift)
  shift = unsigned(shift) % 32
  return signed((unsigned(value) * 2 ^ shift) % TWO_32)
end
function bit.rshift(value, shift)
  shift = unsigned(shift) % 32
  return signed(math.floor(unsigned(value) / 2 ^ shift))
end
function bit.arshift(value, shift)
  shift = unsigned(shift) % 32
  local result = math.floor(unsigned(value) / 2 ^ shift)
  if unsigned(value) >= TWO_31 and shift > 0 then result = result + TWO_32 - 2 ^ (32 - shift) end
  return signed(result)
end
return bit
