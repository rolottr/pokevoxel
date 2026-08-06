import { describe, expect, it } from 'vitest';
import { parseRuntimeEvent, RUNTIME_EVENT_PREFIX } from '../../src/runtime/runtimeEvents';

describe('runtime event worker bridge', () => {
  const payload = '{"version":1,"id":1,"type":"import-progress","frame":0,"payload":{"progress":0,"stage":"hash"}}';

  it('accepts the exact worker event line forwarded without a pthread prefix', () => {
    expect(parseRuntimeEvent(`${RUNTIME_EVENT_PREFIX}${payload}`)?.type).toBe('import-progress');
  });

  it('rejects ordinary pthread diagnostics rather than loosening the event parser', () => {
    expect(parseRuntimeEvent(`Thread undefined: ${RUNTIME_EVENT_PREFIX}${payload}`)).toBeUndefined();
  });
});

it('parses bounded owner handshake events', () => {
  const payload = JSON.stringify({ version: 1, id: 7, type: 'runtime-prepared', frame: 0, payload: {} });
  expect(parseRuntimeEvent(`${RUNTIME_EVENT_PREFIX}${payload}`)?.type).toBe('runtime-prepared');
});

it('accepts only named persistence domains with an exact positive request id', () => {
  const valid = JSON.stringify({ version: 1, id: 8, type: 'persistence-request', frame: 0, payload: { domain: 'save', id: 3 } });
  const invalid = JSON.stringify({ version: 1, id: 9, type: 'persistence-request', frame: 0, payload: { domain: 'rom', id: 3 } });
  expect(parseRuntimeEvent(`${RUNTIME_EVENT_PREFIX}${valid}`)?.type).toBe('persistence-request');
  expect(parseRuntimeEvent(`${RUNTIME_EVENT_PREFIX}${invalid}`)).toBeUndefined();
});

it('accepts only the persistence-correlated mod restart marker', () => {
  const line = (id: number, payload: unknown) => `${RUNTIME_EVENT_PREFIX}${JSON.stringify({ version: 1, id, type: 'mod-restart-ready', frame: 0, payload })}`;
  expect(parseRuntimeEvent(line(9, { id: 4 }))?.type).toBe('mod-restart-ready');
  expect(parseRuntimeEvent(line(10, { id: 0 }))).toBeUndefined();
  expect(parseRuntimeEvent(line(11, { id: 4, path: 'options.lua' }))).toBeUndefined();
});

it('accepts the privacy-safe ordinary-save restoration marker', () => {
  const payload = JSON.stringify({ version: 1, id: 10, type: 'persistence-restored', frame: 0, payload: {} });
  expect(parseRuntimeEvent(`${RUNTIME_EVENT_PREFIX}${payload}`)?.type).toBe('persistence-restored');
});

it('accepts the fixed-mode rebuildable-cache completion marker', () => {
  const payload = JSON.stringify({ version: 1, id: 11, type: 'cache-cleared', frame: 0, payload: {} });
  expect(parseRuntimeEvent(`${RUNTIME_EVENT_PREFIX}${payload}`)?.type).toBe('cache-cleared');
});

it('accepts only a bounded semantic ordinary-save summary', () => {
  const payload = { phase: 'restored', version: 'yellow', slot: 'yellow-1', partyCount: 1, map: 'PALLET_TOWN', x: 10, y: 8, optionsSha256: 'a'.repeat(64) };
  const valid = JSON.stringify({ version: 1, id: 12, type: 'persistence-summary', frame: 0, payload });
  expect(parseRuntimeEvent(`${RUNTIME_EVENT_PREFIX}${valid}`)?.type).toBe('persistence-summary');
  expect(parseRuntimeEvent(`${RUNTIME_EVENT_PREFIX}${JSON.stringify({ version: 1, id: 13, type: 'persistence-summary', frame: 0, payload: { ...payload, map: '../save.lua' } })}`)).toBeUndefined();
});

