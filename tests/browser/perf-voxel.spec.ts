import { expect, test } from './helpers/voxelHarness';
import { collectFramePerf, dumpSceneContext, reportFramePerf, walkArrows, withSceneDiagnostics } from './helpers/framePerf';

test.skip(process.env.POKEVOXEL_VOXEL_SCENARIOS !== '1', 'test-runtime voxel scenarios are opt-in');

const scenes = [
  ['1', 'PALLET_TOWN'], ['2', 'REDS_HOUSE_1F'],
  ['3', 'VIRIDIAN_FOREST'], ['4', 'ROCK_TUNNEL_1F'],
] as const;

test('collects voxel frame pacing evidence for idle and walking scenes', async ({ voxel }) => {
  test.setTimeout(420_000);
  await voxel.ensureTitle();
  for (const [key, map] of scenes) {
    await voxel.command(key);
    await withSceneDiagnostics(voxel.page, () => expect.poll(() => voxel.probe(), { timeout: 20_000 }).toMatchObject({ map }));
    await voxel.page.waitForTimeout(1_500);
    const idle = await collectFramePerf(voxel.page, `${map}-idle`, 8_000);
    reportFramePerf(idle);
    const walking = await collectFramePerf(voxel.page, `${map}-walk`, 14_000, (deadlineAt) => walkArrows(voxel.page, deadlineAt));
    reportFramePerf(walking);
    expect(walking.probes.length).toBeGreaterThan(0);
  }
  await dumpSceneContext(voxel.page);
});

test('collects warp transition evidence through the Pallet house door', async ({ voxel }) => {
  test.setTimeout(180_000);
  await voxel.ensureTitle();
  await voxel.command('1');
  await withSceneDiagnostics(voxel.page, () => expect.poll(() => voxel.probe(), { timeout: 20_000 }).toMatchObject({ map: 'PALLET_TOWN' }));
  await voxel.page.waitForTimeout(1_000);
  const transitions = await collectFramePerf(voxel.page, 'pallet-warp-cycle', 16_000, async (deadlineAt) => {
    while (Date.now() < deadlineAt) {
      await voxel.command('5'); // house door warp in
      await voxel.page.waitForTimeout(2_500);
      await voxel.command('6'); // house exit warp out
      await voxel.page.waitForTimeout(2_500);
    }
  });
  reportFramePerf(transitions);
  expect(transitions.probes.length).toBeGreaterThan(0);
  await dumpSceneContext(voxel.page);
});
