export const RUNTIME_EVENT_PREFIX = 'POKEVOXEL_EVENT ';
export const RUNTIME_EVENT_SCHEMA_VERSION = 1;
export type RuntimeEventType = 'bootstrap-ready' | 'runtime-prepared' | 'import-phase' | 'import-progress' | 'cache-committed' | 'cache-restored' | 'cache-cleared' | 'game-started' | 'title-ready' | 'new-game-started' | 'overworld-ready' | 'voxel-ready' | 'voxel-unready' | 'voxel-occlusion-probe' | 'water-ready' | 'water-unready' | 'battle-ready' | 'battle-returned' | 'first-person-ready' | 'first-person-released' | 'first-person-parity' | 'error' | 'sync-request' | 'persistence-request' | 'persistence-saving' | 'persistence-complete' | 'persistence-failed' | 'persistence-restored' | 'persistence-summary' | 'audio-probe' | 'overworld-input-ready' | 'battle-input-phase';
export type RuntimeEvent = Readonly<{ version: 1; id: number; type: RuntimeEventType; frame: number; payload: Record<string, unknown> }>;
export type AudioProbe = Readonly<{ scene: 'none' | 'title' | 'overworld' | 'battle' | 'victory'; queued: number; playing: boolean; effect: 'none' | 'sfx' | 'low-hp'; effectId: number; lowHp: boolean; musicSources: number; pcmPeak: number; pcmFrames: number; pcmNonzero: boolean; musicVolume: number; sfxVolume: number; lowHpActivations: number; victoryActivations: number }>;
/** Bounded, semantic evidence emitted only after the active voxel pipeline draws. */
export type VoxelProbe = Readonly<{ map: 'PALLET_TOWN' | 'REDS_HOUSE_1F' | 'VIRIDIAN_FOREST' | 'ROCK_TUNNEL_1F'; loads: number; stableFrames: number; depth: boolean; npcDepth: boolean; buildingDepth: boolean; palette: 'active' | 'default'; dayNight: 'DAY' | 'NIGHT' | 'MORNING' | 'EVENING'; menus: boolean; streamCount: number; fallback: boolean }>;
export type VoxelOcclusionProbe = Readonly<{ x: number; y: number; card: number; angle: number; hidden: boolean; packed: boolean }>;
export type WaterProbe = Readonly<{ map: 'ROUTE_19' | 'ROUTE_20' | 'REDS_HOUSE_1F'; mode: 'sky' | 'full'; reflection: boolean; animated: boolean; surfing: boolean; indoor: boolean; fallback: boolean; stableFrames: number }>;
export type BattleCategory = 'wild' | 'trainer' | 'rival' | 'gym' | 'jessie-james' | 'legendary' | 'elite-four' | 'final';
export type BattleProbe = Readonly<{ category: BattleCategory; kind: 'wild' | 'trainer'; map: string; staged: true; fallback: false }>;
export type BattleReturnProbe = Readonly<{ category: BattleCategory; map: string; returned: boolean; castRestored: boolean }>;
export type FirstPersonProbe = Readonly<{ map: string; cellX: number; cellY: number; facing: 'up' | 'down' | 'left' | 'right'; surfing: boolean; driving: true; captured: true; camera: true; stableFrames: number; fallback: false }>;
export type FirstPersonReleaseProbe = Readonly<{ map: string; cellX: number; cellY: number; facing: 'up' | 'down' | 'left' | 'right'; surfing: boolean; driving: boolean; captured: false; sequence: number }>;
export type FirstPersonParityProbe = Readonly<{ scenario: 'outdoor' | 'indoor' | 'cave' | 'water' | 'scripted-warp' | 'random-encounter'; map: string; cellX: number; cellY: number; facing: 'up' | 'down' | 'left' | 'right'; surfing: boolean; flagsSame: boolean; transitioning: boolean }>;
export type PersistenceSummary = Readonly<{ phase: 'committed' | 'restored' | 'resumed'; version: 'red' | 'blue' | 'yellow'; slot: string; partyCount: number; map: string; x: number; y: number; optionsSha256: string }>;

