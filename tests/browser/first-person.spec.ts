import { expect, test } from './helpers/voxelHarness';

test.skip(process.env.POKEVOXEL_FIRST_PERSON_SCENARIOS !== '1', 'test-runtime first-person scenarios are opt-in');
test.use({ headless: false });

type FirstPersonProbe = { map: string; cellX: number; cellY: number; facing: string; surfing: boolean; driving: true; captured: true; camera: true; stableFrames: number; fallback: false };
type ReleaseProbe = { map: string; cellX: number; cellY: number; facing: string; surfing: boolean; driving: boolean; captured: false; sequence: number };
type ParityProbe = { scenario: string; map: string; cellX: number; cellY: number; facing: string; surfing: boolean; flagsSame: boolean; transitioning: boolean };

async function read<T>(page: import('@playwright/test').Page, testId: string): Promise<T | undefined> {
  const marker = page.getByTestId(testId);
  return await marker.isVisible() ? JSON.parse(await marker.innerText()) as T : undefined;
}

async function releaseSequence(page: import('@playwright/test').Page): Promise<number> {
  return (await read<ReleaseProbe>(page, 'first-person-release-probe'))?.sequence ?? 0;
}

async function expectReleaseAfter(page: import('@playwright/test').Page, beforeSequence: number, expected: Omit<Partial<ReleaseProbe>, 'captured' | 'sequence'>): Promise<void> {
  await expect.poll(async () => {
    const probe = await read<ReleaseProbe>(page, 'first-person-release-probe');
    return probe && probe.sequence > beforeSequence ? probe : undefined;
  }, { timeout: 10_000 }).toMatchObject({ ...expected, captured: false });
}

async function expectParity(page: import('@playwright/test').Page, expected: Partial<ParityProbe>): Promise<void> {
  await expect.poll(() => read<ParityProbe>(page, 'first-person-parity-probe'), { timeout: 5_000 }).toMatchObject(expected);
}

