import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acquireLease, browserFailureClass, browserRuntimePhase, completeRunManifest, createRunId, failedBrowserTestIds, findFreeLoopbackPort, focusBrowserArguments, recommendedBrowserCommand, recoverAbandonedBrowserRuns, releaseLease, writeRunManifest } from '../../scripts/lib/harness.mjs';

describe('browser harness', () => {
  it('creates a run-scoped identifier and allocates a loopback port', async () => {
    expect(createRunId(new Date('2026-08-04T00:00:00.000Z'), '12345678-abcd')).toBe('20260804000000000-12345678');
    await expect(findFreeLoopbackPort()).resolves.toBeGreaterThan(0);
  });

  it('owns a PID-bound lease and recovers a stale lease', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pokevoxel-harness-'));
    const lockPath = join(directory, 'lane.json');
    try {
      const lease = await acquireLease(lockPath, { pid: 42, token: 'owner', startIdentity: () => 'start', isAlive: () => true });
      expect(JSON.parse(readFileSync(lockPath, 'utf8'))).toMatchObject({ pid: 42, token: 'owner' });
      releaseLease(lease);
      expect(existsSync(lockPath)).toBe(false);

      writeFileSync(lockPath, JSON.stringify({ pid: 99, processStartIdentity: 'old', token: 'stale' }));
      const recovered = await acquireLease(lockPath, { pid: 42, token: 'fresh', startIdentity: () => 'start', isAlive: () => false });
      expect(recovered.token).toBe('fresh');
      releaseLease(recovered);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('writes manifests without ROM paths or names', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pokevoxel-harness-'));
    const manifestPath = join(directory, 'manifest.json');
    try {
      writeRunManifest(manifestPath, {
        runId: 'run', startedAt: '2026-08-04T00:00:00.000Z', port: 1234, privateAudio: true,
        outputDir: '/private/work/test-results', testArgs: ['tests/browser/audio.spec.ts'],
      });
      const manifest = readFileSync(manifestPath, 'utf8');
      expect(manifest).not.toMatch(/\.gbc?|POKEVOXEL_TEST_ROM_PATH|Pokemon/i);
      expect(manifest).toContain('<path>');
      completeRunManifest(manifestPath, {
        finishedAt: '2026-08-04T00:00:01.000Z', durationMs: 1_000, exitStatus: 1, failureStage: 'playwright', cleanupState: 'complete', failureClass: 'evaluator/test', failedTestIds: ['tests/browser/audio-start.spec.ts:7:3 › starts'], runtimePhase: 'title', recommendedNextCommand: 'npm run check:resume -- --changed tests/browser/audio-start.spec.ts', artifactsRetained: true,
      });
      expect(JSON.parse(readFileSync(manifestPath, 'utf8'))).toMatchObject({ exitStatus: 1, durationMs: 1_000, cleanupState: 'complete', failureClass: 'evaluator/test', runtimePhase: 'title', artifactsRetained: true });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('extracts actionable browser failure evidence without volatile process details', () => {
    const output = 'Error: title did not start at /tmp/run-42 port 9321\nruntime phase=title\ntests/browser/audio-start.spec.ts:7:3 › starts audio';
    expect(failedBrowserTestIds(output)).toEqual(['tests/browser/audio-start.spec.ts:7:3 › starts audio']);
    expect(browserRuntimePhase(output)).toBe('title');
    expect(browserFailureClass('playwright', output)).toBe('evaluator/test');
    expect(browserFailureClass('playwright', output, true)).toBe('orchestration/timeout');
    expect(recommendedBrowserCommand(failedBrowserTestIds(output))).toBe('npm run check:resume -- --changed tests/browser/audio-start.spec.ts');
  });

  it('builds a loopback-only focus browser command for the generated profile', () => {
    const args = focusBrowserArguments(9123, '/tmp/generated-profile');
    expect(args).toEqual(expect.arrayContaining([
      '--remote-debugging-port=9123',
      '--remote-debugging-address=127.0.0.1',
      '--user-data-dir=/tmp/generated-profile',
      '--mute-audio',
      'about:blank',
    ]));
    expect(args).not.toContain('--headless');
    expect(() => focusBrowserArguments(0, '/tmp/generated-profile')).toThrow(/valid TCP port/);
  });

  it('recovers only stale incomplete safely named browser runs', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'pokevoxel-runs-'));
    const now = Date.now() + 10 * 60_000;
    const createRun = (name: string, details: Record<string, unknown>) => {
      const runRoot = join(runsRoot, name);
      mkdirSync(runRoot, { recursive: true });
      writeFileSync(join(runRoot, 'manifest.json'), JSON.stringify({
        version: 1,
        runId: name,
        startedAt: new Date(now - 10 * 60_000).toISOString(),
        port: 1234,
        privateAudio: true,
        outputDir: 'test-results',
        testArgs: ['tests/browser/first-person.spec.ts'],
        ...details,
      }));
      for (const directory of ['indexeddb-profile', 'site', 'test-runtime', 'test-results']) mkdirSync(join(runRoot, directory));
      writeFileSync(join(runRoot, 'test-results', 'trace.zip'), 'retained');
      writeFileSync(join(runRoot, 'unrelated.txt'), 'preserved');
      return runRoot;
    };
    const stale = createRun('20260804162911663-7a67be8a', {});
    const fresh = createRun('20260805090000000-11111111', { startedAt: new Date(now - 1_000).toISOString() });
    const terminal = createRun('20260805080000000-22222222', { finishedAt: new Date(now - 1_000).toISOString(), exitStatus: 0 });
    const mismatched = createRun('20260805070000000-33333333', { runId: '20260805070000000-44444444' });
    const unsafe = createRun('not-a-run', {});
    try {
      expect(recoverAbandonedBrowserRuns(runsRoot, { now: () => now, staleAfterMs: 5 * 60_000 })).toBe(1);
      for (const directory of ['indexeddb-profile', 'site', 'test-runtime']) expect(existsSync(join(stale, directory))).toBe(false);
      expect(readFileSync(join(stale, 'test-results', 'trace.zip'), 'utf8')).toBe('retained');
      expect(readFileSync(join(stale, 'unrelated.txt'), 'utf8')).toBe('preserved');
      expect(JSON.parse(readFileSync(join(stale, 'manifest.json'), 'utf8'))).toMatchObject({
        exitStatus: 1,
        failureStage: 'interrupted',
        failureClass: 'orchestration/lifecycle',
        cleanupState: 'recovered-abandoned',
        artifactsRetained: true,
      });
      for (const untouched of [fresh, terminal, mismatched, unsafe]) expect(existsSync(join(untouched, 'indexeddb-profile'))).toBe(true);
    } finally {
      rmSync(runsRoot, { recursive: true, force: true });
    }
  });

  it('does not recover an abandoned run while a browser lane is active', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'pokevoxel-runs-'));
    const runName = '20260804162911663-7a67be8a';
    const runRoot = join(runsRoot, runName);
    mkdirSync(join(runRoot, 'indexeddb-profile'), { recursive: true });
    writeFileSync(join(runRoot, 'manifest.json'), JSON.stringify({
      version: 1, runId: runName, startedAt: '2026-08-04T00:00:00.000Z', port: 1234,
      privateAudio: true, outputDir: 'test-results', testArgs: [],
    }));
    try {
      expect(recoverAbandonedBrowserRuns(runsRoot, { now: () => Date.parse('2026-08-05T00:00:00.000Z'), activeLease: true })).toBe(0);
      expect(existsSync(join(runRoot, 'indexeddb-profile'))).toBe(true);
    } finally {
      rmSync(runsRoot, { recursive: true, force: true });
    }
  });

  it('keeps the production client and browser CLI on the root release boundary', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    const runner = readFileSync(join(process.cwd(), 'scripts', 'run-browser-lane.mjs'), 'utf8');
    const playwrightConfig = readFileSync(join(process.cwd(), 'playwright.config.ts'), 'utf8');
    expect(packageJson.scripts['build:client']).toBe('vite build');
    expect(runner).toContain('await fetch(`${baseURL}/`)');
    expect(runner).not.toContain("'--base', '/pokevoxel/'");
    expect(runner).toContain("'@playwright', 'test', 'cli.js'");
    expect(runner).toContain("command(process.execPath, playwrightArgs");
    expect(runner).not.toContain("['exec', 'playwright'");
    expect(runner).toContain('POKEVOXEL_BROWSER_STAGE_WALL_TIMEOUT_MS');
    expect(runner).toContain('POKEVOXEL_PLAYWRIGHT_IDLE_TIMEOUT_MS');
    expect(runner).toContain('POKEVOXEL_FOCUS_BROWSER_CDP_ENDPOINT');
    expect(runner).toContain('waitForFocusBrowser(focusBrowserEndpoint, focusBrowser)');
    expect(runner).toContain("process.kill(-processChild.pid, signal)");
    expect(runner.indexOf('rmSync(profileDir, { recursive: true, force: true })')).toBeLessThan(runner.indexOf('try { releaseLease(lease);'));
    expect(playwrightConfig).toContain("args: ['--mute-audio']");
  });
});
