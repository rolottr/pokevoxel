import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('private audio harness boundaries', () => {
  it('keeps semantic commands out of the production runtime source', () => {
    const bootstrap = read('runtime/game/src/web/BrowserBootstrap.lua');
    expect(bootstrap).toContain('function B.keypressed(key) end');
    expect(bootstrap).not.toContain('AudioScenario');
    expect(bootstrap).not.toContain('POKEVOXEL_TEST_AUDIO_DRIVER');
  });

  it('serves audio scenarios from a run-scoped overlay and removes private state', () => {
    const runner = read('scripts/run-browser-lane.mjs');
    expect(runner).toContain("const audioScenarios = process.argv.includes('--audio-scenarios')");
    expect(runner).toContain("resolve(runRoot, 'site')");
    expect(runner).toContain("'build-test-runtime.mjs'");
    expect(runner).toContain("rmSync(profileDir, { recursive: true, force: true })");
    expect(runner).toContain("process.env.POKEVOXEL_RETAIN_PRIVATE_PROFILE !== '1'");
  });

  it('routes fast focused checks separately from the release journey', () => {
    const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>;
    expect(scripts['test:browser:audio:focused']).toContain('--audio-scenarios');
    expect(scripts['test:browser:audio:focused']).toContain('audio-low-hp.spec.ts');
    expect(scripts['test:browser:audio:journey']).toContain('POKEVOXEL_PUBLIC_AUDIO_JOURNEY=1');
    expect(scripts['test:browser:audio:journey']).toContain('POKEVOXEL_PLAYWRIGHT_WALL_TIMEOUT_MS=660000');
    expect(scripts['test:browser:audio:journey']).toContain('POKEVOXEL_PLAYWRIGHT_IDLE_TIMEOUT_MS=660000');
    expect(scripts['test:browser:full']).toContain('test:browser:audio:journey');
    expect(scripts['verify:private']).toContain('test:browser:audio:focused');
  });

  it('uses one worker-scoped persistent profile for split scenario specs', () => {
    const helper = read('tests/browser/helpers/audioHarness.ts');
    expect(helper).toContain('launchPersistentContext(profile');
    expect(helper).toContain("args: ['--mute-audio']");
    expect(helper).toContain("{ scope: 'worker' }");
    expect(helper).toContain('if (this.started) return');
  });
});
