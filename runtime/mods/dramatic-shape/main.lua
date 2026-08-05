-- Pokevoxel's browser-safe Dramatic Shape baseline. It owns the voxel
-- overworld, reflective water, staged battles, retained first- and third-person
-- cameras, shared camera controls, and miniature post-process.
local mod = ...
if mod._pokevoxelLoaded then error("DRAMATIC_SHAPE_DUPLICATE_LOAD") end
mod._pokevoxelLoaded = true

local V = { mod = mod, path = mod.path }
local modules, dataFiles = {}, {}

-- PhysFS supplies executable chunks directly.  Do not use string load: the
-- browser runtime is Lua 5.1 and its archive files are not package.path.
local function chunkFor(relative)
  local path = mod.path .. "/" .. relative
  local chunk, err = love.filesystem.load(path)
  if not chunk then
    error(("DRAMATIC_SHAPE_MODULE_LOAD:%s:%s"):format(relative, tostring(err)), 0)
  end
  return chunk
end

function V.require(name)
  local hit = modules[name]
  if hit ~= nil then return hit end
  local value = chunkFor("lib/" .. name .. ".lua")(V)
  modules[name] = value
  return value
end

function V.data(name)
  local hit = dataFiles[name]
  if hit ~= nil then return hit end
  local value = chunkFor("data/" .. name .. ".lua")(V)
  dataFiles[name] = value
  return value
end

local Voxel = V.require("VoxelState")
local Voxel3D = V.require("Voxel3D")
local VoxelScene = V.require("VoxelScene")
local TiltShift = V.require("TiltShift")
local ChunkMesher = V.require("ChunkMesher")
local VoxelGrid = V.require("VoxelGrid")
local WorldCurve = V.require("WorldCurve")
local DayNight = V.require("DayNight")
local DayTint = V.require("DayTint")
local Water = V.require("Water")
local OverworldBattle = V.require("OverworldBattle")
local BattleExit = V.require("BattleExit")
local AntiAlias = V.require("AntiAlias")
local FirstPerson = V.require("FirstPerson")
local FreeMove = V.require("FreeMove")
local CamControl = V.require("CamControl")
local BrowserEvents = require("src.web.BrowserEvents")

local capabilityReported = false
local drawFailureReported = false
local updateFailureReported = false
local stableKey, emittedKey, streamMap, stableFrames, streamCount = nil, nil, nil, 0, 0
local readyVisible = false
local waterStableKey, waterEmittedKey, waterStableFrames, waterVisible = nil, nil, 0, false
local battleReadyKey = nil
local firstPersonStableKey, firstPersonStableFrames = nil, 0
local firstPersonVisible = false
local firstPersonReleaseSequence = 0
local applyFull

-- The pipeline returns a framebuffer-pixel canvas. Renderer composites that
-- canvas with the window DPI scale, so using logical dimensions here would
-- shrink the scene twice on a high-DPI display.
local function sceneSize(ctx)
  if love.graphics and love.graphics.getPixelDimensions then
    local width, height = love.graphics.getPixelDimensions()
    if width and height and width > 0 and height > 0 then
      return width, height
    end
  end
  return ctx.width, ctx.height
end

local voidFill = { last = nil }
function voidFill.check()
  local TileRenderer = require("src.render.TileRenderer")
  local current = TileRenderer.voidFill
  if voidFill.last ~= nil and current ~= voidFill.last then
    ChunkMesher.invalidate()
  end
  voidFill.last = current
end

local function reportCapability()
  if capabilityReported then return end
  capabilityReported = true
  BrowserEvents.error("POKEVOXEL_VOXEL_CAPABILITY_UNAVAILABLE")
end

local function reportDrawFailure(err)
  FirstPerson.releaseInput()
  if drawFailureReported then return end
  drawFailureReported = true
  -- The browser bridge retains only this bounded source site. Never forward
  -- the raw Lua error: it can contain local paths or runtime payloads.
  local file, line = tostring(err or ""):match("([%w_-]+%.lua):(%d+):")
  local code = "POKEVOXEL_VOXEL_DRAW_FAILED"
  if file and line then
    print(file .. ":" .. line .. ": render exception")
  else
    -- Some LÖVE bindings throw a message without a Lua source site. Retain
    -- only a bounded semantic class: take the final colon-delimited detail,
    -- remove everything except ASCII words/digits, and never print raw input.
    local detail = tostring(err or "unknown"):match(".*:%s*(.-)$")
      or tostring(err or "unknown")
    detail = detail:upper():gsub("[^A-Z0-9]+", "_"):sub(1, 96)
    print("main.lua:185: " .. detail)
    code = "POKEVOXEL_VOXEL_EXCEPTION_" .. detail
  end
  BrowserEvents.error(code)
