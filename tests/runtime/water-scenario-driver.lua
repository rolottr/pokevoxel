-- POKEVOXEL_TEST_WATER_SCENARIOS: injected only into the disposable archive.
-- Real maps, retained Water setting, and the ordinary save's surfing bit are
-- exercised; production receives neither scenario controls nor failure hooks.
local Driver = {}
local savedBegin

local function game()
  assert(_G.POKEVOXEL_GAME and _G.POKEVOXEL_GAME.overworld, "water scenario requires a running overworld")
  local G = _G.POKEVOXEL_GAME
  -- Match the voxel fixture's proof that its real mod and render pipeline
  -- own this frame. This lives only in the disposable archive: on a broken
  -- fixture it turns an absent browser probe into an exact causal failure.
  local function fail(code)
    require("src.web.BrowserEvents").error(code)
    error(code, 0)
  end
  local loaded = G.modStatus and G.modStatus.loaded or {}
  if #loaded ~= 1 or loaded[1].id ~= "DRAMATIC_SHAPE" then
    local reason = (G.modStatus and G.modStatus.errors and G.modStatus.errors[1])
      or "unknown"
    reason = tostring(reason):upper():gsub("[^A-Z0-9_]+", "_"):sub(1, 96)
    fail("POKEVOXEL_WATER_MOD_LOAD_FAILED_" .. reason)
  end
  local Pipelines = require("src.render.Pipelines")
  local level = Pipelines.level("voxel")
  if level ~= 1 then fail("POKEVOXEL_WATER_LEVEL_" .. tostring(level)) end
  local pipelineId = Pipelines.worldPipeline()
  if pipelineId ~= "voxel" then
    fail("POKEVOXEL_WATER_WORLD_PIPELINE_" .. tostring(pipelineId or "none"))
  end
  return G
end
local function water(G)
  local api = assert(G.mods and G.mods.exports and G.mods.exports.DRAMATIC_SHAPE, "Dramatic Shape not loaded")
  local requireModule = assert(api.lib and api.lib.require,
    "Dramatic Shape module API missing")
  return requireModule("Water")
end
local function map(G, id)
  -- The title screen remains the stack top after browser Start. The fixture
  -- must make the existing live overworld the draw owner; it does not create
  -- a replacement state or alter production navigation.
  if G.stack:top() ~= G.overworld or not G.overworld.map then
    G.stack:init()
    G.stack:push(G.overworld, id, 5, 5, "down")
  else
    G.overworld:setMap(id, 5, 5, "down", { via = "test-water-fixture" })
  end
end
local function setLevel(G, index)
  water(G).setting:setIndex(index, G)
end
function Driver.handle(key)
  local G = game()
  if key == "0" then G.save.surfing = false; map(G, "REDS_HOUSE_1F"); return true end -- real overworld precondition
  if key == "1" then setLevel(G, 2); G.save.surfing = false; map(G, "ROUTE_19"); return true end -- SKY shoreline
  if key == "2" then setLevel(G, 1); G.save.surfing = true; map(G, "ROUTE_19"); return true end -- FULL Surf
  if key == "3" then setLevel(G, 1); G.save.surfing = true; map(G, "ROUTE_20"); return true end -- heavy water
  if key == "4" then setLevel(G, 2); G.save.surfing = false; map(G, "REDS_HOUSE_1F"); return true end -- indoor no stale water
  if key == "5" then
    local W = water(G); savedBegin = savedBegin or W.begin; W.begin = function() return false end
    setLevel(G, 1); map(G, "ROUTE_19"); return true
  end
  if key == "6" and savedBegin then water(G).begin = savedBegin; savedBegin = nil; return true end
  return false
end
return Driver
