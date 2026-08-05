import { expect, test } from '@playwright/test';
import { expectNoRawRomInIndexedDb } from './privateRomAudit';

const productBase = '/';

test('imports the configured canonical ROM locally, commits its detected version, and boots only after Start game', async ({ page }) => {
  test.setTimeout(180_000);
  const privatePath = process.env.POKEVOXEL_TEST_ROM_PATH;
  test.skip(!privatePath, 'private import-and-boot scenario is opt-in');
  const requests: { method: string; postData: string | null }[] = [];
  await page.goto(productBase);
  await expectNoRawRomInIndexedDb(page, privatePath);

  // Navigation legitimately fetches local application assets. From here on no
  // import action may upload a body or issue a non-GET request.
  page.on('request', (request) => requests.push({ method: request.method(), postData: request.postData() }));

  await page.locator('#gen1-rom-input').setInputFiles(privatePath!);
  await expect(page.getByTestId('import-progress')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('cache-committed')).toBeAttached({ timeout: 120_000 });
  await expect(page.getByTestId('start-over')).toHaveAttribute('aria-label', 'Start over');
  await expect(page.getByTestId('start-over')).toHaveAttribute('title', 'Start over');
  await expect(page.getByTestId('start-over')).toHaveCSS('position', 'absolute');
  await expect(page.getByTestId('game-controls')).toBeHidden();
  const start = page.getByRole('button', { name: /^start game$/i });
  await expect(start).toBeVisible();
  await start.click();
  await expect(page.getByTestId('audio-state')).toHaveText('running');
  await expect(page.getByTestId('yellow-runtime-title-ready')).toBeVisible({ timeout: 60_000 });
  const controls = page.getByTestId('game-controls');
  await expect(controls).toBeVisible();
  await expect(controls.getByTestId('quick-controls')).toContainText('Camera3');
  await controls.getByText('All controls').click();
  await expect(controls).toContainText('OFF → 15° → 35° → 50° → 75° → 1ST → 3RD');
  await expect(page.locator('canvas')).toBeFocused();
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(controls).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(requests.filter(({ method, postData }) => method !== 'GET' || postData !== null)).toEqual([]);
  expect(await page.evaluate((path) => {
    const name = path.split(/[\\/]/).at(-1) ?? '';
    const text = document.body.innerText;
    return text.includes(path) || text.includes(name);
  }, privatePath)).toBe(false);
  await expectNoRawRomInIndexedDb(page, privatePath);

  await page.reload();
  // A reload cannot silently re-run the raw import. It must restore only the
  // hash-validated generated cache, then require a fresh click for audio.
  await expect(page.getByTestId('cache-restored')).toBeAttached({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: /^start game$/i })).toBeVisible();
  await page.getByRole('button', { name: /^start game$/i }).click();
  await expect(page.getByTestId('yellow-runtime-title-ready')).toBeVisible({ timeout: 60_000 });
  await page.locator('canvas').press('Enter');
  // Yellow's first confirm opens the title menu; the second selects NEW GAME.
  await page.waitForTimeout(250);
  await page.locator('canvas').press('Enter');
  await expect(page.getByTestId('yellow-new-game-started')).toBeVisible({ timeout: 60_000 });
  await expectNoRawRomInIndexedDb(page, privatePath);
});