end

local function reportUpdateFailure()
  FirstPerson.releaseInput()
  if updateFailureReported then return end
  updateFailureReported = true
  BrowserEvents.error("POKEVOXEL_VOXEL_UPDATE_FAILED")
end

local function emitReady(ctx)
  local map = ctx.state and ctx.state.map
  local mapId = map and map.id or "unknown"
  local Game = require("src.core.Game")
  local top = Game.stack and Game.stack:top()
  local menuOpen = top and top.screenId == "StartMenu" or false
  local key = tostring(mapId) .. (menuOpen and "|menu" or "|world")
  if stableKey ~= key then
    stableKey, stableFrames = key, 0
  end
  if streamMap ~= mapId then
    streamMap = mapId
    streamCount = streamCount + 1
  end
  stableFrames = stableFrames + 1
  if stableFrames < 2 or emittedKey == key then return end
  emittedKey = key
  local palette = ctx.paletteFor and ctx.paletteFor(map)
  local paletteName = type(palette) == "table" and "active" or "default"
  local dayNight = DayNight.tod and DayNight.tod() or "DAY"
  local evidence = VoxelScene.evidence()
  local status = Game.modStatus and Game.modStatus.loaded and Game.modStatus.loaded[1]
  local loads = status and tonumber(status.entryLoads) or 0
  BrowserEvents.emit("voxel-ready", string.format(
    '{"map":"%s","loads":%d,"stableFrames":%d,"depth":%s,"npcDepth":%s,"buildingDepth":%s,"palette":"%s","dayNight":"%s","menus":%s,"streamCount":%d,"fallback":false}',
    tostring(mapId), loads, stableFrames, evidence.depth and "true" or "false",
    evidence.npcDepth and "true" or "false",
    evidence.buildingDepth and "true" or "false", paletteName,
    tostring(dayNight), menuOpen and "true" or "false", streamCount))
  readyVisible = true
end

local function clearReady()
  if not readyVisible then return end
  readyVisible = false
  emittedKey = nil
  BrowserEvents.emit("voxel-unready", "{}")
end

local function clearWaterReady()
  waterStableKey, waterEmittedKey, waterStableFrames = nil, nil, 0
  if not waterVisible then return end
  waterVisible = false
  BrowserEvents.emit("water-unready", "{}")
end

local function emitWaterReady(ctx)
  local map = ctx.state and ctx.state.map
  if not map or (map.def and not require("src.world.Map").isOutdoor(map.def)) then
    clearWaterReady()
    return
  end
  local Game = require("src.core.Game")
  local evidence = VoxelScene.waterEvidence()
  if not evidence or not evidence.hadWater then
    clearWaterReady()
    return
  end
  if evidence.failure or not evidence.reflection then
    clearWaterReady()
    BrowserEvents.error(evidence.failure or "POKEVOXEL_WATER_REFLECTION_UNAVAILABLE")
    return
  end
  local mapId = map.id or "unknown"
  local surfing = Game.save and Game.save.surfing or false
  local key = mapId .. "|" .. evidence.mode .. "|" .. tostring(surfing)
  if key ~= waterStableKey then waterStableKey, waterStableFrames = key, 0 end
  waterStableFrames = waterStableFrames + 1
  if waterStableFrames < 2 or waterEmittedKey == key then return end
  waterEmittedKey = key
  BrowserEvents.emit("water-ready", string.format(
    '{"map":"%s","mode":"%s","reflection":true,"animated":%s,"surfing":%s,"indoor":%s,"fallback":false,"stableFrames":%d}',
    tostring(mapId), evidence.mode, evidence.animated and "true" or "false",
    surfing and "true" or "false", "false",
    waterStableFrames))
  waterVisible = true
end

local function emitBattleReady()
  local evidence = OverworldBattle.evidence()
  if not (evidence and evidence.staged) then return end
  local key = evidence.category .. "|" .. evidence.map
  if battleReadyKey == key then return end
  battleReadyKey = key
  BrowserEvents.emit("battle-ready", string.format(
    '{"category":"%s","kind":"%s","map":"%s","staged":true,"fallback":false}',
    evidence.category, evidence.kind, evidence.map))
