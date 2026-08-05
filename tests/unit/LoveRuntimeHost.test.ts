import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LoveRuntimeHost,
  runtimeRevisionFromManifest,
  sanitizeRuntimeDiagnostic,
  versionedRuntimeUrl,
} from '../../src/runtime/LoveRuntimeHost';

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalFetch = globalThis.fetch;
const runtimeRevision = 'a'.repeat(64);

beforeEach(() => {
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async () => ({
    ok: true,
    json: async () => ({ schemaVersion: 1, files: { 'game.data': { sha256: runtimeRevision } } }),
  }) });
});

afterEach(() => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: originalFetch });
});

describe('LoveRuntimeHost startup ownership', () => {
  it('accepts only a bounded public runtime revision and versions every asset URL', () => {
    const revision = 'a'.repeat(64);
    expect(runtimeRevisionFromManifest({
      schemaVersion: 1,
      files: { 'game.data': { sha256: revision } },
    })).toBe(revision);
    expect(() => runtimeRevisionFromManifest({
      schemaVersion: 1,
      files: { 'game.data': { sha256: '../stale' } },
    })).toThrow('POKEVOXEL_RUNTIME_MANIFEST_INVALID');
    expect(versionedRuntimeUrl('love.worker.js', revision, '/pokevoxel/', 'https://example.test'))
      .toBe(`https://example.test/pokevoxel/runtime/love.worker.js?v=${revision}`);
  });

  it('retains only a bounded path-free Lua diagnostic', () => {
    expect(sanitizeRuntimeDiagnostic('/private/build/mods/dramatic-shape/lib/Voxel3D.lua:917: bad argument at /private/user/cart.gbc'))
      .toBe('Voxel3D.lua:917: bad argument at <path>');
    expect(sanitizeRuntimeDiagnostic('ordinary runtime stdout')).toBeUndefined();
  });
  it('joins same-canvas starts while the first runtime initialization is pending', async () => {
    let startLove!: () => void;
    let loveCalls = 0;
    const runtimeWindow: Record<string, unknown> = { location: { origin: 'https://example.test' } };
    const documentStub = {
      createElement: () => ({ dataset: {}, remove: () => undefined } as unknown as HTMLScriptElement),
      head: {
        append: (script: HTMLScriptElement) => {
          if (new URL(script.src).pathname.endsWith('/love.js')) {
            runtimeWindow.Love = (module: Record<string, unknown>) => {
              loveCalls += 1;
              module.pokevoxelAdapter = {
                stageRom: () => undefined,
                persistentFsReady: () => Promise.resolve(),
                syncPersistentFs: () => Promise.resolve(),
                resumeAudio: () => Promise.resolve(),
                signalStart: () => undefined,
                dispose: () => undefined,
              };
              return new Promise<void>((resolve) => { startLove = resolve; });
            };
          }
          script.onload?.(new Event('load'));
        },
      },
      querySelectorAll: () => [],
    };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: runtimeWindow });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: documentStub });

    const host = new LoveRuntimeHost();
    const canvas = {} as HTMLCanvasElement;
    const first = host.start(canvas);
    const second = host.start(canvas);
    expect(second).toBe(first);
    await settle();
    expect(loveCalls).toBe(1);

    startLove();
    expect(await second).toBe(await first);
    expect(host.isRunning).toBe(true);
  });

  it('fully disposes the import runtime before starting one cache-backed replacement', async () => {
    let loveCalls = 0;
    const disposeCalls: number[] = [];
    const runtimeWindow: Record<string, unknown> = { location: { origin: 'https://example.test' } };
    const documentStub = {
      createElement: () => ({ dataset: {}, remove: () => undefined } as unknown as HTMLScriptElement),
      head: { append: (script: HTMLScriptElement) => {
        if (new URL(script.src).pathname.endsWith('/love.js')) runtimeWindow.Love = (module: Record<string, unknown>) => {
          const index = loveCalls++; disposeCalls[index] = 0;
          module.pokevoxelAdapter = { stageRom: () => undefined, persistentFsReady: () => Promise.resolve(), syncPersistentFs: () => Promise.resolve(), resumeAudio: () => Promise.resolve(), signalStart: () => undefined, dispose: () => { disposeCalls[index] += 1; } };
        };
        script.onload?.(new Event('load'));
      } },
      querySelectorAll: () => [],
    };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: runtimeWindow });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: documentStub });

    const host = new LoveRuntimeHost(); const canvas = {} as HTMLCanvasElement;
    await host.start(canvas);
    await host.restartFromPersistentCache(canvas);
    expect(loveCalls).toBe(2);
    expect(disposeCalls).toEqual([1, 0]);
    expect(host.isRunning).toBe(true);
  });

  it('disposes a locally constructed adapter when its pending persistent startup is superseded', async () => {
    let loveCalls = 0;
    const persistent = [deferred<void>(), deferred<void>()];
    const disposeCalls = [0, 0];
    const runtimeWindow: Record<string, unknown> = { location: { origin: 'https://example.test' } };
    const documentStub = {
      createElement: () => ({ dataset: {}, remove: () => undefined } as unknown as HTMLScriptElement),
      head: {
        append: (script: HTMLScriptElement) => {
          if (new URL(script.src).pathname.endsWith('/love.js')) {
            runtimeWindow.Love = (module: Record<string, unknown>) => {
              const index = loveCalls++;
              module.pokevoxelAdapter = {
                stageRom: () => undefined,
                persistentFsReady: () => persistent[index].promise,
                syncPersistentFs: () => Promise.resolve(),
                resumeAudio: () => Promise.resolve(),
                signalStart: () => undefined,
                dispose: () => { disposeCalls[index] += 1; },
              };
            };
          }
          script.onload?.(new Event('load'));
        },
      },
      querySelectorAll: () => [],
    };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: runtimeWindow });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: documentStub });

    const host = new LoveRuntimeHost();
    const canvas = {} as HTMLCanvasElement;
    const superseded = host.start(canvas);
    await settle();
    expect(loveCalls).toBe(1);

    host.dispose();
    const current = host.start(canvas);
    await settle();
    expect(loveCalls).toBe(2);

    persistent[1].resolve();
    await expect(current).resolves.toBeDefined();
    persistent[0].resolve();
    await expect(superseded).rejects.toThrow('POKEVOXEL_RUNTIME_SUPERSEDED');
    expect(disposeCalls).toEqual([1, 0]);
    expect(host.isRunning).toBe(true);
  });

  it('runs the fixed cache-only maintenance mode and waits for cache-cleared', async () => {
    let argumentsSeen: string[] | undefined;
    let disposeCalls = 0;
    const runtimeWindow: Record<string, unknown> = { location: { origin: 'https://example.test' } };
    const documentStub = {
      createElement: () => ({ dataset: {}, remove: () => undefined } as unknown as HTMLScriptElement),
      head: { append: (script: HTMLScriptElement) => {
        if (new URL(script.src).pathname.endsWith('/love.js')) runtimeWindow.Love = (module: Record<string, unknown>) => {
          argumentsSeen = module.arguments as string[];
          module.pokevoxelAdapter = { stageRom: () => undefined, persistentFsReady: () => Promise.resolve(), syncPersistentFs: () => Promise.resolve(), resumeAudio: () => Promise.resolve(), signalStart: () => undefined, dispose: () => { disposeCalls += 1; } };
          const line = `POKEVOXEL_EVENT ${JSON.stringify({ version: 1, id: 1, type: 'cache-cleared', frame: 0, payload: {} })}`;
          (module.print as (value: string) => void)(line);
        };
        script.onload?.(new Event('load'));
      } },
      querySelectorAll: () => [],
    };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: runtimeWindow });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: documentStub });

    await new LoveRuntimeHost().clearRebuildableCache({} as HTMLCanvasElement);
    expect(argumentsSeen).toEqual(['./game.love', '--pokevoxel-clear-cache']);
    expect(disposeCalls).toBe(1);
  });

  it('keeps a confirmed persistence request visibly saving before completion', async () => {
    let module!: Record<string, unknown>;
    const events: string[] = [];
    const runtimeWindow: Record<string, unknown> = { location: { origin: 'https://example.test' }, setTimeout };
    const documentStub = {
      createElement: () => ({ dataset: {}, remove: () => undefined } as unknown as HTMLScriptElement),
      head: { append: (script: HTMLScriptElement) => {
        if (new URL(script.src).pathname.endsWith('/love.js')) runtimeWindow.Love = (value: Record<string, unknown>) => {
          module = value;
          module.pokevoxelAdapter = { stageRom: () => undefined, persistentFsReady: () => Promise.resolve(), syncPersistentFs: () => Promise.resolve(), resumeAudio: () => Promise.resolve(), signalStart: () => undefined, dispose: () => undefined };
        };
        script.onload?.(new Event('load'));
      } },
      querySelectorAll: () => [],
    };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: runtimeWindow });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: documentStub });

    await new LoveRuntimeHost().start({} as HTMLCanvasElement, (event) => events.push(event.type));
    const line = `POKEVOXEL_EVENT ${JSON.stringify({ version: 1, id: 1, type: 'persistence-request', frame: 0, payload: { domain: 'save', id: 1 } })}`;
    (module.print as (line: string) => void)(line);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(events).toEqual(['persistence-request']);
    await new Promise((resolve) => setTimeout(resolve, 175));
    expect(events).toEqual(['persistence-request', 'persistence-complete']);
  });

  it('resumes audio before signaling the browser game start', async () => {
    const order: string[] = [];
    const { host, canvas } = installRunningRuntime({
      resumeAudio: async () => { order.push('resume:start'); await Promise.resolve(); order.push('resume:end'); },
      signalStart: () => { order.push('signal'); },
    });
    await host.start(canvas);
    await host.startGame();
    expect(order).toEqual(['resume:start', 'resume:end', 'signal']);
  });

  it('does not signal the browser game when audio resume fails', async () => {
    let signalCalls = 0;
    const { host, canvas } = installRunningRuntime({
      resumeAudio: async () => { throw new Error('audio resume failed'); },
      signalStart: () => { signalCalls += 1; },
    });
    await host.start(canvas);
    await expect(host.startGame()).rejects.toThrow('audio resume failed');
    expect(signalCalls).toBe(0);
  });

  it('reuses the unlocked adapter on focus regain without signaling Start again', async () => {
    const { host, canvas, emit } = installLifecycleRuntime();
    await host.start(canvas);
    await host.startGame();
    emit('focus');
    await settle();
    expect(host.isRunning).toBe(true);
    expect(emit.calls()).toEqual({ resume: 2, signal: 1, focus: [true] });
  });

  it('reports a failed post-unlock resume without disposing or re-signaling Start', async () => {
    const { host, canvas, emit } = installLifecycleRuntime({ failAfterInitialResume: true });
    let failures = 0;
    await host.start(canvas, undefined, () => { failures += 1; });
    await host.startGame();
    emit('focus');
    await settle();
    expect(failures).toBe(1);
    expect(host.isRunning).toBe(true);
    expect(emit.calls()).toEqual({ resume: 2, signal: 1, focus: [true] });
  });

  it('forwards real browser blur and focus events through the bounded Lua mailbox', async () => {
    const { host, canvas, emit } = installLifecycleRuntime();
    await host.start(canvas);
    emit('blur');
    emit('focus');
    await settle();
    expect(emit.calls()).toEqual({ resume: 0, signal: 0, focus: [false, true] });
  });
});

