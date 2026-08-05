import { expect, test, type Page } from '@playwright/test';

const productBase = '/';
type AudioProbe = Readonly<{ scene: 'none' | 'title' | 'overworld' | 'battle' | 'victory'; queued: number; playing: boolean; effect: 'none' | 'sfx' | 'low-hp'; effectId: number; lowHp: boolean; musicSources: number; pcmPeak: number; pcmFrames: number; pcmNonzero: boolean; musicVolume: number; sfxVolume: number; lowHpActivations: number; victoryActivations: number }>;
type Summary = Readonly<{ map: string; x: number; y: number; partyCount: number }>;
type AudioInstrumentation = Readonly<{ contexts: number; resumes: number; running: number; inactive: number }>;

async function currentProbe(page: Page): Promise<AudioProbe | undefined> {
  const marker = page.getByTestId('audio-probe');
  if (!await marker.isVisible()) return undefined;
  return JSON.parse(await marker.innerText()) as AudioProbe;
}

/** Browser API instrumentation only: no game state, filesystem, or source is exposed. */
async function installAudioInstrumentation(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const key = '__pokevoxelAudioInstrumentation';
    const state = { contexts: [] as AudioContext[], resumes: 0 };
    Object.defineProperty(window, key, { value: state, configurable: true });
    const wrap = (name: 'AudioContext' | 'webkitAudioContext'): void => {
      const Original = window[name] as typeof AudioContext | undefined;
      if (!Original) return;
      const Wrapped = function (this: unknown, ...args: ConstructorParameters<typeof AudioContext>): AudioContext {
        const context = new Original(...args); state.contexts.push(context);
        const resume = context.resume.bind(context);
        context.resume = () => { state.resumes += 1; return resume(); };
        return context;
      } as unknown as typeof AudioContext;
      Wrapped.prototype = Original.prototype;
      Object.setPrototypeOf(Wrapped, Original);
      Object.defineProperty(window, name, { value: Wrapped, configurable: true });
    };
    wrap('AudioContext');
    if (window.webkitAudioContext !== window.AudioContext) wrap('webkitAudioContext');
  });
}

async function instrumentation(page: Page): Promise<AudioInstrumentation> {
  return page.evaluate(() => {
    const state = (window as Window & typeof globalThis & { __pokevoxelAudioInstrumentation?: { contexts: AudioContext[]; resumes: number } }).__pokevoxelAudioInstrumentation;
    return { contexts: state?.contexts.length ?? 0, resumes: state?.resumes ?? 0, running: state?.contexts.filter((context) => context.state === 'running').length ?? 0, inactive: state?.contexts.filter((context) => context.state !== 'running').length ?? 0 };
  });
}

async function tapGameKey(page: Page, key: string, holdMs = 100): Promise<void> {
  await page.locator('canvas').focus();
  await page.keyboard.down(key); await page.waitForTimeout(holdMs); await page.keyboard.up(key);
}

async function tapMany(page: Page, key: string, count: number, holdMs = 100, pauseMs = 150): Promise<void> {
  for (let index = 0; index < count; index += 1) { await tapGameKey(page, key, holdMs); await page.waitForTimeout(pauseMs); }
}

async function checkpoint(page: Page, expected?: Partial<Summary>): Promise<Summary> {
  await tapGameKey(page, 'F1');
  const marker = page.getByTestId('persistence-summary-committed');
  await expect(marker).toBeVisible({ timeout: 60_000 });
  if (expected) await expect.poll(async () => JSON.parse(await marker.innerText()) as Summary, { timeout: 60_000 }).toMatchObject(expected);
  return JSON.parse(await marker.innerText()) as Summary;
}

async function waitReady(page: Page): Promise<void> { await expect(page.getByTestId('overworld-input-ready')).toHaveText('true', { timeout: 60_000 }); }
async function mashUntilReady(page: Page): Promise<void> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (await page.getByTestId('overworld-input-ready').textContent() === 'true') return;
    await tapGameKey(page, 'Enter', 40); await page.waitForTimeout(70);
  }
  const safe = await checkpoint(page); throw new Error(`overworld idle timeout ${JSON.stringify({ map: safe.map, x: safe.x, y: safe.y, partyCount: safe.partyCount, probe: await currentProbe(page) })}`);
}
async function reachOverworld(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await page.getByTestId('overworld-ready').isVisible()) return;
    await tapGameKey(page, 'ArrowDown'); await page.waitForTimeout(75);
    await tapGameKey(page, 'Enter', 500); await page.waitForTimeout(125);
  }
  await expect(page.getByTestId('overworld-ready')).toBeVisible();
}

