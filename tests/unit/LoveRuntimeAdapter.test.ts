import { describe, expect, it } from 'vitest';
import { LoveRuntimeAdapter, STAGED_ROM_PATH, type LoveRuntimeCapabilities } from '../../src/runtime/LoveRuntimeAdapter';
import { LoveRuntimeHost } from '../../src/runtime/LoveRuntimeHost';
const bytes = () => new Uint8Array([1, 2, 3]).buffer;
describe('LoveRuntimeAdapter ROM staging boundary', () => {
  it('writes accepted ROM bytes only through the fixed volatile MEMFS boundary', async () => {
    let stagedPath: string | undefined;
    let staged: Uint8Array | undefined;
    const adapter = new LoveRuntimeAdapter({ stageFile: async (path, data) => { stagedPath = path; staged = new Uint8Array(data).slice(); } });
    const rom = bytes(); await adapter.stageRom(rom);
    expect(STAGED_ROM_PATH).toBe('/tmp/pokevoxel-rom.gb');
    expect(stagedPath).toBe(STAGED_ROM_PATH);
    expect(STAGED_ROM_PATH.startsWith('/home/web_user/love')).toBe(false);
    expect(staged).toEqual(new Uint8Array([1, 2, 3]));
    expect([...new Uint8Array(rom)]).toEqual([0, 0, 0]);
  });
  it('clears pending ROM bytes on replacement, fatal staging failure, and retry cleanup', async () => {
    const host = new LoveRuntimeHost(); const first = bytes(); const replacement = bytes();
    host.acceptValidatedRom(first); host.acceptValidatedRom(replacement); expect([...new Uint8Array(first)]).toEqual([0, 0, 0]);
    await expect(host.stagePendingRom(new LoveRuntimeAdapter(async () => { throw new Error('staging failed'); }))).rejects.toThrow('staging failed');
    expect(host.hasPendingRom).toBe(false); expect([...new Uint8Array(replacement)]).toEqual([0, 0, 0]);
    const retry = bytes(); host.acceptValidatedRom(retry); host.clearPendingRom(); expect([...new Uint8Array(retry)]).toEqual([0, 0, 0]);
  });
  it('does not expose a generic arbitrary filesystem write API', () => {
    const adapter = new LoveRuntimeAdapter(async () => undefined); expect('writeFile' in adapter).toBe(false); expect('writePath' in adapter).toBe(false);
  });
  it('keeps the patched runtime capability boundary to the seven named operations', () => {
    const capabilities: LoveRuntimeCapabilities = {
      stageRom: () => Promise.resolve(), persistentFsReady: () => Promise.resolve(), syncPersistentFs: () => Promise.resolve(),
      resumeAudio: () => Promise.resolve(), signalStart: () => undefined, signalFocus: () => undefined, dispose: () => undefined,
    };
    expect(Object.keys(capabilities).sort()).toEqual(['dispose', 'persistentFsReady', 'resumeAudio', 'signalFocus', 'signalStart', 'stageRom', 'syncPersistentFs']);
  });
  it('signals Start with only the two fixed audio renderer values', async () => {
    let selected: string | undefined;
    const adapter = new LoveRuntimeAdapter({
      stageRom: () => Promise.resolve(), persistentFsReady: () => Promise.resolve(), syncPersistentFs: () => Promise.resolve(),
      resumeAudio: () => Promise.resolve(), signalStart: (renderer) => { selected = renderer; }, signalFocus: () => undefined, dispose: () => undefined,
    });
    await adapter.signalStart('stock');
    expect(selected).toBe('stock');
    await expect(adapter.signalStart('other' as 'stock')).rejects.toThrow('POKEVOXEL_AUDIO_RENDERER_INVALID');
  });
});
