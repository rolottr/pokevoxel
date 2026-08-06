import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const text = (...parts: string[]) => readFileSync(resolve(root, ...parts), 'utf8');

describe('Layer 5 audio source contracts', () => {
  it('keeps browser audio resume inside the explicit Start lifecycle', () => {
    const host = text('src', 'runtime', 'LoveRuntimeHost.ts');
    expect(host).toMatch(/await adapter\.resumeAudio\(\);[\s\S]{0,120}?await adapter\.signalStart\(renderer\)/);
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
    expect(chip).toContain('renderer = telemetry.renderer');
    expect(chip).toContain('noteQueuedRenderer(m, buf.renderer)');
    expect(chip).toContain('syncAudibleRenderer(m, queued)');
    expect(chip).toContain('getFreeBufferCount');
    expect(chip).toContain('m.source:isPlaying()');
    expect(bootstrap).toContain('Events.emit("audio-probe"');
    expect(events).toContain("'audio-probe'");
    expect(events).toContain("renderer: 'stock' | 'pokeaudio-hd'");
    expect(`${chip}\n${bootstrap}`).not.toMatch(/audio-probe[^\n]*(?:song|path|bytes)/i);
  });

  it('packages one shared serializable PokeAudio HD renderer for main-thread and worker synthesis', () => {
    const synth = text('runtime', 'game', 'src', 'core', 'ChipSynth.lua');
    const chip = text('runtime', 'game', 'src', 'core', 'ChipAudio.lua');
    const worker = text('runtime', 'game', 'src', 'core', 'chip_worker.lua');
    const main = text('runtime', 'mods', 'pokeaudio-hd', 'main.lua');
    const renderer = text('runtime', 'mods', 'pokeaudio-hd', 'audio', 'ModernRetro.lua');
    const build = text('scripts', 'build-runtime.mjs');
    const audit = text('scripts', 'audit-runtime.mjs');
    expect(synth).toContain('function ChipSynth.setRenderer(descriptor)');
    expect(synth).toContain('function Engine:refreshRenderer()');
    expect(synth).toContain('rendererId = activeRendererId');
    expect(chip).toContain('renderer = ChipSynth.getRendererDescriptor()');
    expect(chip).not.toContain('if currentMusic then ChipAudio.stopMusic() end');
    expect(chip).toContain('LIVE_SWITCH_QUEUE_TARGET = 8');
    expect(chip).toContain('LIVE_SWITCH_START_TARGET = 4');
    expect(chip).toContain('ChipAudio.setLiveRendererSwitch');
    expect(chip).toContain('function ChipAudio.rendererSwitchStatus(target)');
    expect(chip).toContain('pending * MUSIC_BUFFER_SAMPLES / SAMPLE_RATE');
    expect(chip).toContain('buf.renderer ~= selectedRenderer');
    expect(chip).not.toContain('liveSwitch = liveRendererSwitch');
    expect(worker).toContain('ChipSynth.setRenderer(cmd.renderer)');
    expect(worker).toContain('outCh:getCount() < LOOKAHEAD');
    expect(worker).not.toContain('liveLookahead');
    expect(worker).toContain('local IDLE_SLEEP = 0.010');
    expect(worker).toContain('love.timer.sleep(IDLE_SLEEP)');
    expect(worker).not.toContain('love.timer.sleep(0.001)');
    expect(worker).toContain('renderer = engine:getRendererId()');
    expect(main).toContain('id = "pokeaudio-hd"');
    expect(main).toContain('ChipAudio.setLiveRendererSwitch(true)');
    expect(main).toContain('mod.exports.toggle = function()');
    expect(main).toContain('mod.exports.selectRenderer = function(value, announce)');
    expect(main).toContain('mod.options:define(rendererSchema)');
    expect(main).toContain('label = "AUDIO DRIVER"');
    expect(main).toContain('mod.events:on("mod.options_changed"');
    expect(main).toContain('payload.key == "renderer"');
    expect(main).toContain('{ "8BIT", "stock" }');
    expect(main).toContain('ChipAudio.rendererSwitchStatus(noticeTarget)');
    expect(main).toContain('AUDIO: %s > %s %.1fs');
    for (const method of ['pulse', 'wave', 'noise', 'mixChannel', 'processStereo']) {
      expect(renderer).toContain(`function Renderer:${method}`);
    }
    expect(build).toContain("{ id: 'pokeaudio-hd', path: join(runtime, 'mods', 'pokeaudio-hd') }");
    expect(audit).toContain("count('mods/pokeaudio-hd/manifest.json') !== 1");
  });

  it('always loads PokeAudio and exposes one direct live F10 audio-driver control', () => {
    const manifestJson = text('runtime', 'mods', 'pokeaudio-hd', 'manifest.json');
    const manifest = text('runtime', 'game', 'src', 'mods', 'Manifest.lua');
    const loader = text('runtime', 'game', 'src', 'mods', 'Loader.lua');
    const manager = text('runtime', 'game', 'src', 'mods', 'ManagerState.lua');
    expect(JSON.parse(manifestJson).always_loaded).toBe(true);
    expect(manifest).toContain('always_loaded must be a boolean');
    expect(manifest).toContain('always_loaded = alwaysLoaded');
    expect(loader).toContain('if mod.manifest.always_loaded and self.disabled[id] then');
    expect(loader).toMatch(/if mod\.manifest\.always_loaded then[\s\S]{0,180}if enabled == false then return false end/);
    expect(manager).toContain('if m.always_loaded then return false end');
    expect(manager).toMatch(/function ManagerState:detailRows\(m\)[\s\S]{0,100}if m\.always_loaded then/);
    expect(manager).toContain('label = option.label');
    expect(manager).toContain('self:notify("USE AUDIO DRIVER")');
  });

  it('applies the fixed homepage preference before title audio and mirrors only the saved F10 value', () => {
    const bootstrap = text('runtime', 'game', 'src', 'web', 'BrowserBootstrap.lua');
    const patch = text('scripts', 'patch-love-runtime.mjs');
    const app = text('src', 'app', 'PokevoxelApp.ts');
    expect(patch).toContain('renderer!=="pokeaudio-hd"&&renderer!=="stock"');
    expect(patch).toContain('FS.writeFile("/tmp/pokevoxel-audio-renderer",renderer)');
    expect(bootstrap).toMatch(/applyAudioPreference\(G,renderer\)[\s\S]{0,80}G:returnToTitle/);
    expect(bootstrap).toContain('options.modOptions[AUDIO_MOD].renderer=renderer');
    expect(bootstrap).toContain('if not (exports and exports.selectRenderer) then error("POKEVOXEL_AUDIO_RENDERER_UNAVAILABLE",0) end');
    expect(bootstrap).toContain('exports.selectRenderer(renderer,false)');
    expect(bootstrap).not.toContain('options.mods[AUDIO_MOD]=true');
    expect(bootstrap).not.toContain('loader.disabled[AUDIO_MOD]=nil');
    expect(bootstrap).not.toContain('ChipAudio.setRenderer(selected)');
    expect(bootstrap).toContain('Events.emit("audio-preference"');
    expect(app).toContain("event.type === 'audio-preference'");
    expect(app).toContain('if (!this.audioRendererOverride)');
    expect(app).toContain('this.audioRendererOverride = true');
    expect(bootstrap).not.toMatch(/mod\.exports\.toggle/);
  });

  it('exposes the live F9 audio comparison without replacing the persistent mod manager', () => {
    const game = text('runtime', 'game', 'src', 'core', 'Game.lua');
    const controls = text('src', 'ui', 'GameControls.ts');
    expect(game).toContain('if key == "f9" then');
    expect(game).toContain('self.mods.exports["pokeaudio-hd"]');
    expect(game).toContain('if key == "f10" then');
    expect(game).toContain('ModRuntime.call("render.hud"');
    expect(controls).toContain("{ label: 'Audio A/B', keys: ['F9']");
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
