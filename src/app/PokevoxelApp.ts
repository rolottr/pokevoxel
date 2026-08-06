import { RomSelectionController } from '../import/RomSelectionController';
import { romValidationMessage, type RomVersion } from '../import/romValidation';
import { LoveRuntimeHost } from '../runtime/LoveRuntimeHost';
import type { AudioRendererPreference, LoveRuntimeAdapter } from '../runtime/LoveRuntimeAdapter';
import type { AudioProbe, BattleProbe, BattleReturnProbe, FirstPersonParityProbe, FirstPersonProbe, FirstPersonReleaseProbe, PersistenceSummary, RuntimeEvent, VoxelOcclusionProbe, VoxelProbe, WaterProbe } from '../runtime/runtimeEvents';
import type { PersistenceErrorCode, PersistenceStatus } from '../persistence/DurableGenerationStore';
import { createGameControls } from '../ui/GameControls';
import { createRuntimeScreen } from '../ui/RuntimeScreen';
import { renderWelcomeScreen } from '../ui/WelcomeScreen';

export const APP_STATES = ['welcome', 'validating', 'importing', 'cache-ready', 'starting', 'playing', 'error'] as const;
export type AppState = (typeof APP_STATES)[number];
export type ShellState = AppState;
export const initialAppState: AppState = 'welcome';

/** A cache-restored event belongs to the initial no-ROM runtime only. */
export function acceptsInitialCacheRestore(state: AppState): boolean { return state === 'welcome'; }
export type AppEvent = 'SELECT_ROM' | 'VALID_ROM' | 'CACHE_COMMITTED' | 'CACHE_RESTORED' | 'IMPORT_COMPLETE' | 'START' | 'GAME_STARTED' | 'TITLE_READY' | 'NEW_GAME_STARTED' | 'FAIL' | 'RETRY';
type TransitionEvent = AppEvent | { type: AppEvent };

export function transitionAppState(state: AppState, event: TransitionEvent): AppState {
  const type = typeof event === 'string' ? event : event.type;
  switch (type) {
    case 'SELECT_ROM': return state === 'welcome' || state === 'error' ? 'validating' : state;
    case 'VALID_ROM': return state === 'validating' ? 'importing' : state;
    case 'CACHE_COMMITTED': return state === 'importing' ? 'cache-ready' : state;
    case 'CACHE_RESTORED': return state === 'welcome' ? 'cache-ready' : state;
    case 'IMPORT_COMPLETE': return state === 'importing' ? 'playing' : state;
    case 'START': return state === 'cache-ready' ? 'starting' : state;
    case 'GAME_STARTED': return state === 'starting' ? 'playing' : state;
    case 'TITLE_READY': return state === 'starting' ? 'playing' : state;
    case 'NEW_GAME_STARTED': return state;
    case 'FAIL': return 'error';
    case 'RETRY': return state === 'error' ? 'welcome' : state;
  }
}

