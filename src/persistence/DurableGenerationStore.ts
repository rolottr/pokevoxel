export const PERSISTENCE_SYNC_TIMEOUT_MS = 15_000;
export type PersistenceDomain = 'save' | 'options' | 'cache';
export type PersistenceStatus = 'idle' | 'saving' | 'saved' | 'failed';
export type SyncPersistentFs = (requestId: number) => Promise<void>;
export type PersistenceErrorCode = 'PERSISTENCE_TIMEOUT' | 'PERSISTENCE_STALE_ACK' | 'PERSISTENCE_SYNC_FAILED' | 'PERSISTENCE_QUOTA_EXCEEDED' | 'PERSISTENCE_PERMISSION_DENIED';

export class DurablePersistenceError extends Error {
  public constructor(public readonly code: PersistenceErrorCode, cause?: unknown) {
    super(code, { cause });
    this.name = 'DurablePersistenceError';
  }
}

/** Browser storage failures are normalized without retaining browser error text. */
export function classifyPersistenceError(error: unknown): DurablePersistenceError {
  if (error instanceof DurablePersistenceError) return error;
  const name = typeof error === 'object' && error !== null && 'name' in error ? (error as { name?: unknown }).name : undefined;
  if (name === 'QuotaExceededError') return new DurablePersistenceError('PERSISTENCE_QUOTA_EXCEEDED', error);
  if (name === 'SecurityError' || name === 'NotAllowedError') return new DurablePersistenceError('PERSISTENCE_PERMISSION_DENIED', error);
  return new DurablePersistenceError('PERSISTENCE_SYNC_FAILED', error);
}

type Pending = { id: number; promise: Promise<void>; resolve: () => void; reject: (error: Error) => void };
type DomainState = { lastCompleted: number; lastAccepted: number; pending: Map<number, Pending> };

/**
 * The bounded browser half of the ordinary-save protocol. It never reads or
 * writes game files: Lua constructs generations and asks this store only to
 * perform an IDBFS sync for an exact request id.
 */
export class DurableGenerationStore {
  private readonly domains = new Map<PersistenceDomain, DomainState>();
  private tail: Promise<void> = Promise.resolve();
  private status: PersistenceStatus = 'idle';
  private listeners = new Set<(status: PersistenceStatus) => void>();

  public constructor(
    private readonly sync: SyncPersistentFs,
    private readonly timeoutMs = PERSISTENCE_SYNC_TIMEOUT_MS,
  ) {}

  public get currentStatus(): PersistenceStatus { return this.status; }
  public onStatus(listener: (status: PersistenceStatus) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  /** Duplicate delivery is idempotent; a stale id is never allowed to masquerade as an acknowledgement. */
  public request(domain: PersistenceDomain, requestId: number): Promise<void> {
    if (!Number.isSafeInteger(requestId) || requestId < 1) return Promise.reject(new DurablePersistenceError('PERSISTENCE_STALE_ACK'));
    const state = this.state(domain);
    if (requestId <= state.lastCompleted) return Promise.resolve();
    const duplicate = state.pending.get(requestId);
    if (duplicate) return duplicate.promise;
    if (requestId <= state.lastAccepted) return Promise.reject(new DurablePersistenceError('PERSISTENCE_STALE_ACK'));
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
    const pending: Pending = { id: requestId, promise, resolve, reject };
    state.lastAccepted = requestId;
    state.pending.set(requestId, pending);
    this.setStatus('saving');
    this.tail = this.tail.catch(() => undefined).then(async () => {
      try {
        await this.withTimeout(requestId);
        // An acknowledgement is valid only for the exact request still pending.
        if (state.pending.get(requestId) !== pending || pending.id !== requestId) throw new DurablePersistenceError('PERSISTENCE_STALE_ACK');
        state.lastCompleted = requestId;
        state.pending.delete(requestId);
        pending.resolve();
        this.setStatus(this.hasPending() ? 'saving' : 'saved');
      } catch (error) {
        if (state.pending.get(requestId) === pending) state.pending.delete(requestId);
        const normalized = classifyPersistenceError(error);
        pending.reject(normalized);
        this.setStatus('failed');
      }
    });
    return promise;
  }

  /** Secondary page lifecycle signal: wait for already requested durable work; never invent a filesystem request. */
  public flush(): Promise<void> { return this.tail; }

  private state(domain: PersistenceDomain): DomainState {
    let value = this.domains.get(domain);
    if (!value) { value = { lastCompleted: 0, lastAccepted: 0, pending: new Map() }; this.domains.set(domain, value); }
    return value;
  }
  private withTimeout(requestId: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new DurablePersistenceError('PERSISTENCE_TIMEOUT')), this.timeoutMs);
      void this.sync(requestId).then(() => { clearTimeout(timer); resolve(); }, (error: unknown) => { clearTimeout(timer); reject(error); });
    });
  }
  private setStatus(status: PersistenceStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }
  private hasPending(): boolean { return [...this.domains.values()].some((state) => state.pending.size > 0); }
}
