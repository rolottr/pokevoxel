import { describe, expect, it, vi } from 'vitest';
import { DurableGenerationStore } from '../../src/persistence/DurableGenerationStore';

const tick = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); };

describe('DurableGenerationStore', () => {
  it('serializes requests, accepts exact duplicate delivery, and does not let an options acknowledgement confirm a save', async () => {
    const calls: number[] = [];
    let release!: () => void;
    const first = new Promise<void>((resolve) => { release = resolve; });
    const store = new DurableGenerationStore((id) => { calls.push(id); return id === 1 ? first : Promise.resolve(); });
    const save = store.request('save', 1);
    expect(store.request('save', 1)).toBe(save);
    const option = store.request('options', 1);
    await tick();
    expect(calls).toEqual([1]);
    release();
    await save;
    await option;
    expect(calls).toEqual([1, 1]);
  });

  it('keeps save generations ordered and rejects stale ids', async () => {
    const calls: number[] = [];
    const store = new DurableGenerationStore(async (id) => { calls.push(id); });
    await Promise.all([store.request('save', 3), store.request('save', 4)]);
    expect(calls).toEqual([3, 4]);
    await expect(store.request('save', 0)).rejects.toMatchObject({ code: 'PERSISTENCE_STALE_ACK' });
  });

  it('times out at fifteen seconds and leaves retry ownership to the Lua mailbox protocol', async () => {
    vi.useFakeTimers();
    try {
      const hanging = new DurableGenerationStore(() => new Promise<void>(() => undefined));
      const timeout = hanging.request('save', 1);
      const timedOut = expect(timeout).rejects.toMatchObject({ code: 'PERSISTENCE_TIMEOUT' });
      await vi.advanceTimersByTimeAsync(15_000);
      await timedOut;

      const aborted = vi.fn(async () => { throw new DOMException('gone', 'AbortError'); });
      await expect(new DurableGenerationStore(aborted).request('save', 1)).rejects.toMatchObject({ code: 'PERSISTENCE_SYNC_FAILED' });
      expect(aborted).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it('does not retry quota or permission failures and reports a stable code', async () => {
    const quota = new DOMException('full', 'QuotaExceededError');
    const sync = vi.fn(async () => { throw quota; });
    const store = new DurableGenerationStore(sync);
    await expect(store.request('save', 1)).rejects.toMatchObject({ code: 'PERSISTENCE_QUOTA_EXCEEDED' });
    expect(sync).toHaveBeenCalledTimes(1);
    expect(store.currentStatus).toBe('failed');

    const denied = new DurableGenerationStore(async () => { throw new DOMException('denied', 'SecurityError'); });
    await expect(denied.request('save', 1)).rejects.toMatchObject({ code: 'PERSISTENCE_PERMISSION_DENIED' });
  });


  it('flushes only requested work for page lifecycle signals', async () => {
    const sync = vi.fn(async () => undefined);
    const store = new DurableGenerationStore(sync);
    await store.flush();
    expect(sync).not.toHaveBeenCalled();
    await store.request('options', 1);
    await store.flush();
    expect(sync).toHaveBeenCalledWith(1);
  });
});