export type ShellModel = { state: AppState; gameVersion?: RomVersion; error?: string; errorCode?: string; progress?: number; audioState?: string; audioResumeFailed?: boolean; cacheRestored?: boolean; gameStarted?: boolean; titleReady?: boolean; newGameStarted?: boolean; overworldReady?: boolean; runtimePrepared?: boolean; importPhase?: ImportPhase; persistenceStatus?: PersistenceStatus; persistenceErrorCode?: PersistenceErrorCode; persistenceRestored?: boolean; persistenceCommittedSummary?: PersistenceSummary; persistenceRestoredSummary?: PersistenceSummary; persistenceResumedSummary?: PersistenceSummary; audioProbe?: AudioProbe; voxelProbe?: VoxelProbe; voxelOcclusionProbe?: VoxelOcclusionProbe; waterProbe?: WaterProbe; battleProbe?: BattleProbe; battleReturnProbe?: BattleReturnProbe; firstPersonProbe?: FirstPersonProbe; firstPersonReleaseProbe?: FirstPersonReleaseProbe; firstPersonParityProbe?: FirstPersonParityProbe; overworldInputReady?: boolean; battleInputPhase?: 'none' | 'menu' | 'move' | 'messages'; storageWarning?: string };
type ImportPhase = 'signal-consumed' | 'rom-read' | 'manifest-parsed' | 'session-entered';
const IMPORT_PHASES = new Set<ImportPhase>(['signal-consumed', 'rom-read', 'manifest-parsed', 'session-entered']);
function runtimeVersion(value: unknown): RomVersion | undefined { return value === 'red' || value === 'blue' || value === 'yellow' ? value : undefined; }
const SAFE_RUNTIME_ERRORS = new Set([
  'import-failed', 'cache-failed', 'runtime-unavailable', 'audio-unavailable',
  'storage-unavailable', 'POKEVOXEL_WATER_DEPTH_UNAVAILABLE',
  'POKEVOXEL_WATER_SHADER_UNAVAILABLE',
  'POKEVOXEL_WATER_REFLECTION_UNAVAILABLE',
  'POKEVOXEL_VOXEL_SHADER_UNAVAILABLE', 'POKEVOXEL_VOXEL_CANVAS_UNAVAILABLE',
  'POKEVOXEL_VOXEL_DEPTH_UNAVAILABLE', 'POKEVOXEL_VOXEL_SCENE_END_FAILED',
  'POKEVOXEL_VOXEL_SCENE_BEGIN_FAILED', 'POKEVOXEL_VOXEL_SCENE_DRAW_FAILED',
  'POKEVOXEL_VOXEL_PREFETCH_EXCEPTION', 'POKEVOXEL_VOXEL_SHADOW_PASS_EXCEPTION',
  'POKEVOXEL_VOXEL_SCENE_BEGIN_EXCEPTION', 'POKEVOXEL_VOXEL_SCENE_DRAW_EXCEPTION',
  'POKEVOXEL_VOXEL_SCENE_END_EXCEPTION',
  'POKEVOXEL_VOXEL_UPDATE_FAILED', 'POKEVOXEL_VOXEL_DRAW_FAILED',
]);
const RECOVERABLE_PERSISTENCE_ERRORS = new Set<PersistenceErrorCode>(['PERSISTENCE_QUOTA_EXCEEDED', 'PERSISTENCE_PERMISSION_DENIED']);
function safeRuntimeError(value: unknown): { message: string; code: string } {
  const code = typeof value === 'string' && (SAFE_RUNTIME_ERRORS.has(value) || /^POKEVOXEL_VOXEL_EXCEPTION_[A-Z0-9_]{1,96}$/.test(value) || /^POKEVOXEL_VOXEL_SCENE_BEGIN_LINE_[0-9]{1,5}$/.test(value)) ? value : 'runtime-unavailable';
  const copy: Record<string, string> = { 'import-failed': 'The game could not be imported. Choose the ROM again.', 'cache-failed': 'The game files could not be prepared on this device. Try again.', 'audio-unavailable': 'Audio could not start. Try again from the beginning.', 'storage-unavailable': 'Browser storage is unavailable. Try again in a supported browser.', 'runtime-unavailable': 'The browser game runtime could not start. Try again.', POKEVOXEL_WATER_DEPTH_UNAVAILABLE: 'Reflective voxel water is unsupported because a readable depth target could not be allocated.', POKEVOXEL_WATER_SHADER_UNAVAILABLE: 'Reflective voxel water is unsupported because its shader could not be created.', POKEVOXEL_WATER_REFLECTION_UNAVAILABLE: 'Reflective voxel water is unsupported in this graphics mode.', POKEVOXEL_VOXEL_SHADER_UNAVAILABLE: 'The voxel shader could not be created.', POKEVOXEL_VOXEL_CANVAS_UNAVAILABLE: 'The voxel canvas could not be created.', POKEVOXEL_VOXEL_DEPTH_UNAVAILABLE: 'The voxel depth target could not be attached.', POKEVOXEL_VOXEL_PREFETCH_EXCEPTION: 'Voxel world preparation failed before the frame could be rendered.', POKEVOXEL_VOXEL_SHADOW_PASS_EXCEPTION: 'The voxel shadow pass could not be rendered.', POKEVOXEL_VOXEL_SCENE_BEGIN_EXCEPTION: 'The voxel scene could not begin.', POKEVOXEL_VOXEL_SCENE_DRAW_EXCEPTION: 'The voxel scene draw did not complete.', POKEVOXEL_VOXEL_SCENE_END_EXCEPTION: 'The voxel scene ended before producing a frame.', POKEVOXEL_VOXEL_SCENE_BEGIN_FAILED: 'The voxel scene could not begin.', POKEVOXEL_VOXEL_SCENE_DRAW_FAILED: 'The voxel scene draw did not complete.', POKEVOXEL_VOXEL_SCENE_END_FAILED: 'The voxel scene ended before producing a frame.', POKEVOXEL_VOXEL_UPDATE_FAILED: 'Voxel world preparation failed before the frame could be rendered.', POKEVOXEL_VOXEL_DRAW_FAILED: 'The voxel world frame could not be rendered.' };
  return { code, message: copy[code] ?? (code.startsWith('POKEVOXEL_VOXEL_EXCEPTION_') || code.startsWith('POKEVOXEL_VOXEL_SCENE_BEGIN_LINE_') ? copy.POKEVOXEL_VOXEL_DRAW_FAILED! : copy['runtime-unavailable']!) };
}

