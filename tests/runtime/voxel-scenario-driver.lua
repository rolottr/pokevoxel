-- POKEVOXEL_TEST_VOXEL_SCENARIOS: copied only into the disposable test archive.
-- It drives the real live overworld/map loader; production sources expose no
-- test input or map-selection API.
local Driver = {}

local fixtures = {
  ["1"] = { map = "PALLET_TOWN", x = 5, y = 6 },
  ["2"] = { map = "REDS_HOUSE_1F", x = 3, y = 5 },
  ["3"] = { map = "VIRIDIAN_FOREST", x = 5, y = 5 },
  ["4"] = { map = "ROCK_TUNNEL_1F", x = 5, y = 5 },
}

-- Red's house is the useful general Pallet fixture above, but it cannot prove
-- the reported lab-roof overlap. Frame the canonical lab entrance instead so
-- Oak's original spawn at (10, 4) is genuinely behind that building.
local palletLabOcclusionFixture = { map = "PALLET_TOWN", x = 12, y = 12 }

local function game()
  assert(_G.POKEVOXEL_GAME and _G.POKEVOXEL_GAME.overworld,
    "voxel scenario requires a running overworld")
  local G = _G.POKEVOXEL_GAME
  local loaded = G.modStatus and G.modStatus.loaded or {}
  if #loaded ~= 1 or loaded[1].id ~= "DRAMATIC_SHAPE" then
    local reason = (G.modStatus and G.modStatus.errors and G.modStatus.errors[1])
      or "unknown"
    reason = tostring(reason):upper():gsub("[^A-Z0-9_]+", "_"):sub(1, 96)
    require("src.web.BrowserEvents").error(
      "POKEVOXEL_VOXEL_MOD_LOAD_FAILED_" .. reason)
    error("POKEVOXEL_VOXEL_MOD_LOAD_FAILED", 0)
  end
  local Pipelines = require("src.render.Pipelines")
  local level = Pipelines.level("voxel")
  if level ~= 1 and level ~= 5 then
    require("src.web.BrowserEvents").error(
      "POKEVOXEL_VOXEL_LEVEL_" .. tostring(level))
    error("POKEVOXEL_VOXEL_LEVEL_INVALID", 0)
  end
  local pipelineId = Pipelines.worldPipeline()
  if pipelineId ~= "voxel" then
    require("src.web.BrowserEvents").error(
      "POKEVOXEL_VOXEL_WORLD_PIPELINE_" .. tostring(pipelineId or "none"))
    error("POKEVOXEL_VOXEL_WORLD_PIPELINE_INVALID", 0)
  end
  return G
end

local function loadFixture(fixture)
  local G = game()
  if G.stack:top() ~= G.overworld or not G.overworld.map then
    G.stack:init()
    G.stack:push(G.overworld, fixture.map, fixture.x, fixture.y, "down")
  else
    G.overworld:setMap(fixture.map, fixture.x, fixture.y, "down",
      { via = "test-voxel-fixture" })
  end
  return true
end

local function palletHouseDoor()
  local G = game()
  loadFixture(fixtures["1"])
  for _, warp in ipairs(G.overworld.map.def.warps or {}) do
    if warp.destMap == "REDS_HOUSE_1F" then
      -- Keep the real controller's transition/warp ownership. The test never
      -- invents a replacement map or a test-only mod hook.
      G.overworld:takeWarp(warp)
      return true
    end
  end
  error("PALLET_TOWN house-door warp is unavailable")
end

local function palletHouseExit()
  local G = game()
  if not (G.overworld.map and G.overworld.map.id == "REDS_HOUSE_1F") then
    loadFixture(fixtures["2"])
  end
  for _, warp in ipairs(G.overworld.map.def.warps or {}) do
    -- Gen 1 house exits are canonical LAST_MAP warps. The actual Pallet door
    -- entry above seeds lastOutdoor, so the real controller resolves this
    -- return rather than the test inventing a direct destination.
    if warp.destMap == "LAST_MAP" then
      G.overworld:takeWarp(warp)
      return true
    end
  end
  error("REDS_HOUSE_1F Pallet exit warp is unavailable")
