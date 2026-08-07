import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const productPath = (...parts: string[]) => resolve(root, ...parts);
const text = (...parts: string[]) => readFileSync(productPath(...parts), 'utf8');

describe('Layer 3 browser runtime source contracts', () => {
  it('provides the web bootstrap, event, and durable-generation boundaries', () => {
    for (const path of [
      ['runtime', 'game', 'main.lua'],
      ['runtime', 'game', 'src', 'web', 'BrowserBootstrap.lua'],
      ['runtime', 'game', 'src', 'web', 'BrowserEvents.lua'],
      ['runtime', 'game', 'src', 'web', 'DurableGeneration.lua'],
    ]) expect(existsSync(productPath(...path))).toBe(true);
  });

  it('keeps the stable love.js identity while the retained runtime selects Red, Blue, or Yellow', () => {
    const conf = text('runtime', 'game', 'conf.lua');
    expect(conf).toMatch(/identity\s*=\s*["']pokevoxel-yellow["']/);
    expect(conf).toMatch(/version\s*=\s*["']11\.4["']/);
  });

  it('keeps the gameplay canvas keyboard-focusable after title readiness', () => {
    const runtime = text('src', 'ui', 'RuntimeScreen.ts');
    const app = text('src', 'app', 'PokevoxelApp.ts');
    expect(runtime).toContain('canvas.tabIndex = 0');
    expect(app).toContain('this.runtime.canvas.focus({ preventScroll: true })');
  });

  it('packages the exact pinned diagnostics module required by lifecycle resume', () => {
    const game = text('runtime', 'game', 'src', 'core', 'Game.lua');
    const diagnostics = text('runtime', 'game', 'src', 'debug', 'SwitchDiagnostics.lua');
    expect(game).toContain('require("src.debug.SwitchDiagnostics")');
    expect(diagnostics).toContain('function SwitchDiagnostics.isEnabled()');
    expect(diagnostics).toContain('function SwitchDiagnostics.onEvent(kind, payload)');
    expect(diagnostics).toContain('function SwitchDiagnostics.onJoystickEvent(kind, joystick, button, extra)');
  });

  it('packages the complete built-in mod manager required by F10', () => {
    const game = text('runtime', 'game', 'src', 'core', 'Game.lua');
    const screens = text('runtime', 'game', 'src', 'ui', 'Screens.lua');
    const manager = text('runtime', 'game', 'src', 'mods', 'ManagerState.lua');
    const profiles = text('runtime', 'game', 'src', 'mods', 'ModProfile.lua');
    expect(game).toContain('Screens.push(self, "ManagerState")');
    expect(screens).toContain('ManagerState = "src.mods.ManagerState"');
    expect(manager).toContain('local ModProfile = require("src.mods.ModProfile")');
    expect(profiles).toContain('function ModProfile.ensureFirst(opts, available, modOptions)');
  });

  it('packages the complete built-in link screen exposed by the pause menu', () => {
    const startMenu = text('runtime', 'game', 'src', 'ui', 'StartMenu.lua');
    const linkState = text('runtime', 'game', 'src', 'link', 'LinkState.lua');
    const net = text('runtime', 'game', 'src', 'link', 'Net.lua');
    const presence = text('runtime', 'game', 'src', 'core', 'DiscordPresence.lua');
    expect(startMenu).toContain('local LinkState = require("src.link.LinkState")');
    expect(linkState).toContain('local Net = require("src.link.Net")');
    expect(linkState).toContain('local DiscordPresence = require("src.core.DiscordPresence")');
    expect(net).toContain('local hasEnet, enet = pcall(require, "enet")');
    expect(presence).toContain('local function isDesktop()');
  });

  it('uses an explicit browser frame loop that updates, draws, and presents', () => {
    const main = text('runtime', 'game', 'main.lua');
    expect(main).toMatch(/function love\.run\(\)/);
    expect(main).toMatch(/love\.event\.pump\(\)/);
    expect(main).toMatch(/love\.update\(dt\)/);
    expect(main).toMatch(/love\.draw\(\)/);
    expect(main).toMatch(/love\.graphics\.present\(\)/);
    // The browser event loop paces the iteration; an emscripten main-thread
    // sleep busy-waits and pushed tight frames past their vsync slot.
    expect(main).not.toMatch(/love\.timer\.sleep\(/);
    expect(main).not.toContain('FrameCap.current');
  });

  it('keeps the pinned link module closure exposed by the pause menu', () => {
    const links = readdirSync(productPath('runtime', 'game', 'src', 'link')).filter((name) => name.endsWith('.lua'));
    expect(links).toEqual([
      'CodeEntry.lua',
      'Fingerprint.lua',
      'Handshake.lua',
      'Json.lua',
      'LinkBattle.lua',
      'LinkState.lua',
      'Net.lua',
      'Protocol.lua',
      'Tournament.lua',
    ]);
  });

  it('contains no excluded desktop modules or product runtime paths', () => {
    const forbidden = /(?:Pisco|VR(?:XR|GL|Rig)?|Horde|SaveEditor|NativePicker|Updater)/i;
    const files = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? files(path) : [path];
    });
    expect(files(productPath('runtime')).map((path) => path.replace(`${root}/`, '')).filter((path) => forbidden.test(path))).toEqual([]);
  });

  it('keeps upstream test exports out of the production audio module', () => {
    const chipAudio = text('runtime', 'game', 'src', 'core', 'ChipAudio.lua');
    expect(chipAudio).not.toContain('_slimAudioForTest');
    expect(chipAudio).not.toContain('test-only: expose slimAudio');
  });

  it('defines bounded schema-v1 POKEVoxel events with monotonic identifiers', () => {
    const events = text('runtime', 'game', 'src', 'web', 'BrowserEvents.lua');
    expect(events).toContain('POKEVOXEL_EVENT ');
    expect(events).toMatch(/schemaVersion\s*=\s*1/);
    expect(events).toMatch(/4096/);
    expect(events).toMatch(/monotonic|nextId|eventId/i);
  });

  it('throttles import progress to monotonic one-percent buckets and retains completion', () => {
    const bootstrap = text('runtime', 'game', 'src', 'web', 'BrowserBootstrap.lua');
    expect(bootstrap).toMatch(/local progressTicks,nextProgress=0,0/);
    expect(bootstrap).toMatch(/progress>=nextProgress or p==t/);
    expect(bootstrap).toMatch(/nextProgress=math\.min\(1,nextProgress\+0\.01\)/);
    expect(bootstrap).toMatch(/import-progress/);
  });

  it('requires a post-boot title-ready and a post-input new-game event instead of treating game-started as title proof', () => {
    const eventTypes = text('src', 'runtime', 'runtimeEvents.ts');
    const app = text('src', 'app', 'PokevoxelApp.ts');
    const welcome = text('src', 'ui', 'WelcomeScreen.ts');
    expect(eventTypes).toContain("'title-ready'");
    expect(eventTypes).toContain("'new-game-started'");
    expect(app).toMatch(/event\.type\s*===\s*['"]title-ready['"]/);
    expect(app).toMatch(/event\.type\s*===\s*['"]new-game-started['"]/);
    expect(app).not.toMatch(/yellow-title-ready/);
    expect(welcome).toContain("'yellow-runtime-title-ready'");
    expect(welcome).toContain("'yellow-new-game-started'");
    expect(welcome).toContain("'cache-restored'");
    expect(welcome).toMatch(/model\.newGameStarted\s*\|\|\s*model\.titleReady/);
  });

  it('loads every runtime epoch through a no-store manifest revision', () => {
    const host = text('src', 'runtime', 'LoveRuntimeHost.ts');
    expect(host).toContain("cache: 'no-store'");
    expect(host).toContain('runtimeRevisionFromManifest');
    expect(host).toContain('versionedRuntimeUrl');
    expect(host).toContain("runtime-manifest.json");
  });

  it('defers only browser cache-preload screens until the verified Start gesture', () => {
    const game = text('runtime', 'game', 'src', 'core', 'Game.lua');
    const bootstrap = text('runtime', 'game', 'src', 'web', 'BrowserBootstrap.lua');
    expect(game).toContain('function Game:load(options)');
    expect(game).toContain('elseif not options.deferInitialScreen then');
    expect(game).toContain('Screens.push(self, bootScreens(self).splash or splash');
    expect(bootstrap).toContain('G:load({ deferInitialScreen = true })');
    expect(bootstrap).toContain('B.preparedTitle=G:makeTitleState()');
    expect(bootstrap).toContain('G:returnToTitle(B.preparedTitle)');
  });

  it('restores only a hash-valid cached generation after reload and requires a new Start gesture', () => {
    const bootstrap = text('runtime', 'game', 'src', 'web', 'BrowserBootstrap.lua');
    const durable = text('runtime', 'game', 'src', 'web', 'DurableGeneration.lua');
    const eventTypes = text('src', 'runtime', 'runtimeEvents.ts');
    const app = text('src', 'app', 'PokevoxelApp.ts');
    expect(durable).toContain('function DurableGeneration.restoreActive()');
    expect(bootstrap).toMatch(/restoreActive\s*\(/);
    expect(bootstrap).toContain('cache-restored');
    expect(bootstrap).toMatch(/awaiting-start/);
    expect(eventTypes).toContain("'cache-restored'");
    expect(app).toMatch(/event\.type\s*===\s*['"]cache-restored['"]/);
  });

  it('stages the validated ROM before callMain with only fixed SDL controls', () => {
    const host = text('src', 'runtime', 'LoveRuntimeHost.ts'); const patch = text('scripts', 'patch-love-runtime.mjs'); const bootstrap = text('runtime', 'game', 'src', 'web', 'BrowserBootstrap.lua');
    expect(host).toContain('pokevoxelStageRomBeforeRun'); expect(host).toContain('const ready = Promise.resolve(love(module))'); expect(host).toContain('restartFromPersistentCache');
    for (const token of ['POKEVOXEL_ROM_STAGE', '/tmp/pokevoxel-rom.gb', '/tmp/pokevoxel-sync-', '/tmp/pokevoxel-audio-renderer', '/tmp/pokevoxel-start']) expect(patch).toContain(token);
    for (const token of ['/tmp/pokevoxel-sync-', '/tmp/pokevoxel-audio-renderer', '/tmp/pokevoxel-start']) expect(bootstrap).toContain(token);
    for (const token of ['GameVersion.forSha1', 'rom_manifest.json', 'rom_manifest_blue.json', 'rom_manifest_yellow.json']) expect(bootstrap).toContain(token);
    for (const forbidden of ['pokevoxelBindTransport', 'transport-ready', 'require("ffi")']) expect(`${host}\n${bootstrap}`).not.toContain(forbidden);
  });
  it('pins all three upstream binaries and guards every patch anchor before mutation', () => { const patch=text('scripts','patch-love-runtime.mjs'); for(const token of ['stock-love.js','love.wasm','stock-worker.js','researchAnchors','stock.split(value).length!==2']) expect(patch).toContain(token); });
  it('disposes the patched runtime and rejects later bridge calls', () => { const patch=text('scripts','patch-love-runtime.mjs'); for(const token of ['pauseMainLoop','terminateAllThreads','close','POKEVOXEL_RUNTIME_DISPOSED']) expect(patch).toContain(token); });

  it('resumes the LÖVE OpenAL context rather than an unrelated SDL context', () => { const patch=text('scripts', 'patch-love-runtime.mjs'); const host=text('src', 'runtime', 'LoveRuntimeHost.ts'); expect(patch).toContain('AL&&AL.currentCtx&&AL.currentCtx.audioCtx'); expect(patch).not.toContain('Module[\"SDL2\"].audioContext'); expect(host).not.toContain('.module.SDL2'); });
  it('repairs the pinned OpenAL stop-vector dereference with an exact stock anchor', () => { const patch=text('scripts', 'patch-love-runtime.mjs'); expect(patch).toContain('openAlStopVectorAnchor'); expect(patch).toContain('openAlStopVectorReplacement'); expect(patch).toContain('missing/ambiguous OpenAL stop-vector anchor'); expect(patch).toContain('OpenAL stop-vector patch postcondition failed'); expect(patch).toContain('AL.currentCtx.sources[GROWABLE_HEAP_I32()[pSourceIds+i*4>>2]]'); });
  it('requests WebGL2 from the pinned love.js runtime for readable depth canvases', () => { const patch=text('scripts', 'patch-love-runtime.mjs'); const audit=text('scripts', 'audit-runtime.mjs'); for (const token of ['webglVersionAnchor', 'webglVersionReplacement', 'missing/ambiguous WebGL context-version anchor', 'WebGL context-version patch postcondition failed']) expect(patch).toContain(token); expect(audit).toContain("love.includes('majorVersion:2')"); });

  it('audits one pruned Dramatic built-in while allowing the Layer 6 voxel/tilt-shift pair', () => {
    const audit = text('scripts', 'audit-runtime.mjs');
    const dramaticMain = text('runtime', 'mods', 'dramatic-shape', 'main.lua');
    const dramaticManifest = text('runtime', 'mods', 'dramatic-shape', 'manifest.json');
    expect(audit).toContain("count('mods/dramatic-shape/manifest.json') !== 1");
    expect(audit).toContain("count('mods/dramatic-shape/main.lua') !== 1");
    expect(`${dramaticMain}\n${dramaticManifest}`).not.toMatch(/\b(?:VR|Horde|Pisco)\b/i);
    expect(dramaticManifest).toContain('"entry": "main.lua"');
    expect(dramaticMain).toContain('DRAMATIC_SHAPE_DUPLICATE_LOAD');
    expect((dramaticMain.match(/render_pipelines:register/g) ?? [])).toHaveLength(2);
    expect(dramaticMain).toContain('levels = Voxel.ANGLE_LABELS');
    const voxelState = text('runtime', 'mods', 'dramatic-shape', 'lib', 'VoxelState.lua');
    for (const label of ['OFF', 'FULL', '15', '35', '50', '75', '1ST (EXPERIMENTAL)', '3RD (EXPERIMENTAL)']) {
      expect(voxelState).toContain(`"${label}"`);
    }
    expect(voxelState).toContain('Voxel.TP_LEVEL = 7');
    expect(dramaticMain).toContain('defaultLevel = 1');
  });

  it('activates a valid dynamic generation through a physical cache overlay', () => {
    const cacheFs = text('runtime', 'game', 'src', 'import', 'CacheFs.lua');
    const generation = text('runtime', 'game', 'src', 'web', 'DurableGeneration.lua');
    expect(cacheFs).toContain('function CacheFs.mountOverlay(rel)');
    expect(cacheFs).toContain('if not base then return false end');
    expect(generation).toContain('CacheFs.mountOverlay(generationPrefix(active, version):sub(1, -2))');
    expect(generation).toContain('valid(generationPrefix(active, version))');
    expect(generation).toContain('GameVersion.set(version)');
  });

  it('commits cache generation data before its authoritative marker pointer', () => {
    const generation = text('runtime', 'game', 'src', 'web', 'DurableGeneration.lua');
    const dataSync = generation.search(/sync.*generation|generation.*sync/i);
    const marker = generation.search(/active.*previous|previous.*active/i);
    expect(dataSync).toBeGreaterThanOrEqual(0);
    expect(marker).toBeGreaterThan(dataSync);
    expect(generation).toMatch(/\.tmp/);
    expect(generation).toMatch(/\.bak/);
  });

  it('provides deterministic runtime build, patch, and artifact audit scripts', () => {
    for (const script of ['build-runtime.mjs', 'patch-love-runtime.mjs', 'audit-dist.mjs']) {
      expect(existsSync(productPath('scripts', script))).toBe(true);
    }
  });
});
