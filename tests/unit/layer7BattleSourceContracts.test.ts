import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const source = (...parts: string[]) => readFileSync(resolve(root, ...parts), 'utf8');

describe('Layer 7B staged battle contracts', () => {
  it('activates the retained presentation module on the always-running voxel tick', () => {
    const main = source('runtime', 'mods', 'dramatic-shape', 'main.lua');
    expect(main).toContain('local OverworldBattle = V.require("OverworldBattle")');
    expect(main).toContain('OverworldBattle.update(dt)');
    expect(main).toContain('OverworldBattle.install()');
    expect(main).toContain('mod.events:on("battle.started"');
    expect(main).toContain('mod.events:on("battle.ended"');
    expect(main).toContain('OverworldBattle.finish()');
  });

  it('covers every required encounter category with real BattleState constructors', () => {
    const driver = source('tests', 'runtime', 'battle-scenario-driver.lua');
    for (const category of ['wild', 'trainer', 'rival', 'gym', 'jessie-james', 'legendary', 'elite-four', 'final']) {
      expect(driver).toContain(`category = "${category}"`);
    }
    expect(driver).toContain('BattleState.newWild');
    expect(driver).toContain('BattleState.newTrainer');
    expect(driver).toContain('G.overworld:pushBattle(battle)');
    expect(driver).toContain('battle:finish()');
    expect(driver).toContain('G:writeSave()');
  });

  it('keeps battle rules and world position owned by the base game', () => {
    const battle = source('runtime', 'mods', 'dramatic-shape', 'lib', 'OverworldBattle.lua');
    for (const method of ['playerMonFainted', 'enemyMonFainted', 'useItem', 'switchPlayer', 'applyStatus', 'finishEvolution']) {
      expect(battle).not.toContain(`BattleState.${method}`);
    }
    expect(battle).toContain('return inner(self, battle)');
    expect(battle).toContain('state.player.cellX == finished.x');
    expect(battle).toContain('state.player.cellY == finished.y');
    expect(battle).toContain('finished.castRestored');
  });
});