it('accepts a bounded summary emitted only after title Continue restores the save', () => {
  const payload = { phase: 'resumed', version: 'yellow', slot: 'yellow-slot1', partyCount: 1, map: 'PALLET_TOWN', x: 10, y: 8, optionsSha256: 'a'.repeat(64) };
  const valid = JSON.stringify({ version: 1, id: 14, type: 'persistence-summary', frame: 0, payload });
  expect(parseRuntimeEvent(`${RUNTIME_EVENT_PREFIX}${valid}`)?.type).toBe('persistence-summary');
});

it('accepts only the bounded semantic audio probe and rejects content-bearing payloads', () => {
  const payload = { scene: 'battle', renderer: 'pokeaudio-hd', queued: 2, playing: true, effect: 'low-hp', effectId: 7, lowHp: true, musicSources: 1, pcmPeak: 125000, pcmFrames: 4096, pcmNonzero: true, musicVolume: 7, sfxVolume: 7, lowHpActivations: 1, victoryActivations: 1 };
  const valid = JSON.stringify({ version: 1, id: 15, type: 'audio-probe', frame: 0, payload });
  expect(parseRuntimeEvent(`${RUNTIME_EVENT_PREFIX}${valid}`)?.type).toBe('audio-probe');
  // Extra keys are rejected so a future producer cannot add a song/path/PCM field.
  expect(parseRuntimeEvent(`${RUNTIME_EVENT_PREFIX}${JSON.stringify({ version: 1, id: 16, type: 'audio-probe', frame: 0, payload: { ...payload, song: 'Music_Battle' } })}`)).toBeUndefined();
  expect(parseRuntimeEvent(`${RUNTIME_EVENT_PREFIX}${JSON.stringify({ version: 1, id: 17, type: 'audio-probe', frame: 0, payload: { ...payload, musicVolume: 8 } })}`)).toBeUndefined();
  expect(parseRuntimeEvent(`${RUNTIME_EVENT_PREFIX}${JSON.stringify({ version: 1, id: 18, type: 'audio-probe', frame: 0, payload: { ...payload, renderer: 'other' } })}`)).toBeUndefined();
});

it('accepts only the persisted HD or Stock homepage preference', () => {
  const line = (id: number, payload: unknown) => `${RUNTIME_EVENT_PREFIX}${JSON.stringify({ version: 1, id, type: 'audio-preference', frame: 0, payload })}`;
  expect(parseRuntimeEvent(line(19, { renderer: 'pokeaudio-hd' }))?.type).toBe('audio-preference');
  expect(parseRuntimeEvent(line(20, { renderer: 'stock' }))?.type).toBe('audio-preference');
  expect(parseRuntimeEvent(line(21, { renderer: 'other' }))).toBeUndefined();
  expect(parseRuntimeEvent(line(22, { renderer: 'stock', path: 'options.lua' }))).toBeUndefined();
});


it('accepts only exact bounded battle input phases', () => {
  const event = (id: number, payload: unknown) => `${RUNTIME_EVENT_PREFIX}${JSON.stringify({ version: 1, id, type: 'battle-input-phase', frame: 0, payload })}`;
  for (const phase of ['none', 'menu', 'move', 'messages']) expect(parseRuntimeEvent(event(20 + phase.length, { phase }))?.type).toBe('battle-input-phase');
  expect(parseRuntimeEvent(event(30, { phase: 'moveSelect' }))).toBeUndefined();
  expect(parseRuntimeEvent(event(31, { phase: 'menu', source: 'battle' }))).toBeUndefined();
});

it('accepts only the bounded water evidence and rejects a fallback claim', () => {
  const payload = { map: 'ROUTE_19', mode: 'full', reflection: true, animated: true, surfing: true, indoor: false, fallback: false, stableFrames: 2 };
  const line = (id: number, value: unknown) => `${RUNTIME_EVENT_PREFIX}${JSON.stringify({ version: 1, id, type: 'water-ready', frame: 0, payload: value })}`;
  expect(parseRuntimeEvent(line(40, payload))?.type).toBe('water-ready');
  expect(parseRuntimeEvent(line(41, { ...payload, map: 'PALLET_TOWN' }))).toBeUndefined();
  expect(parseRuntimeEvent(line(42, { ...payload, mode: 'off' }))).toBeUndefined();
});

