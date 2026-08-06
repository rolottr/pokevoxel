import { clearRomBuffer } from '../import/romValidation';
import { DurableGenerationStore, classifyPersistenceError, type PersistenceDomain } from '../persistence/DurableGenerationStore';
import { LoveRuntimeAdapter, type AudioRendererPreference, type LoveRuntimeCapabilities } from './LoveRuntimeAdapter';
import { parseRuntimeEvent, type RuntimeEvent } from './runtimeEvents';

type LoveFactory = (module: RuntimeModule) => Promise<unknown> | unknown;
type RuntimeModule = Record<string, unknown> & { canvas: HTMLCanvasElement; arguments: string[]; locateFile: (name: string) => string; print?: (line: string) => void; printErr?: (line: string) => void; pokevoxelStageRomBeforeRun?: boolean; pokevoxelRuntimeDiagnostics?: string[]; pokevoxelRuntimeRevision?: string };
type RuntimeWindow = Window & typeof globalThis & { Module?: RuntimeModule; Love?: LoveFactory };
const MINIMUM_SAVING_PRESENTATION_MS = 150;
const MAX_RUNTIME_DIAGNOSTICS = 8;
const RUNTIME_REVISION_PATTERN = /^[0-9a-f]{64}$/;

export function runtimeRevisionFromManifest(value: unknown): string {
  if (!value || typeof value !== 'object') throw new Error('POKEVOXEL_RUNTIME_MANIFEST_INVALID');
  const manifest = value as { schemaVersion?: unknown; files?: unknown };
  const files = manifest.files;
  if (manifest.schemaVersion !== 1 || !files || typeof files !== 'object') throw new Error('POKEVOXEL_RUNTIME_MANIFEST_INVALID');
  const gameData = (files as Record<string, unknown>)['game.data'];
  const revision = gameData && typeof gameData === 'object'
    ? (gameData as Record<string, unknown>).sha256
    : undefined;
  if (typeof revision !== 'string' || !RUNTIME_REVISION_PATTERN.test(revision)) throw new Error('POKEVOXEL_RUNTIME_MANIFEST_INVALID');
  return revision;
}

export function versionedRuntimeUrl(name: string, revision: string, basePath: string, origin: string): string {
  if (!RUNTIME_REVISION_PATTERN.test(revision)) throw new Error('POKEVOXEL_RUNTIME_MANIFEST_INVALID');
  const url = new URL(`runtime/${name}`, new URL(basePath, origin));
  url.searchParams.set('v', revision);
  return url.toString();
}

