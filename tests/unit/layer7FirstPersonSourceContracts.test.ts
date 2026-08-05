import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const text = (...parts: string[]) => readFileSync(resolve(root, ...parts), 'utf8');

describe('retained first-person integration contracts', () => {
  it('installs the retained camera/free-move seams without replacing base gameplay ownership', () => {
    const main = text('runtime', 'mods', 'dramatic-shape', 'main.lua');
    const scene = text('runtime', 'mods', 'dramatic-shape', 'lib', 'VoxelScene.lua');
    const movement = text('runtime', 'mods', 'dramatic-shape', 'lib', 'FreeMove.lua');
    expect(main).toContain('FirstPerson.install()');
    expect(main).toContain('FreeMove.install()');
    expect(main).toContain('levels = Voxel.ANGLE_LABELS');
    expect(scene).toContain('FirstPerson.frame(me, cx, cy, vw, vh)');
    expect(movement).toContain('state:onStepComplete()');
    expect(movement).toContain('state:takeWarp(w.def)');
    expect(movement).toContain('return inner(self)');
  });

  it('releases only first-person-owned input for every required ownership transition', () => {
    const first = text('runtime', 'mods', 'dramatic-shape', 'lib', 'FirstPerson.lua');
    const main = text('runtime', 'mods', 'dramatic-shape', 'main.lua');
    const bootstrap = text('runtime', 'game', 'src', 'web', 'BrowserBootstrap.lua');
    expect(first).toContain('function FirstPerson.releaseInput()');
    expect(first).toContain('local wantCapture = driving');
    expect(first).toContain('not ow.transitioning');
    expect(first).toContain('if not f then FirstPerson.releaseInput() end');
    expect(main).toContain('mod.events:on("battle.started"');
    expect(main.match(/FirstPerson\.releaseInput\(\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(main).toContain('if firstPersonVisible then');
    expect(main).toContain('firstPersonReleaseSequence = firstPersonReleaseSequence + 1');
    expect(bootstrap).toContain('local path="/tmp/pokevoxel-focus-"..nextSequence');
    expect(bootstrap).toContain('if G and G.focus then G:focus(focused) end');
  });

  it('keeps the scenario matrix disposable and the focused closure exact', () => {
    const driver = text('tests', 'runtime', 'first-person-scenario-driver.lua');
    const pkg = JSON.parse(text('package.json')) as { scripts: Record<string, string> };
    for (const value of ['outdoor', 'indoor', 'cave', 'water', 'scripted-warp', 'random-encounter']) expect(driver).toContain(value);
    expect(driver).toContain('G.overworld:onStepComplete()');
    expect(driver).toContain('G.overworld:takeWarp(def)');
    expect(driver).not.toContain('Encounter.roll =');
    expect(pkg.scripts['test:browser:first-person:focused']).toContain('--first-person-scenarios');
    const browser = text('tests', 'browser', 'first-person.spec.ts');
    expect(browser).toContain("'first-person-parity-probe'");
    expect(browser).toContain('probe.sequence > beforeSequence');
    expect(browser).not.toContain("page.on('console'");
  });
});
