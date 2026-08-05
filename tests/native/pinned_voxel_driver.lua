-- Product-owned Layer 6 native retained-mod smoke. This runs from a temporary
-- project containing the audited product game/mod trees; no ROM or generated
-- cache is read. It proves the Lua 5.1 module-loader path and retained voxel
-- primitives can load under the configured desktop LÖVE runtime.
local V = { path = "mods/dramatic-shape" }
local loaded = {}
function V.require(name)
  if loaded[name] ~= nil then return loaded[name] end
  local chunk, err = love.filesystem.load(V.path .. "/lib/" .. name .. ".lua")
  assert(chunk, err)
  loaded[name] = chunk(V)
  return loaded[name]
end
function V.data(name)
  local chunk, err = love.filesystem.load(V.path .. "/data/" .. name .. ".lua")
  assert(chunk, err)
  return chunk(V)
end

function love.load()
  local names = { "VoxelState", "Voxel3D", "ChunkMesher", "DayNight", "VoxelScene", "TiltShift" }
  for _, name in ipairs(names) do assert(V.require(name), "missing retained module " .. name) end
  local DayNight = V.require("DayNight")
  assert(type(DayNight.tod()) == "string", "day/night capability is unavailable")
  print("[voxel] retained native modules: " .. #names)
  love.event.quit(0)
end
