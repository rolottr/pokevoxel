-- Test-only deterministic audio controls. This file is copied exclusively
-- into the ephemeral browser-test .love archive; it is never part of the
-- public runtime allowlist.
local Music = require("src.core.Music")
local Sound = require("src.core.Sound")
local BattleState = require("src.battle.BattleState")

local Driver = {}
local muted = false

local function gameData()
  local game = _G.POKEVOXEL_GAME
  return game and game.data or nil
end

local function lowHealth(data, hp)
  -- Exercise the real BattleState latch and updateFx path rather than
  -- invoking Sound directly. The fixture has the minimum live HUD state the
  -- production predicate requires.
  local battle = setmetatable({
    data = data,
    player = { mon = { hp = hp, stats = { hp = 100 } }, shownHP = hp },
    showPlayerBack = false,
    introSlide = 0,
  }, BattleState)
  battle:updateFx()
  return battle.lowHealthAlarmOn
end

function Driver.handle(key)
  local data = gameData()
  if not data then return false end
  if key == "1" then
    Music.play(data, Music.special(data, "title"), nil, { reason = "title" })
    return true
  elseif key == "2" then
    Music.playMap(data, "PALLET_TOWN", false, false)
    return true
  elseif key == "3" then
    Music.playBattle(data, "wild")
    return true
  elseif key == "4" then
    return lowHealth(data, 5)
  elseif key == "5" then
    lowHealth(data, 100)
    return true
  elseif key == "6" then
    Music.playVictory(data, "wild")
    return true
  elseif key == "7" then
    muted = not muted
    local level = muted and 0 or 7
    Music.setVolumeLevel(level)
    Sound.setVolumeLevel(level)
    return true
  end
  return false
end

return Driver
