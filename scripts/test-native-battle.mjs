#!/usr/bin/env node
/** Native Layer 7B lifecycle smoke against the exact shipped battle module. */
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const product = resolve(dirname(new URL(import.meta.url).pathname), '..');
const love = [
  process.env.POKEVOXEL_NATIVE_LOVE,
  '/Applications/love.app/Contents/MacOS/love',
  '/opt/homebrew/bin/love',
].filter(Boolean).find(existsSync);
const timeoutMs = Number(process.env.POKEVOXEL_NATIVE_BATTLE_TIMEOUT_MS ?? 30_000);
const mod = join(product, 'runtime', 'mods', 'dramatic-shape');
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 5_000) throw new Error('POKEVOXEL_NATIVE_BATTLE_TIMEOUT_MS must be an integer of at least 5000.');
if (!love) throw new Error('native LÖVE executable is unavailable; set POKEVOXEL_NATIVE_LOVE to an 11.4-compatible executable.');
if (!existsSync(mod)) throw new Error(`native battle gate input is missing: ${mod}`);

const battleDriver = String.raw`local state
local delegated
local game = { save = { options = { battleLayout = "wide" } } }
function game:writeOptions() self.optionsWritten = true end

local OverworldState = {}
function OverworldState:pushBattle(battle) delegated = battle; return "delegated" end
local BattleState = {
  resolveBattleScale = function() return 1 end,
  picImage = function(_, image) return image end,
  backPlacement = function() return 0, 0, 1 end,
  frontPlacement = function() return 0, 0, 1 end,
  draw = function() end,
  drawPicsLayer = function() end,
  drawTextArea = function() end,
  drawAnimLayer = function() end,
  drawZonePass = function() end,
  drawHUDs = function() end,
}
package.preload["src.world.OverworldController"] = function() return OverworldState end
package.preload["src.battle.BattleState"] = function() return BattleState end
package.preload["src.core.Game"] = function() return game end

local modules = {
  ModSetting = { new = function()
    return { get = function() return true end }
  end },
  BattleArena = { find = function()
    return { shape = "native", player = { 0, 0 }, enemy = { 16, 0 } }
  end },
  BattleCam = { reset = function() end, update = function() end },
  BattleScene = {},
  BattleDOF = { invalidate = function() end },
  BattleHud = { invalidate = function() end },
  BattlePics = { invalidate = function() end },
  Voxel3D = { available = function() return true end },
  ChunkMesher = { pump = function() end },
}
local V = { mod = { log = { warn = function() end } } }
function V.require(name) return assert(modules[name], "missing stub " .. name) end

local chunk = assert(love.filesystem.load("mods/dramatic-shape/lib/OverworldBattle.lua"))
local Battles = chunk(V)

local categories = {
  { "wild", { kind = "wild", enemy = { mon = { species = "RATTATA" } } } },
  { "trainer", { kind = "trainer", oppClass = "OPP_YOUNGSTER" } },
  { "rival", { kind = "trainer", oppClass = "OPP_RIVAL1" } },
  { "gym", { kind = "trainer", oppClass = "OPP_BROCK", isGymLeader = true } },
  { "jessie-james", { kind = "trainer", oppClass = "OPP_ROCKET", partyIndex = 42 } },
  { "legendary", { kind = "wild", enemy = { mon = { species = "MEWTWO" } } } },
  { "elite-four", { kind = "trainer", oppClass = "OPP_LORELEI" } },
  { "final", { kind = "trainer", oppClass = "OPP_RIVAL3" } },
}
for _, row in ipairs(categories) do
  assert(Battles.category(row[2]) == row[1], "native category mismatch: " .. row[1])
end

Battles.install()
local originalEntities = { { id = "player" }, { id = "npc" } }
local originalGhosts = { { id = "ghost" } }
state = {
  map = { id = "PALLET_TOWN" },
  player = { cellX = 5, cellY = 6 },
  entities = originalEntities,
  ghosts = originalGhosts,
}
local battle = categories[2][2]
battle.battleKind = function(self) return self.kind end
assert(OverworldState.pushBattle(state, battle) == "delegated")
assert(delegated == battle, "wrapped pushBattle did not delegate")
assert(state.entities ~= originalEntities and #state.entities == 1,
  "battle begin did not cull the overworld cast")
local evidence = assert(Battles.finish())
assert(evidence.returned and evidence.castRestored,
  "battle finish did not restore the native overworld")
assert(state.entities == originalEntities and state.ghosts == originalGhosts,
  "battle finish did not restore list identity")
assert(state.player.cellX == 5 and state.player.cellY == 6,
  "battle presentation moved the player")
assert(game.save.options.battleLayout == "og" and game.optionsWritten,
  "staged battle did not pin the compatible layout")
print("[battle] native parity: 8 categories, delegated state, exact return")

function love.load() love.event.quit(0) end
`;

const root = mkdtempSync(join(tmpdir(), 'pokevoxel-native-battle-'));
let child;
try {
  cpSync(mod, join(root, 'mods', 'dramatic-shape'), { recursive: true });
  writeFileSync(join(root, 'battle_driver.lua'), battleDriver);
  writeFileSync(join(root, 'main.lua'), 'require("battle_driver")\n');
  const status = await new Promise((resolveExit, rejectExit) => {
    child = spawn(love, ['.'], { cwd: root, stdio: 'inherit', detached: true });
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    }, timeoutMs);
    child.once('error', rejectExit);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      signal ? rejectExit(new Error('native battle driver was terminated.')) : resolveExit(code ?? 1);
    });
  });
  if (status !== 0) process.exitCode = status;
} finally {
  if (child?.exitCode === null) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  }
  rmSync(root, { recursive: true, force: true });
}
