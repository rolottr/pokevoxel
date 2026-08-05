#!/usr/bin/env node
/** Build a disposable, scenario-only runtime without changing public/runtime. */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileHashes, publishDirectoryAtomically } from './lib/harness.mjs';

const product = resolve(dirname(new URL(import.meta.url).pathname), '..');
const publicRuntime = join(product, 'public', 'runtime');
const allowedOutputRoot = join(product, '.pokevoxel-test-data', 'runs');
const game = join(product, 'runtime', 'game');
const mod = join(product, 'runtime', 'mods', 'dramatic-shape');
const lovePackage = join(product, 'node_modules', 'love.js');
const memory = 512 * 1024 * 1024;
const expected = ['game.js', 'game.data', 'love.js', 'love.wasm', 'love.worker.js', 'runtime-manifest.json'];
const payloadFiles = expected.filter((name) => name !== 'runtime-manifest.json');
const anchor = 'function B.keypressed(key) end';
const scenarios = {
  audio: {
    marker: 'POKEVOXEL_TEST_AUDIO_SCENARIOS',
    driver: join(product, 'tests', 'runtime', 'audio-scenario-driver.lua'),
    archiveDriver: 'AudioScenario.lua',
    module: 'AudioScenario',
  },
  voxel: {
    marker: 'POKEVOXEL_TEST_VOXEL_SCENARIOS',
    driver: join(product, 'tests', 'runtime', 'voxel-scenario-driver.lua'),
    archiveDriver: 'VoxelScenario.lua',
    module: 'VoxelScenario',
  },
  water: {
    marker: 'POKEVOXEL_TEST_WATER_SCENARIOS',
    driver: join(product, 'tests', 'runtime', 'water-scenario-driver.lua'),
    archiveDriver: 'WaterScenario.lua',
    module: 'WaterScenario',
  },
  battle: {
    marker: 'POKEVOXEL_TEST_BATTLE_SCENARIOS',
    driver: join(product, 'tests', 'runtime', 'battle-scenario-driver.lua'),
    archiveDriver: 'BattleScenario.lua',
    module: 'BattleScenario',
  },
  'first-person': {
    marker: 'POKEVOXEL_TEST_FIRST_PERSON_SCENARIOS',
    driver: join(product, 'tests', 'runtime', 'first-person-scenario-driver.lua'),
    archiveDriver: 'FirstPersonScenario.lua',
    module: 'FirstPersonScenario',
  },
};

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const scenarioName = argument('--scenario') ?? 'audio';
const scenario = scenarios[scenarioName];
if (!scenario) throw new Error('test runtime scenario must be audio, voxel, water, battle, or first-person.');
const replacement = [
  `-- ${scenario.marker}: injected only into the ephemeral test archive.`,
  `local TestScenario=require("src.test.${scenario.module}")`,
  'function B.keypressed(key) return TestScenario.handle(key) end',
].join('\n');

function refuseUnsafeOutput(output) {
  mkdirSync(allowedOutputRoot, { recursive: true });
  const relation = relative(allowedOutputRoot, output);
  const segments = relation.split(/[\\/]/).filter(Boolean);
  if (!relation || relation === '..' || relation.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || segments.length < 2) {
    throw new Error('test runtime output must be a child of .pokevoxel-test-data/runs/<run-id>');
  }
  let existing = output;
  while (!existsSync(existing)) existing = dirname(existing);
  const projected = resolve(realpathSync(existing), relative(existing, output));
  const realRoot = realpathSync(allowedOutputRoot);
  const realRelation = relative(realRoot, projected);
  if (!realRelation || realRelation === '..' || realRelation.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error('test runtime output resolves outside the generated run root');
  }
}

const requestedOutput = argument('--output');
if (!requestedOutput || requestedOutput.startsWith('-')) throw new Error('Usage: node scripts/build-test-runtime.mjs --output <directory>');
const output = resolve(product, requestedOutput);
refuseUnsafeOutput(output);
for (const path of [publicRuntime, game, mod, scenario.driver, join(lovePackage, 'index.js')]) {
  if (!existsSync(path)) throw new Error(`test runtime input is missing: ${path}`);
}

// Refuse to generate a test archive from unaudited production payloads.
execFileSync(process.execPath, [join(product, 'scripts', 'audit-runtime.mjs')], { stdio: 'inherit' });
const publicHashes = fileHashes(publicRuntime, payloadFiles);
const work = mkdtempSync(join(tmpdir(), 'pokevoxel-test-runtime-'));
const stage = join(work, 'stage');
const candidate = join(work, 'runtime');
const archive = join(work, 'pokevoxel-test-audio.love');
try {
  cpSync(game, stage, { recursive: true });
  const bootstrap = join(stage, 'src', 'web', 'BrowserBootstrap.lua');
  const source = readFileSync(bootstrap, 'utf8');
  if (source.split(anchor).length !== 2) throw new Error('BrowserBootstrap keypress anchor is missing or ambiguous');
  if (source.includes('POKEVOXEL_TEST_')) throw new Error('production BrowserBootstrap unexpectedly contains a test marker');
  writeFileSync(bootstrap, source.replace(anchor, replacement));
  mkdirSync(join(stage, 'src', 'test'), { recursive: true });
  cpSync(scenario.driver, join(stage, 'src', 'test', scenario.archiveDriver));
  mkdirSync(join(stage, 'mods'), { recursive: true });
  cpSync(mod, join(stage, 'mods', 'dramatic-shape'), { recursive: true });
  execFileSync('zip', ['-X', '-q', '-r', archive, '.'], { cwd: stage, stdio: 'inherit' });
  execFileSync(process.execPath, [join(lovePackage, 'index.js'), '-t', 'Pokevoxel Yellow test audio', '-m', String(memory), archive, candidate], { stdio: 'inherit' });
  rmSync(join(candidate, 'index.html'), { force: true });
  rmSync(join(candidate, 'theme'), { recursive: true, force: true });
  // Keep the tested archive distinct, but use the exact audited adapter/WASM
  // stack used by production.
  for (const name of ['love.js', 'love.wasm', 'love.worker.js']) cpSync(join(publicRuntime, name), join(candidate, name));
  if (!readFileSync(join(candidate, 'game.js'), 'utf8').includes('game.love')) throw new Error('test game.js does not package the explicit .love archive');
  for (const name of payloadFiles) if (!existsSync(join(candidate, name))) throw new Error(`test runtime output missing ${name}`);
  const hashes = fileHashes(candidate, payloadFiles);
  writeFileSync(join(candidate, 'runtime-manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    variant: `test-${scenarioName}`,
    loveJsVersion: '11.4.1',
    initialMemoryBytes: memory,
    publicRuntime: { hashes: publicHashes },
    files: Object.fromEntries(payloadFiles.map((name) => [name, { sha256: hashes[name] }])),
  }, null, 2)}\n`);
  publishDirectoryAtomically(candidate, output);
  console.log(`Built isolated test-${scenarioName} runtime: ${output}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
