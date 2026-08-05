import { createRequire } from 'node:module';
import { expect, test } from './helpers/voxelHarness';

type DecodedPng = Readonly<{ width: number; height: number; data: Buffer }>;
const { PNG } = createRequire(import.meta.url)('playwright-core/lib/utilsBundle') as {
  PNG: { sync: { read(input: Buffer): DecodedPng } };
};

test.skip(process.env.POKEVOXEL_VOXEL_SCENARIOS !== '1', 'test-runtime voxel scenarios are opt-in');

const fixtures = [
  ['1', 'PALLET_TOWN'], ['2', 'REDS_HOUSE_1F'],
  ['3', 'VIRIDIAN_FOREST'], ['4', 'ROCK_TUNNEL_1F'],
] as const;

test('renders all representative maps with a real voxel-ready draw and no fallback', async ({ voxel }) => {
  test.setTimeout(180_000);
  await voxel.ensureTitle();
  for (const [key, map] of fixtures) {
    await voxel.command(key);
    await expect.poll(() => voxel.probe(), { timeout: 15_000 }).toMatchObject({
      map, loads: 1, stableFrames: 2, depth: true, npcDepth: true,
      buildingDepth: true, palette: expect.any(String), dayNight: expect.any(String),
      menus: false, fallback: false,
    });
    expect((await voxel.probe())?.streamCount).toBeGreaterThan(0);
    await voxel.toggleMenu();
    await expect.poll(() => voxel.probe(), { timeout: 15_000 }).toMatchObject({
      map, depth: true, npcDepth: true, buildingDepth: true, menus: true,
      fallback: false,
    });
    await voxel.toggleMenu();
    await expect.poll(() => voxel.probe(), { timeout: 15_000 }).toMatchObject({ map, menus: false });
  }
});

test('uses the Pallet house door warp and retains a single mod load across repeated streaming', async ({ voxel }) => {
  test.setTimeout(180_000);
  await voxel.ensureTitle();
  await voxel.command('5');
  await expect.poll(() => voxel.probe(), { timeout: 15_000 }).toMatchObject({ map: 'REDS_HOUSE_1F', loads: 1, stableFrames: 2, depth: true, npcDepth: true, buildingDepth: true, menus: false, fallback: false });
  let before = (await voxel.probe())?.streamCount ?? 0;
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await voxel.command('6');
    await expect.poll(() => voxel.probe(), { timeout: 15_000 }).toMatchObject({ map: 'PALLET_TOWN', loads: 1, stableFrames: 2, fallback: false });
    expect((await voxel.probe())?.streamCount).toBeGreaterThan(before);
    before = (await voxel.probe())?.streamCount ?? before;
    await voxel.command('5');
    await expect.poll(() => voxel.probe(), { timeout: 15_000 }).toMatchObject({ map: 'REDS_HOUSE_1F', loads: 1, stableFrames: 2, fallback: false });
    expect((await voxel.probe())?.streamCount).toBeGreaterThan(before);
    before = (await voxel.probe())?.streamCount ?? before;
  }
});

test('publishes a stable Pallet voxel frame promptly on a cold house exit', async ({ voxel }) => {
  test.setTimeout(120_000);
  await voxel.ensureTitle();
  const started = Date.now();
  await voxel.command('8');
  await expect.poll(() => voxel.probe(), { timeout: 2_500 }).toMatchObject({
    map: 'PALLET_TOWN', loads: 1, stableFrames: 2, depth: true,
    npcDepth: true, buildingDepth: true, menus: false, fallback: false,
  });
  expect(Date.now() - started).toBeLessThanOrEqual(2_500);
});

test('lets the Pallet lab roof occlude canonical Oak behind it', async ({ voxel }) => {
  test.setTimeout(120_000);
  await voxel.ensureTitle();
  expect(voxel.startHandoffMs()).toBeLessThanOrEqual(1_000);
  const runtime = await voxel.runtimeRevisionEvidence();
  expect(runtime.revision).toMatch(/^[0-9a-f]{64}$/);
  for (const asset of ['game.js', 'game.data', 'love.js'] as const) {
    expect(runtime.assets[asset]).toBe(runtime.revision);
  }
  await voxel.command('1');
  try {
    await expect.poll(() => voxel.probe(), { timeout: 15_000 }).toMatchObject({
      map: 'PALLET_TOWN', depth: true, npcDepth: true, buildingDepth: true,
      fallback: false,
    });
  } catch (error) {
    const diagnostics = await voxel.runtimeDiagnostics();
    throw new Error(`Pallet voxel readiness failed; runtime diagnostics: ${JSON.stringify(diagnostics)}`, { cause: error });
  }
  await voxel.forcePackedDepth();
  await voxel.setPalletLowAngle();

  const canvas = voxel.page.locator('canvas');
  const anchor = await voxel.locatePalletOcclusionNpc();
  expect(anchor.packed).toBe(true);
  expect(anchor.angle).toBeCloseTo(75 * Math.PI / 180, 2);
  await voxel.page.waitForTimeout(250);
  const dimensions = await canvas.evaluate((element: HTMLCanvasElement) => ({
    width: element.width, height: element.height,
  }));
  // Both images remain in memory. The configured failure-only screenshot
  // policy still owns retained artifacts.
  const before = PNG.sync.read(await canvas.screenshot());
  await voxel.hidePalletOcclusionNpc();
  await voxel.page.waitForTimeout(250);
  const after = PNG.sync.read(await canvas.screenshot());

  expect(after.width).toBe(before.width);
  expect(after.height).toBe(before.height);
  const sx = before.width / dimensions.width;
  const sy = before.height / dimensions.height;
  const left = Math.max(0, Math.floor((anchor.x - anchor.card * 0.75) * sx));
  const right = Math.min(before.width, Math.ceil((anchor.x + anchor.card * 0.75) * sx));
  const top = Math.max(0, Math.floor((anchor.y - anchor.card * 1.2) * sy));
  const bottom = Math.min(before.height, Math.ceil((anchor.y + anchor.card * 0.2) * sy));
  let changed = 0;
  let compared = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * before.width + x) * 4;
      const delta = Math.max(
        Math.abs(before.data[offset] - after.data[offset]),
        Math.abs(before.data[offset + 1] - after.data[offset + 1]),
        Math.abs(before.data[offset + 2] - after.data[offset + 2]),
      );
      if (delta > 16) changed += 1;
      compared += 1;
    }
  }
  expect(compared).toBeGreaterThan(1_000);
  expect(changed / compared).toBeLessThan(0.02);
});

test('clears stale readiness when an active voxel draw stops producing a canvas', async ({ voxel }) => {
  test.setTimeout(180_000);
  await voxel.ensureTitle();
  await voxel.command('1');
  await expect.poll(() => voxel.probe(), { timeout: 15_000 }).toMatchObject({
    map: 'PALLET_TOWN', loads: 1, stableFrames: 2, depth: true,
    npcDepth: true, buildingDepth: true, fallback: false,
  });
  await voxel.command('7');
  await expect.poll(() => voxel.probe(), { timeout: 15_000 }).toBeUndefined();
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(await voxel.probe()).toBeUndefined();
});
