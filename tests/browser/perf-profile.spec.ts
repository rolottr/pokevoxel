import { expect, test } from './helpers/voxelHarness';
import { walkArrows } from './helpers/framePerf';

test.skip(process.env.POKEVOXEL_VOXEL_SCENARIOS !== '1', 'test-runtime voxel scenarios are opt-in');

type ProfileNode = { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; hitCount?: number; children?: number[] };
type Profile = { nodes: ProfileNode[]; samples?: number[]; timeDeltas?: number[] };

test('profiles the browser main thread during a Viridian Forest walk', async ({ voxel }) => {
  test.setTimeout(300_000);
  await voxel.ensureTitle();
  await voxel.command('3');
  await expect.poll(() => voxel.probe(), { timeout: 30_000 }).toMatchObject({ map: 'VIRIDIAN_FOREST' });
  const client = await voxel.context.newCDPSession(voxel.page);
  await client.send('Profiler.enable');
  await client.send('Profiler.setSamplingInterval', { interval: 200 });
  await client.send('Profiler.start');
  await walkArrows(voxel.page, Date.now() + 12_000);
  const { profile } = await client.send('Profiler.stop') as { profile: Profile };
  await client.detach();
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const self = new Map<number, number>();
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  for (let index = 0; index < samples.length; index += 1) {
    const id = samples[index]!;
    self.set(id, (self.get(id) ?? 0) + (deltas[index] ?? 0));
  }
  const rows = [...self.entries()]
    .map(([id, micros]) => ({ node: nodes.get(id), micros }))
    .filter((row) => row.node)
    .sort((left, right) => right.micros - left.micros)
    .slice(0, 20)
    .map((row) => ({
      ms: Math.round(row.micros / 1000),
      fn: row.node!.callFrame.functionName || '(anonymous)',
      url: row.node!.callFrame.url.split('/').pop() ?? '',
      line: row.node!.callFrame.lineNumber,
    }));
  console.log(`POKEVOXEL_PROFILE_EVIDENCE ${JSON.stringify(rows)}`);
  expect(rows.length).toBeGreaterThan(0);
});