function installRunningRuntime(overrides: Partial<{ resumeAudio: () => Promise<void>; signalStart: () => void }> = {}): { host: LoveRuntimeHost; canvas: HTMLCanvasElement } {
  const runtimeWindow: Record<string, unknown> = { location: { origin: 'https://example.test' } };
  const documentStub = {
    createElement: () => ({ dataset: {}, remove: () => undefined } as unknown as HTMLScriptElement),
    head: { append: (script: HTMLScriptElement) => {
      if (new URL(script.src).pathname.endsWith('/love.js')) runtimeWindow.Love = (module: Record<string, unknown>) => {
        module.pokevoxelAdapter = {
          stageRom: () => undefined,
          persistentFsReady: () => Promise.resolve(),
          syncPersistentFs: () => Promise.resolve(),
          resumeAudio: overrides.resumeAudio ?? (() => Promise.resolve()),
          signalStart: overrides.signalStart ?? (() => undefined),
          dispose: () => undefined,
        };
      };
      script.onload?.(new Event('load'));
    } },
    querySelectorAll: () => [],
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: runtimeWindow });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: documentStub });
  return { host: new LoveRuntimeHost(), canvas: {} as HTMLCanvasElement };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}


function installLifecycleRuntime(options: { failAfterInitialResume?: boolean } = {}): {
  host: LoveRuntimeHost; canvas: HTMLCanvasElement; emit: ((name: string) => void) & { calls: () => { resume: number; signal: number; focus: boolean[] } };
} {
  const listeners = new Map<string, Set<() => void>>();
  const add = (name: string, listener: () => void): void => { const set = listeners.get(name) ?? new Set(); set.add(listener); listeners.set(name, set); };
  const remove = (name: string, listener: () => void): void => { listeners.get(name)?.delete(listener); };
  let resume = 0; let signal = 0; const focus: boolean[] = [];
  const runtimeWindow: Record<string, unknown> = { location: { origin: 'https://example.test' }, addEventListener: add, removeEventListener: remove };
  const documentStub = {
    visibilityState: 'visible', addEventListener: add, removeEventListener: remove,
    createElement: () => ({ dataset: {}, remove: () => undefined } as unknown as HTMLScriptElement),
    head: { append: (script: HTMLScriptElement) => {
      if (new URL(script.src).pathname.endsWith('/love.js')) runtimeWindow.Love = (module: Record<string, unknown>) => {
        module.pokevoxelAdapter = {
          stageRom: () => undefined, persistentFsReady: () => Promise.resolve(), syncPersistentFs: () => Promise.resolve(),
          resumeAudio: async () => { resume += 1; if (options.failAfterInitialResume && resume > 1) throw new Error('blocked'); },
          signalStart: () => { signal += 1; }, signalFocus: (focused: boolean) => { focus.push(focused); }, dispose: () => undefined,
        };
      };
      script.onload?.(new Event('load'));
    } }, querySelectorAll: () => [],
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: runtimeWindow });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: documentStub });
  const emit = ((name: string): void => { for (const listener of listeners.get(name) ?? []) listener(); }) as ((name: string) => void) & { calls: () => { resume: number; signal: number; focus: boolean[] } };
  emit.calls = () => ({ resume, signal, focus: [...focus] });
  return { host: new LoveRuntimeHost(), canvas: {} as HTMLCanvasElement, emit };
}