/** Apply a runtime detail without discarding facts emitted by an earlier event. */
export function mergeShellModel(model: ShellModel, detail: Omit<ShellModel, 'state'>): ShellModel {
  return { ...model, ...detail };
}

/** Preserve bounded runtime facts while a shell state-transition event arrives. */
export function transitionShellModel(model: ShellModel, event: TransitionEvent, detail: Omit<ShellModel, 'state'> = {}): ShellModel {
  return { ...mergeShellModel(model, detail), state: transitionAppState(model.state, event) };
}

/** A lifecycle resume failure wins over later title/game-ready markers until a real resume succeeds. */
export function audioLifecycleDetail(model: ShellModel): Pick<ShellModel, 'audioState' | 'audioResumeFailed'> {
  return model.audioResumeFailed ? { audioState: 'blocked', audioResumeFailed: true } : { audioState: 'running', audioResumeFailed: false };
}

/** A conservative pre-import check; browser estimates are advisory and never inspect game files. */
export async function storageHasQuotaPressure(storage: StorageManager | undefined = navigator.storage): Promise<boolean> {
  if (!storage?.estimate) return false;
  try {
    const { quota, usage } = await storage.estimate();
    return typeof quota === 'number' && quota > 0 && typeof usage === 'number' && usage / quota >= 0.9;
  } catch { return false; }
}

export class PokevoxelApp {
  private model: ShellModel = { state: initialAppState };
  private readonly host = new LoveRuntimeHost();
  private readonly romSelection = new RomSelectionController(this.host);
  private readonly runtime = createRuntimeScreen();
  private readonly gameControls = createGameControls(this.runtime.canvas);
  private readonly controls = document.createElement('div');
  private initialBoot?: number;
  private cacheRestart?: Promise<void>;
  private pendingModRestartId?: number;
  private completedPersistenceId?: number;
  private storagePersistence?: Promise<boolean>;
  private clearingCache = false;
  private audioRenderer: AudioRendererPreference = 'pokeaudio-hd';
  private audioRendererOverride = false;

