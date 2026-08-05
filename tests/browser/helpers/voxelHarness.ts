import { chromium, expect, test as base, type BrowserContext, type Page } from '@playwright/test';

export type VoxelProbe = Readonly<{
  map: 'PALLET_TOWN' | 'REDS_HOUSE_1F' | 'VIRIDIAN_FOREST' | 'ROCK_TUNNEL_1F';
  loads: number;
  stableFrames: number;
  depth: boolean;
  npcDepth: boolean;
  buildingDepth: boolean;
  palette: 'active' | 'default';
  dayNight: 'DAY' | 'NIGHT' | 'MORNING' | 'EVENING';
  menus: boolean;
  streamCount: number;
  fallback: boolean;
}>;

class VoxelHarness {
  private phase: 'unknown' | 'title' | 'overworld' = 'unknown';
  private readonly runtimeRequests = new Map<string, string>();
  private startHandoffMilliseconds?: number;
  constructor(readonly context: BrowserContext, readonly page: Page, private readonly baseURL: string) {
    this.page.on('request', (request) => {
      const url = new URL(request.url());
      const name = url.pathname.match(/\/runtime\/(game\.js|game\.data|love\.js|love\.wasm|love\.worker\.js)$/)?.[1];
      if (name) this.runtimeRequests.set(name, url.searchParams.get('v') ?? '');
    });
  }

  async ensureTitle(): Promise<void> {
    // The shared profile preserves the cached ROM while each test begins at title.
    await this.page.goto(new URL('/', this.baseURL).href);
    const restored = this.page.getByTestId('cache-restored');
    if (!await restored.isVisible()) {
      const rom = process.env.POKEVOXEL_TEST_ROM_PATH;
      if (!rom) throw new Error('POKEVOXEL_TEST_ROM_PATH is required for the private voxel lane.');
      await this.page.locator('#gen1-rom-input').setInputFiles(rom);
      await expect(this.page.getByTestId('cache-committed')).toBeAttached({ timeout: 120_000 });
    }
    const startedAt = Date.now();
    await this.page.getByRole('button', { name: /^start game$/i }).click();
    await expect(this.page.locator('.runtime-stage')).toHaveAttribute('data-state', 'playing', { timeout: 5_000 });
    this.startHandoffMilliseconds = Date.now() - startedAt;
    await expect(this.page.getByTestId('yellow-runtime-title-ready')).toBeVisible({ timeout: 60_000 });
    this.phase = 'title';
  }

  startHandoffMs(): number | undefined { return this.startHandoffMilliseconds; }

  async runtimeRevisionEvidence(): Promise<Readonly<{ revision: string; assets: Record<string, string> }>> {
    const revision = await this.page.locator('.runtime-stage').getAttribute('data-runtime-revision') ?? '';
    return { revision, assets: Object.fromEntries(this.runtimeRequests) };
  }

  async runtimeDiagnostics(): Promise<readonly string[]> {
    return this.page.evaluate(() => {
      const runtime = (window as Window & { Module?: { pokevoxelRuntimeDiagnostics?: unknown } }).Module;
      const diagnostics = runtime?.pokevoxelRuntimeDiagnostics;
      return Array.isArray(diagnostics)
        ? diagnostics.filter((value): value is string => typeof value === 'string')
        : [];
    });
  }

  async ensureOverworld(): Promise<void> {
    await this.ensureTitle();
    // Private scenario archives reserve 0 for one phase transition only: they
    // push the existing live overworld before any numbered scenario command.
    await this.tapGameKey('0', 80);
    await expect(this.page.getByTestId('overworld-ready')).toBeVisible({ timeout: 60_000 });
    this.phase = 'overworld';
  }

  async command(key: string): Promise<void> {
    if (this.phase === 'unknown') throw new Error(`Voxel command ${key} requires title or overworld phase; call ensureTitle() or ensureOverworld() first.`);
    await this.page.locator('canvas').focus();
    await this.page.keyboard.press(key);
  }

  async toggleMenu(): Promise<void> {
    if (this.phase === 'unknown') throw new Error('Voxel menu requires title or overworld phase; call ensureTitle() or ensureOverworld() first.');
    await this.page.locator('canvas').focus();
    await this.page.keyboard.press('Escape');
  }