it('accepts only the bounded disposable voxel occlusion probe', () => {
  const line = (id: number, payload: unknown) => `${RUNTIME_EVENT_PREFIX}${JSON.stringify({ version: 1, id, type: 'voxel-occlusion-probe', frame: 0, payload })}`;
  const probe = { x: 640.25, y: 180.5, card: 72.75, angle: 75 * Math.PI / 180, hidden: false, packed: true };
  expect(parseRuntimeEvent(line(43, probe))?.type).toBe('voxel-occlusion-probe');
  expect(parseRuntimeEvent(line(44, { ...probe, path: '../rom.gbc' }))).toBeUndefined();
  expect(parseRuntimeEvent(line(45, { ...probe, card: 0 }))).toBeUndefined();
  expect(parseRuntimeEvent(line(46, { ...probe, angle: Math.PI + 0.01 }))).toBeUndefined();
});

it('accepts the engine time-of-day vocabulary emitted by the voxel runtime', () => {
  const line = (id: number, dayNight: string) => `${RUNTIME_EVENT_PREFIX}${JSON.stringify({
    version: 1, id, type: 'voxel-ready', frame: 0,
    payload: { map: 'PALLET_TOWN', loads: 1, stableFrames: 2, depth: true,
      npcDepth: true, buildingDepth: true, palette: 'active', dayNight,
      menus: false, streamCount: 1, fallback: false },
  })}`;
  for (const [index, period] of ['DAY', 'NIGHT', 'MORNING', 'EVENING'].entries()) {
    expect(parseRuntimeEvent(line(47 + index, period))?.type).toBe('voxel-ready');
  }
  expect(parseRuntimeEvent(line(51, 'DUSK'))).toBeUndefined();
});

it('accepts only bounded staged-battle and exact-return evidence', () => {
  const line = (id: number, type: string, payload: unknown) => `${RUNTIME_EVENT_PREFIX}${JSON.stringify({ version: 1, id, type, frame: 0, payload })}`;
  const ready = { category: 'jessie-james', kind: 'trainer', map: 'PALLET_TOWN', staged: true, fallback: false };
  const returned = { category: 'jessie-james', map: 'PALLET_TOWN', returned: true, castRestored: true };
  expect(parseRuntimeEvent(line(50, 'battle-ready', ready))?.type).toBe('battle-ready');
  expect(parseRuntimeEvent(line(51, 'battle-returned', returned))?.type).toBe('battle-returned');
  expect(parseRuntimeEvent(line(52, 'battle-ready', { ...ready, fallback: true }))).toBeUndefined();
  expect(parseRuntimeEvent(line(53, 'battle-returned', { ...returned, category: 'link' }))).toBeUndefined();
});

it('accepts exact first-person render and release evidence without save content', () => {
  const line = (id: number, type: string, payload: unknown) => `${RUNTIME_EVENT_PREFIX}${JSON.stringify({ version: 1, id, type, frame: 0, payload })}`;
  const ready = { map: 'PALLET_TOWN', cellX: 5, cellY: 6, facing: 'down', surfing: false, driving: true, captured: true, camera: true, stableFrames: 2, fallback: false };
  const released = { map: 'PALLET_TOWN', cellX: 5, cellY: 6, facing: 'down', surfing: false, driving: false, captured: false, sequence: 1 };
  const parity = { scenario: 'outdoor', map: 'PALLET_TOWN', cellX: 5, cellY: 6, facing: 'down', surfing: false, flagsSame: true, transitioning: false };
  expect(parseRuntimeEvent(line(60, 'first-person-ready', ready))?.type).toBe('first-person-ready');
  expect(parseRuntimeEvent(line(61, 'first-person-released', released))?.type).toBe('first-person-released');
  expect(parseRuntimeEvent(line(62, 'first-person-parity', parity))?.type).toBe('first-person-parity');
  expect(parseRuntimeEvent(line(63, 'first-person-ready', { ...ready, camera: false }))).toBeUndefined();
  expect(parseRuntimeEvent(line(64, 'first-person-released', { ...released, sequence: -1 }))).toBeUndefined();
  expect(parseRuntimeEvent(line(65, 'first-person-parity', { ...parity, scenario: 'custom' }))).toBeUndefined();
  expect(parseRuntimeEvent(line(66, 'first-person-parity', { ...parity, flags: {} }))).toBeUndefined();
});