  public constructor(private readonly root: HTMLElement) {
    this.controls.className = 'runtime-controls';
    this.root.replaceChildren(this.runtime.element, this.gameControls, this.controls);
    this.render();
    this.scheduleInitialRuntime(); // One runtime starts once to populate IDBFS and restore a cache, if present.
  }
  public get state(): AppState { return this.model.state; }
  public setState(state: AppState, detail: Omit<ShellModel, 'state'> = {}): void { this.model = { ...detail, state }; this.render(); }
  // Runtime events can arrive before a state-transition marker (for example,
  // the bounded restored-save summary precedes cache-restored). Keep those
  // facts when advancing the shell state instead of replacing the whole model.
  private dispatch(event: TransitionEvent, detail: Omit<ShellModel, 'state'> = {}): void { const next = transitionShellModel(this.model, event, detail); this.setState(next.state, next); }

  private scheduleInitialRuntime(): void {
    if (this.host.isRunning || this.initialBoot !== undefined) return;
    this.initialBoot = window.setTimeout(() => { this.initialBoot = undefined; void this.ensureRuntime().catch(() => this.failRuntime('runtime-unavailable')); }, 750);
  }
  private cancelInitialRuntime(): void { if (this.initialBoot !== undefined) { window.clearTimeout(this.initialBoot); this.initialBoot = undefined; } }
  private async ensureRuntime(): Promise<LoveRuntimeAdapter> {
    const adapter = await this.host.start(this.runtime.canvas, (event) => this.onRuntimeEvent(event), () => this.onAudioResumeFailed());
    if (this.host.runtimeRevision) this.runtime.element.dataset.runtimeRevision = this.host.runtimeRevision;
    return adapter;
  }
  private async selectFile(file: File): Promise<void> {
    this.cancelInitialRuntime();
    if (await storageHasQuotaPressure()) {
      this.setState('error', { errorCode: 'storage-unavailable', error: 'Device storage is nearly full. Free space, then choose the ROM again. Existing saves were not changed.', storageWarning: 'Cache generations can be rebuilt after space is available; saved games are never cleared automatically.' });
      return;
    }
    this.dispatch('SELECT_ROM');
    const result = await this.romSelection.select(file);
    if (result.kind === 'stale') return;
    if (result.kind === 'error') { this.dispatch('FAIL', { error: romValidationMessage(result.code), errorCode: result.code }); return; }
    if (this.model.state !== 'validating') return;
    this.dispatch('VALID_ROM', { progress: 0, gameVersion: result.version });
    try {
      await this.ensureRuntime(); // The host stages the accepted ROM before this runtime can call LÖVE main.
    } catch { this.failRuntime('runtime-unavailable'); }
  }

