-- POKEVOXEL_TEST_BATTLE_SCENARIOS: injected only into the disposable archive.
-- It constructs real Yellow BattleState instances for each required encounter
-- class and drives them through the overworld's ordinary push/finish seams.
local Driver = {}

local encounters = {
  ["1"] = { category = "wild", kind = "wild", species = "RATTATA", level = 5 },
  ["2"] = { category = "trainer", kind = "trainer", trainer = "OPP_YOUNGSTER", party = 1 },
  ["3"] = { category = "rival", kind = "trainer", trainer = "OPP_RIVAL1", party = 1 },
  ["4"] = { category = "gym", kind = "trainer", trainer = "OPP_BROCK", party = 1 },
  ["5"] = { category = "jessie-james", kind = "trainer", trainer = "OPP_ROCKET", party = 42 },
  ["6"] = { category = "legendary", kind = "wild", species = "MEWTWO", level = 70 },
  ["7"] = { category = "elite-four", kind = "trainer", trainer = "OPP_LORELEI", party = 1 },
  ["8"] = { category = "final", kind = "trainer", trainer = "OPP_RIVAL3", party = 1 },
}

local function game()
  local G = assert(_G.POKEVOXEL_GAME, "battle scenario requires a running game")
  local loaded = G.modStatus and G.modStatus.loaded or {}
  assert(#loaded == 1 and loaded[1].id == "DRAMATIC_SHAPE",
    "battle scenario requires the built-in Dramatic Shape mod")
  return G
end

local function battleApi(G)
  local exports = assert(G.mods and G.mods.exports and
    G.mods.exports.DRAMATIC_SHAPE, "Dramatic Shape exports unavailable")
  return assert(exports.lib and exports.lib.require,
    "Dramatic Shape module API missing")("OverworldBattle")
end

local function resetOverworld(G)
  while G.stack:top() and G.stack:top() ~= G.overworld do G.stack:pop() end
  if G.stack:top() ~= G.overworld or not G.overworld.map then
    G.stack:init()
    G.stack:push(G.overworld, "PALLET_TOWN", 5, 6, "down")
  elseif G.overworld.map.id ~= "PALLET_TOWN" then
    G.overworld:setMap("PALLET_TOWN", 5, 6, "down",
      { via = "test-battle-fixture" })
  end
end

local function ensureParty(G)
  local Pokemon = require("src.pokemon.Pokemon")
  if not (G.save.party and G.save.party[1]) then
    G.save.party = { Pokemon.new(G.data, "PIKACHU", 50) }
  end
  G.save.party[1].hp = G.save.party[1].stats.hp
end

local function startBattle(spec)
  local G = game()
  resetOverworld(G)
  ensureParty(G)
  local BattleState = require("src.battle.BattleState")
  local battle = spec.kind == "wild"
    and BattleState.newWild(G, spec.species, spec.level)
    or BattleState.newTrainer(G, spec.trainer, spec.party)
  assert(battleApi(G).category(battle) == spec.category,
    "battle category classifier disagrees with the fixture")
  battle.onFinish = function() end
  G.overworld:pushBattle(battle)
  return true
end

local function finishBattle()
  local G = game()
  local battle = battleApi(G).battle()
  assert(battle, "no staged battle to finish")
  battle.result = "run"
  battle:finish()
  assert(G:writeSave(), "post-battle save failed")
  return true
end

function Driver.handle(key)
  if key == "0" then
    resetOverworld(game()); return true
  end
  if encounters[key] then return startBattle(encounters[key]) end
  if key == "9" then return finishBattle() end
  return false
end

return Driver
