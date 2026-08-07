import { expect, test } from './helpers/voxelHarness';
import { collectFramePerf, dumpSceneContext, reportFramePerf } from './helpers/framePerf';

test.skip(process.env.POKEVOXEL_BATTLE_SCENARIOS !== '1', 'test-runtime battle scenarios are opt-in');

type BattleProbe = Readonly<{ category: string; staged: true }>;

async function battleProbe(page: import('@playwright/test').Page): Promise<BattleProbe | undefined> {
  const marker = page.getByTestId('battle-probe');
  if (!await marker.isVisible()) return undefined;
  return JSON.parse(await marker.innerText()) as BattleProbe;
}

const stages = [['1', 'wild'], ['4', 'gym']] as const;

test('collects staged battle frame pacing evidence', async ({ voxel }) => {
  test.setTimeout(420_000);
  await voxel.ensureOverworld();
  for (const [key, category] of stages) {
    await voxel.command(key);
    await expect.poll(() => battleProbe(voxel.page), { timeout: 30_000 }).toMatchObject({ category, staged: true });
    await voxel.page.waitForTimeout(1_000);
    const battle = await collectFramePerf(voxel.page, `battle-${category}`, 12_000);
    reportFramePerf(battle);
    expect(battle.probes.length).toBeGreaterThan(0);
    await voxel.command('9');
    await expect.poll(async () => {
      const marker = voxel.page.getByTestId('battle-return-probe');
      return await marker.isVisible() ? JSON.parse(await marker.innerText()) as { returned: boolean } : undefined;
    }, { timeout: 20_000 }).toMatchObject({ returned: true });
    await voxel.page.waitForTimeout(1_000);
  }
  await dumpSceneContext(voxel.page);
});