  private onRuntimeEvent(event: RuntimeEvent): void {
    if (event.type === 'runtime-prepared') { this.model = { ...this.model, runtimePrepared: true }; this.render(); return; }
    if (event.type === 'import-phase' && this.model.state === 'importing') {
      const phase = event.payload.phase;
      if (typeof phase === 'string' && IMPORT_PHASES.has(phase as ImportPhase)) { this.model = { ...this.model, importPhase: phase as ImportPhase }; this.render(); }
      return;
    }
    if (event.type === 'import-progress' && this.model.state === 'importing') {
      const progress = typeof event.payload.progress === 'number' ? Math.max(0, Math.min(1, event.payload.progress)) : this.model.progress;
      this.model = { ...this.model, progress }; this.render(); return;
    }
    if (event.type === 'cache-restored') {
      // The import handoff boots the same newly written cache to prepare it.
      // That event must not relabel an imported cache as a reload restore.
      if (acceptsInitialCacheRestore(this.model.state)) this.dispatch('CACHE_RESTORED', { cacheRestored: true, gameVersion: runtimeVersion(event.payload.version), persistenceRestored: this.model.persistenceRestored });
      return;
    }
    if (event.type === 'cache-committed') {
      this.model = { ...this.model, gameVersion: runtimeVersion(event.payload.version) ?? this.model.gameVersion };
      this.beginCacheRuntimeHandoff(); return;
    }
    if (event.type === 'game-started') {
      this.runtime.canvas.setAttribute('aria-hidden', 'false');
      this.runtime.canvas.focus({ preventScroll: true });
      this.dispatch('GAME_STARTED', { gameStarted: true, ...audioLifecycleDetail(this.model), cacheRestored: this.model.cacheRestored, persistenceRestored: this.model.persistenceRestored, storageWarning: this.model.storageWarning });
      return;
    }
    if (event.type === 'persistence-request' || event.type === 'persistence-saving') { this.model = { ...this.model, persistenceStatus: 'saving' }; this.render(); return; }
    if (event.type === 'persistence-complete') {
      const id = event.payload.id;
      this.completedPersistenceId = typeof id === 'number' ? id : undefined;
      this.model = { ...this.model, persistenceStatus: 'saved', persistenceErrorCode: undefined };
      this.render();
      if (this.pendingModRestartId === this.completedPersistenceId) this.beginModRuntimeRestart();
      return;
    }
    if (event.type === 'mod-restart-ready') {
      this.pendingModRestartId = event.payload.id as number;
      if (this.pendingModRestartId === this.completedPersistenceId) this.beginModRuntimeRestart();
      return;
    }
    if (event.type === 'persistence-failed') {
      const code = event.payload.code;
      const persistenceErrorCode = typeof code === 'string' && RECOVERABLE_PERSISTENCE_ERRORS.has(code as PersistenceErrorCode) ? code as PersistenceErrorCode : 'PERSISTENCE_SYNC_FAILED';
      const storageWarning = persistenceErrorCode === 'PERSISTENCE_QUOTA_EXCEEDED'
        ? 'Browser storage is full. This save was not confirmed. You can explicitly clear only rebuildable game cache; ordinary saves and options are kept.'
        : persistenceErrorCode === 'PERSISTENCE_PERMISSION_DENIED'
          ? 'Browser storage permission was denied. This save was not confirmed. You can explicitly clear only rebuildable game cache; ordinary saves and options are kept.'
          : 'The save was not confirmed by browser storage.';
      this.model = { ...this.model, persistenceStatus: 'failed', persistenceErrorCode, storageWarning }; this.render(); return;
    }
    if (event.type === 'persistence-restored') { this.model = { ...this.model, persistenceRestored: true }; this.render(); return; }
    if (event.type === 'overworld-ready') { this.model = { ...this.model, overworldReady: true }; this.render(); return; }
    if (event.type === 'battle-input-phase') { this.model = { ...this.model, battleInputPhase: event.payload.phase as 'none' | 'menu' | 'move' | 'messages' }; this.render(); return; }
    if (event.type === 'overworld-input-ready') { this.model = { ...this.model, overworldInputReady: event.payload.ready === true }; this.render(); return; }
    if (event.type === 'audio-preference') {
      if (!this.audioRendererOverride) this.audioRenderer = event.payload.renderer as AudioRendererPreference;
      this.render(); return;
    }
    if (event.type === 'audio-probe') { this.model = { ...this.model, audioProbe: event.payload as AudioProbe }; this.render(); return; }
    if (event.type === 'voxel-ready') { this.model = { ...this.model, voxelProbe: event.payload as VoxelProbe }; this.render(); return; }
    if (event.type === 'voxel-occlusion-probe') { this.model = { ...this.model, voxelOcclusionProbe: event.payload as VoxelOcclusionProbe }; this.render(); return; }
    if (event.type === 'water-ready') { this.model = { ...this.model, waterProbe: event.payload as WaterProbe }; this.render(); return; }
    if (event.type === 'battle-ready') { this.model = { ...this.model, battleProbe: event.payload as BattleProbe, battleReturnProbe: undefined }; this.render(); return; }
    if (event.type === 'battle-returned') { this.model = { ...this.model, battleProbe: undefined, battleReturnProbe: event.payload as BattleReturnProbe }; this.render(); return; }
    if (event.type === 'first-person-ready') { this.model = { ...this.model, firstPersonProbe: event.payload as FirstPersonProbe }; this.render(); return; }
    if (event.type === 'first-person-released') { this.model = { ...this.model, firstPersonProbe: undefined, firstPersonReleaseProbe: event.payload as FirstPersonReleaseProbe }; this.render(); return; }
    if (event.type === 'first-person-parity') { this.model = { ...this.model, firstPersonParityProbe: event.payload as FirstPersonParityProbe }; this.render(); return; }
    if (event.type === 'water-unready') { this.model = { ...this.model, waterProbe: undefined }; this.render(); return; }
    if (event.type === 'voxel-unready') { this.model = { ...this.model, voxelProbe: undefined }; this.render(); return; }
    if (event.type === 'persistence-summary') {
      const summary = event.payload as PersistenceSummary;
      this.model = summary.phase === 'committed'
        ? { ...this.model, persistenceCommittedSummary: summary }
        : summary.phase === 'restored'
          ? { ...this.model, persistenceRestoredSummary: summary }
          : { ...this.model, persistenceResumedSummary: summary };
      this.render();
      return;
    }
    if (event.type === 'title-ready') {
      this.runtime.canvas.setAttribute('aria-hidden', 'false');
      this.runtime.canvas.focus({ preventScroll: true });
      this.dispatch('TITLE_READY', { titleReady: true, ...audioLifecycleDetail(this.model), storageWarning: this.model.storageWarning, persistenceRestored: this.model.persistenceRestored });
      return;
    }
    if (event.type === 'new-game-started') { this.dispatch('NEW_GAME_STARTED', { newGameStarted: true, ...audioLifecycleDetail(this.model), cacheRestored: this.model.cacheRestored, persistenceRestored: this.model.persistenceRestored, storageWarning: this.model.storageWarning }); return; }
    if (event.type === 'error') this.failRuntime(event.payload.code);
  }

