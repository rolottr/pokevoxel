import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const text = (...parts: string[]) => readFileSync(resolve(root, ...parts), 'utf8');

describe('Layer 5 audio source contracts', () => {
  it('keeps browser audio resume inside the explicit Start lifecycle', () => {
    const host = text('src', 'runtime', 'LoveRuntimeHost.ts');
    expect(host).toMatch(/await adapter\.resumeAudio\(\);[\s\S]{0,120}?await adapter\.signalStart\(\)/);
  });

  it('does not expand the patched runtime capability surface for audio inspection', () => {
    const adapter = text('src', 'runtime', 'LoveRuntimeAdapter.ts');
    const body = adapter.match(/export type LoveRuntimeCapabilities\s*=\s*\{([\s\S]*?)\n\};/);
    expect(body).toBeTruthy();
    const names = [...body![1].matchAll(/^\s*(\w+):/gm)].map((match) => match[1]).sort();
    expect(names).toEqual(['dispose', 'persistentFsReady', 'resumeAudio', 'signalFocus', 'signalStart', 'stageRom', 'syncPersistentFs']);
  });

  it('emits only bounded semantic audio probe fields from real queued-source state', () => {
    const chip = text('runtime', 'game', 'src', 'core', 'ChipAudio.lua');
    const bootstrap = text('runtime', 'game', 'src', 'web', 'BrowserBootstrap.lua');
    const events = text('src', 'runtime', 'runtimeEvents.ts');
    expect(chip).toContain('function ChipAudio.audioProbe()');
    expect(chip).toContain('getFreeBufferCount');
    expect(chip).toContain('m.source:isPlaying()');
    expect(bootstrap).toContain('Events.emit("audio-probe"');
    expect(events).toContain("'audio-probe'");
    expect(`${chip}\n${bootstrap}`).not.toMatch(/audio-probe[^\n]*(?:song|path|bytes)/i);
  });

  it('records semantic title/map/battle/victory intent only after real audio sources start', () => {
    const music = text('runtime', 'game', 'src', 'core', 'Music.lua');
    const title = text('runtime', 'game', 'src', 'ui', 'TitleState.lua');
    const sound = text('runtime', 'game', 'src', 'core', 'Sound.lua');
    expect(music).toContain('ctx and ctx.reason == "map" and "overworld"');
    expect(music).toContain('ctx and ctx.reason == "battle" and "battle"');
    expect(music).toContain('ctx and ctx.reason == "victory" and "victory"');
    expect(title).toContain('{ reason = "title" }');
    expect(sound).toContain('ChipAudio").noteEffect("sfx")');
    expect(sound).toContain('ChipAudio").setLowHp(true)');
  });

  it('runs private native audio against the locked pin with an absolute import path', () => {
    const nativeGate = text('scripts', 'test-native-audio.mjs');
    expect(nativeGate).toContain('resolve(process.cwd(), process.env.POKEVOXEL_TEST_ROM_PATH)');
    expect(nativeGate).toContain('POKEPORT_IMPORT_ROM: romPath');
    expect(nativeGate).toContain('POKEPORT_IDENTITY: identity');
    expect(nativeGate).toContain("'upstream-lock.json'");
    expect(nativeGate).toContain("'worktree', 'prune'");
    expect(nativeGate).toContain("'worktree', 'add', '--detach'");
    expect(nativeGate).toContain("process.kill(-child.pid, signal)");
    expect(nativeGate).toContain("signalOwnedChild(child, 'SIGTERM')");
    expect(nativeGate).toContain("signalOwnedChild(child, 'SIGKILL')");
    expect(nativeGate).toContain('detached: true');
    expect(nativeGate).toContain("['SIGINT', 130]");
    expect(nativeGate).toContain('pinned_yellow_audio_driver.lua');
  });

  it('keeps the native audio gate limited to retained upstream audio assertions', () => {
    const driver = text('tests', 'native', 'pinned_yellow_audio_driver.lua');
    for (const token of ['Music_PalletTown', 'Go_Inside', 'Collision', 'Music_TitleScreen', 'Press_AB', 'PIKACHU', 'Level_Up', 'POKEPORT_AUDIO_EXHAUSTIVE']) {
      expect(driver).toContain(token);
    }
    expect(driver).not.toMatch(/Gengar|ImageWriter|battleAnims|transparentTile/);
  });
});

describe('Layer 6 focus and audio lifecycle source contracts', () => {
  it('forwards browser focus and visibility events to the active Game input reset handlers', () => {
    const main = text('runtime', 'game', 'main.lua');
    const bootstrap = text('runtime', 'game', 'src', 'web', 'BrowserBootstrap.lua');
    const host = text('src', 'runtime', 'LoveRuntimeHost.ts');
    expect(main).toContain('function love.focus(f) if _G.POKEVOXEL_GAME and _G.POKEVOXEL_GAME.focus then _G.POKEVOXEL_GAME:focus(f) end end');
    expect(main).toContain('function love.visible(v) if _G.POKEVOXEL_GAME and _G.POKEVOXEL_GAME.visible then _G.POKEVOXEL_GAME:visible(v) end end');
    expect(host).toContain('adapter.signalFocus(focused)');
    expect(bootstrap).toContain('if G and G.focus then G:focus(focused) end');
  });

  it('coalesces post-unlock lifecycle audio resumes without expanding runtime capabilities', () => {
    const host = text('src', 'runtime', 'LoveRuntimeHost.ts');
    expect(host).toContain('if (!this.audioUnlocked || this.lifecycleAudioResume) return;');
    expect(host).toContain('adapter.resumeAudio()');
    expect(host).not.toContain('adapter.signalStart();\n        .catch');
  });
});

describe('Layer 6 recoverable browser audio UI contract', () => {
  it('keeps post-unlock audio recovery on the live runtime instead of routing it through runtime failure', () => {
    const app = text('src', 'app', 'PokevoxelApp.ts');
    const screen = text('src', 'ui', 'WelcomeScreen.ts');
    expect(app).toContain('await this.host.resumeAudioAfterInterruption();');
    expect(app).toContain("this.model = { ...this.model, audioState: 'blocked', audioResumeFailed: true };");
    expect(screen).toContain("reenable.dataset.testid = 'reenable-audio'");
    expect(screen).toContain("reenable.textContent = 'Enable audio'");
  });
});