end

-- The user's first exit starts with no Pallet mesh in cache. Seed only the
-- canonical LAST_MAP prerequisite, then let the real warp/transition/map
-- controller own the same house-exit path as production.
local function coldPalletHouseExit()
  local G = game()
  loadFixture(fixtures["2"])
  G.overworld:rememberOutdoor("PALLET_TOWN", 5, 6)
  for _, warp in ipairs(G.overworld.map.def.warps or {}) do
    if warp.destMap == "LAST_MAP" then
      G.overworld:takeWarp(warp)
      return true
    end
  end
  error("REDS_HOUSE_1F cold Pallet exit warp is unavailable")
end

local function failActiveVoxelDraw()
  local G = game()
  local exports = G.mods and G.mods.exports and G.mods.exports.DRAMATIC_SHAPE
  local lib = exports and exports.lib
  assert(lib and lib.require, "Dramatic Shape exports are unavailable")
  local Voxel3D = lib.require("Voxel3D")
  Voxel3D.beginScene = function() return false end
  return true
end

-- Exercise the real 75-degree orbit rung used by the user's broad failure
-- screenshot. This changes only the disposable profile's presentation level;
-- the production pipeline owns the tween and camera matrices as usual.
local function palletLowAngle()
  local Pipelines = require("src.render.Pipelines")
  assert(Pipelines.setLevel("voxel", 5) == 5,
    "Pallet low-angle fixture could not select the 75-degree rung")
  return true
end

-- Force the browser-only packed-depth branch without changing production
-- code. Select the retained FULL water mode explicitly so a shared profile's
-- persisted option cannot route around the target switch, then make the next
-- readable-depth allocation unavailable. The real graphics API still creates
-- and binds its ordinary internal depth target, reproducing the exact
-- capability split that lost world depth in the user's Chrome session.
local function forcePackedDepth()
  local G = game()
  local exports = G.mods and G.mods.exports and G.mods.exports.DRAMATIC_SHAPE
  local lib = exports and exports.lib
  assert(lib and lib.require, "Dramatic Shape exports are unavailable")
  local Voxel3D = lib.require("Voxel3D")
  lib.require("Water").setting:setIndex(1, G)
  -- Voxel3D.beginScene closes over the real readable-depth allocator. Replace
  -- only that upvalue inside this disposable archive; graphics globals and the
  -- production module stay untouched, while the next invalidated slot must
  -- take the exact packed fallback.
  local forced = false
  for index = 1, 64 do
    local name = debug.getupvalue(Voxel3D.beginScene, index)
    if not name then break end
    if name == "newDepth" then
      debug.setupvalue(Voxel3D.beginScene, index, function() return nil end)
      forced = true
      break
    end
  end
  assert(forced, "readable depth allocator upvalue is unavailable")
  Voxel3D.invalidate()
  return true
end

local function findPalletOcclusionNpc(G)
  assert(G.overworld.map and G.overworld.map.id == "PALLET_TOWN",
    "Pallet occlusion fixture requires PALLET_TOWN")
  for _, entity in ipairs(G.overworld.entities or {}) do
    if entity ~= G.overworld.player and entity.cellX == 10
        and entity.cellY == 4 then
      return entity
    end
  end
end

local function preparePalletOcclusionNpc()
  local G = game()
  -- A continued save correctly hides Oak after the opening escort. This
  -- disposable visual scenario needs the original Yellow object at its
  -- canonical spawn, so reset only that scenario-owned object toggle and
  -- rebuild Pallet at the lab entrance through the real map loader. No
  -- production save or map definition is changed.
  G.save.objectToggles = G.save.objectToggles or {}
  G.save.objectToggles.PALLET_TOWN =
    G.save.objectToggles.PALLET_TOWN or {}
  G.save.objectToggles.PALLET_TOWN.PALLETTOWN_OAK = true
  loadFixture(palletLabOcclusionFixture)

  local oak = findPalletOcclusionNpc(G)
  if oak then return oak end
  error("canonical Pallet occlusion NPC is unavailable")
