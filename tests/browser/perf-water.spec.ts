import { expect, test } from './helpers/voxelHarness';
import { collectFramePerf, dumpSceneContext, reportFramePerf, walkArrows } from './helpers/framePerf';

test.skip(process.env.POKEVOXEL_WATER_SCENARIOS !== '1', 'test-runtime water scenarios are opt-in');

type WaterProbe = Readonly<{ map: string; mode: 'sky' | 'full'; surfing: boolean }>;

async function waterProbe(page: import('@playwright/test').Page): Promise<WaterProbe | undefined> {
  const marker = page.getByTestId('water-probe');
  if (!await marker.isVisible()) return undefined;
  return JSON.parse(await marker.innerText()) as WaterProbe;
}

const scenes = [
  ['1', 'ROUTE_19', 'sky'], ['2', 'ROUTE_19', 'full'], ['3', 'ROUTE_20', 'full'],
] as const;

test('collects water frame pacing evidence for shoreline and surf', async ({ voxel }) => {
  test.setTimeout(420_000);
  await voxel.ensureOverworld();
  for (const [key, map, mode] of scenes) {
    await voxel.command(key);
    await expect.poll(() => waterProbe(voxel.page), { timeout: 30_000 }).toMatchObject({ map, mode });
    await voxel.page.waitForTimeout(1_500);
    const idle = await collectFramePerf(voxel.page, `${map}-${mode}-idle`, 8_000);
    reportFramePerf(idle);
    const walking = await collectFramePerf(voxel.page, `${map}-${mode}-walk`, 14_000, (deadlineAt) => walkArrows(voxel.page, deadlineAt));
    reportFramePerf(walking);
    expect(walking.probes.length).toBeGreaterThan(0);
  }
  await dumpSceneContext(voxel.page);
});

test('collects option hotkey storm evidence for curve and water cycling', async ({ voxel }) => {
  test.setTimeout(420_000);
  console.log('storm: entering overworld');
  await voxel.ensureOverworld();
  console.log('storm: overworld ready, selecting surf route');
  await voxel.command('2');
  await expect.poll(() => waterProbe(voxel.page), { timeout: 30_000 }).toMatchObject({ map: 'ROUTE_19', mode: 'full' });
  console.log('storm: route ready, starting hotkey storm');
  await voxel.page.waitForTimeout(1_500);
  const storm = await collectFramePerf(voxel.page, 'option-hotkey-storm', 16_000, async (deadlineAt) => {
    await voxel.page.locator('canvas').focus();
    while (Date.now() < deadlineAt) {
      await voxel.page.keyboard.press('7'); // WorldCurve cycle -> writeOptions
      await voxel.page.waitForTimeout(1_800);
      await voxel.page.keyboard.press('9'); // Water cycle -> writeOptions
      await voxel.page.waitForTimeout(1_800);
    }
  });
  reportFramePerf(storm);
  expect(storm.probes.length).toBeGreaterThan(0);
  await dumpSceneContext(voxel.page);
});
