-- Run with: luajit tests/lua/bit_shim_spec.lua
-- Force the arithmetic fallback even when the local LuaJIT exposes native bit.
local saved = assert(rawget(_G, "bit"), "LuaJIT native bit is required for parity testing")
_G.bit = nil
package.loaded.bit = nil
package.path = "runtime/game/?.lua;" .. package.path
local bit = assert(require("bit"))
local function same(actual, expected, label)
  assert(actual == expected, (label or "vector") .. ": expected " .. expected .. ", got " .. actual)
end
same(bit.band(0xF0, 0x3C), 0x30, "band")
same(bit.band(-1, 0x7fffffff), 0x7fffffff, "band signed")
same(bit.bor(0xF0, 0x0F), 0xFF, "bor")
same(bit.bxor(0xAA, 0xFF), 0x55, "bxor")
same(bit.bnot(0), -1, "bnot zero")
same(bit.bnot(-1), 0, "bnot negative")
same(bit.lshift(1, 31), -2147483648, "lshift sign")
same(bit.lshift(1, 32), 1, "lshift masked count")
same(bit.rshift(-1, 1), 2147483647, "rshift unsigned")
same(bit.rshift(-2147483648, 31), 1, "rshift high")
same(bit.arshift(-2147483648, 1), -1073741824, "arshift sign")
same(bit.arshift(-1, 31), -1, "arshift fill")
same(bit.band(0xFFFF, 0x0FFF, 0x00FF), 0x00FF, "vararg band")
package.loaded["src.import.Rom"] = nil
assert(require("src.import.Rom"), "Rom module must resolve the shim explicitly")

-- A deterministic randomized corpus catches signed conversion and shift-count
-- edge cases against the native LuaJIT implementation used on desktop.
math.randomseed(324508639)
for _ = 1, 4000 do
  local function value()
    local number = math.random(0, 65535) * 65536 + math.random(0, 65535)
    return math.random(0, 1) == 0 and number or number - 4294967296
  end
  local left, right, shift = value(), value(), math.random(-80, 80)
  same(bit.band(left, right), saved.band(left, right), "random band")
  same(bit.bor(left, right), saved.bor(left, right), "random bor")
  same(bit.bxor(left, right), saved.bxor(left, right), "random bxor")
  same(bit.bnot(left), saved.bnot(left), "random bnot")
  same(bit.lshift(left, shift), saved.lshift(left, shift), "random lshift")
  same(bit.rshift(left, shift), saved.rshift(left, shift), "random rshift")
  same(bit.arshift(left, shift), saved.arshift(left, shift), "random arshift")
end
_G.bit = saved
print("bit shim vectors passed")