/** Keep only a bounded Lua site and message; discard arbitrary stdout and paths. */
export function sanitizeRuntimeDiagnostic(line: string): string | undefined {
  const match = line.match(/(?:^|[\\/])([A-Za-z0-9_-]+\.lua):(\d+):\s*(.*)$/);
  if (!match) return undefined;
  const message = (match[3] ?? '')
    .replace(/(?:[A-Za-z]:)?[\\/][^\s'"`]+/g, '<path>')
    .replace(/[^\x20-\x7e]/g, '')
    .slice(0, 160);
  return `${match[1]}:${match[2]}: ${message}`;
}

function waitForSavingPresentation(startedAt: number): Promise<void> {
  const remaining = MINIMUM_SAVING_PRESENTATION_MS - (performance.now() - startedAt);
  return remaining > 0 ? new Promise((resolve) => window.setTimeout(resolve, remaining)) : Promise.resolve();
}

/** Holds one accepted ROM and one browser runtime; no filesystem is exposed. */
export class LoveRuntimeHost {
  private pendingRom?: ArrayBuffer;
  private active?: { adapter: LoveRuntimeAdapter; canvas: HTMLCanvasElement; module: RuntimeModule };
  private starting?: { canvas: HTMLCanvasElement; promise: Promise<LoveRuntimeAdapter>; epoch: number };
  private removeLifecycleFlush?: () => void;
  private onAudioResumeFailed?: () => void;
  private audioUnlocked = false;
  private lifecycleAudioResume?: Promise<void>;
  private epoch = 0;
  public get hasPendingRom(): boolean { return this.pendingRom !== undefined; }
  public get isRunning(): boolean { return this.active !== undefined; }
  public get runtimeRevision(): string | undefined { return this.active?.module.pokevoxelRuntimeRevision; }

  /** A newly validated ROM gets one clean runtime epoch so it can be staged before callMain. */
  public acceptValidatedRom(buffer: ArrayBuffer): void {
    this.clearPendingRom(); this.pendingRom = buffer;
    if (this.active || this.starting) this.dispose(false);
  }
  public clearPendingRom(): void { clearRomBuffer(this.pendingRom); this.pendingRom = undefined; }

  /** Compatibility boundary for non-browser callers; browser imports stage pre-run. */
  public async stagePendingRom(adapter: LoveRuntimeAdapter): Promise<void> {
    const pending = this.pendingRom;
    if (!pending) throw new Error('No accepted ROM is pending staging.');
    this.pendingRom = undefined;
    await adapter.stageRom(pending);
  }

  public start(canvas: HTMLCanvasElement, onEvent?: (event: RuntimeEvent) => void, onAudioResumeFailed?: () => void): Promise<LoveRuntimeAdapter> {
    this.onAudioResumeFailed = onAudioResumeFailed;
    if (this.active) { if (this.active.canvas !== canvas) return Promise.reject(new Error('POKEVOXEL_RUNTIME_CANVAS_MISMATCH')); return Promise.resolve(this.active.adapter); }
    if (this.starting) { if (this.starting.canvas !== canvas) return Promise.reject(new Error('POKEVOXEL_RUNTIME_CANVAS_MISMATCH')); return this.starting.promise; }
    const epoch = ++this.epoch; const promise = this.initialize(canvas, onEvent, epoch);
    this.starting = { canvas, promise, epoch };
    void promise.finally(() => { if (this.starting?.epoch === epoch) this.starting = undefined; }).catch(() => undefined);
    return promise;
  }

  private async initialize(canvas: HTMLCanvasElement, onEvent: ((event: RuntimeEvent) => void) | undefined, epoch: number, modeArgument?: '--pokevoxel-clear-cache'): Promise<LoveRuntimeAdapter> {
    const current = (): void => { if (this.epoch !== epoch) throw new Error('POKEVOXEL_RUNTIME_SUPERSEDED'); };
    const runtimeWindow = window as RuntimeWindow; let adapter: LoveRuntimeAdapter | undefined;
    const revision = await this.loadRuntimeRevision(); current();
    // Lua owns the single abort retry with a new immutable generation; this
    // bridge only serializes the exact mailbox request and applies its bound.
    const persistence = new DurableGenerationStore((requestId) => {
      if (!adapter) return Promise.reject(new Error('POKEVOXEL_RUNTIME_ADAPTER_MISSING'));
      return adapter.syncPersistentFs(requestId);
    });
    const module = this.createModule(canvas, revision, (event) => {
      if (event.type === 'bootstrap-ready') {  return; }
      if (event.type === 'sync-request') { void persistence.request('cache', event.payload.id as number).catch(() => undefined); return; }
      if (event.type === 'persistence-request') {
        const startedAt = performance.now();
        onEvent?.(event);
        void persistence.request(event.payload.domain as PersistenceDomain, event.payload.id as number)
          // IndexedDB can acknowledge a small save in the same event turn.
          // Keep the truthful in-progress state visible long enough to paint
          // before reporting the already-confirmed completion.
          .then(async () => { await waitForSavingPresentation(startedAt); onEvent?.({ ...event, type: 'persistence-complete' }); })
          .catch((error: unknown) => onEvent?.({ ...event, type: 'persistence-failed', payload: { code: classifyPersistenceError(error).code } }));
        return;
      }
      onEvent?.(event);
    }, modeArgument);
    const requiresRomStage = this.pendingRom !== undefined; module.pokevoxelStageRomBeforeRun = requiresRomStage; runtimeWindow.Module = module;
    try {
      await loadClassicScript(this.runtimeUrl('game.js', revision)); current(); await loadClassicScript(this.runtimeUrl('love.js', revision)); current();
      const love = runtimeWindow.Love; if (typeof love !== 'function') throw new Error('POKEVOXEL_RUNTIME_LOAD_FAILED');
      const ready = Promise.resolve(love(module));
      const capabilities = module.pokevoxelAdapter as LoveRuntimeCapabilities | undefined;
      if (!capabilities) throw new Error('POKEVOXEL_RUNTIME_ADAPTER_MISSING');
      adapter = new LoveRuntimeAdapter(capabilities);
      if (requiresRomStage) { const pending = this.pendingRom; if (!pending) throw new Error('POKEVOXEL_ROM_STAGE_SUPERSEDED'); this.pendingRom = undefined; await adapter.stageRom(pending); }
      await ready; current(); await adapter.persistentFsReady(); current();
      this.installLifecycleFlush(persistence, adapter);
      this.active = { adapter, canvas, module }; return adapter;
    } catch (error) { if (this.epoch === epoch) this.dispose(false); else adapter?.dispose(); throw error; }
  }

  /** Ends the import-only epoch before a cache-backed game boots in love.load. */
  public async restartFromPersistentCache(canvas: HTMLCanvasElement, onEvent?: (event: RuntimeEvent) => void, onAudioResumeFailed?: () => void): Promise<LoveRuntimeAdapter> {
    this.dispose(false);
    // Let the terminated PThread release its canvas/module turn before the
    // next single runtime is created. No adapter from the old epoch survives.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    return this.start(canvas, onEvent, onAudioResumeFailed);
  }

  /**
   * Runs a fixed, Lua-owned cache-only maintenance epoch. The only extra
   * argument is intentionally non-user-controlled; it cannot expose a file
   * path or a generic filesystem surface.
   */
  public async clearRebuildableCache(canvas: HTMLCanvasElement): Promise<void> {
    this.dispose();
    let complete!: () => void;
    let fail!: (error: Error) => void;
    const cleared = new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
    const epoch = ++this.epoch;
    const runtime = this.initialize(canvas, (event) => {
      if (event.type === 'cache-cleared') complete();
      if (event.type === 'error') fail(new Error('POKEVOXEL_CACHE_CLEAR_FAILED'));
    }, epoch, '--pokevoxel-clear-cache');
    try { await runtime; await withTimeout(cleared, 15_000, 'POKEVOXEL_CACHE_CLEAR_TIMEOUT'); }
    finally { this.dispose(); }
  }

  public async startGame(renderer: AudioRendererPreference = 'pokeaudio-hd'): Promise<void> {
    const adapter = this.active?.adapter; if (!adapter) throw new Error('POKEVOXEL_RUNTIME_NOT_RUNNING');
    await adapter.resumeAudio();
    this.audioUnlocked = true;
    await adapter.signalStart(renderer);
  }
  /** Re-enables an already-unlocked context without restarting or re-signaling Lua. */
  public async resumeAudioAfterInterruption(): Promise<void> {
    const adapter = this.active?.adapter; if (!adapter || !this.audioUnlocked) throw new Error('POKEVOXEL_AUDIO_NOT_UNLOCKED');
    await adapter.resumeAudio();
  }
  public dispose(clearPending = true): void {
    this.removeLifecycleFlush?.(); this.removeLifecycleFlush = undefined;
    this.audioUnlocked = false; this.lifecycleAudioResume = undefined; this.onAudioResumeFailed = undefined;
    this.epoch += 1; this.starting = undefined; if (clearPending) this.clearPendingRom(); const active = this.active;
    if (active) { active.adapter.dispose(); active.canvas.width = active.canvas.width; }
    document.querySelectorAll('script[data-pokevoxel-runtime]').forEach((script) => script.remove()); const runtimeWindow = window as RuntimeWindow;
    if (!active || runtimeWindow.Module === active.module) delete runtimeWindow.Module; this.active = undefined;
  }
  private createModule(canvas: HTMLCanvasElement, revision: string, onEvent?: (event: RuntimeEvent) => void, modeArgument?: '--pokevoxel-clear-cache'): RuntimeModule {
    const diagnostics: string[] = [];
    const forward = (line: string): void => {
      const event = parseRuntimeEvent(line);
      if (event) { onEvent?.(event); return; }
      const diagnostic = sanitizeRuntimeDiagnostic(line);
      if (!diagnostic) return;
      diagnostics.push(diagnostic);
      if (diagnostics.length > MAX_RUNTIME_DIAGNOSTICS) diagnostics.shift();
    };
    return { canvas, arguments: modeArgument ? ['./game.love', modeArgument] : ['./game.love'], locateFile: (name) => this.runtimeUrl(name, revision), print: forward, printErr: forward, pokevoxelRuntimeDiagnostics: diagnostics, pokevoxelRuntimeRevision: revision };
  }
  private installLifecycleFlush(persistence: DurableGenerationStore, adapter: LoveRuntimeAdapter): void {
    this.removeLifecycleFlush?.();
    if (typeof window.addEventListener !== 'function' || typeof document.addEventListener !== 'function') return;
    const flush = (): void => { void persistence.flush().catch(() => undefined); };
    const signalFocus = (focused: boolean): void => { void adapter.signalFocus(focused).catch(() => undefined); };
    const resume = (): void => {
      if (!this.audioUnlocked || this.lifecycleAudioResume) return;
      this.lifecycleAudioResume = adapter.resumeAudio()
        .catch(() => { this.onAudioResumeFailed?.(); })
        .finally(() => { this.lifecycleAudioResume = undefined; });
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') { signalFocus(false); flush(); }
      else if (document.visibilityState === 'visible') { signalFocus(true); resume(); }
    };
    const onBlur = (): void => { signalFocus(false); flush(); };
    const onFocus = (): void => { signalFocus(true); resume(); };
    window.addEventListener('pagehide', flush);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    this.removeLifecycleFlush = () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }
  private async loadRuntimeRevision(): Promise<string> {
    const manifestUrl = new URL('runtime/runtime-manifest.json', new URL(import.meta.env.BASE_URL, window.location.origin));
    const response = await fetch(manifestUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error('POKEVOXEL_RUNTIME_MANIFEST_INVALID');
    return runtimeRevisionFromManifest(await response.json());
  }
  private runtimeUrl(name: string, revision: string): string { return versionedRuntimeUrl(name, revision, import.meta.env.BASE_URL, window.location.origin); }
}
function loadClassicScript(source: string): Promise<void> { return new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = source; script.async = false; script.dataset.pokevoxelRuntime = 'true'; script.onload = () => resolve(); script.onerror = () => { script.remove(); reject(new Error('POKEVOXEL_RUNTIME_SCRIPT_FAILED')); }; document.head.append(script); }); }
function withTimeout<T>(value: Promise<T>, timeoutMs: number, code: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(code)), timeoutMs);
    void value.then((result) => { clearTimeout(timer); resolve(result); }, (error: unknown) => { clearTimeout(timer); reject(error); });
  });
}
