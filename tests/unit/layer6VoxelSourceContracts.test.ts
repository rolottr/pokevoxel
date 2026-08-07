import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const text = (...parts: string[]) => readFileSync(resolve(root, ...parts), 'utf8');

describe('Layer 6 voxel harness contracts', () => {
  it('accepts only the bounded post-draw voxel readiness schema', () => {
    const events = text('src', 'runtime', 'runtimeEvents.ts');
    expect(events).toContain("'voxel-ready'");
    expect(events).toContain('function isVoxelProbe');
    expect(events).toContain("'PALLET_TOWN' | 'REDS_HOUSE_1F' | 'VIRIDIAN_FOREST' | 'ROCK_TUNNEL_1F'");
    expect(events).toContain('(value.loads as number) === 1');
    expect(events).toContain('(value.stableFrames as number) >= 2');
    expect(events).toContain('typeof value.npcDepth');
    expect(events).toContain('typeof value.buildingDepth');
  });

  it('keeps fixture selection and the Pallet house warp entirely in a disposable driver', () => {
    const driver = text('tests', 'runtime', 'voxel-scenario-driver.lua');
    for (const fixture of ['PALLET_TOWN', 'REDS_HOUSE_1F', 'VIRIDIAN_FOREST', 'ROCK_TUNNEL_1F']) expect(driver).toContain(fixture);
    expect(driver).toContain('G.overworld:takeWarp(warp)');
    expect(driver).toContain('palletHouseExit');
    expect(driver).toContain('debug.getupvalue(Voxel3D.beginScene, index)');
    expect(driver).toContain('debug.setupvalue(Voxel3D.beginScene, index, function() return nil end)');
    expect(driver).toContain('Voxel3D.invalidate()');
    expect((driver.match(/G\.overworld:takeWarp\(warp\)/g) ?? [])).toHaveLength(3);
    expect(text('runtime', 'game', 'src', 'web', 'BrowserBootstrap.lua')).not.toContain('POKEVOXEL_TEST_VOXEL_SCENARIOS');
  });

  it('builds an isolated voxel archive and rejects test-only code in production', () => {
    const build = text('scripts', 'build-test-runtime.mjs');
    const audit = text('scripts', 'audit-test-runtime.mjs');
    expect(build).toContain("voxel: {");
    expect(build).toContain("'voxel-scenario-driver.lua'");
    expect(build).toContain("variant: `test-${scenarioName}`");
    expect(audit).toContain("'test-voxel'");
    expect(audit).toContain("'VoxelScenario.lua'");
    expect(audit).toContain('production archive includes a test scenario driver');
  });

  it('runs the exact focused browser lane and audits removed integrations in the archive', () => {
    const pkg = JSON.parse(text('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['test:browser:voxel:focused']).toContain('--voxel-scenarios');
    expect(pkg.scripts['test:browser:voxel:focused']).toContain('voxel-overworld.spec.ts');
    expect(text('scripts', 'audit-runtime.mjs')).toContain('forbiddenVoxel');
  });

  it('loads only the fixed audited built-in and leaves menu composition above the world pass', () => {
    const loader = text('runtime', 'game', 'src', 'mods', 'Loader.lua');
    expect(loader).toContain('{ id = "DRAMATIC_SHAPE", path = "mods/dramatic-shape" }');
    expect(loader).toContain('{ id = "pokeaudio-hd", path = "mods/pokeaudio-hd" }');
    expect(loader).not.toContain('self.fs.getDirectoryItems(root)');
    const stack = text('runtime', 'game', 'src', 'core', 'StateStack.lua');
    expect(stack).toContain('for i = self:visibleBase(), #self.states do');
    const overworld = text('runtime', 'game', 'src', 'world', 'OverworldController.lua');
    expect(overworld.indexOf('self:drawWorld()')).toBeLessThan(overworld.indexOf('self:drawUI()'));
  });

  it('invalidates stale readiness across every capability, update, draw, and context-loss exit', () => {
    const main = text('runtime', 'mods', 'dramatic-shape', 'main.lua');
    expect(main).toMatch(/if not ready then\s+clearReady\(\)\s+reportCapability\(\)/);
    expect(main).toMatch(/if not ok then\s+clearReady\(\)[\s\S]*?reportUpdateFailure\(\)/);
    expect(main).toMatch(/if not ok then\s+clearReady\(\)[\s\S]*?reportDrawFailure\(canvas\)/);
    expect(main).toMatch(/if renderFailure[^\n]*then\s+clearReady\(\)\s+clearWaterReady\(\)/);
    expect(main).toMatch(/if not canvas then\s+clearReady\(\)/);
    expect(main).toMatch(/invalidate = function\(\)\s+clearReady\(\)/);
    expect(main).toContain('BrowserEvents.emit("voxel-unready", "{}")');
    const browser = text('tests', 'browser', 'voxel-overworld.spec.ts');
    expect(browser).toContain("await voxel.command('7')");
    expect(browser).toContain('toBeUndefined()');
  });
});
