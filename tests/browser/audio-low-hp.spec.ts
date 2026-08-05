import { expect, test } from './helpers/audioHarness';

test.skip(process.env.POKEVOXEL_AUDIO_SCENARIOS !== '1', 'test-runtime audio scenarios are opt-in');

test('starts and clears low-HP audio through the real BattleState alarm path', async ({ audio }) => {
  test.setTimeout(180_000);
  await audio.ensureTitle();
  await audio.command('3');
  const before = await audio.probe();

  await audio.command('4');
  await expect.poll(() => audio.probe(), { timeout: 15_000 }).toMatchObject({ scene: 'battle', lowHp: true, effect: 'low-hp', musicSources: 1 });
  expect((await audio.probe())!.lowHpActivations).toBeGreaterThan(before!.lowHpActivations);

  await audio.command('5');
  await expect.poll(() => audio.probe(), { timeout: 15_000 }).toMatchObject({ lowHp: false, musicSources: 1 });
});