async function tapUntilBattle(page: Page): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if ((await currentProbe(page))?.scene === 'battle') return;
    await tapGameKey(page, 'Enter', 40); await page.waitForTimeout(70);
  }
  const safe = await checkpoint(page);
  throw new Error(`battle timeout ${JSON.stringify({ map: safe.map, x: safe.x, y: safe.y, partyCount: safe.partyCount, probe: await currentProbe(page) })}`);
}

/** Opt-in real browser proof with public keyboard input and bounded semantic telemetry only. */
test('keeps one live music source through title, options, and the public Oak-rival audio lifecycle', async ({ page }) => {
  test.setTimeout(600_000);
  const privatePath = process.env.POKEVOXEL_TEST_ROM_PATH;
  test.skip(!privatePath || process.env.POKEVOXEL_PUBLIC_AUDIO_JOURNEY !== '1', 'slow public browser-audio journey is release-only');
  await installAudioInstrumentation(page);
  await page.goto(productBase);
  await page.locator('#gen1-rom-input').setInputFiles(privatePath!);
  await expect(page.getByTestId('cache-committed')).toBeAttached({ timeout: 120_000 });
  await page.getByRole('button', { name: /^start game$/i }).click();
  await expect(page.getByTestId('yellow-runtime-title-ready')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => instrumentation(page), { timeout: 15_000 }).toMatchObject({ contexts: 2, resumes: 1, running: 1, inactive: 1 });
  await expect.poll(() => currentProbe(page), { timeout: 30_000 }).toMatchObject({ scene: 'title', musicSources: 1, pcmNonzero: true });
  expect((await currentProbe(page))!.queued).toBeGreaterThan(0);
  expect((await currentProbe(page))!.pcmPeak).toBeGreaterThan(0);
  expect((await currentProbe(page))!.pcmFrames).toBeGreaterThan(0);

  const beforeFocus = await instrumentation(page);
  await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
  await expect.poll(() => instrumentation(page), { timeout: 15_000 }).toMatchObject({ contexts: beforeFocus.contexts, running: 1, inactive: 1 });
  expect((await instrumentation(page)).resumes).toBeGreaterThan(beforeFocus.resumes);

  const beforeTitleEffect = (await currentProbe(page))!.effectId;
  await tapGameKey(page, 'Enter', 500);
  await expect.poll(() => currentProbe(page), { timeout: 15_000 }).toMatchObject({ effect: 'sfx' });
  expect((await currentProbe(page))!.effectId).toBeGreaterThan(beforeTitleEffect);
  await tapGameKey(page, 'Enter', 500);
  await expect(page.getByTestId('yellow-new-game-started')).toBeVisible({ timeout: 60_000 });
  await reachOverworld(page);
  await expect.poll(() => currentProbe(page), { timeout: 30_000 }).toMatchObject({ scene: 'overworld', musicSources: 1, pcmNonzero: true });

  // Bedroom options: Escape -> Start Menu -> OPTIONS. Both volume rows are
  // altered solely through the ordinary menu and rechecked via bounded probe.
  await waitReady(page);
  await tapGameKey(page, 'Escape'); await tapMany(page, 'ArrowDown', 4); await tapGameKey(page, 'Enter', 500);
  // The retained Dramatic Shape options hook removes BATTLE LAYOUT and
  // BATTLE BG while staged battles own them, placing MUSIC VOL at row 7.
  await tapMany(page, 'ArrowDown', 6); await tapMany(page, 'ArrowLeft', 7);
  await tapGameKey(page, 'ArrowDown'); await tapMany(page, 'ArrowLeft', 7);
  await expect.poll(() => currentProbe(page), { timeout: 30_000 }).toMatchObject({ musicVolume: 0, sfxVolume: 0, musicSources: 1 });
  await tapMany(page, 'ArrowRight', 7); await tapGameKey(page, 'ArrowUp'); await tapMany(page, 'ArrowRight', 7);
  await expect.poll(() => currentProbe(page), { timeout: 30_000 }).toMatchObject({ musicVolume: 7, sfxVolume: 7, musicSources: 1 });
  await tapGameKey(page, 'Escape'); await tapGameKey(page, 'Escape');
  await expect.poll(() => instrumentation(page), { timeout: 15_000 }).toMatchObject({ contexts: beforeFocus.contexts, running: 1, inactive: 1 });

  const walk = (key: string, count: number): Promise<void> => tapMany(page, key, count, 100, 180);
  const moveOne = async (key: string, expected: Partial<Summary>): Promise<void> => { await tapGameKey(page, key, 100); await page.waitForTimeout(350); await checkpoint(page, expected); };
  await checkpoint(page, { map: 'REDS_HOUSE_2F', x: 3, y: 6, partyCount: 0 });
  // Public Player PC withdrawal: new Yellow starts with one Potion.
  await moveOne('ArrowLeft', { map: 'REDS_HOUSE_2F', x: 2, y: 6, partyCount: 0 });
  await moveOne('ArrowUp', { map: 'REDS_HOUSE_2F', x: 2, y: 5, partyCount: 0 });
  await moveOne('ArrowUp', { map: 'REDS_HOUSE_2F', x: 2, y: 4, partyCount: 0 });
  await moveOne('ArrowUp', { map: 'REDS_HOUSE_2F', x: 2, y: 3, partyCount: 0 });
  await moveOne('ArrowUp', { map: 'REDS_HOUSE_2F', x: 2, y: 2, partyCount: 0 });
  await moveOne('ArrowLeft', { map: 'REDS_HOUSE_2F', x: 1, y: 2, partyCount: 0 });
  await moveOne('ArrowLeft', { map: 'REDS_HOUSE_2F', x: 0, y: 2, partyCount: 0 });
  await tapGameKey(page, 'ArrowUp', 50);
  const beforePcEffect = (await currentProbe(page))!.effectId;
  await tapGameKey(page, 'Enter', 500); await page.waitForTimeout(250);
  await tapGameKey(page, 'Enter', 500); await page.waitForTimeout(250);
  await tapGameKey(page, 'Enter', 500); await page.waitForTimeout(250);
  await tapGameKey(page, 'Enter', 500);
  await expect.poll(async () => (await currentProbe(page))!.effectId, { timeout: 15_000 }).toBeGreaterThanOrEqual(beforePcEffect + 2);
  await tapGameKey(page, 'x', 150); await tapGameKey(page, 'x', 150);
  await moveOne('ArrowRight', { map: 'REDS_HOUSE_2F', x: 1, y: 2, partyCount: 0 });
  await moveOne('ArrowRight', { map: 'REDS_HOUSE_2F', x: 2, y: 2, partyCount: 0 });
  await moveOne('ArrowDown', { map: 'REDS_HOUSE_2F', x: 2, y: 3, partyCount: 0 });
  await moveOne('ArrowDown', { map: 'REDS_HOUSE_2F', x: 2, y: 4, partyCount: 0 });
  await moveOne('ArrowDown', { map: 'REDS_HOUSE_2F', x: 2, y: 5, partyCount: 0 });
  await moveOne('ArrowDown', { map: 'REDS_HOUSE_2F', x: 2, y: 6, partyCount: 0 });
  await moveOne('ArrowRight', { map: 'REDS_HOUSE_2F', x: 3, y: 6, partyCount: 0 });

  await walk('ArrowRight', 2); await walk('ArrowUp', 5); await walk('ArrowRight', 2); await page.waitForTimeout(1500); await checkpoint(page, { map: 'REDS_HOUSE_1F' });
  await walk('ArrowDown', 5); await walk('ArrowLeft', 4); await walk('ArrowDown', 2); await page.waitForTimeout(1500); await checkpoint(page, { map: 'PALLET_TOWN', x: 5, y: 6 });
  await walk('ArrowRight', 5); await walk('ArrowUp', 6); await mashUntilReady(page);
  await walk('ArrowDown', 1); await walk('ArrowRight', 2); await tapGameKey(page, 'ArrowUp'); await tapGameKey(page, 'Enter', 500);
  await mashUntilReady(page); await checkpoint(page, { partyCount: 1 });
  await walk('ArrowDown', 3);
  await tapUntilBattle(page);
  await expect.poll(() => currentProbe(page), { timeout: 90_000 }).toMatchObject({ scene: 'battle', musicSources: 1, pcmNonzero: true });
  await expect.poll(() => instrumentation(page), { timeout: 15_000 }).toMatchObject({ contexts: beforeFocus.contexts, running: 1, inactive: 1 });

});
