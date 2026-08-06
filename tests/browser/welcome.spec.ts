import { expect, test, type Page } from '@playwright/test';

const productBase = '/';
const privateLookingName = 'private-gen1-rom.gb';

async function openWelcome(page: Page) {
  await page.goto(productBase);
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#app')).toHaveAttribute('data-shell-state', 'welcome');
}

test('opens the production welcome screen at the root deployment path', async ({ page }) => {
  await openWelcome(page);
  expect(new URL(page.url()).pathname).toBe(productBase);
  await expect(page.locator('.privacy-note')).toContainText(/local|device|upload/i);
  await expect(page.getByTestId('pokevoxel-logo')).toContainText('POKEVOXEL');
  await expect(page.getByTestId('rom-sha-list').locator('li')).toHaveCount(3);
  await expect(page.getByTestId('rom-sha-list')).toContainText('ea9bcae617fdf159b045185467ae58b2e4a48b9a');
  await expect(page.getByTestId('rom-sha-list')).toContainText('d7037c83e1ae5b39bde3c30787637ba1d4c48ce2');
  await expect(page.getByTestId('rom-sha-list')).toContainText('cc7d03262ebfaf2f06772c1a480c7d9d5f4a38e1');
  const hdAudio = page.getByTestId('hd-audio-checkbox');
  await expect(hdAudio).toBeChecked();
  await hdAudio.uncheck();
  await expect(hdAudio).not.toBeChecked();
});

test('activates the accessible ROM picker by keyboard without exposing the raw input', async ({ page }) => {
  await openWelcome(page);
  const picker = page.getByTestId('rom-drop-target');
  await picker.focus();
  await expect(picker).toBeFocused();
  const chooser = page.waitForEvent('filechooser');
  await picker.press('Enter');
  await chooser;
  await expect(page.locator('#gen1-rom-input')).toHaveAttribute('accept', /\.gb,\.gbc/);
});

test('shows a keyboard-accessible drag and drop affordance', async ({ page }) => {
  await openWelcome(page);
  const dropTarget = page.getByTestId('rom-drop-target');
  await expect(dropTarget).toBeVisible();
  await expect(dropTarget).toHaveAttribute('tabindex', '0');
  await dropTarget.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('rom-drop-target')).toBeFocused();
});

test('does not make a network request or leak a selected dummy filename', async ({ page }) => {
  await openWelcome(page);
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.locator('#gen1-rom-input').setInputFiles({
    name: privateLookingName,
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(32, 7),
  });
  await expect(page.locator('#app')).toHaveAttribute('data-shell-state', 'error');
  await expect(page.getByTestId('import-error')).toHaveAttribute('data-error-code', 'wrong-size');
  await expect(page.locator('body')).not.toContainText(privateLookingName);
  expect(requests).toEqual([]);
});

test('honors reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openWelcome(page);
  await expect(page.locator('.welcome-shell')).toHaveCSS('transition-duration', '0s');
});

for (const width of [320, 768, 1440]) {
  test(`keeps the welcome screen usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openWelcome(page);
    await expect(page.getByTestId('rom-drop-target')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });
}

test('production preview supplies cross-origin isolation and SharedArrayBuffer', async ({ page }) => {
  await openWelcome(page);
  await expect.poll(() => page.evaluate(() => ({
    crossOriginIsolated: globalThis.crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
  }))).toEqual({ crossOriginIsolated: true, sharedArrayBuffer: true });
});

test('accepts a synthetic drop locally without leaking its generated filename or making a request', async ({ page }) => {
  await openWelcome(page);
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.getByTestId('rom-drop-target').evaluate((target, fileName) => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(32).fill(9)], fileName, { type: 'application/octet-stream' }));
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
  }, privateLookingName);
  await expect(page.locator('#app')).toHaveAttribute('data-shell-state', 'error');
  await expect(page.getByTestId('import-error')).toHaveAttribute('data-error-code', 'wrong-size');
  await expect(page.locator('body')).not.toContainText(privateLookingName);
  expect(requests).toEqual([]);
});

test('keeps focus order meaningful from the picker through audio choice to the visible import action', async ({ page }) => {
  await openWelcome(page);
  await page.locator('#gen1-rom-input').setInputFiles({
    name: privateLookingName,
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(16),
  });
  await expect(page.locator('#app')).toHaveAttribute('data-shell-state', 'error');
  const picker = page.getByTestId('rom-drop-target');
  await picker.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('hd-audio-checkbox')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /choose another file/i })).toBeFocused();
});

test('recovers from the shell error state by returning to the welcome state', async ({ page }) => {
  await openWelcome(page);
  await page.locator('#gen1-rom-input').setInputFiles({
    name: privateLookingName,
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(16),
  });
  await expect(page.locator('#app')).toHaveAttribute('data-shell-state', 'error');
  await page.getByRole('button', { name: /choose another file/i }).click();
  await expect(page.locator('#app')).toHaveAttribute('data-shell-state', 'welcome');
});

test('requires explicit confirmation before clearing rebuildable cache under quota pressure', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: {
      estimate: async () => ({ quota: 100, usage: 95 }),
      persist: async () => false,
    } });
    let confirmations = 0;
    window.confirm = () => { confirmations += 1; return false; };
    Object.defineProperty(window, '__pokevoxelConfirmations', { value: () => confirmations });
  });
  await openWelcome(page);
  await page.locator('#gen1-rom-input').setInputFiles({ name: privateLookingName, mimeType: 'application/octet-stream', buffer: Buffer.alloc(32) });
  await expect(page.getByTestId('import-error')).toHaveAttribute('data-error-code', 'storage-unavailable');
  const clear = page.getByTestId('clear-rebuildable-cache');
  await expect(clear).toBeVisible();
  await clear.click();
  await expect.poll(() => page.evaluate(() => (window as Window & { __pokevoxelConfirmations: () => number }).__pokevoxelConfirmations())).toBe(1);
  await expect(page.getByTestId('import-error')).toContainText(/nearly full/i);
});

test('clears only via the confirmed fixed cache-maintenance runtime mode', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: {
      estimate: async () => ({ quota: 100, usage: 95 }), persist: async () => false,
    } });
    window.confirm = () => true;
  });
  await openWelcome(page);
  await page.locator('#gen1-rom-input').setInputFiles({ name: privateLookingName, mimeType: 'application/octet-stream', buffer: Buffer.alloc(32) });
  await page.getByTestId('clear-rebuildable-cache').click();
  await expect(page.locator('#app')).toHaveAttribute('data-shell-state', 'welcome', { timeout: 30_000 });
  await expect(page.getByTestId('storage-warning')).toContainText(/rebuildable cache cleared|saves and options were kept/i);
});