  private beginCacheRuntimeHandoff(): void {
    if (this.cacheRestart) return;
    this.cacheRestart = this.host.restartFromPersistentCache(this.runtime.canvas, (event) => this.onRuntimeEvent(event), () => this.onAudioResumeFailed())
      .then(() => { if (this.model.state === 'importing') this.dispatch('CACHE_COMMITTED', { cacheRestored: false }); })
      .catch(() => this.failRuntime('runtime-unavailable'))
      .finally(() => { this.cacheRestart = undefined; });
  }

  private beginModRuntimeRestart(): void {
    if (this.cacheRestart || this.pendingModRestartId === undefined) return;
    this.pendingModRestartId = undefined;
    this.completedPersistenceId = undefined;
    const retained = {
      gameVersion: this.model.gameVersion,
      cacheRestored: true,
      persistenceStatus: this.model.persistenceStatus,
      persistenceRestored: this.model.persistenceRestored,
      persistenceCommittedSummary: this.model.persistenceCommittedSummary,
      persistenceRestoredSummary: this.model.persistenceRestoredSummary,
      persistenceResumedSummary: this.model.persistenceResumedSummary,
      storageWarning: this.model.storageWarning,
    };
    this.runtime.canvas.setAttribute('aria-hidden', 'true');
    this.setState('starting', { ...retained, audioState: 'restarting', audioResumeFailed: false });
    this.cacheRestart = this.host.restartFromPersistentCache(this.runtime.canvas, (event) => this.onRuntimeEvent(event), () => this.onAudioResumeFailed())
      .then(() => {
        if (this.host.runtimeRevision) this.runtime.element.dataset.runtimeRevision = this.host.runtimeRevision;
        if (this.model.state === 'starting') this.setState('cache-ready', { ...retained, runtimePrepared: true });
      })
      .catch(() => this.failRuntime('runtime-unavailable'))
      .finally(() => { this.cacheRestart = undefined; });
  }