end

-- Give the browser the live GPU projection of canonical Oak's logical foot
-- anchor. This is disposable test telemetry only: production emits no NPC
-- coordinates, and the private ROM is never named or serialized.
local function palletOcclusionProjection(entity)
  local G = game()
  local exports = G.mods and G.mods.exports and G.mods.exports.DRAMATIC_SHAPE
  local lib = exports and exports.lib
  assert(lib and lib.require, "Dramatic Shape exports are unavailable")
  local Voxel3D = lib.require("Voxel3D")
  local VoxelScene = lib.require("VoxelScene")
  local VoxelState = lib.require("VoxelState")
  local ground = VoxelScene.groundAt(G.overworld.map,
                                      entity.cellX, entity.cellY)
  local x, y, scale = Voxel3D.project(entity.px + 8, ground, entity.py + 8)
  assert(x and y and scale, "Pallet occlusion anchor is behind the camera")
  local card = math.max(8, 16 * (Voxel3D.cell or 1) * scale)
  -- depthPacked() intentionally describes only an ACTIVE render pass. This
  -- command runs between frames, after endScene(), so asking that public
  -- function always returned false even when the retained world slot was the
  -- packed fallback. Read the same closed-over `held` record in this
  -- disposable driver instead; no production diagnostic API is added.
  local packed = false
  for index = 1, 32 do
    local name, value = debug.getupvalue(Voxel3D.depthPacked, index)
    if not name then break end
    if name == "held" then
      packed = value and value.packedDepth == true or false
      break
    end
  end
  return x, y, card, VoxelState.angle, packed
end

local function emitPalletOcclusionProbe(entity, hidden)
  local x, y, card, angle, packed = palletOcclusionProjection(entity)
  require("src.web.BrowserEvents").emit("voxel-occlusion-probe",
    string.format('{"x":%.3f,"y":%.3f,"card":%.3f,"angle":%.6f,"hidden":%s,"packed":%s}',
                  x, y, card, angle, hidden and "true" or "false",
                  packed and "true" or "false"))
end

local function reportPalletOcclusionAnchor()
  local G = game()
  local entity = findPalletOcclusionNpc(G)
  if not entity then error("canonical Pallet occlusion NPC is unavailable") end
  emitPalletOcclusionProbe(entity, false)
  return true
end

-- Remove only Oak from the disposable scene's draw list. The before/after
-- crop should be materially identical when the lab already owns every
-- overlapping pixel; a visible card produces a large localized difference.
local function hidePalletOcclusionNpc()
  local G = game()
  local entity = findPalletOcclusionNpc(G)
  if not entity then
    error("canonical Pallet occlusion NPC is unavailable")
  end
  local x, y, card, angle, packed = palletOcclusionProjection(entity)
  for index, candidate in ipairs(G.overworld.entities or {}) do
    if candidate == entity then
      table.remove(G.overworld.entities, index)
      require("src.web.BrowserEvents").emit("voxel-occlusion-probe",
        string.format('{"x":%.3f,"y":%.3f,"card":%.3f,"angle":%.6f,"hidden":true,"packed":%s}',
                      x, y, card, angle, packed and "true" or "false"))
      return true
    end
  end
  error("canonical Pallet occlusion NPC was not in the draw list")
end

function Driver.handle(key)
  if fixtures[key] then return loadFixture(fixtures[key]) end
  if key == "5" then return palletHouseDoor() end
  if key == "6" then return palletHouseExit() end
  if key == "7" then return failActiveVoxelDraw() end
  if key == "8" then return coldPalletHouseExit() end
  if key == "p" then return forcePackedDepth() end
  if key == "r" then return palletLowAngle() end
  -- Preparation reloads the map and therefore invalidates the old GPU slot.
  -- Sampling is a separate command so the browser can wait for a real draw
  -- before asking whether that newly-created slot uses packed depth.
  if key == "9" then preparePalletOcclusionNpc(); return true end
  if key == "o" then return reportPalletOcclusionAnchor() end
  if key == "q" then return hidePalletOcclusionNpc() end
  return false
end

return Driver
