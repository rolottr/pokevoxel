import { expect, test } from './helpers/voxelHarness';
import { collectFramePerf, dumpSceneContext, reportFramePerf, walkArrows } from './helpers/framePerf';

test.skip(process.env.POKEVOXEL_FIRST_PERSON_SCENARIOS !== '1', 'test-runtime first-person scenarios are opt-in');
// Headed under xvfb has no GPU; without an explicit ANGLE backend the WebGL
// context never comes up and the import stalls at zero progress.
test.use({ headless: false, launchOptions: { args: ['--mute-audio', '--use-angle=swiftshader', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--window-position=0,0'] } });

type FirstPersonProbe = Readonly<{ map: string; captured: true }>;

async function firstPersonProbe(page: import('@playwright/test').Page): Promise<FirstPersonProbe | undefined> {
  const marker = page.getByTestId('first-person-probe');
  if (!await marker.isVisible()) return undefined;
  return JSON.parse(await marker.innerText()) as FirstPersonProbe;
}

const scenes = [['1', 'PALLET_TOWN'], ['4', 'ROUTE_19']] as const;

test('collects first-person frame pacing evidence outdoors and on water', async ({ voxel }) => {
  test.setTimeout(420_000);
  await voxel.ensureOverworld();
  for (const [key, map] of scenes) {
    await voxel.command(key);
    await expect.poll(() => firstPersonProbe(voxel.page), { timeout: 30_000 }).toMatchObject({ map, captured: true });
    await voxel.page.waitForTimeout(1_000);
    const idle = await collectFramePerf(voxel.page, `fp-${map}-idle`, 8_000);
    reportFramePerf(idle);
    const walking = await collectFramePerf(voxel.page, `fp-${map}-walk`, 12_000, (deadlineAt) => walkArrows(voxel.page, deadlineAt));
    reportFramePerf(walking);
    expect(walking.probes.length).toBeGreaterThan(0);
    await voxel.command('7'); // release first person before the next scenario
    await voxel.page.waitForTimeout(500);
  }
  await dumpSceneContext(voxel.page);
});
