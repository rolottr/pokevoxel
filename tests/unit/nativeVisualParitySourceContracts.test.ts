import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const text = (...parts: string[]) => readFileSync(resolve(root, ...parts), 'utf8');

describe('compatible-stable native visual parity', () => {
  it('renders the browser scene at framebuffer resolution with stable optional supersampling', () => {
    const main = text('runtime', 'mods', 'dramatic-shape', 'main.lua');
    expect(main).toContain('local function sceneSize(ctx)');
    expect(main).toContain('love.graphics.getPixelDimensions()');
    expect(main).toContain('local renderWidth, renderHeight = AntiAlias.expand(width, height)');
    expect(main).toContain('ctx.scale * AntiAlias.factor()');
    expect(main).toContain('return AntiAlias.resolve(canvas, width, height, "world")');
    expect(main).not.toContain('VOXEL_RENDER_SCALE');
  });

  it('restores the retained stable presentation hooks without excluded modes', () => {
    const main = text('runtime', 'mods', 'dramatic-shape', 'main.lua');
    for (const contract of [
      'applyFull(level)',
      'WorldCurve.setting:setIndex(1, Game)',
      'Pipelines.setLevel("tiltshift", Pipelines.maxLevel("tiltshift"))',
      'mod.options:define(optionSchema)',
      'BattleExit.install()',
      'DayTint.install()',
      'CamControl.install()',
      'ChunkMesher.refresh(self.id)',
      'mod.events:on("save.writing"',
      'mod.events:on("save.loaded"',
      'mod.events:on("save.created"',
      'mod.hooks:wrap("world.tod"',
      'DayNight.store()',
      'DayNight.restore()',
    ]) expect(main).toContain(contract);
    expect(main).not.toMatch(/V\.require\("(?:VR|Horde)/);
  });

  it('uses stable shadow/reflection inputs and first-person shadow framing', () => {
    const scene = text('runtime', 'mods', 'dramatic-shape', 'lib', 'VoxelScene.lua');
    const voxel = text('runtime', 'mods', 'dramatic-shape', 'lib', 'Voxel3D.lua');
    const shadow = text('runtime', 'mods', 'dramatic-shape', 'lib', 'ShadowMap.lua');
    expect(scene).toContain('local fitSig = ShadowMap.prepare(cx, cy, vw, vh)');
    expect(shadow).toContain('ShadowMap.CACHE_STEP = 128');
    expect(scene).toContain('put(p.facing); put(p.phase); put(p.flip and 1 or 0)');
    expect(scene).toContain('local shadowX, shadowY = FirstPerson.shadowCenter(cx, cy, vh)');
    expect(voxel).toContain('function Voxel3D.beginWater(paint, restoreDepth)');
    expect(voxel).not.toContain('mirrorKey');
    expect(voxel).not.toContain('waterLayer');
    expect(scene).toContain('local curved = (Voxel3D.curveK or 0) > 0');
  });

  it('uses the stable 4:3 start geometry in both runtime layers', () => {
    const conf = text('runtime', 'game', 'conf.lua');
    const screen = text('src', 'ui', 'RuntimeScreen.ts');
    const css = text('src', 'styles.css');
    expect(conf).toContain('t.window.width = 1024');
    expect(conf).toContain('t.window.height = 768');
    expect(conf).toContain('t.window.minwidth = 480');
    expect(conf).toContain('t.window.minheight = 360');
    expect(screen).toContain('canvas.width = 1024');
    expect(screen).toContain('canvas.height = 768');
    expect(css).toContain('aspect-ratio: 4 / 3');
    expect(css).not.toContain('aspect-ratio: 16 / 9');
  });
});