  async probe(): Promise<VoxelProbe | undefined> {
    const marker = this.page.getByTestId('voxel-probe');
    if (!await marker.isVisible()) return undefined;
    return JSON.parse(await marker.innerText()) as VoxelProbe;
  }

  async setPalletLowAngle(): Promise<void> {
    await this.command('r');
    // The retained camera tween is exactly 0.25 seconds. Give the real update
    // loop two complete tween windows before reading its projected anchor.
    await this.page.waitForTimeout(500);
  }

  async forcePackedDepth(): Promise<void> {
    await this.command('p');
    await this.page.waitForTimeout(250);
  }

  async locatePalletOcclusionNpc(): Promise<Readonly<{ x: number; y: number; card: number; angle: number; packed: boolean }>> {
    await this.command('9');
    // Command 9 reloads the same map, so the previous readiness marker is not
    // evidence that the replacement mesh has drawn. Wait beyond the retained
    // 250 ms camera tween before sampling the live GPU slot with command o.
    await this.page.waitForTimeout(750);
    await this.command('o');
    await expect.poll(() => this.occlusionProbe(), { timeout: 2_000 }).toMatchObject({ hidden: false });
    return await this.occlusionProbe() as Readonly<{ x: number; y: number; card: number; angle: number; hidden: boolean; packed: boolean }>;
  }

  async hidePalletOcclusionNpc(): Promise<void> {
    await this.command('q');
    await expect.poll(() => this.occlusionProbe(), { timeout: 2_000 }).toMatchObject({ hidden: true });
  }

  private async occlusionProbe(): Promise<Readonly<{ x: number; y: number; card: number; angle: number; hidden: boolean; packed: boolean }> | undefined> {
    const marker = this.page.getByTestId('voxel-occlusion-probe');
    if (!await marker.isVisible()) return undefined;
    return JSON.parse(await marker.innerText()) as Readonly<{ x: number; y: number; card: number; angle: number; hidden: boolean; packed: boolean }>;
  }

  private async tapGameKey(key: string, waitMs: number): Promise<void> {
    await this.page.locator('canvas').focus();
    await this.page.keyboard.down(key);
    await this.page.waitForTimeout(waitMs);
    await this.page.keyboard.up(key);
  }
}

type WorkerFixtures = { voxel: VoxelHarness };
export const test = base.extend<{}, WorkerFixtures>({
  voxel: [async ({ headless, launchOptions }, use, workerInfo) => {
    const profile = process.env.POKEVOXEL_TEST_PROFILE_DIR;
    if (!profile) throw new Error('POKEVOXEL_TEST_PROFILE_DIR is required for the private voxel lane.');
    const baseURL = workerInfo.project.use.baseURL;
    if (typeof baseURL !== 'string') throw new Error('The private voxel lane requires a project baseURL.');
    const focusBrowserEndpoint = process.env.POKEVOXEL_FOCUS_BROWSER_CDP_ENDPOINT;
    if (focusBrowserEndpoint) {
      // The lane owns this headed browser and its generated profile. Connecting
      // without Playwright's default focus override preserves real tab focus.
      const browser = await chromium.connectOverCDP(focusBrowserEndpoint, {
        noDefaults: true,
      } as Parameters<typeof chromium.connectOverCDP>[1] & { noDefaults: true });
      const context = browser.contexts()[0];
      if (!context) throw new Error('The owned focus browser did not expose its default context.');
      const page = context.pages()[0] ?? await context.newPage();
      await use(new VoxelHarness(context, page, baseURL));
      return;
    }
    const context = await chromium.launchPersistentContext(profile, {
      ...launchOptions,
      headless,
      channel: process.env.POKEVOXEL_BROWSER_CHANNEL ?? 'chrome',
      baseURL,
    });
    const page = context.pages()[0] ?? await context.newPage();
    try { await use(new VoxelHarness(context, page, baseURL)); }
    finally { await context.close(); }
  }, { scope: 'worker' }],
});
export { expect };
