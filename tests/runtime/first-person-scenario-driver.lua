-- POKEVOXEL_TEST_FIRST_PERSON_SCENARIOS: injected only into the disposable archive.
-- It selects real maps and the retained 1ST rung, then observes the ordinary
-- overworld controller. It never replaces collision, warps, encounters, flags,
-- or battle transitions.
local Driver = {}
local reference = nil
local scenario = "none"
local dialogTested = false

local scenarios = {
  ["1"] = { id = "outdoor", map = "PALLET_TOWN", x = 5, y = 6, facing = "down", surfing = false },
  ["2"] = { id = "indoor", map = "REDS_HOUSE_1F", x = 3, y = 5, facing = "down", surfing = false },
  ["3"] = { id = "cave", map = "ROCK_TUNNEL_1F", x = 5, y = 5, facing = "down", surfing = false },
  ["4"] = { id = "water", map = "ROUTE_19", x = 5, y = 5, facing = "down", surfing = true },
  ["5"] = { id = "scripted-warp", map = "PALLET_TOWN", x = 5, y = 6, facing = "down", surfing = false },
  ["6"] = { id = "random-encounter", map = "ROCK_TUNNEL_1F", x = 5, y = 5, facing = "down", surfing = false },
}

local function game()
  local G = assert(_G.POKEVOXEL_GAME, "first-person scenario requires a running game")
  -- Dramatic Shape must be loaded and only the audited built-in pair may be.
  local loaded = G.modStatus and G.modStatus.loaded or {}
  local shape, foreign = nil, false
  for _, mod in ipairs(loaded) do
    if mod.id == "DRAMATIC_SHAPE" then shape = mod
    elseif mod.id ~= "pokeaudio-hd" then foreign = true end
  end
  assert(shape and not foreign,
    "first-person scenario requires the built-in Dramatic Shape mod")
  return G
end

local function copyFlags(flags)
  local out = {}
  for key, value in pairs(flags or {}) do out[key] = value end
  return out
end

local function flagsSame(flags)
  local seen = 0
  for key, value in pairs(flags or {}) do
    seen = seen + 1
    if not reference or reference.flags[key] ~= value then return false end
  end
  local expected = 0
  for _ in pairs(reference and reference.flags or {}) do expected = expected + 1 end
  return seen == expected
end

local function ensureParty(G)
  local Pokemon = require("src.pokemon.Pokemon")
  if not (G.save.party and G.save.party[1]) then
    G.save.party = { Pokemon.new(G.data, "PIKACHU", 50) }
  end
  for _, mon in ipairs(G.save.party) do
    mon.hp = mon.stats.hp
    mon.status = nil
  end
  G.save.repelSteps, G.save.safari = nil, nil
end

local function selectScenario(spec)
  local G = game()
  while G.stack:top() and G.stack:top() ~= G.overworld do G.stack:pop() end
  if G.stack:top() ~= G.overworld or not G.overworld.map then
    G.stack:init()
    G.stack:push(G.overworld, spec.map, spec.x, spec.y, spec.facing)
  else
    G.overworld:setMap(spec.map, spec.x, spec.y, spec.facing,
      { via = "test-first-person-fixture" })
  end
  ensureParty(G)
  local p = G.overworld.player
  G.save.surfing, p.surfing = spec.surfing, spec.surfing
  if G.overworld.syncSurfingPikachu then G.overworld:syncSurfingPikachu() end
  local Pipelines = require("src.render.Pipelines")
  assert(Pipelines.setLevel("voxel", 6) == 6, "retained 1ST rung unavailable")
  Pipelines.syncOptions(G.save.options)
  scenario = spec.id
  reference = {
    map = G.overworld.map.id, cellX = p.cellX, cellY = p.cellY,
    facing = p.facing, surfing = G.save.surfing == true,
    flags = copyFlags(G.save.flags),
  }
  return true
end

local function gridExit()
  local G = game()
  local Pipelines = require("src.render.Pipelines")
  Pipelines.setLevel("voxel", 0)
  Pipelines.syncOptions(G.save.options)
  return true
end

local function emitParity()
  local G = game()
  local p = G.overworld.player
  require("src.web.BrowserEvents").emit("first-person-parity", string.format(
    '{"scenario":"%s","map":"%s","cellX":%d,"cellY":%d,"facing":"%s","surfing":%s,"flagsSame":%s,"transitioning":%s}',
    scenario, tostring(G.overworld.map.id), p.cellX, p.cellY,
    tostring(p.facing), G.save.surfing and "true" or "false",
    flagsSame(G.save.flags) and "true" or "false",
    G.overworld.transitioning and "true" or "false"))
  return true
end

local function startWarp()
  local G = game()
  local def = assert(G.overworld.map.def.warps and G.overworld.map.def.warps[1],
    "scripted-warp scenario map has no retained warp")
  local p = G.overworld.player
  p.cellX, p.cellY, p.px, p.py = def.x, def.y, def.x * 16, def.y * 16
  G.overworld:takeWarp(def)
  return true
end

local function rollOrdinaryEncounter()
  local G = game()
  for _ = 1, 1024 do
    if G.stack:top() ~= G.overworld then return true end
    G.overworld:onStepComplete()
  end
  error("ordinary retained encounter did not start within the bounded fixture", 0)
end

local function openDialog()
  local G = game()
  G.stack:push(require("src.render.TextBox").new(G, "FIRST PERSON INPUT RELEASE TEST"))
  return true
end

local function closeOverlay()
  local G = game()
  if G.stack:top() ~= G.overworld then G.stack:pop() end
  return true
end

local function failNextDraw()
  local G = game()
  local exports = assert(G.mods.exports.DRAMATIC_SHAPE)
  local Voxel3D = exports.lib.require("Voxel3D")
  Voxel3D.beginScene = function()
    error("POKEVOXEL_TEST_FIRST_PERSON_DRAW_FAILURE", 0)
  end
  return true
end

function Driver.handle(key)
  if key == "0" then return selectScenario(scenarios["1"]) end
  if scenarios[key] then return selectScenario(scenarios[key]) end
  if key == "7" then
    if scenario == "scripted-warp" then return startWarp() end
    if scenario == "random-encounter" then return rollOrdinaryEncounter() end
    return gridExit()
  end
  if key == "8" then return emitParity() end
  if key == "9" then
    local G = game()
    if G.stack:top() ~= G.overworld then
      dialogTested = true
      return closeOverlay()
    end
    if dialogTested then return failNextDraw() end
    return openDialog()
  end
  return false
end

return Driver
