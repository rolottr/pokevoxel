import { expect, test } from './helpers/audioHarness';

test.skip(process.env.POKEVOXEL_AUDIO_SCENARIOS !== '1', 'test-runtime audio scenarios are opt-in');

test('starts audio from the explicit gesture and preserves browser audio ownership', async ({ audio }) => {
  test.setTimeout(180_000);
  await audio.ensureTitle();
  const baseline = await audio.instrumentation();
  const hdProbe = await audio.probe();
  expect(baseline.contexts).toBeGreaterThan(0);
  expect(baseline.running).toBeGreaterThan(0);
  expect(hdProbe).toBeDefined();
  const initialScene = hdProbe!.scene;

  await audio.applyPersistentAudioToggle('stock');
  await audio.applyPersistentAudioToggle('pokeaudio-hd');
  const restartedBaseline = await audio.instrumentation();

  await audio.command('F9');
  await expect.poll(() => audio.probe(), { timeout: 30_000 }).toMatchObject({
    scene: initialScene, renderer: 'stock', musicSources: 1, pcmNonzero: true,
  });
  await audio.command('F9');
  await expect.poll(() => audio.probe(), { timeout: 30_000 }).toMatchObject({
    scene: initialScene, renderer: 'pokeaudio-hd', musicSources: 1, pcmNonzero: true,
  });
  const restoredHdProbe = await audio.probe();
  expect(restoredHdProbe?.effectId).toBe(hdProbe?.effectId);
  expect(restoredHdProbe?.musicSources).toBe(hdProbe?.musicSources);

  const beforeFocus = restartedBaseline.resumes;
  await audio.page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
  await expect.poll(() => audio.instrumentation(), { timeout: 15_000 }).toMatchObject({ contexts: restartedBaseline.contexts, running: restartedBaseline.running });
  expect((await audio.instrumentation()).resumes).toBeGreaterThan(beforeFocus);

  await audio.command('7');
  await expect.poll(() => audio.probe(), { timeout: 15_000 }).toMatchObject({ musicVolume: 0, musicSources: 1 });
  await audio.command('3');
  await expect.poll(() => audio.probe(), { timeout: 30_000 }).toMatchObject({ scene: 'battle', renderer: 'pokeaudio-hd', musicVolume: 0, musicSources: 1, pcmNonzero: true });
  await audio.command('7');
  await expect.poll(() => audio.probe(), { timeout: 15_000 }).toMatchObject({ musicVolume: 7, musicSources: 1 });
  expect((await audio.instrumentation()).contexts).toBe(restartedBaseline.contexts);
});
