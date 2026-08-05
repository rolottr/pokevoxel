import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.POKEVOXEL_PREVIEW_PORT ?? 4173);
const baseURL = process.env.POKEVOXEL_BASE_URL ?? `http://127.0.0.1:${port}`;
const privateAudio = process.env.POKEVOXEL_PRIVATE_AUDIO === '1';
const testTimeout = Number(process.env.POKEVOXEL_PLAYWRIGHT_TEST_TIMEOUT_MS ?? 90_000);

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  timeout: Number.isSafeInteger(testTimeout) && testTimeout >= 5_000 ? testTimeout : 90_000,
  workers: privateAudio ? 1 : undefined,
  outputDir: process.env.POKEVOXEL_TEST_OUTPUT_DIR ?? 'test-results',
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    ...devices['Desktop Chrome'],
    channel: process.env.POKEVOXEL_BROWSER_CHANNEL ?? 'chrome',
    launchOptions: { args: ['--mute-audio'] },
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  webServer: process.env.POKEVOXEL_BASE_URL ? undefined : {
    command: `npm run preview -- --host 127.0.0.1 --port ${port}`,
    url: `${baseURL}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
