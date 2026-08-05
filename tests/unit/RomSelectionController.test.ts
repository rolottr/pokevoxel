import { describe, expect, it } from 'vitest';
import { RomSelectionController, type RomValidator } from '../../src/import/RomSelectionController';
import type { RomValidationResult } from '../../src/import/romValidation';

const file = (name: string) => ({ name } as File);
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const accepted = (fill: number): RomValidationResult => ({ ok: true, buffer: new Uint8Array(8).fill(fill).buffer });

describe('RomSelectionController latest-selection ownership', () => {
  it('keeps the newest accepted ROM and zeroes an older validation that resolves last', async () => {
    const first = deferred<RomValidationResult>();
    const second = deferred<RomValidationResult>();
    const validator: RomValidator = (selected) => selected.name === 'first' ? first.promise : second.promise;
    const controller = new RomSelectionController(undefined, validator);

    const older = controller.select(file('first'));
    const newer = controller.select(file('second'));
    const newest = accepted(2);
    second.resolve(newest);
    await expect(newer).resolves.toEqual({ kind: 'accepted' });
    expect(controller.hasPendingRom).toBe(true);

    const stale = accepted(1);
    first.resolve(stale);
    await expect(older).resolves.toEqual({ kind: 'stale' });
    expect(new Uint8Array(stale.buffer).every((byte) => byte === 0)).toBe(true);
    expect(new Uint8Array(newest.buffer).every((byte) => byte === 2)).toBe(true);
  });

  it('invalidates an in-flight validation on retry and releases its stale buffer', async () => {
    const pending = deferred<RomValidationResult>();
    const controller = new RomSelectionController(undefined, async () => pending.promise);
    const selection = controller.select(file('slow'));
    controller.retry();

    const stale = accepted(3);
    pending.resolve(stale);
    await expect(selection).resolves.toEqual({ kind: 'stale' });
    expect(controller.hasPendingRom).toBe(false);
    expect(new Uint8Array(stale.buffer).every((byte) => byte === 0)).toBe(true);
  });

  it('converts an unexpected validator failure into a safe unreadable result', async () => {
    const controller = new RomSelectionController(undefined, async () => { throw new Error('do not expose local details'); });
    await expect(controller.select(file('broken'))).resolves.toEqual({ kind: 'error', code: 'unreadable' });
    expect(controller.hasPendingRom).toBe(false);
  });
});