end

local function clearFirstPersonReady()
  firstPersonStableKey, firstPersonStableFrames = nil, 0
  if not firstPersonVisible then return end
  firstPersonVisible = false
  firstPersonReleaseSequence = firstPersonReleaseSequence + 1
  local e = FirstPerson.evidence()
  BrowserEvents.emit("first-person-released", string.format(
    '{"map":"%s","cellX":%d,"cellY":%d,"facing":"%s","surfing":%s,"driving":%s,"captured":false,"sequence":%d}',
    tostring(e.map), e.cellX, e.cellY, tostring(e.facing),
    e.surfing and "true" or "false", e.driving and "true" or "false",
    firstPersonReleaseSequence))
end

local function emitFirstPersonReady()
  local e = FirstPerson.evidence()
  if not (e.engaged and e.driving and e.captured and e.camera
      and e.blend >= 0.98) then
    clearFirstPersonReady()
    return
  end
  local key = table.concat({ e.map, e.cellX, e.cellY, e.facing,
                             e.surfing and "surf" or "land" }, "|")
  if key ~= firstPersonStableKey then
    firstPersonStableKey, firstPersonStableFrames = key, 0
  end
  firstPersonStableFrames = firstPersonStableFrames + 1
  if firstPersonStableFrames < 2 or firstPersonVisible then return end
  firstPersonVisible = true
  BrowserEvents.emit("first-person-ready", string.format(
    '{"map":"%s","cellX":%d,"cellY":%d,"facing":"%s","surfing":%s,"driving":true,"captured":true,"camera":true,"stableFrames":%d,"fallback":false}',
    tostring(e.map), e.cellX, e.cellY, tostring(e.facing),
    e.surfing and "true" or "false", firstPersonStableFrames))
end

mod.content.render_pipelines:register("voxel", {
  label = "VOXEL",
  levels = Voxel.ANGLE_LABELS,
  hotkey = "3",
  priority = 20,
  defaultLevel = 1,
  available = function()
    local ready = Voxel3D.available()
    if not ready then
      clearReady()
      reportCapability()
    end
    return ready
  end,
  update = function(dt, level)
    local ok, err = pcall(function()
      applyFull(level)
      Voxel.update(dt, level)
      FirstPerson.update(dt)
      if firstPersonVisible then
        local e = FirstPerson.evidence()
        if not (e.engaged and e.driving and e.captured and e.camera) then
          clearFirstPersonReady()
        end
      end
      DayNight.update(dt)
      OverworldBattle.update(dt)
      emitBattleReady()
      voidFill.check()
      if not Voxel.active() then return end
      local Game = require("src.core.Game")
      local ow = Game and Game.overworld
      if ow and ow.map and ow.camera then VoxelScene.prefetch(ow) end
      ChunkMesher.pump(Game and Game.stack and Game.stack:top() ~= ow)
    end)
    if not ok then
      clearReady()
      FirstPerson.releaseInput()
      clearFirstPersonReady()
      reportUpdateFailure()
      error(err, 0)
    end
  end,
  drawWorld = function(ctx)
    local width, height = sceneSize(ctx)
    local renderWidth, renderHeight = AntiAlias.expand(width, height)
    local ok, canvas, renderFailure = pcall(VoxelScene.render, ctx.state,
                             renderWidth, renderHeight,
                             ctx.vw, ctx.vh, ctx.paletteFor)
    if not ok then
      clearReady()
      FirstPerson.releaseInput()
      clearFirstPersonReady()
      reportDrawFailure(canvas)
      return nil
    end
    -- The async mesher intentionally returns nil until the current map's first
    -- real terrain mesh lands. That is startup, not a failed draw; readiness
    -- remains absent and the engine may show its ordinary world for the brief
    -- build interval, but it can never count as a voxel pass.
    if renderFailure and tostring(renderFailure):match("^POKEVOXEL_") then
      clearReady()
      clearWaterReady()
      FirstPerson.releaseInput()
      clearFirstPersonReady()
      BrowserEvents.error(renderFailure)
      return nil
    end
    -- A clean nil is the asynchronous map-mesh handoff. `Voxel.ready` can
    -- still describe the previous map for this event turn, so it must not
    -- promote a transient frame into a permanent shell error. Real render
    -- failures arrive above as a caught exception or a fixed failure code.
    if not canvas then
      clearReady()
      return nil
    end
    if Voxel3D.beginOverlay() then
      ctx.drawFx(function(wx, wy) return Voxel3D.project(wx, 0, wy) end,
                 ctx.scale * AntiAlias.factor())
      Voxel3D.endOverlay()
    end
    emitReady(ctx)
    emitWaterReady(ctx)
    emitFirstPersonReady()
    return AntiAlias.resolve(canvas, width, height, "world")
  end,
  invalidate = function()
    clearReady()
    clearWaterReady()
    FirstPerson.releaseInput()
    clearFirstPersonReady()
    stableKey, emittedKey, streamMap, stableFrames = nil, nil, nil, 0
    Voxel3D.invalidate()
    OverworldBattle.invalidate()
    ChunkMesher.invalidate()
  end,
})

