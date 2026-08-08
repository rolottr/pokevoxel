import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAMERA_LADDER, CONTROL_SECTIONS, QUICK_CONTROLS } from '../../src/ui/GameControls';

const root = process.cwd();
const text = (...parts: string[]) => readFileSync(resolve(root, ...parts), 'utf8');
const item = (label: string) => CONTROL_SECTIONS.flatMap((section) => section.items).find((entry) => entry.label === label);

describe('release controls', () => {
  it('keeps essential play and camera shortcuts in the compact ribbon', () => {
    expect(QUICK_CONTROLS.map((entry) => entry.label)).toEqual(['Move', 'A', 'B', 'Save / load', 'Camera', 'Zoom']);
    expect(QUICK_CONTROLS.find((entry) => entry.label === 'Camera')?.keys).toEqual(['3']);
    expect(QUICK_CONTROLS.find((entry) => entry.label === 'Zoom')?.keys).toEqual(['Q', 'E', 'Wheel']);
  });

  it('anchors the 4:3 game canvas directly below the controls', () => {
    const css = text('src', 'styles.css');
    expect(css).toContain('--runtime-top: 4.5rem');
    expect(css).toContain('padding-top: var(--runtime-top); place-items: start center');
    expect(css).toContain('calc(133.333vh - var(--runtime-width-offset))');
  });

  it('documents every retained camera rung, switch, and camera input', () => {
    expect(CAMERA_LADDER).toEqual(['OFF', '15°', '35°', '50°', '75°', '1ST', '3RD']);
    expect(item('Voxel camera')?.keys).toEqual(['3', 'Select']);
    expect(item('Voxel grid')?.keys).toEqual(['5']);
    expect(item('Tilt-shift pipeline')?.keys).toEqual(['6']);
    expect(item('World curve')?.keys).toEqual(['7']);
    expect(item('Staged 3D battles')?.keys).toEqual(['8']);
    expect(item('Water rendering')?.keys).toEqual(['9']);
    expect(item('FPS monitor')?.keys).toEqual(['F8']);
    expect(item('Free look')?.keys).toEqual(['Mouse', 'Right stick', '1-finger drag']);
    expect(item('Camera zoom')?.keys).toEqual(['Q', 'E', 'Wheel', 'Stick clicks', 'Pinch']);
    expect(item('FULL preset')?.description).toMatch(/options only/i);
  });

  it('keeps the guide coupled to the retained Lua mappings instead of inferred controls', () => {
    const input = text('runtime', 'game', 'src', 'core', 'Input.lua');
    const game = text('runtime', 'game', 'src', 'core', 'Game.lua');
    const mod = text('runtime', 'mods', 'dramatic-shape', 'main.lua');
    const voxel = text('runtime', 'mods', 'dramatic-shape', 'lib', 'VoxelState.lua');
    const first = text('runtime', 'mods', 'dramatic-shape', 'lib', 'FirstPerson.lua');
    const camera = text('runtime', 'mods', 'dramatic-shape', 'lib', 'CamControl.lua');
    for (const binding of ['w = "up"', 'z = "a"', 'x = "b"', 'escape = "start"', 'tab = "select"']) expect(input).toContain(binding);
    for (const key of ['"f1"', '"f2"', 'key == "1"', 'key == "2"', 'key == "4"', 'key == "f10"']) expect(game).toContain(key);
    for (const key of ['["3"]', '["5"]', '["6"]', '["7"]', '["8"]', '["9"]']) expect(mod).toContain(key);
    expect(voxel).toContain('Voxel.HOTKEY_ORDER = { 0, 2, 3, 4, 5, 6, 7 }');
    expect(first).toContain('local MOUSE_BTN = { [1] = "a", [2] = "b" }');
    expect(camera).toContain('button == "leftstick" or button == "rightstick"');
  });

  it('ships a root-based Cloudflare Worker Assets contract', () => {
    const pkg = JSON.parse(text('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['build:client']).toBe('vite build');
    expect(text('public', '_headers')).toContain('Cross-Origin-Embedder-Policy: require-corp');
    expect(text('public', '_headers')).toContain('Cache-Control: no-cache');
    expect(text('wrangler.jsonc')).toContain('"not_found_handling": "single-page-application"');
  });

  it('keeps release copy explicit about the fork, both upstreams, and local ROM privacy', () => {
    const readme = text('README.md');
    expect(readme).toMatch(/unofficial fork\/integration/i);
    expect(readme).toContain('https://github.com/bryanthaboi/gen1recomp');
    expect(readme).toContain('https://github.com/DramaticShape/DramaticShapeVoxelMod');
    expect(readme).toMatch(/thank/i);
    expect(readme).toMatch(/never uploaded/i);
    expect(readme).toMatch(/npm run build/);
    expect(readme).toMatch(/Deploy command.*`npx wrangler deploy`/i);
  });
});
