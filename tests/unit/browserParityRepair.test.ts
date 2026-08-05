import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const text = (...parts: string[]): string => readFileSync(resolve(root, ...parts), 'utf8');

type Rgba4 = readonly [number, number, number, number];

function packShadow(depthCode: number, caster: 0 | 1): Rgba4 {
  const packed = depthCode * 2 + caster;
  return [
    Math.floor(packed / 4096),
    Math.floor(packed / 256) % 16,
    Math.floor(packed / 16) % 16,
    packed % 16,
  ].map((digit) => Math.round((digit / 15) * 15)) as unknown as Rgba4;
}

function unpackShadow(rgba4: Rgba4): { depthCode: number; caster: number } {
  const alpha = rgba4[3];
  return {
    depthCode: rgba4[0] * 2048 + rgba4[1] * 128 + rgba4[2] * 8 + Math.floor(alpha / 2),
    caster: alpha % 2,
  };
}

describe('reported browser parity repair', () => {
  it('round-trips every 15-bit shadow depth and caster marker through RGBA4', () => {
    for (let depthCode = 0; depthCode <= 0x7fff; depthCode += 1) {
      for (const caster of [0, 1] as const) {
        expect(unpackShadow(packShadow(depthCode, caster))).toEqual({ depthCode, caster });
      }
    }
  });

  it('uses one RGBA4 depth/caster contract in the writer, scene, and water shaders', () => {
    const shadow = text('runtime', 'mods', 'dramatic-shape', 'lib', 'ShadowMap.lua');
    const voxel = text('runtime', 'mods', 'dramatic-shape', 'lib', 'Voxel3D.lua');
    const water = text('runtime', 'mods', 'dramatic-shape', 'lib', 'Water.lua');

    expect(shadow).toContain('{ format = "rgba4", dpiscale = 1 }');
    expect(shadow).toContain('32767.0 / 32768.0');
    expect(shadow).toContain('digits.a = floor(d) * 2.0 + sprite;');
    expect(shadow).toContain('love.graphics.clear(1, 1, 1, 1, true, true)');
    for (const reader of [voxel, water]) {
      expect(reader).toContain('float shadowDepth(vec4 c)');
      expect(reader).toContain('c.r * 30720.0');
      expect(reader).toContain('floor(c.a * 7.5 + 0.0001)');
      expect(reader).toContain('/ 32767.0');
    }
    expect(water).toContain('float shadowCaster(vec4 c)');
    expect(water).toContain('mod(floor(c.a * 15.0 + 0.5), 2.0)');
    expect(water).toContain('max(step(z, shadowDepth(c)), shadowCaster(c))');
  });

  it('memoizes the shadow capability probe instead of resizing the live map every frame', () => {
    const shadow = text('runtime', 'mods', 'dramatic-shape', 'lib', 'ShadowMap.lua');
    const available = shadow.slice(
      shadow.indexOf('function ShadowMap.available()'),
      shadow.indexOf('function ShadowMap.texture()'),
    );
    expect(shadow).toContain('local capability = nil');
    expect(available).toContain('if capability == nil then');
    expect(available).toContain('capability = getShader() ~= nil');
    expect(available.match(/getCanvas\(ShadowMap\.SIZES\[1\]\)/g)).toHaveLength(1);
    expect(shadow).toMatch(/function ShadowMap\.invalidate\(\)[\s\S]*capability = nil/);
  });

  it('keeps walking cards out of the cached static shadow pass', () => {
    const shadow = text('runtime', 'mods', 'dramatic-shape', 'lib', 'ShadowMap.lua');
    const voxel = text('runtime', 'mods', 'dramatic-shape', 'lib', 'Voxel3D.lua');
    const scene = text('runtime', 'mods', 'dramatic-shape', 'lib', 'VoxelScene.lua');
    const staticSignature = scene.slice(
      scene.indexOf('local function staticShadowSignature'),
      scene.indexOf('local castSigBuf'),
    );
    const castSignature = scene.slice(
      scene.indexOf('local function castShadowSignature'),
      scene.indexOf('-- The sun pass:'),
    );

    expect(shadow).toContain('ShadowMap.CACHE_STEP = 128');
    expect(shadow).toContain('local castCanvas = nil');
    expect(shadow).toContain('function ShadowMap.beginStatic()');
    expect(shadow).toContain('function ShadowMap.beginCast()');
    expect(staticSignature).not.toContain('posed');
    expect(staticSignature).not.toContain('p.px');
    expect(castSignature).toContain('p.px');
    expect(voxel).toContain('uniform Image sunCastMap;');
    expect(voxel).toMatch(/return min\(shadowDepth\(Texel\(sunMap, uv\)\),\s*shadowDepth\(Texel\(sunCastMap, uv\)\)\);/);
    expect(voxel).toContain('"sunCastMap", castTex');
  });

  it('keeps the live canvas and shell decoration hidden until playing and uses the pinned billboard depth bias', () => {
    const css = text('src', 'styles.css');
    const scene = text('runtime', 'mods', 'dramatic-shape', 'lib', 'VoxelScene.lua');
    expect(css).toMatch(/\.runtime-canvas\s*\{[^}]*opacity:\s*0;/);
    expect(css).toContain('.runtime-stage[data-state="playing"]::before, .runtime-stage[data-state="playing"]::after { display: none; }');
    expect(css).toMatch(/\.runtime-stage\[data-state="playing"\] \.runtime-canvas\s*\{[^}]*opacity:\s*1;/);
    expect(scene).not.toContain('MAX_BILLBOARD_PULL');
    expect(scene).toContain('return VoxelScene.pull(math.max(leanAngle(), 0.05))');
    const leanDefinition = scene.indexOf('local lean = math.max(leanAngle(), 0.05)');
    const cappedPull = scene.indexOf('local pull = billboardPull()', leanDefinition);
    const flowerCorrection = scene.indexOf('math.sin(lean)', cappedPull);
    expect(leanDefinition).toBeGreaterThan(-1);
    expect(cappedPull).toBeGreaterThan(leanDefinition);
    expect(flowerCorrection).toBeGreaterThan(cappedPull);
  });

  it('owns ordinary F1/F2 state commands before overlays without changing normal speed', () => {
    const modMain = text('runtime', 'mods', 'dramatic-shape', 'main.lua');
    const game = text('runtime', 'game', 'src', 'core', 'Game.lua');
    const fixed = text('runtime', 'game', 'src', 'core', 'FixedStep.lua');
    const speed = text('runtime', 'game', 'src', 'core', 'GameSpeed.lua');
    const save = text('runtime', 'game', 'src', 'core', 'SaveData.lua');
    const stateCommands = game.indexOf('if (key == "f1" or key == "f2")');
    const overlayCapture = game.indexOf('self.stack:top().onKeyPressed');
    expect(stateCommands).toBeGreaterThan(-1);
    expect(stateCommands).toBeLessThan(overlayCapture);
    expect(game).toContain('if key == "f1" then self:writeSave()');
    expect(game).toContain('local loaded, recovered = SaveData.load()');
    expect(game).toContain('if loaded then self:restoreSave(loaded, recovered) end');
    expect(fixed).toContain('FixedStep.STEP = 1 / 60');
    expect(speed).toContain('GameSpeed.DEFAULT = 1');
    expect(save).toContain('speed = 1');
    expect(game).toContain('FixedStep:update(dt * speed)');
    expect(modMain).not.toContain('love.timer.sleep = function');
    expect(modMain).not.toContain('_voxelFrameSleep');
  });
});