mod.content.render_pipelines:register("tiltshift", {
  label = "T-SHIFT",
  levels = TiltShift.LABELS,
  hotkey = "6",
  priority = 10,
  update = function(dt, level) TiltShift.update(dt, level) end,
  worldPresent = function(canvas) return TiltShift.apply(canvas) end,
  invalidate = function() TiltShift.invalidate() end,
})

-- FULL is the stable mod's one-shot diorama preset. It sets the other rows on
-- entry and then releases them so the player may adjust the result.
local fullWas = nil
applyFull = function(level)
  local full = Voxel.isFull(level)
  local was = fullWas
  fullWas = full
  if not full or was == true or was == nil then return end
  local Game = require("src.core.Game")
  local Pipelines = require("src.render.Pipelines")
  local Zoom = require("src.render.Zoom")
  local options = Game.save and Game.save.options
  if not options then return end
  Pipelines.setLevel("tiltshift", Pipelines.maxLevel("tiltshift"))
  Pipelines.syncOptions(options)
  WorldCurve.setting:setIndex(1, Game)
  Water.setting:setIndex(1, Game)
  options.zoom = 0
  Zoom.applyOptions(options)
  OverworldBattle.setting:setIndex(1, Game)
  OverworldBattle.backSetting:setIndex(1, Game)
  OverworldBattle.forceOG(Game)
  DayNight.forceSync(Game)
  if Game.writeOptions then pcall(Game.writeOptions, Game) end
end

local function stagedBattles()
  return OverworldBattle.enabled()
end

local SETTINGS = {
  { VoxelGrid.setting, "One-pixel wireframe along every voxel edge." },
  { WorldCurve.setting,
    "Bend the world down over the horizon, Animal Crossing style." },
  { Water.setting,
    "Reflections on water. FULL adds the shoreline, trees and buildings; "
      .. "SKY keeps the sky, sun and moon at lower cost." },
  { OverworldBattle.setting,
    "Fight on the map with the stable staged battle camera.", full = true },
  { OverworldBattle.backSetting,
    "Keep your Pokemon's original back sprite on the battle menu.",
    when = stagedBattles, full = true },
  { DayNight.setting,
    "Choose the stable outdoor day, night, cycle or clock-synced lighting." },
  { AntiAlias.setting,
    "Supersample the 3D scene to smooth geometry and sprite-card edges.",
    full = true },
}

