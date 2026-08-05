import { describe, expect, it, vi } from 'vitest';
import {
  appendEvidenceTail, attemptScopeKey, buildFailureEvidence, ensureAttemptAllowed,
  executePlan, normalizeFailureAttempts, planChecks, recordFailure,
  relevantChangedPaths, resumeStage, sanitizeEvidence, selectLatestFailedManifest,
  semanticFailureIdentity, serializeFailureAttempts,
} from '../../scripts/lib/checks.mjs';

describe('check selector', () => {
  it('classifies edit and all declared tiers', () => {
    expect(planChecks({ tier: 'edit', changed: ['src/app/PokevoxelApp.ts'] }).stages.map((entry) => entry.name)).toEqual(['typecheck']);
    expect(planChecks({ tier: 'edit', changed: ['README.md'] }).stages).toEqual([]);
    expect(planChecks({ tier: 'edit', changed: ['scripts/run-checks.mjs'] }).stages.map((entry) => entry.name)).toEqual(['syntax:scripts/run-checks.mjs', 'targeted-unit']);
    expect(planChecks({ tier: 'goal', goal: 'G006' }).stages.map((entry) => entry.name)).toEqual(['typecheck', 'audio-unit', 'audio-browser', 'native-audio']);
    expect(planChecks({ tier: 'goal', goal: 'G007' }).stages.map((entry) => entry.name)).toEqual(['typecheck', 'voxel-unit', 'voxel-browser', 'native-voxel']);
    expect(planChecks({ tier: 'goal', goal: 'G008' }).stages.map((entry) => entry.name)).toEqual(['typecheck', 'water-unit', 'water-browser']);
    expect(planChecks({ tier: 'goal', goal: 'G009' }).stages.map((entry) => entry.name)).toEqual(['typecheck', 'battle-unit', 'battle-native', 'battle-browser']);
    expect(planChecks({ tier: 'goal', goal: 'G010' }).stages.map((entry) => entry.name)).toEqual(['typecheck', 'first-person-unit', 'first-person-browser']);
    expect(planChecks({ tier: 'merge' }).stages.at(-1)).toMatchObject({ name: 'browser-public', env: { POKEVOXEL_SKIP_CLIENT_BUILD: '1' } });
    expect(planChecks({ tier: 'full' })).toMatchObject({
      cachePolicy: 'fresh',
      stages: [
        { name: 'upstream' }, { name: 'typecheck' }, { name: 'unit' }, { name: 'lua' },
        { name: 'browser-matrix', env: { POKEVOXEL_DISABLE_CACHE: '1' } }, { name: 'native-audio' },
      ],
    });
  });

  it('fails closed for missing, unsafe, and unmapped edit paths', () => {
    expect(() => planChecks({ tier: 'edit' })).toThrow(/requires/);
    expect(() => planChecks({ tier: 'edit', changed: ['dist/a.js'] })).toThrow(/unsafe/);
    expect(() => planChecks({ tier: 'edit', changed: ['unknown.surface'] })).toThrow(/unmapped/);
  });

  it('redacts and bounds evidence before storing it', () => {
    const privateText = 'POKEVOXEL_TEST_ROM_PATH=/private/name.gbc failed at /Users/dev/private/name.gbc';
    expect(sanitizeEvidence(privateText)).not.toMatch(/name\.gbc|\/Users\/dev/);
    expect(appendEvidenceTail('', 'a'.repeat(5_000))).toHaveLength(4_000);
  });

  it('blocks a third identical attempt before an executor can run', async () => {
    const scope = attemptScopeKey({ tier: 'edit', goal: null, stage: 'unit', failureClass: 'evaluator/test', assertionSummary: 'expected x', runtimePhase: null });
    expect(scope).toContain('"stage":"unit"');
    const first = recordFailure(undefined, { stage: 'unit' });
    const second = recordFailure(first, { stage: 'unit' });
    expect(second.count).toBe(2);
    const executor = vi.fn(async () => ({ exit: 0, output: '' }));
    expect(() => ensureAttemptAllowed(second)).toThrow(/third/);
    expect(executor).not.toHaveBeenCalled();
    expect(() => ensureAttemptAllowed(second, { relevantChanged: [] })).toThrow(/causal/);
    expect(() => ensureAttemptAllowed(second, { relevantChanged: ['src/app.ts'] })).not.toThrow();
    const reopened = recordFailure(second, { stage: 'unit' });
    expect(reopened.count).toBe(3);
    expect(() => ensureAttemptAllowed(reopened, { relevantChanged: ['src/app.ts'] })).toThrow(/stop testing/);
    const run = await executePlan({ stages: [{ name: 'first' }, { name: 'second' }] } as never, async (entry) => ({ exit: entry.name === 'second' ? 1 : 0, output: 'failure' }));
    expect(run.failed).toBe('second');
  });

  it('bounds a silent stage and terminates its owned process group', async () => {
    vi.stubEnv('POKEVOXEL_CHECK_STAGE_WALL_TIMEOUT_MS', '5000');
    vi.stubEnv('POKEVOXEL_CHECK_STAGE_IDLE_TIMEOUT_MS', '100');
    try {
      const run = await executePlan({ stages: [{ name: 'silent', command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], env: {} }] } as never);
      expect(run.failed).toBe('silent');
      expect(run.output).toContain('idle timeout');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('keeps semantic failure identity stable across volatile diagnostics', () => {
    const first = semanticFailureIdentity({ tier: 'goal', goal: 'G007', stage: 'voxel-browser', output: '\u001b[31mError: expected overworld\u001b[0m at /tmp/run-123 port 9222 after 42ms\nphase=overworld\ntests/browser/voxel-overworld.spec.ts:18:3 › enters town' });
    const second = semanticFailureIdentity({ tier: 'goal', goal: 'G007', stage: 'voxel-browser', output: 'Error: expected overworld at /tmp/run-999 port 4811 after 2s\nphase=overworld\ntests/browser/voxel-overworld.spec.ts:18:3 › enters town' });
    expect(first).toEqual(second);
    expect(attemptScopeKey(first)).toBe(attemptScopeKey(second));
  });

  it('requires a relevant declared path and narrows browser resume to the failed test', () => {
    const browser = planChecks({ tier: 'goal', goal: 'G007' }).stages.find((entry) => entry.name === 'voxel-browser')!;
    expect(relevantChangedPaths(browser, ['docs/harness.md'])).toEqual([]);
    expect(relevantChangedPaths(browser, ['tests/browser/voxel-overworld.spec.ts'])).toEqual(['tests/browser/voxel-overworld.spec.ts']);
    expect(resumeStage(browser, 'tests/browser/voxel-overworld.spec.ts:18:3 › enters town')).toMatchObject({
      command: process.execPath,
      args: ['scripts/run-browser-lane.mjs', '--private-audio', '--voxel-scenarios', '--', 'tests/browser/voxel-overworld.spec.ts:18'],
    });
  });

  it('selects only the requested goal failure and requires a goal for goal-origin resume', () => {
    const g008 = { exit: 1, goal: 'G008', failureStage: 'water-browser', finishedAt: '2026-08-04T16:20:00Z' };
    const g009 = { exit: 1, goal: 'G009', failureStage: 'battle-native', finishedAt: '2026-08-04T16:10:00Z' };
    expect(selectLatestFailedManifest([g008, g009], 'G009')).toBe(g009);
    expect(() => selectLatestFailedManifest([g008, g009], 'G010')).toThrow(/for goal G010/);
    expect(() => selectLatestFailedManifest([g008, g009], undefined)).toThrow(/explicit --goal/);
  });

  it('preserves the G009 native failure when goal execution has no changed paths', async () => {
    const plan = planChecks({ tier: 'goal', goal: 'G009' });
    const result = await executePlan(plan, async (entry) => ({
      exit: entry.name === 'battle-native' ? 1 : 0,
      output: entry.name === 'battle-native' ? 'Error: compatible native LOVE executable unavailable' : 'passed',
    }));
    expect(result.results.map((entry) => [entry.name, entry.exit])).toEqual([
      ['typecheck', 0], ['battle-unit', 0], ['battle-native', 1],
    ]);
    const evidence = buildFailureEvidence({ plan, result, changed: [] })!;
    expect(evidence.relevant).toEqual([]);
    expect(evidence.manifest).toMatchObject({
      failureStage: 'battle-native',
      failureClass: 'environment/external',
      recommendedNextCommand: 'npm run check:resume -- --goal G009 --changed scripts/test-native-battle.mjs',
    });
  });

  it('ignores opaque legacy state and writes readable failure attempts', () => {
    const legacy = { 'opaque-digest:goal:G009': { stage: 'battle-native', signature: 'opaque', count: 2 } };
    expect(normalizeFailureAttempts(legacy)).toEqual([]);
    const identity = semanticFailureIdentity({
      tier: 'goal', goal: 'G009', stage: 'battle-native',
      output: 'Error: compatible native LOVE executable unavailable',
    });
    const attempt = recordFailure(undefined, {
      stage: 'battle-native', identity,
      relevantPaths: ['scripts/test-native-battle.mjs'], changedPaths: [],
    });
    expect(attempt).toMatchObject({
      goal: 'G009', tier: 'goal', stage: 'battle-native', failedTest: null,
      failureClass: 'environment/external', assertion: expect.any(String),
      runtimePhase: null, count: 1, changedPaths: [],
    });
    expect(serializeFailureAttempts([attempt])).toEqual({ schemaVersion: 2, attempts: [attempt] });
  });
});
