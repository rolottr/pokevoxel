import { chromium, expect, test as base, type BrowserContext, type Page } from '@playwright/test';

export type AudioProbe = Readonly<{
  scene: 'none' | 'title' | 'overworld' | 'battle' | 'victory';
  queued: number;
  playing: boolean;
  effect: 'none' | 'sfx' | 'low-hp';
  effectId: number;
  lowHp: boolean;
  musicSources: number;
  pcmPeak: number;
  pcmFrames: number;
  pcmNonzero: boolean;
  musicVolume: number;
  sfxVolume: number;
  lowHpActivations: number;
  victoryActivations: number;
}>;

export type AudioInstrumentation = Readonly<{ contexts: number; resumes: number; running: number; inactive: number }>;

class AudioHarness {
  private phase: 'unknown' | 'title' | 'overworld' = 'unknown';
  private started = false;

  constructor(readonly context: BrowserContext, readonly page: Page) {}

  async ensureTitle(): Promise<void> {
    if (this.started) return;
    // A persistent profile keeps the ROM cache fast; navigation resets scenario state.
    await this.page.goto('/');
    const restored = this.page.getByTestId('cache-restored');
    if (!await restored.isVisible()) {
      const rom = process.env.POKEVOXEL_TEST_ROM_PATH;
      if (!rom) throw new Error('POKEVOXEL_TEST_ROM_PATH is required for the private audio lane.');
      await this.page.locator('#gen1-rom-input').setInputFiles(rom);
      await expect(this.page.getByTestId('cache-committed')).toBeAttached({ timeout: 120_000 });
    }
    await this.page.getByRole('button', { name: /^start game$/i }).click();
    await expect(this.page.getByTestId('yellow-runtime-title-ready')).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => this.probe(), { timeout: 30_000 }).toMatchObject({ scene: 'title', musicSources: 1, pcmNonzero: true });
    this.phase = 'title';
    this.started = true;
  }

  async ensureOverworld(): Promise<void> {
    await this.ensureTitle();
    await this.command('2');
    await expect.poll(() => this.probe(), { timeout: 30_000 }).toMatchObject({ scene: 'overworld', musicSources: 1, pcmNonzero: true });
    this.phase = 'overworld';
  }

  async command(key: '1' | '2' | '3' | '4' | '5' | '6' | '7'): Promise<void> {
    if (this.phase === 'unknown') throw new Error(`Audio command ${key} requires title or overworld phase; call ensureTitle() or ensureOverworld() first.`);
    await this.page.locator('canvas').focus();
    await this.page.keyboard.down(key);
    await this.page.waitForTimeout(80);
    await this.page.keyboard.up(key);
  }

  async probe(): Promise<AudioProbe | undefined> {
    const marker = this.page.getByTestId('audio-probe');
    if (!await marker.isVisible()) return undefined;
    return JSON.parse(await marker.innerText()) as AudioProbe;
  }

  async instrumentation(): Promise<AudioInstrumentation> {
    return this.page.evaluate(() => {
      const state = (window as Window & typeof globalThis & { __pokevoxelAudioInstrumentation?: { contexts: AudioContext[]; resumes: number } }).__pokevoxelAudioInstrumentation;
      const contexts = state?.contexts ?? [];
      return {
        contexts: contexts.length,
        resumes: state?.resumes ?? 0,
        running: contexts.filter((context) => context.state === 'running').length,
        inactive: contexts.filter((context) => context.state !== 'running').length,
      };
    });
  }
}

type WorkerFixtures = { audio: AudioHarness };

export const test = base.extend<{}, WorkerFixtures>({
  audio: [async ({}, use, workerInfo) => {
    const profile = process.env.POKEVOXEL_TEST_PROFILE_DIR;
    if (!profile) throw new Error('POKEVOXEL_TEST_PROFILE_DIR is required for the private audio lane.');
    const context = await chromium.launchPersistentContext(profile, {
      channel: process.env.POKEVOXEL_BROWSER_CHANNEL ?? 'chrome',
      baseURL: workerInfo.project.use.baseURL as string,
    });
    await context.addInitScript(() => {
      const state = { contexts: [] as AudioContext[], resumes: 0 };
      Object.defineProperty(window, '__pokevoxelAudioInstrumentation', { value: state, configurable: true });
      const wrap = (name: 'AudioContext' | 'webkitAudioContext'): void => {
        const original = window[name] as typeof AudioContext | undefined;
        if (!original) return;
        const wrapped = function (this: unknown, ...args: ConstructorParameters<typeof AudioContext>): AudioContext {
          const audioContext = new original(...args);
          state.contexts.push(audioContext);
          const resume = audioContext.resume.bind(audioContext);
          audioContext.resume = () => { state.resumes += 1; return resume(); };
          return audioContext;
        } as unknown as typeof AudioContext;
        wrapped.prototype = original.prototype;
        Object.setPrototypeOf(wrapped, original);
        Object.defineProperty(window, name, { value: wrapped, configurable: true });
      };
      wrap('AudioContext');
      if (window.webkitAudioContext !== window.AudioContext) wrap('webkitAudioContext');
    });
    const page = context.pages()[0] ?? await context.newPage();
    try {
      await use(new AudioHarness(context, page));
    } finally {
      await context.close();
    }
  }, { scope: 'worker' }],
});

export { expect };