  private async startGame(): Promise<void> {
    const audioRenderer = this.audioRenderer;
    this.dispatch('START', { audioState: 'resuming', audioResumeFailed: false, cacheRestored: this.model.cacheRestored, persistenceRestored: this.model.persistenceRestored, storageWarning: this.model.storageWarning });
    // Start the persistence request in the click stack, before any runtime
    // await. Browsers otherwise treat it as an untrusted background request.
    const persistence = this.storagePersistence ??= this.requestPersistentStorage();
    try {
      await this.host.startGame(audioRenderer);
      this.audioRendererOverride = false;
      const persisted = await persistence;
      const storageWarning = persisted ? undefined : 'Browser storage persistence was not granted; keep a backup of important progress.';
      this.model = mergeShellModel(this.model, { ...audioLifecycleDetail(this.model), storageWarning });
      this.render();
    }
    catch { this.failRuntime('audio-unavailable'); }
  }
  private onAudioResumeFailed(): void {
    if (this.model.state !== 'starting' && this.model.state !== 'playing') return;
    this.model = { ...this.model, audioState: 'blocked', audioResumeFailed: true };
    this.render();
  }
  private async reenableAudio(): Promise<void> {
    if (this.model.state !== 'playing') return;
    this.model = { ...this.model, audioState: 'resuming', audioResumeFailed: false };
    this.render();
    try {
      await this.host.resumeAudioAfterInterruption();
      this.model = { ...this.model, audioState: 'running', audioResumeFailed: false };
      this.render();
    } catch { this.onAudioResumeFailed(); }
  }
  private async requestPersistentStorage(): Promise<boolean> {
    try { return await navigator.storage?.persist?.() === true; } catch { return false; }
  }
  private async clearRebuildableCache(): Promise<void> {
    if (this.clearingCache) return;
    const confirmed = window.confirm('Clear rebuildable imported game cache? Ordinary saves and options will be kept.');
    if (!confirmed) return;
    this.clearingCache = true;
    this.setState('error', { errorCode: 'storage-unavailable', error: 'Clearing rebuildable game cache…' });
    try {
      await this.host.clearRebuildableCache(this.runtime.canvas);
      this.setState('welcome', { storageWarning: 'Rebuildable cache cleared. Ordinary saves and options were kept.' });
      this.scheduleInitialRuntime();
    } catch {
      this.setState('error', { errorCode: 'storage-unavailable', error: 'The rebuildable cache could not be cleared. Ordinary saves and options were kept.' });
    } finally { this.clearingCache = false; }
  }
  private failRuntime(code: unknown): void { const safe = safeRuntimeError(code); this.romSelection.cancel(); this.host.dispose(); this.dispatch('FAIL', { error: safe.message, errorCode: safe.code }); }
  private reset(): void { this.romSelection.retry(); this.host.dispose(); this.setState('welcome'); this.scheduleInitialRuntime(); }
  private clearAcceptedRom(): void { this.romSelection.cancel(); this.host.dispose(); this.setState('welcome'); }
  private render(): void {
    this.root.dataset.shellState = this.model.state; this.root.dataset.testid = 'pokevoxel-app'; this.runtime.element.dataset.state = this.model.state;
    this.gameControls.hidden = this.model.state !== 'playing';
    if (this.model.state !== 'playing') this.gameControls.querySelector('details')?.removeAttribute('open');
    if (this.model.runtimePrepared) this.runtime.element.dataset.runtimePrepared = 'true'; else delete this.runtime.element.dataset.runtimePrepared;
    if (this.model.importPhase) this.runtime.element.dataset.importPhase = this.model.importPhase; else delete this.runtime.element.dataset.importPhase;
    this.controls.replaceChildren(renderWelcomeScreen({ model: this.model, audioRenderer: this.audioRenderer, onAudioRendererChange: (renderer) => { this.audioRenderer = renderer; this.audioRendererOverride = true; this.render(); }, onFile: (file) => { void this.selectFile(file); }, onReset: () => this.reset(), onClearAcceptedRom: () => this.clearAcceptedRom(), onClearRebuildableCache: () => { void this.clearRebuildableCache(); }, onStartGame: () => { void this.startGame(); }, onReenableAudio: () => { void this.reenableAudio(); } }));
  }
}