test('retained 1ST matches logical grid state across representative Yellow scenarios and releases input ownership', async ({ voxel }) => {
  test.setTimeout(300_000);
  await voxel.ensureOverworld();
  const matrix = [
    ['1', 'outdoor', 'PALLET_TOWN', 5, 6, false],
    ['2', 'indoor', 'REDS_HOUSE_1F', 3, 5, false],
    ['3', 'cave', 'ROCK_TUNNEL_1F', 5, 5, false],
    ['4', 'water', 'ROUTE_19', 5, 5, true],
  ] as const;
  for (const [key, scenario, map, cellX, cellY, surfing] of matrix) {
    await voxel.command(key);
    await expect.poll(() => read<FirstPersonProbe>(voxel.page, 'first-person-probe'), { timeout: 20_000 }).toMatchObject({ map, cellX, cellY, surfing, driving: true, captured: true, camera: true, stableFrames: 2, fallback: false });
    const ready = (await read<FirstPersonProbe>(voxel.page, 'first-person-probe'))!;
    const beforeSequence = await releaseSequence(voxel.page);
    await voxel.command('7');
    await expectReleaseAfter(voxel.page, beforeSequence, { map, cellX, cellY, facing: ready.facing, surfing, driving: false });
    await voxel.command('8');
    await expectParity(voxel.page, { scenario, map, cellX, cellY, facing: ready.facing, surfing, flagsSame: true, transitioning: false });
  }

  await voxel.command('1');
  await expect.poll(() => read<FirstPersonProbe>(voxel.page, 'first-person-probe'), { timeout: 20_000 }).toMatchObject({ map: 'PALLET_TOWN', captured: true });
  let ready = (await read<FirstPersonProbe>(voxel.page, 'first-person-probe'))!;
  let beforeSequence = await releaseSequence(voxel.page);
  await voxel.toggleMenu();
  await expectReleaseAfter(voxel.page, beforeSequence, { map: ready.map, cellX: ready.cellX, cellY: ready.cellY, facing: ready.facing, surfing: ready.surfing, driving: false });
  await voxel.toggleMenu();
  await expect.poll(() => read<FirstPersonProbe>(voxel.page, 'first-person-probe'), { timeout: 10_000 }).toMatchObject({ captured: true, driving: true });
  ready = (await read<FirstPersonProbe>(voxel.page, 'first-person-probe'))!;
  beforeSequence = await releaseSequence(voxel.page);
  await voxel.command('9');
  await expectReleaseAfter(voxel.page, beforeSequence, { map: ready.map, cellX: ready.cellX, cellY: ready.cellY, facing: ready.facing, surfing: ready.surfing, driving: false });
  await voxel.command('9');
  await expect.poll(() => read<FirstPersonProbe>(voxel.page, 'first-person-probe'), { timeout: 10_000 }).toMatchObject({ captured: true, driving: true });
  ready = (await read<FirstPersonProbe>(voxel.page, 'first-person-probe'))!;
  beforeSequence = await releaseSequence(voxel.page);
  // This lane connects to a headed browser without Playwright's focus override.
  // Minimize the game target's real Chrome window: unlike foregrounding a tab,
  // this remains deterministic while LÖVE owns relative mouse capture.
  const cdp = await voxel.context.newCDPSession(voxel.page);
  const { windowId, bounds } = await cdp.send('Browser.getWindowForTarget');
  const restoreState = bounds.windowState === 'minimized' ? 'normal' : bounds.windowState ?? 'normal';
  try {
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
    await expectReleaseAfter(voxel.page, beforeSequence, { map: ready.map, cellX: ready.cellX, cellY: ready.cellY, facing: ready.facing, surfing: ready.surfing, driving: true });
  } finally {
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: restoreState } }).catch(() => undefined);
    await voxel.page.bringToFront().catch(() => undefined);
    await cdp.detach().catch(() => undefined);
  }
  await voxel.page.locator('canvas').focus();
  await expect.poll(() => read<FirstPersonProbe>(voxel.page, 'first-person-probe'), { timeout: 10_000 }).toMatchObject({ captured: true, driving: true });

  await voxel.command('5');
  await expect.poll(() => read<FirstPersonProbe>(voxel.page, 'first-person-probe'), { timeout: 20_000 }).toMatchObject({ map: 'PALLET_TOWN', captured: true });
  beforeSequence = await releaseSequence(voxel.page);
  await voxel.command('7');
  await expectReleaseAfter(voxel.page, beforeSequence, { driving: false });
  await expect.poll(() => read<FirstPersonProbe>(voxel.page, 'first-person-probe'), { timeout: 20_000 }).toMatchObject({ captured: true, driving: true });
  expect((await read<FirstPersonProbe>(voxel.page, 'first-person-probe'))?.map).not.toBe('PALLET_TOWN');
  await voxel.command('8');
  await expectParity(voxel.page, { scenario: 'scripted-warp', flagsSame: true, transitioning: false });

  await voxel.command('6');
  await expect.poll(() => read<FirstPersonProbe>(voxel.page, 'first-person-probe'), { timeout: 20_000 }).toMatchObject({ map: 'ROCK_TUNNEL_1F', captured: true });
  beforeSequence = await releaseSequence(voxel.page);
  await voxel.command('7');
  await expectReleaseAfter(voxel.page, beforeSequence, { driving: false });
  await expect(voxel.page.getByTestId('battle-probe')).toBeVisible({ timeout: 20_000 });

  await voxel.command('0');
  await expect.poll(() => read<FirstPersonProbe>(voxel.page, 'first-person-probe'), { timeout: 20_000 }).toMatchObject({ captured: true, driving: true });
  ready = (await read<FirstPersonProbe>(voxel.page, 'first-person-probe'))!;
  beforeSequence = await releaseSequence(voxel.page);
  await voxel.command('9');
  await expectReleaseAfter(voxel.page, beforeSequence, { map: ready.map, cellX: ready.cellX, cellY: ready.cellY, facing: ready.facing, surfing: ready.surfing, driving: true });
  await expect(voxel.page.getByTestId('import-error')).toBeVisible({ timeout: 10_000 });
});
