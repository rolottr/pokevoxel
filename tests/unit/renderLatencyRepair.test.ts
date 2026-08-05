import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const source = (...parts: string[]): string => readFileSync(resolve(root, ...parts), 'utf8');

describe('voxel render latency and occlusion repair', () => {
  it('keeps generated browser and harness state outside the Vite watch graph', () => {
    const vite = source('vite.config.ts');
    expect(vite).toContain("ignored: ['**/.pokevoxel-test-data/**']");
  });

  it('builds runtime before dev and rebuilds changed runtime source before reloading', () => {
    const pkg = JSON.parse(source('package.json')) as { scripts: Record<string, string> };
    const vite = source('vite.config.ts');
    expect(pkg.scripts.predev).toBe('npm run build:runtime');
    expect(vite).toContain("'runtime/game'");
    expect(vite).toContain("'runtime/mods/dramatic-shape'");
    expect(vite).toContain("'full-reload'");
    expect(vite).toContain("'scripts/build-runtime.mjs'");
  });

  it('queues current-map body terrain before the complete border ring', () => {
    const scene = source('runtime', 'mods', 'dramatic-shape', 'lib', 'VoxelScene.lua');
    const body = scene.indexOf('ChunkMesher.request(state.map, true, nil, true)');
    const full = scene.indexOf('ChunkMesher.request(state.map, false, masks, true)');
    expect(body).toBeGreaterThan(-1);
    expect(full).toBeGreaterThan(body);
  });

  it('publishes usable terrain before building auxiliary scene meshes', () => {
    const mesher = source('runtime', 'mods', 'dramatic-shape', 'lib', 'ChunkMesher.lua');
    const jobStart = mesher.indexOf('local function runJob(job)');
    const jobEnd = mesher.indexOf('\nend\n\n-- Queue a build', jobStart);
    const job = mesher.slice(jobStart, jobEnd);
    const geometry = job.indexOf('runGeometry(map, job.slot == "body"');
    const publish = job.indexOf('swapSlot(c, job.slot');
    const auxiliary = job.indexOf('buildGrassMesh');
    expect(geometry).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(geometry);
    expect(auxiliary).toBeGreaterThan(publish);
  });

  it('uses the pinned per-vertex depth path for character cards', () => {
    const voxel = source('runtime', 'mods', 'dramatic-shape', 'lib', 'Voxel3D.lua');
    const scene = source('runtime', 'mods', 'dramatic-shape', 'lib', 'VoxelScene.lua');
    expect(voxel).not.toContain('pullHeight');
    expect(voxel).not.toContain('logicalDepth');
    expect(voxel).toContain('w.xyz += normalize(eye - w.xyz) * pull;');
    expect(voxel).toContain('return vp * w;');
    expect(scene).not.toContain('CHARACTER_PULL_HEIGHT');
    expect(scene).toContain('return VoxelScene.pull(math.max(leanAngle(), 0.05))');
  });

  it('frames the lab rather than Reds house for the canonical Oak occlusion proof', () => {
    const driver = source('tests', 'runtime', 'voxel-scenario-driver.lua');
    expect(driver).toContain(
      'local palletLabOcclusionFixture = { map = "PALLET_TOWN", x = 12, y = 12 }',
    );
    expect(driver).toContain('loadFixture(palletLabOcclusionFixture)');
    expect(driver).toContain('Pipelines.setLevel("voxel", 5)');
    expect(driver).toContain('"angle":%.6f');
  });
});
