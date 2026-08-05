#!/usr/bin/env node
/** Verify that a disposable test runtime differs only in its .love payload. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileHashes } from './lib/harness.mjs';

const product = resolve(dirname(new URL(import.meta.url).pathname), '..');
const publicRuntime = join(product, 'public', 'runtime');
const expected = ['game.js', 'game.data', 'love.js', 'love.wasm', 'love.worker.js', 'runtime-manifest.json'];
const generic = ['love.js', 'love.wasm', 'love.worker.js'];
const payload = expected.filter((name) => name !== 'runtime-manifest.json');
const variants = {
  'test-audio': { marker: 'POKEVOXEL_TEST_AUDIO_SCENARIOS', driver: 'AudioScenario.lua', module: 'AudioScenario', checks: ['BattleState', 'key == "7"'] },
  'test-voxel': { marker: 'POKEVOXEL_TEST_VOXEL_SCENARIOS', driver: 'VoxelScenario.lua', module: 'VoxelScenario', checks: ['PALLET_TOWN', 'ROCK_TUNNEL_1F', 'takeWarp'] },
  'test-water': { marker: 'POKEVOXEL_TEST_WATER_SCENARIOS', driver: 'WaterScenario.lua', module: 'WaterScenario', checks: ['ROUTE_19', 'ROUTE_20', 'W.begin'] },
  'test-battle': { marker: 'POKEVOXEL_TEST_BATTLE_SCENARIOS', driver: 'BattleScenario.lua', module: 'BattleScenario', checks: ['OPP_RIVAL3', 'OPP_ROCKET', 'battle:finish()'] },
  'test-first-person': { marker: 'POKEVOXEL_TEST_FIRST_PERSON_SCENARIOS', driver: 'FirstPersonScenario.lua', module: 'FirstPersonScenario', checks: ['scripted-warp', 'random-encounter', 'G.overworld:onStepComplete()', 'G.overworld:takeWarp(def)'] },
};

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
const requestedRuntime = argument('--runtime');
if (!requestedRuntime || requestedRuntime.startsWith('-')) throw new Error('Usage: node scripts/audit-test-runtime.mjs --runtime <directory>');
const runtime = resolve(product, requestedRuntime);
if (!existsSync(publicRuntime) || !existsSync(runtime)) throw new Error('public/runtime and the test runtime must both exist');
const names = readdirSync(runtime).sort();
if (JSON.stringify(names) !== JSON.stringify([...expected].sort())) throw new Error('test runtime has an unexpected file set');
for (const name of expected) if (!statSync(join(runtime, name)).isFile()) throw new Error(`test runtime output is not a file: ${name}`);
const manifest = JSON.parse(readFileSync(join(runtime, 'runtime-manifest.json'), 'utf8'));
const variant = variants[manifest.variant];
if (manifest.schemaVersion !== 1 || !variant || manifest.loveJsVersion !== '11.4.1' || manifest.initialMemoryBytes !== 536870912) throw new Error('test runtime manifest is not a pinned supported test variant');
const actual = fileHashes(runtime, payload);
for (const name of payload) if (manifest.files?.[name]?.sha256 !== actual[name]) throw new Error(`test runtime manifest hash mismatch: ${name}`);
const publicHashes = fileHashes(publicRuntime, payload);
for (const name of generic) {
  if (actual[name] !== publicHashes[name] || manifest.publicRuntime?.hashes?.[name] !== publicHashes[name]) throw new Error(`test runtime generic file differs from public runtime: ${name}`);
}
const publicArchive = join(publicRuntime, 'game.data');
const testArchive = join(runtime, 'game.data');
const entries = (archive) => execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
const count = (items, name) => items.filter((item) => item === name).length;
const publicEntries = entries(publicArchive);
const testEntries = entries(testArchive);
for (const name of ['AudioScenario.lua', 'VoxelScenario.lua', 'WaterScenario.lua', 'BattleScenario.lua', 'FirstPersonScenario.lua']) {
  const entry = `src/test/${name}`;
  if (count(publicEntries, entry) !== 0) throw new Error('production archive includes a test scenario driver');
  if (count(testEntries, entry) !== (name === variant.driver ? 1 : 0)) throw new Error('test archive has an unexpected scenario driver');
}
const unzipText = (archive, entry) => execFileSync('unzip', ['-p', archive, entry], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const publicBootstrap = unzipText(publicArchive, 'src/web/BrowserBootstrap.lua');
const testBootstrap = unzipText(testArchive, 'src/web/BrowserBootstrap.lua');
const driver = unzipText(testArchive, `src/test/${variant.driver}`);
const publicChipAudio = unzipText(publicArchive, 'src/core/ChipAudio.lua');
if (publicBootstrap.includes('POKEVOXEL_TEST_') || publicBootstrap.includes('AudioScenario') || publicBootstrap.includes('VoxelScenario') || publicBootstrap.includes('WaterScenario') || publicBootstrap.includes('BattleScenario') || publicBootstrap.includes('FirstPersonScenario')) throw new Error('production bootstrap includes test-only scenario code');
if (/ForTest|test hooks \(headless\)|forceAwaitingFirstBuffer/.test(publicChipAudio)) throw new Error('production ChipAudio includes test-only hooks');
if (testBootstrap.split(variant.marker).length !== 2 || !testBootstrap.includes(`TestScenario.handle(key)`)) throw new Error('test bootstrap does not contain exactly one guarded scenario patch');
if (!driver.includes('function Driver.handle(key)') || !variant.checks.every((check) => driver.includes(check))) throw new Error('test scenario driver is incomplete');
// BrowserBootstrap's fixed /tmp import filename is already in the public
// archive. Audit test-only additions for user paths, ROM identity, or secret
// environment names instead of rejecting that public contract.
const privatePattern = /(?:pisco|pokemon\s*-\s*yellow|\/users\/|POKEVOXEL_TEST_ROM_PATH)/i;
for (const [label, value] of [['test archive source', `${testBootstrap}\n${driver}`], ['test glue', readFileSync(join(runtime, 'game.js'), 'utf8')]]) {
  if (privatePattern.test(value)) throw new Error(`${label} contains a private ROM marker`);
}
console.log(`Test runtime audit passed: ${names.length} files, isolated ${manifest.variant} driver and production-equivalent generic runtime.`);
