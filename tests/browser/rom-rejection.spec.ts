import { expect, test } from '@playwright/test';
import { expectNoRawRomInIndexedDb } from './privateRomAudit';

const productBase = '/';
const privateLookingName = 'private-yellow-rom.gbc';

async function open(page: import('@playwright/test').Page) {
  await page.goto(productBase);
  await expect(page.locator('#app')).toHaveAttribute('data-shell-state', 'welcome');
}

for (const scenario of [
  { name: 'wrong-size', bytes: 31, expectedCode: 'wrong-size' },
  { name: 'wrong-digest', bytes: 1_048_576, expectedCode: 'wrong-digest' },
]) {
  test(`rejects a generated ${scenario.name} file locally without privacy leakage`, async ({ page }) => {
    await open(page);
    await expectNoRawRomInIndexedDb(page, privateLookingName);
    const requests: { url: string; method: string; postData: string | null }[] = [];
    page.on('request', (request) => requests.push({ url: request.url(), method: request.method(), postData: request.postData() }));

    await page.locator('#gen1-rom-input').setInputFiles({
      name: privateLookingName,
      mimeType: 'application/octet-stream',
      buffer: Buffer.alloc(scenario.bytes, 9),
    });

    const error = page.getByTestId('import-error');
    await expect(error).toHaveAttribute('data-error-code', scenario.expectedCode);
    await expect(page.locator('body')).not.toContainText(privateLookingName);
    expect(requests).toEqual([]);
    await expectNoRawRomInIndexedDb(page, privateLookingName);

    await page.reload();
    await expect(page.locator('#app')).toHaveAttribute('data-shell-state', 'welcome');
    await expectNoRawRomInIndexedDb(page, privateLookingName);
  });
}

test('validates an explicitly configured private canonical file without persisting or disclosing it', async ({ page }) => {
  const privatePath = process.env.POKEVOXEL_TEST_ROM_PATH;
  test.skip(!privatePath, 'private ROM scenario is opt-in');
  await open(page);
  await expectNoRawRomInIndexedDb(page, privatePath);
  const requests: { url: string; method: string; postData: string | null }[] = [];
  page.on('request', (request) => requests.push({ url: request.url(), method: request.method(), postData: request.postData() }));

  await page.locator('#gen1-rom-input').setInputFiles(privatePath!);
  await expect(page.locator('#app')).toHaveAttribute('data-shell-state', 'importing');
  // The local runtime may lazily GET its same-origin assets after staging;
  // the ROM flow must never submit a body or use a mutating request.
  expect(requests.filter(({ method, postData }) => method !== 'GET' || postData !== null)).toEqual([]);
  expect(requests.every(({ url }) => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
  expect(await page.evaluate((path) => {
    const name = path.split(/[\\/]/).at(-1) ?? '';
    const text = document.body.innerText;
    return text.includes(path) || text.includes(name) || /[0-9a-f]{40}/i.test(text);
  }, privatePath)).toBe(false);
  await expectNoRawRomInIndexedDb(page, privatePath);

  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-shell-state', 'welcome');
  await expectNoRawRomInIndexedDb(page, privatePath);
});