local optionSchema = {}
for _, entry in ipairs(SETTINGS) do
  optionSchema[#optionSchema + 1] = entry[1]:schema(entry[2])
end
mod.options:define(optionSchema)

local function cycleVoxel(game)
  local Pipelines = require("src.render.Pipelines")
  local top = game.stack and game.stack:top()
  if not Pipelines.canToggle("voxel", top, game.overworld) then return false end
  Pipelines.setLevel("voxel", Voxel.nextHotkeyLevel(Pipelines.level("voxel")))
  Pipelines.syncOptions(game.save.options)
  game.save.options.tilt = 0
  game.save.options.gbcfx = 0
  require("src.render.GBCFX").setLevel(0)
  require("src.render.Tilt").setLevel(0)
  game:writeOptions()
  return true
end

local HOTKEYS = {
  ["3"] = "pipeline",
  ["6"] = "pipeline",
  ["5"] = VoxelGrid.setting,
  ["7"] = WorldCurve.setting,
  ["8"] = OverworldBattle.setting,
  ["9"] = Water.setting,
}

do
  local Game = require("src.core.Game")
  if not Game.dramaticShapeCameraKeys then
    local Pipelines = require("src.render.Pipelines")
    local inner = Game.keypressed
    function Game:keypressed(key, ...)
      local top = self.stack and self.stack:top()
      if (key == "q" or key == "e") and not (top and top.onKeyPressed)
          and CamControl.zoomBy(key == "q" and 1 or -1) then
        return
      end
      local claim = HOTKEYS[key]
      if claim and not (top and top.onKeyPressed) then
        if claim == "pipeline" then
          if key == "3" then
            if cycleVoxel(self) then return end
          elseif Pipelines.hotkey(key, top, self.overworld) then
            Pipelines.syncOptions(self.save.options)
            require("src.render.Tilt").setLevel(self.save.options.tilt or 0)
            self:writeOptions()
            return
          end
        elseif Pipelines.canToggle("voxel", top, self.overworld) then
          claim:cycle(self)
          if stagedBattles() then OverworldBattle.forceOG(self) end
          return
        end
      end
      return inner(self, key, ...)
    end
    Game.dramaticShapeCameraKeys = true
  end
end

local function insertGrouped(rows, extra)
  local anchor = nil
  for index, row in ipairs(rows) do
    local id = type(row) == "table" and row.id
    if id == "pipeline:voxel" or id == "pipeline:tiltshift" then
      anchor = index
    end
  end
  if not anchor then
    for _, row in ipairs(extra) do rows[#rows + 1] = row end
    return rows
  end
  for index, row in ipairs(extra) do table.insert(rows, anchor + index, row) end
  return rows
end

local function dropRow(rows, id)
  for index = #rows, 1, -1 do
    if type(rows[index]) == "table" and rows[index].id == id then
      table.remove(rows, index)
    end
  end
end

local function pinEngineFx(game)
  game = game or require("src.core.Game")
  local options = game and game.save and game.save.options
  local changed = false
  if options then
    changed = (options.tilt or 0) ~= 0 or (options.gbcfx or 0) ~= 0
      or (options.battleBg or "white") ~= "white"
    options.tilt, options.gbcfx, options.battleBg = 0, 0, "white"
  end
  pcall(require("src.render.Tilt").setLevel, 0)
  pcall(require("src.render.GBCFX").setLevel, 0)
  if changed and game.writeOptions then pcall(game.writeOptions, game) end
end

mod.hooks:wrap("ui.options.rows", function(next, game, rows)
  local output = next(game, rows)
  if type(output) ~= "table" then return output end
  local Pipelines = require("src.render.Pipelines")
  pinEngineFx(game)
  dropRow(output, "tilt")
  dropRow(output, "gbcfx")
  dropRow(output, "battleBg")
  if stagedBattles() then
    OverworldBattle.forceOG(game)
    dropRow(output, "battleLayout")
  end
  local full = Voxel.isFull(Pipelines.level("voxel"))
  if full then
    DayNight.forceSync(game)
    dropRow(output, "pipeline:tiltshift")
  end
  local extra = {}
  for _, entry in ipairs(SETTINGS) do
    if (entry.full or not full) and (not entry.when or entry.when()) then
      extra[#extra + 1] = entry[1]:row()
    end
  end
  return insertGrouped(output, extra)
end)

mod.events:on("mod.options_changed", function(payload)
  if not (payload and payload.mod == mod.id) then return end
  for _, entry in ipairs(SETTINGS) do
    if payload.key == entry[1].key then entry[1]:sync(payload.value) end
  end
  if stagedBattles() then OverworldBattle.forceOG() end
  local Pipelines = require("src.render.Pipelines")
  if Voxel.isFull(Pipelines.level("voxel")) then DayNight.forceSync() end
end)

mod.events:on("world.block_replaced", function(payload)
  local mapId = payload and (payload.mapId or (payload.map and payload.map.id))
  if mapId then ChunkMesher.refresh(mapId) end
end)

do
  local Map = require("src.world.Map")
  if not Map.dramaticShapeBlockHook then
    local setBlock = Map.setBlock
    Map.setBlock = function(self, bx, by, block)
      local before = self:blockAt(bx, by)
      setBlock(self, bx, by, block)
      if self.id and self:blockAt(bx, by) ~= before then
        ChunkMesher.refresh(self.id)
      end
    end
    Map.dramaticShapeBlockHook = true
  end
end

mod.events:on("map.reloaded", function(payload)
  if payload and payload.reason == "colors" then return end
  local mapId = payload and (payload.mapId or (payload.map and payload.map.id))
  if mapId then ChunkMesher.invalidate(mapId) end
end)

-- Battles keep the engine's own state machine, menus, rewards, save data and
-- return transition. These hooks change only the presentation surface behind
-- that state and restore the exact overworld cast and player cell on exit.
OverworldBattle.install()
FirstPerson.install()
FreeMove.install()
CamControl.install()

-- Rebuild the live options rows when FULL or staged battles change which
-- stable rows are meaningful.
do
  local OptionsMenu = require("src.ui.OptionsMenu")
  if not OptionsMenu.dramaticShapeFullHook then
    local Pipelines = require("src.render.Pipelines")
    local inner = OptionsMenu.update
    local function idAt(menu, index)
      local row = menu.rows and menu.rows[index or 1]
      return type(row) == "table" and row.id or nil
    end
    function OptionsMenu:update(dt)
      local before = Pipelines.level("voxel")
      local hadBattles = OverworldBattle.enabled()
      local selected = idAt(self, self.index)
      inner(self, dt)
      local after = Pipelines.level("voxel")
      local crossedFull = after ~= before
        and (Voxel.isFull(before) or Voxel.isFull(after))
      if crossedFull or OverworldBattle.enabled() ~= hadBattles then
        local rebuilt = OptionsMenu.new(self.game)
        self.rows = rebuilt.rows
        for index = 1, #self.rows do
          if selected and idAt(self, index) == selected then
            self.index = index
            break
          end
        end
        local cancel = #self.rows + 1
        if (self.index or 1) > cancel then self.index = cancel end
      end
    end
    OptionsMenu.dramaticShapeFullHook = true
  end
end

-- SELECT walks the stable camera ladder on controllers and touch layouts.
do
  local OverworldState = require("src.world.OverworldController")
  if not OverworldState.dramaticShapeSelectHook then
    local inner = OverworldState.handleInput
    function OverworldState:handleInput(...)
      local Game = require("src.core.Game")
      local input = Game.input
      if input and input.wasPressed and input:wasPressed("select") then
        if cycleVoxel(Game) then return end
      end
      return inner(self, ...)
    end
    OverworldState.dramaticShapeSelectHook = true
  end
end

mod.content.transitions:register(BattleExit.ID, {
  frames = BattleExit.FRAMES,
})
BattleExit.install()
DayTint.install()

mod.events:on("battle.started", function(payload)
  FirstPerson.releaseInput()
  clearFirstPersonReady()
  battleReadyKey = nil
  OverworldBattle.ensure(payload and payload.battle)
end)
mod.hooks:wrap("pokemon.sprite", function(next, path, ctx)
  local out = next(path, ctx)
  if not (ctx and ctx.kind == "battle" and ctx.side == "back") then
    return out
  end
  if not OverworldBattle.wantsFront() then return out end
  local def = ctx.data and ctx.data.pokemon and ctx.data.pokemon[ctx.species]
  return (def and def.spriteFront) or out
end)
mod.events:on("battle.ended", function()
  local evidence = OverworldBattle.finish()
  battleReadyKey = nil
  if not evidence then return end
  BrowserEvents.emit("battle-returned", string.format(
    '{"category":"%s","map":"%s","returned":%s,"castRestored":%s}',
    evidence.category, evidence.map,
    evidence.returned and "true" or "false",
    evidence.castRestored and "true" or "false"))
end)

-- Retain the upstream save-slot clock contract. Time belongs to the journey,
-- so an ordinary browser save and reload must restore the same period instead
-- of silently restarting the mod clock.
mod.events:on("save.writing", function()
  DayNight.store()
end)

mod.events:on("save.loaded", function()
  DayNight.restore()
  pinEngineFx()
end)

mod.events:on("save.created", function()
  DayNight.restore()
  pinEngineFx()
end)

-- Feed the mod's retained clock through the engine's canonical time-of-day
-- hook so palettes, music, and voxel lighting agree after every reload.
mod.hooks:wrap("world.tod", function(next, tod, ctx)
  local out = next(tod, ctx)
  if out ~= tod then return out end
  return DayNight.tod()
end)

mod.exports.version = "1.5.5-pokevoxel-compatible-stable"
mod.exports.lib = V
return mod
