import { expect, test } from './helpers/audioHarness';

test.skip(process.env.POKEVOXEL_AUDIO_SCENARIOS !== '1', 'test-runtime audio scenarios are opt-in');

test('starts audio from the explicit gesture and preserves browser audio ownership', async ({ audio }) => {
  test.setTimeout(180_000);
  await audio.ensureTitle();
  const baseline = await audio.instrumentation();
  expect(baseline.contexts).toBeGreaterThan(0);
  expect(baseline.running).toBeGreaterThan(0);

  const beforeFocus = baseline.resumes;
  await audio.page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
  await expect.poll(() => audio.instrumentation(), { timeout: 15_000 }).toMatchObject({ contexts: baseline.contexts, running: baseline.running });
  expect((await audio.instrumentation()).resumes).toBeGreaterThan(beforeFocus);

  await audio.command('7');
  await expect.poll(() => audio.probe(), { timeout: 15_000 }).toMatchObject({ musicVolume: 0, musicSources: 1 });
  await audio.command('3');
  await expect.poll(() => audio.probe(), { timeout: 30_000 }).toMatchObject({ scene: 'battle', musicVolume: 0, musicSources: 1, pcmNonzero: true });
  await audio.command('7');
  await expect.poll(() => audio.probe(), { timeout: 15_000 }).toMatchObject({ musicVolume: 7, musicSources: 1 });
  expect((await audio.instrumentation()).contexts).toBe(baseline.contexts);
});
