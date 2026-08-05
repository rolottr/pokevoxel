import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const text = (...parts: string[]) => readFileSync(resolve(root, ...parts), 'utf8');

describe('isolated test-audio runtime contracts', () => {
  it('builds a disposable artifact from an exact Bootstrap anchor and never targets public/runtime', () => {
    const build = text('scripts', 'build-test-runtime.mjs');
    expect(build).toContain("const anchor = 'function B.keypressed(key) end'");
    expect(build).toContain("source.split(anchor).length !== 2");
    expect(build).toContain("test runtime output must be a child of .pokevoxel-test-data/runs/<run-id>");
    expect(build).toContain('realpathSync(existing)');
    expect(build).toContain("archiveDriver: 'AudioScenario.lua'");
    expect(build).toContain('variant: `test-${scenarioName}`');
  });

  it('uses production-equivalent generic files while keeping the generated archive test-specific', () => {
    const build = text('scripts', 'build-test-runtime.mjs');
    const audit = text('scripts', 'audit-test-runtime.mjs');
    expect(build).toContain("['love.js', 'love.wasm', 'love.worker.js']");
    expect(audit).toContain("test runtime generic file differs from public runtime");
    expect(audit).toContain("production archive includes a test scenario driver");
    expect(audit).toContain("test bootstrap does not contain exactly one guarded scenario patch");
  });

  it('keeps deterministic controls outside production source and exercises real low-health state logic', () => {
    const driver = text('tests', 'runtime', 'audio-scenario-driver.lua');
    for (const key of ['key == "1"', 'key == "2"', 'key == "3"', 'key == "4"', 'key == "5"', 'key == "6"', 'key == "7"']) expect(driver).toContain(key);
    expect(driver).toContain('battle:updateFx()');
    expect(driver).toContain('return battle.lowHealthAlarmOn');
    expect(driver).toContain('Music.playMap(data, "PALLET_TOWN"');
    expect(driver).toContain('Music.special(data, "title")');
    expect(driver).toContain('return false');
  });
});

describe('isolated test-voxel runtime contracts', () => {
  it('selects the voxel scenario explicitly and preserves the production generic runtime', () => {
    const build = text('scripts', 'build-test-runtime.mjs');
    const audit = text('scripts', 'audit-test-runtime.mjs');
    expect(build).toContain("const scenarioName = argument('--scenario') ?? 'audio'");
    expect(build).toContain("marker: 'POKEVOXEL_TEST_VOXEL_SCENARIOS'");
    expect(audit).toContain("'test-voxel'");
    expect(audit).toContain("'VoxelScenario.lua'");
  });
});

describe('isolated test-battle runtime contracts', () => {
  it('keeps the encounter matrix in the disposable archive only', () => {
    const build = text('scripts', 'build-test-runtime.mjs');
    const audit = text('scripts', 'audit-test-runtime.mjs');
    expect(build).toContain("marker: 'POKEVOXEL_TEST_BATTLE_SCENARIOS'");
    expect(build).toContain("archiveDriver: 'BattleScenario.lua'");
    expect(audit).toContain("'test-battle'");
    expect(audit).toContain("'BattleScenario.lua'");
  });
});

describe('isolated test-first-person runtime contracts', () => {
  it('keeps the parity matrix in the disposable archive only', () => {
    const build = text('scripts', 'build-test-runtime.mjs');
    const audit = text('scripts', 'audit-test-runtime.mjs');
    expect(build).toContain("marker: 'POKEVOXEL_TEST_FIRST_PERSON_SCENARIOS'");
    expect(build).toContain("archiveDriver: 'FirstPersonScenario.lua'");
    expect(audit).toContain("'test-first-person'");
    expect(audit).toContain("'FirstPersonScenario.lua'");
  });
});
