import { expect, test, chromium, type Page } from '@playwright/test';
import { rm } from 'node:fs/promises';
import { expectNoRawRomInIndexedDb } from './privateRomAudit';

const productBase = '/';
type Summary = Readonly<{ phase: 'committed' | 'restored' | 'resumed'; version: 'red' | 'blue' | 'yellow'; slot: string; partyCount: number; map: string; x: number; y: number; optionsSha256: string }>;

async function summary(page: Page, phase: Summary['phase']): Promise<Summary | undefined> {
  const marker = page.getByTestId(`persistence-summary-${phase}`);
  if (!await marker.isVisible()) return undefined;
  return JSON.parse(await marker.innerText()) as Summary;
}
async function hasOverworld(page: Page): Promise<boolean> {
  return page.getByTestId('overworld-ready').isVisible();
}

/**
 * LÖVE consumes input on its next fixed update. Hold through that update:
 * Playwright's `press()` can dispatch keydown and keyup in the same browser
 * turn, which deliberately does not create a game input edge.
 */
async function tapGameKey(page: Page, key: string, holdMs = 80): Promise<void> {
  await page.locator('canvas').focus();
  await page.keyboard.down(key);
  await page.waitForTimeout(holdMs);
  await page.keyboard.up(key);
}

/** Real public title/new-game input; no state injection or emulator snapshot. */
async function reachOverworld(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await hasOverworld(page)) return;
    // Down is inert in text beats; at the naming preset menu it moves from
    // NEW NAME to the first preset, avoiding the keyboard-grid trap.
    await tapGameKey(page, 'ArrowDown');
    await page.waitForTimeout(75);
    await tapGameKey(page, 'Enter', 500);
    await page.waitForTimeout(125);
  }
  expect(await hasOverworld(page)).toBe(true);
}

/**
 * Opt-in real browser proof. It records only a bounded semantic summary—never
 * a file, ROM byte, player string, or generic filesystem result.
 */
test('persists an ordinary Yellow save only after marker sync, then restores the exact semantic state in a fresh browser process', async ({}, testInfo) => {
  test.setTimeout(300_000);
  const privatePath = process.env.POKEVOXEL_TEST_ROM_PATH;
  test.skip(!privatePath, 'private save-persistence scenario is opt-in');

  const profile = testInfo.outputPath('persistent-browser-profile');
  const launch = { channel: process.env.POKEVOXEL_BROWSER_CHANNEL ?? 'chrome', baseURL: testInfo.project.use.baseURL as string } as const;
  let context = await chromium.launchPersistentContext(profile, launch);
  try {
    let page = context.pages()[0] ?? await context.newPage();
    await page.goto(productBase);
    await page.locator('#gen1-rom-input').setInputFiles(privatePath!);
    await expect(page.getByTestId('cache-committed')).toBeAttached({ timeout: 120_000 });
    await page.getByRole('button', { name: /^start game$/i }).click();
    await expect(page.getByTestId('yellow-runtime-title-ready')).toBeVisible({ timeout: 60_000 });
    // This is the normal public title/New Game sequence. F1 remains strictly
    // unavailable until the bounded overworld-ready event confirms live play.
    await tapGameKey(page, 'Enter');
    await page.waitForTimeout(250);
    await tapGameKey(page, 'Enter');
    await expect(page.getByTestId('yellow-new-game-started')).toBeVisible({ timeout: 60_000 });
    await reachOverworld(page);
    await tapGameKey(page, 'F1');
    await expect(page.getByTestId('persistence-status')).toHaveText('Saving...', { timeout: 30_000 });
    await expect(page.getByTestId('persistence-status')).toHaveText('Saved', { timeout: 60_000 });
    await expect.poll(async () => summary(page, 'committed'), { timeout: 30_000 }).toBeDefined();
    const committed = await summary(page, 'committed')!;
    expect(committed.map).not.toBe('UNKNOWN');
    expect(committed.x !== 0 || committed.y !== 0).toBe(true);
    expect(committed.optionsSha256).toMatch(/^[a-f0-9]{64}$/);
    await expectNoRawRomInIndexedDb(page, privatePath);

    await context.close();
    // Closing and reopening the same profile is a browser restart/tab-close
    // proof, not a reload within the original context.
    context = await chromium.launchPersistentContext(profile, launch);
    page = context.pages()[0] ?? await context.newPage();
    await page.goto(productBase);
    await expect(page.getByTestId('persistence-restored')).toBeAttached({ timeout: 60_000 });
    await expect(page.getByTestId('cache-restored')).toBeAttached({ timeout: 60_000 });
    // Exercise the actual title CONTINUE path. The first press opens the
    // menu, the second selects CONTINUE, and the third confirms its info box.
    await page.getByRole('button', { name: /^start game$/i }).click();
    await expect(page.getByTestId('yellow-runtime-title-ready')).toBeVisible({ timeout: 60_000 });
    // Runtime handoff is the first screen that renders bounded summaries; the
    // cache-ready shell intentionally exposes only its restoration markers.
    await expect.poll(async () => summary(page, 'restored'), { timeout: 30_000 }).toBeDefined();
    const restored = await summary(page, 'restored')!;
    expect(restored).toEqual({ ...committed, phase: 'restored' });
    await tapGameKey(page, 'Enter', 500);
    await page.waitForTimeout(125);
    await tapGameKey(page, 'Enter', 500);
    await page.waitForTimeout(125);
    await tapGameKey(page, 'Enter', 500);
    await expect.poll(async () => summary(page, 'resumed'), { timeout: 60_000 }).toBeDefined();
    const resumed = await summary(page, 'resumed')!;
    // First Continue migrates the legacy flat file to deterministic slot1;
    // map, coordinates, party and user options must nevertheless be exact.
    expect(resumed.slot).toBe('yellow-slot1');
    expect(resumed).toEqual({ ...committed, phase: 'resumed', slot: 'yellow-slot1' });
    await expectNoRawRomInIndexedDb(page, privatePath);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
