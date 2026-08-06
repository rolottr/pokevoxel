import { expect, test } from './helpers/audioHarness';

test.skip(process.env.POKEVOXEL_AUDIO_SCENARIOS !== '1', 'test-runtime audio scenarios are opt-in');

test('cycles deterministic title, map, battle, and victory scenes without leaking sources', async ({ audio }) => {
  test.setTimeout(180_000);
  await audio.ensureTitle();
  const baseline = await audio.instrumentation();
  const scenes = [
    ['1', 'title'], ['2', 'overworld'], ['3', 'battle'], ['6', 'victory'], ['2', 'overworld'],
  ] as const;

  for (let cycle = 0; cycle < 3; cycle += 1) {
    for (const [key, scene] of scenes) {
      await audio.command(key);
      await expect.poll(() => audio.probe(), { timeout: 30_000 }).toMatchObject({ scene, renderer: 'pokeaudio-hd', musicSources: 1, pcmNonzero: true });
      await expect.poll(async () => (await audio.probe())?.queued ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
      const probe = await audio.probe();
      expect(probe?.pcmPeak).toBeGreaterThan(0);
    }
  }
  expect((await audio.instrumentation()).contexts).toBe(baseline.contexts);
});
