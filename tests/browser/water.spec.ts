import { expect, test } from './helpers/voxelHarness';

// Playwright's `retain-on-failure` trace records screenshots while the test is
// running and only decides whether to keep them afterwards. That work changes
// the requestAnimationFrame distribution this test is measuring. Clone the
// same voxel fixture with tracing disabled for the timing test alone; the
// failure-path test below keeps the ordinary failure trace, and Playwright's
// failure-only screenshot remains enabled for both.
const performanceTest = test.extend({});
performanceTest.use({ trace: 'off' });

test.skip(process.env.POKEVOXEL_WATER_SCENARIOS !== '1', 'test-runtime water scenarios are opt-in');

type WaterProbe = { map: string; mode: 'sky' | 'full'; reflection: boolean; animated: boolean; surfing: boolean; indoor: boolean; fallback: boolean; stableFrames: number };
async function probe(page: import('@playwright/test').Page): Promise<WaterProbe | undefined> {
  // Read presence and text in one browser task. A map transition can emit
  // water-unready between locator.isVisible() and locator.innerText(); the
  // latter would then wait on a node that was correctly removed and turn a
  // successful unready transition into a 15-second poll timeout.
  const raw = await page.evaluate(() =>
    document.querySelector<HTMLElement>('[data-testid="water-probe"]')?.innerText,
  );
  if (!raw) {
    const diagnostic = await page.evaluate(() => {
      const runtime = window as Window & typeof globalThis & { Module?: { pokevoxelRuntimeDiagnostics?: string[] } };
      return runtime.Module?.pokevoxelRuntimeDiagnostics?.at(-1);
    });
    if (diagnostic) throw new Error(`Water runtime failed at ${diagnostic}`);
    const runtimeError = page.getByTestId('import-error');
    if (await runtimeError.isVisible()) {
      throw new Error(`Water runtime failed with ${await runtimeError.getAttribute('data-error-code') ?? 'unknown-code'}`);
    }
    return undefined;
  }
  return JSON.parse(raw) as WaterProbe;
}
async function command(voxel: { page: import('@playwright/test').Page; command(key: '1'|'2'|'3'|'4'|'5'|'6'): Promise<void> }, key: '1'|'2'|'3'|'4'|'5'|'6'): Promise<void> { await voxel.command(key); }
async function frameEvidence(page: import('@playwright/test').Page): Promise<{ p95: number; heap: number }> {
  return page.evaluate(async () => {
    const samples: number[] = []; let before = performance.now();
    for (let i = 0; i < 120; i += 1) await new Promise<void>((resolve) => requestAnimationFrame((now) => { samples.push(now - before); before = now; resolve(); }));
    samples.sort((a, b) => a - b);
    const memory = performance as Performance & { memory?: { usedJSHeapSize?: number } };
    return { p95: samples[Math.floor(samples.length * 0.95)] ?? Infinity, heap: memory.memory?.usedJSHeapSize ?? 0 };
  });
}

performanceTest('renders SKY/FULL shoreline and Surf routes without fallback within the browser budget', async ({ voxel }) => {
  test.setTimeout(300_000); await voxel.ensureOverworld();
  for (const [key, map, mode, surfing] of [['1', 'ROUTE_19', 'sky', false], ['2', 'ROUTE_19', 'full', true], ['3', 'ROUTE_20', 'full', true]] as const) {
    await command(voxel, key);
    await expect.poll(() => probe(voxel.page), { timeout: 15_000 }).toMatchObject({ map, mode, reflection: true, animated: true, surfing, indoor: false, fallback: false, stableFrames: 2 });
    const evidence = await frameEvidence(voxel.page);
    expect(evidence.p95).toBeLessThanOrEqual(25);
    expect(evidence.heap).toBeLessThanOrEqual(1.25 * 1024 * 1024 * 1024);
  }
});

test('clears water evidence indoors and rejects an allocation/shader failure instead of downgrading', async ({ voxel }) => {
  test.setTimeout(300_000); await voxel.ensureOverworld();
  await command(voxel, '1'); await expect.poll(() => probe(voxel.page), { timeout: 15_000 }).toMatchObject({ map: 'ROUTE_19', fallback: false });
  await command(voxel, '4');
  await expect.poll(() => probe(voxel.page), { timeout: 15_000 }).toBeUndefined();
  await command(voxel, '5');
  await expect.poll(() => voxel.page.getByTestId('water-probe').isVisible(), { timeout: 15_000 }).toBe(false);
});
