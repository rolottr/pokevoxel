-- Run with: luajit tests/lua/bit_shim_benchmark.lua
-- Measures forced fallback only; production uses the native bit fast path.
local saved = assert(rawget(_G, "bit"))
_G.bit = nil
package.loaded.bit = nil
package.path = "runtime/game/?.lua;" .. package.path
local bit = assert(require("bit"))
local started, checksum = os.clock(), 0
for index = 1, 250000 do
  local value = index * 65537
  checksum = checksum + bit.band(value, 0x7fffffff)
  checksum = checksum + bit.bxor(value, 0x5a5a5a5a)
  checksum = checksum + bit.rshift(value, index % 32)
end
local elapsed = os.clock() - started
assert(checksum ~= 0)
print(string.format("bit shim fallback: 750000 operations in %.3fs", elapsed))
_G.bit = saved