/** Parses only the bounded schema emitted by BrowserEvents.lua. */
export function parseRuntimeEvent(line: string): RuntimeEvent | undefined {
  if (!line.startsWith(RUNTIME_EVENT_PREFIX) || line.length > 4096) return undefined;
  try {
    const value: unknown = JSON.parse(line.slice(RUNTIME_EVENT_PREFIX.length));
    if (!value || typeof value !== 'object') return undefined;
    const event = value as Record<string, unknown>;
    if (event.version !== RUNTIME_EVENT_SCHEMA_VERSION || !Number.isSafeInteger(event.id) || (event.id as number) < 1 || typeof event.frame !== 'number' || !Number.isFinite(event.frame) || !isRuntimeEventType(event.type) || !isPayload(event.payload)) return undefined;
    if ((event.type === 'sync-request' || event.type === 'persistence-request') && (!Number.isSafeInteger((event.payload as Record<string, unknown>).id) || ((event.payload as Record<string, unknown>).id as number) < 1)) return undefined;
    if (event.type === 'persistence-request' && !isPersistenceDomain((event.payload as Record<string, unknown>).domain)) return undefined;
    if (event.type === 'persistence-summary' && !isPersistenceSummary(event.payload as Record<string, unknown>)) return undefined;
    if (event.type === 'battle-input-phase' && !['none','menu','move','messages'].includes((event.payload as Record<string, unknown>).phase as string)) return undefined;
    if (event.type === 'battle-input-phase' && Object.keys(event.payload as Record<string, unknown>).length !== 1) return undefined;
    if (event.type === 'overworld-input-ready' && Object.keys(event.payload as Record<string, unknown>).length !== 1) return undefined;
    if (event.type === 'overworld-input-ready' && typeof (event.payload as Record<string, unknown>).ready !== 'boolean') return undefined;
    if (event.type === 'audio-probe' && !isAudioProbe(event.payload as Record<string, unknown>)) return undefined;
    if (event.type === 'voxel-ready' && !isVoxelProbe(event.payload as Record<string, unknown>)) return undefined;
    if (event.type === 'voxel-occlusion-probe' && !isVoxelOcclusionProbe(event.payload as Record<string, unknown>)) return undefined;
    if (event.type === 'water-ready' && !isWaterProbe(event.payload as Record<string, unknown>)) return undefined;
    if (event.type === 'battle-ready' && !isBattleProbe(event.payload as Record<string, unknown>)) return undefined;
    if (event.type === 'battle-returned' && !isBattleReturnProbe(event.payload as Record<string, unknown>)) return undefined;
    if (event.type === 'first-person-ready' && !isFirstPersonProbe(event.payload as Record<string, unknown>)) return undefined;
    if (event.type === 'first-person-released' && !isFirstPersonReleaseProbe(event.payload as Record<string, unknown>)) return undefined;
    if (event.type === 'first-person-parity' && !isFirstPersonParityProbe(event.payload as Record<string, unknown>)) return undefined;
    if (event.type === 'voxel-unready' && Object.keys(event.payload as Record<string, unknown>).length !== 0) return undefined;
    if (event.type === 'water-unready' && Object.keys(event.payload as Record<string, unknown>).length !== 0) return undefined;
    return event as RuntimeEvent;
  } catch { return undefined; }
}
function isRuntimeEventType(value: unknown): value is RuntimeEventType { return value === 'bootstrap-ready' || value === 'runtime-prepared' || value === 'import-phase' || value === 'import-progress' || value === 'cache-committed' || value === 'cache-restored' || value === 'cache-cleared' || value === 'game-started' || value === 'title-ready' || value === 'new-game-started' || value === 'overworld-ready' || value === 'voxel-ready' || value === 'voxel-unready' || value === 'voxel-occlusion-probe' || value === 'water-ready' || value === 'water-unready' || value === 'battle-ready' || value === 'battle-returned' || value === 'first-person-ready' || value === 'first-person-released' || value === 'first-person-parity' || value === 'error' || value === 'sync-request' || value === 'persistence-request' || value === 'persistence-saving' || value === 'persistence-complete' || value === 'persistence-failed' || value === 'persistence-restored' || value === 'persistence-summary' || value === 'audio-probe' || value === 'overworld-input-ready' || value === 'battle-input-phase'; }
const BATTLE_CATEGORIES = ['wild', 'trainer', 'rival', 'gym', 'jessie-james', 'legendary', 'elite-four', 'final'];
function isBattleProbe(value: Record<string, unknown>): boolean {
  return Object.keys(value).sort().join(',') === 'category,fallback,kind,map,staged'
    && BATTLE_CATEGORIES.includes(value.category as string)
    && (value.kind === 'wild' || value.kind === 'trainer')
    && typeof value.map === 'string' && /^[A-Z0-9_]{1,64}$/.test(value.map)
    && value.staged === true && value.fallback === false;
}
function isBattleReturnProbe(value: Record<string, unknown>): boolean {
  return Object.keys(value).sort().join(',') === 'castRestored,category,map,returned'
    && BATTLE_CATEGORIES.includes(value.category as string)
    && typeof value.map === 'string' && /^[A-Z0-9_]{1,64}$/.test(value.map)
    && typeof value.returned === 'boolean' && typeof value.castRestored === 'boolean';
}
const FACING = ['up', 'down', 'left', 'right'];
function isFirstPersonLogicalState(value: Record<string, unknown>): boolean {
  return typeof value.map === 'string' && /^[A-Z0-9_]{1,64}$/.test(value.map)
    && Number.isSafeInteger(value.cellX) && Number.isSafeInteger(value.cellY)
    && FACING.includes(value.facing as string) && typeof value.surfing === 'boolean';
}
function isFirstPersonProbe(value: Record<string, unknown>): boolean {
  return Object.keys(value).sort().join(',') === 'camera,captured,cellX,cellY,driving,facing,fallback,map,stableFrames,surfing'
    && isFirstPersonLogicalState(value) && value.driving === true && value.captured === true
    && value.camera === true && value.fallback === false
    && Number.isSafeInteger(value.stableFrames) && (value.stableFrames as number) >= 2 && (value.stableFrames as number) <= 600;
}
function isFirstPersonReleaseProbe(value: Record<string, unknown>): boolean {
  return Object.keys(value).sort().join(',') === 'captured,cellX,cellY,driving,facing,map,sequence,surfing'
    && isFirstPersonLogicalState(value) && typeof value.driving === 'boolean' && value.captured === false
    && Number.isSafeInteger(value.sequence) && (value.sequence as number) >= 0;
}
const FIRST_PERSON_SCENARIOS = ['outdoor', 'indoor', 'cave', 'water', 'scripted-warp', 'random-encounter'];
function isFirstPersonParityProbe(value: Record<string, unknown>): boolean {
  return Object.keys(value).sort().join(',') === 'cellX,cellY,facing,flagsSame,map,scenario,surfing,transitioning'
    && isFirstPersonLogicalState(value) && FIRST_PERSON_SCENARIOS.includes(value.scenario as string)
    && typeof value.flagsSame === 'boolean' && typeof value.transitioning === 'boolean';
}
function isWaterProbe(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value).sort();
  return keys.join(',') === 'animated,fallback,indoor,map,mode,reflection,stableFrames,surfing'
    && ['ROUTE_19', 'ROUTE_20', 'REDS_HOUSE_1F'].includes(value.map as string)
    && (value.mode === 'sky' || value.mode === 'full') && typeof value.reflection === 'boolean'
    && typeof value.animated === 'boolean' && typeof value.surfing === 'boolean' && typeof value.indoor === 'boolean'
    && typeof value.fallback === 'boolean' && Number.isSafeInteger(value.stableFrames) && (value.stableFrames as number) >= 2 && (value.stableFrames as number) <= 600;
}
function isVoxelProbe(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'buildingDepth,dayNight,depth,fallback,loads,map,menus,npcDepth,palette,stableFrames,streamCount') return false;
  return ['PALLET_TOWN', 'REDS_HOUSE_1F', 'VIRIDIAN_FOREST', 'ROCK_TUNNEL_1F'].includes(value.map as string)
    && Number.isSafeInteger(value.loads) && (value.loads as number) === 1
    && Number.isSafeInteger(value.stableFrames) && (value.stableFrames as number) >= 2 && (value.stableFrames as number) <= 600
    && typeof value.depth === 'boolean' && typeof value.npcDepth === 'boolean' && typeof value.buildingDepth === 'boolean'
    && (value.palette === 'active' || value.palette === 'default')
    && ['DAY', 'NIGHT', 'MORNING', 'EVENING'].includes(value.dayNight as string)
    && typeof value.menus === 'boolean' && Number.isSafeInteger(value.streamCount) && (value.streamCount as number) >= 1 && (value.streamCount as number) <= 1000
    && typeof value.fallback === 'boolean';
}
function isVoxelOcclusionProbe(value: Record<string, unknown>): boolean {
  return Object.keys(value).sort().join(',') === 'angle,card,hidden,packed,x,y'
    && typeof value.x === 'number' && Number.isFinite(value.x) && value.x >= 0 && value.x <= 8192
    && typeof value.y === 'number' && Number.isFinite(value.y) && value.y >= 0 && value.y <= 8192
    && typeof value.card === 'number' && Number.isFinite(value.card) && value.card >= 1 && value.card <= 1024
    && typeof value.angle === 'number' && Number.isFinite(value.angle) && value.angle >= 0 && value.angle <= Math.PI
    && typeof value.hidden === 'boolean' && typeof value.packed === 'boolean';
}
function isAudioProbe(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'effect,effectId,lowHp,lowHpActivations,musicSources,musicVolume,pcmFrames,pcmNonzero,pcmPeak,playing,queued,scene,sfxVolume,victoryActivations') return false;
  return (value.scene === 'none' || value.scene === 'title' || value.scene === 'overworld' || value.scene === 'battle' || value.scene === 'victory')
    && Number.isInteger(value.queued) && (value.queued as number) >= 0 && (value.queued as number) <= 8
    && typeof value.playing === 'boolean'
    && (value.effect === 'none' || value.effect === 'sfx' || value.effect === 'low-hp')
    && Number.isSafeInteger(value.effectId) && (value.effectId as number) >= 0 && (value.effectId as number) <= 1_000_000
    && typeof value.lowHp === 'boolean'
    && Number.isInteger(value.musicSources) && (value.musicSources as number) >= 0 && (value.musicSources as number) <= 1
    && Number.isInteger(value.pcmPeak) && (value.pcmPeak as number) >= 0 && (value.pcmPeak as number) <= 1_000_000
    && Number.isInteger(value.pcmFrames) && (value.pcmFrames as number) >= 0 && (value.pcmFrames as number) <= 65_536
    && typeof value.pcmNonzero === 'boolean'
    && Number.isSafeInteger(value.lowHpActivations) && (value.lowHpActivations as number) >= 0 && (value.lowHpActivations as number) <= 1_000_000
    && Number.isInteger(value.musicVolume) && (value.musicVolume as number) >= 0 && (value.musicVolume as number) <= 7
    && Number.isSafeInteger(value.victoryActivations) && (value.victoryActivations as number) >= 0 && (value.victoryActivations as number) <= 1_000_000
    && Number.isInteger(value.sfxVolume) && (value.sfxVolume as number) >= 0 && (value.sfxVolume as number) <= 7;
}
function isPersistenceDomain(value: unknown): boolean { return value === 'save' || value === 'options' || value === 'cache'; }
function isPersistenceSummary(value: Record<string, unknown>): boolean {
  return (value.phase === 'committed' || value.phase === 'restored' || value.phase === 'resumed') && (value.version === 'red' || value.version === 'blue' || value.version === 'yellow')
    && typeof value.slot === 'string' && /^[a-z0-9_-]{1,64}$/i.test(value.slot)
    && Number.isInteger(value.partyCount) && (value.partyCount as number) >= 0 && (value.partyCount as number) <= 6
    && typeof value.map === 'string' && /^[A-Z0-9_]{1,64}$/.test(value.map)
    && Number.isInteger(value.x) && Number.isInteger(value.y)
    && typeof value.optionsSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.optionsSha256);
}
function isPayload(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
