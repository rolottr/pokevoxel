import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const text = (...parts: string[]): string => readFileSync(resolve(root, ...parts), 'utf8');

describe('frame pacing instrumentation contracts', () => {
  it('measures update, draw, and present slices around the real love.run sections', () => {
    const main = text('runtime', 'game', 'main.lua');
    const update = main.indexOf('if love.update then love.update(dt) end');
    const draw = main.indexOf('if love.draw then love.draw() end');
    const stats = main.indexOf('love.graphics.getStats(stats)');
    const present = main.indexOf('love.graphics.present()');
    const sample = main.indexOf('B.frameSample(dt,');
    expect(update).toBeGreaterThan(-1);
    expect(draw).toBeGreaterThan(update);
    expect(stats).toBeGreaterThan(draw);
    expect(present).toBeGreaterThan(stats);
    expect(sample).toBeGreaterThan(present);
  });

  it('aggregates one bounded probe window in the bootstrap and emits through BrowserEvents', () => {
    const bootstrap = text('runtime', 'game', 'src', 'web', 'BrowserBootstrap.lua');
    expect(bootstrap).toContain('local PERF_WINDOW=120');
    expect(bootstrap).toContain('function B.frameSample(dt,updateMs,drawMs,presentMs,drawCalls,canvasSwitches,gcMs)');
    expect(bootstrap).toContain('if B.state~="running" then return end');
    expect(bootstrap).toContain('_G.POKEVOXEL_PERF=_G.POKEVOXEL_PERF or {meshJobs=0,meshUploads=0,meshMs=0,shadowMs=0}');
    const events = text('runtime', 'game', 'src', 'web', 'BrowserEvents.lua');
    expect(events).toContain('function BrowserEvents.frameProbe(p)');
    expect(events).toContain('"frame-probe"');
  });

  it('counts mod mesh and shadow work through the shared perf table only', () => {
    const mesher = text('runtime', 'mods', 'dramatic-shape', 'lib', 'ChunkMesher.lua');
    expect(mesher).toContain('PERF.meshUploads = PERF.meshUploads + 1');
    expect(mesher).toContain('PERF.meshJobs = PERF.meshJobs + 1');
    const modMain = text('runtime', 'mods', 'dramatic-shape', 'main.lua');
    expect(modMain).toContain('perf.meshMs = perf.meshMs + (love.timer.getTime() - pumpStart)');
    const scene = text('runtime', 'mods', 'dramatic-shape', 'lib', 'VoxelScene.lua');
    expect(scene).toContain('perf.shadowMs = perf.shadowMs + (love.timer.getTime() - shadowStart)');
  });

  it('stores the parsed frame probe on the shell model and renders its hidden marker', () => {
    const app = text('src', 'app', 'PokevoxelApp.ts');
    expect(app).toContain("if (event.type === 'frame-probe') { this.model = { ...this.model, frameProbe: event.payload as FrameProbe }; this.render(); return; }");
    const welcome = text('src', 'ui', 'WelcomeScreen.ts');
    expect(welcome).toContain("probe.dataset.testid = 'frame-probe'");
  });
});
