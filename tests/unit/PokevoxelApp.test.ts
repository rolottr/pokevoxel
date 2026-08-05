import { describe, expect, it } from 'vitest';
import {
  acceptsInitialCacheRestore,
  audioLifecycleDetail,
  initialAppState,
  storageHasQuotaPressure,
  mergeShellModel,
  transitionAppState,
  transitionShellModel,
  type AppState,
  type ShellModel,
} from '../../src/app/PokevoxelApp';
import { persistenceStatusCopy, shouldOfferCacheRecovery } from '../../src/ui/WelcomeScreen';

describe('PokevoxelApp state model', () => {
  it('starts at the welcome state', () => {
    expect(initialAppState).toBe<AppState>('welcome');
  });

  it('moves from welcome to validating when a ROM is selected', () => {
    expect(transitionAppState('welcome', 'SELECT_ROM')).toBe<AppState>('validating');
  });

  it('moves from validating to importing after a valid ROM is confirmed', () => {
    expect(transitionAppState('validating', 'VALID_ROM')).toBe<AppState>('importing');
  });

  it('accepts cache-restored only for the initial welcome boot', () => {
    expect(acceptsInitialCacheRestore('welcome')).toBe(true);
    for (const state of ['validating', 'importing', 'cache-ready', 'starting', 'playing'] as const) {
      expect(acceptsInitialCacheRestore(state)).toBe(false);
    }
  });

  it('moves from importing to playing after import completes', () => {
    expect(transitionAppState('importing', 'IMPORT_COMPLETE')).toBe<AppState>('playing');
  });

  it('hands the visible canvas over when the prepared game starts', () => {
    expect(transitionAppState('starting', 'GAME_STARTED')).toBe<AppState>('playing');
  });

  it('moves from any active state to error when an operation fails', () => {
    for (const state of ['welcome', 'validating', 'importing', 'playing'] as const) {
      expect(transitionAppState(state, 'FAIL')).toBe<AppState>('error');
    }
  });

  it('returns from error to welcome when retrying', () => {
    expect(transitionAppState('error', 'RETRY')).toBe<AppState>('welcome');
  });

  it('keeps an unsupported transition in its current state', () => {
    expect(transitionAppState('welcome', 'IMPORT_COMPLETE')).toBe<AppState>('welcome');
  });

  it('retains a restored summary when cache restoration advances the shell', () => {
    const restored: ShellModel = {
      state: 'welcome',
      persistenceRestored: true,
      persistenceRestoredSummary: { phase: 'restored', version: 'yellow', slot: 'yellow-default', partyCount: 1, map: 'PALLET_TOWN', x: 10, y: 8, optionsSha256: 'a'.repeat(64) },
    };
    const afterCacheRestore = transitionShellModel(restored, 'CACHE_RESTORED', { cacheRestored: true });
    expect(afterCacheRestore.state).toBe('cache-ready');
    expect(afterCacheRestore.persistenceRestoredSummary).toEqual(restored.persistenceRestoredSummary);
  });

  it('keeps a startup lifecycle audio failure through title readiness until a successful re-enable', () => {
    const blocked: ShellModel = { state: 'starting', audioState: 'blocked', audioResumeFailed: true };
    const titleReady = transitionShellModel(blocked, 'TITLE_READY', audioLifecycleDetail(blocked));
    expect(titleReady).toMatchObject({ state: 'playing', audioState: 'blocked', audioResumeFailed: true });
    expect(audioLifecycleDetail({ ...titleReady, audioResumeFailed: false })).toEqual({ audioState: 'running', audioResumeFailed: false });
  });

  it('retains a restored summary when start-time storage persistence resolves', () => {
    const starting: ShellModel = {
      state: 'starting',
      persistenceRestored: true,
      persistenceRestoredSummary: { phase: 'restored', version: 'yellow', slot: 'yellow-default', partyCount: 1, map: 'PALLET_TOWN', x: 10, y: 8, optionsSha256: 'a'.repeat(64) },
    };
    const afterStorage = mergeShellModel(starting, { audioState: 'running' });
    expect(afterStorage).toMatchObject({ state: 'starting', audioState: 'running', persistenceRestoredSummary: starting.persistenceRestoredSummary });
  });
});

describe('storage preflight', () => {
  it('detects quota pressure without treating an unavailable estimate as a failure', async () => {
    await expect(storageHasQuotaPressure({ estimate: async () => ({ quota: 100, usage: 90 }) } as StorageEstimate)).resolves.toBe(true);
    await expect(storageHasQuotaPressure({ estimate: async () => { throw new DOMException('denied', 'SecurityError'); } } as StorageManager)).resolves.toBe(false);
  });
});

describe('persistence status copy', () => {
  it('never reports an unacknowledged save as successful', () => {
    expect(persistenceStatusCopy(undefined)).toBe('Not saved yet');
    expect(persistenceStatusCopy('idle')).toBe('Not saved yet');
    expect(persistenceStatusCopy('saving')).toBe('Saving...');
    expect(persistenceStatusCopy('saved')).toBe('Saved');
    expect(persistenceStatusCopy('failed')).toBe('Save failed');
  });

  it('offers explicit cache-only recovery only for quota or permission failures', () => {
    expect(shouldOfferCacheRecovery('PERSISTENCE_QUOTA_EXCEEDED')).toBe(true);
    expect(shouldOfferCacheRecovery('PERSISTENCE_PERMISSION_DENIED')).toBe(true);
    expect(shouldOfferCacheRecovery('PERSISTENCE_SYNC_FAILED')).toBe(false);
  });
});
