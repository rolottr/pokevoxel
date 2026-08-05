import { expect, test } from './helpers/voxelHarness';

test.skip(process.env.POKEVOXEL_BATTLE_SCENARIOS !== '1', 'test-runtime battle scenarios are opt-in');

type Category = 'wild' | 'trainer' | 'rival' | 'gym' | 'jessie-james' | 'legendary' | 'elite-four' | 'final';
type CommandKey = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8';
type BattleProbe = { category: Category; kind: 'wild' | 'trainer'; map: string; staged: true; fallback: false };
type ReturnProbe = { category: Category; map: string; returned: boolean; castRestored: boolean };

async function read<T>(page: import('@playwright/test').Page, testId: string): Promise<T | undefined> {
  const marker = page.getByTestId(testId);
  return await marker.isVisible() ? JSON.parse(await marker.innerText()) as T : undefined;
}

test('stages every required Yellow encounter class and returns the unchanged overworld for saving', async ({ voxel }) => {
  test.setTimeout(300_000);
  await voxel.ensureOverworld();
  const categories: readonly Category[] = ['wild', 'trainer', 'rival', 'gym', 'jessie-james', 'legendary', 'elite-four', 'final'];
  for (let index = 0; index < categories.length; index += 1) {
    const category = categories[index]!;
    await voxel.command(String(index + 1) as CommandKey);
    await expect.poll(() => read<BattleProbe>(voxel.page, 'battle-probe'), { timeout: 20_000 }).toMatchObject({ category, map: 'PALLET_TOWN', staged: true, fallback: false });
    await voxel.command('9');
    await expect.poll(() => read<ReturnProbe>(voxel.page, 'battle-return-probe'), { timeout: 15_000 }).toEqual({ category, map: 'PALLET_TOWN', returned: true, castRestored: true });
    await expect(voxel.page.getByTestId('persistence-status')).toHaveText(/Saved|Saving/, { timeout: 15_000 });
  }
});
