#!/usr/bin/env node
/** Build and cache the public, ROM-free love.js payload from allowlisted source only. */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { zipSync } from 'fflate';
import { acquireLease, copyDirectory, digestPaths, fileHashes, filesInDirectory, publishDirectoryAtomically, releaseLease, validatesArtifacts } from './lib/harness.mjs';

const product = resolve(dirname(new URL(import.meta.url).pathname), '..');
const runtime = join(product, 'runtime');
const game = join(runtime, 'game');
const mods = [
  { id: 'dramatic-shape', path: join(runtime, 'mods', 'dramatic-shape') },
  { id: 'pokeaudio-hd', path: join(runtime, 'mods', 'pokeaudio-hd') },
];
const output = join(product, 'public', 'runtime');
const lovePackage = join(product, 'node_modules', 'love.js');
const stockDirectory = join(lovePackage, 'src', 'release');
const cacheRoot = join(product, '.pokevoxel-test-data', 'cache', 'runtime');
const memory = 512 * 1024 * 1024;
const expected = ['game.js', 'game.data', 'love.js', 'love.wasm', 'love.worker.js', 'runtime-manifest.json'];
const payloadFiles = expected.filter((file) => file !== 'runtime-manifest.json');
const stock = {
  'love.js': 'eb20a4d947dc99e08e906e946c5b783e3f542f60a3107167a1e92d07bfe531d4',
  'love.wasm': 'f9302c4034de06ead29f6526cc0c61dc73f7fdf7368edb3f568332af587cacf2',
  'love.worker.js': '720c1d0160a6fc61c2a7deda7462310eaacdbad5cd559aba46976dfb7dcd4627',
};
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const archiveDirectory = (source, destination) => {
  const fixedTime = new Date(1980, 0, 1, 0, 0, 0);
  const entries = Object.fromEntries(filesInDirectory(source)
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    .map(({ path, relativePath }) => [relativePath, [new Uint8Array(readFileSync(path)), { mtime: fixedTime }]]));
  writeFileSync(destination, zipSync(entries, { level: 9 }));
};

if (!existsSync(game) || mods.some((mod) => !existsSync(mod.path))) throw new Error('runtime source is incomplete; expected game and built-in mod trees');
for (const mod of mods) for (const required of ['manifest.json', 'main.lua']) if (!existsSync(join(mod.path, required))) throw new Error(`built-in ${mod.id} source is incomplete; missing ${required}`);
for (const [name, expectedHash] of Object.entries(stock)) {
  const path = join(stockDirectory, name);
  if (!existsSync(path) || sha(path) !== expectedHash) throw new Error(`refusing unknown love.js@11.4.1 ${name}; run npm ci`);
}

const inputDigest = digestPaths([
  ...filesInDirectory(game, 'runtime/game/'),
  ...mods.flatMap((mod) => filesInDirectory(mod.path, `runtime/mods/${mod.id}/`)),
  { path: resolve(product, 'scripts', 'build-runtime.mjs'), relativePath: 'scripts/build-runtime.mjs' },
  { path: resolve(product, 'scripts', 'lib', 'harness.mjs'), relativePath: 'scripts/lib/harness.mjs' },
  { path: resolve(product, 'scripts', 'patch-love-runtime.mjs'), relativePath: 'scripts/patch-love-runtime.mjs' },
  { path: join(lovePackage, 'index.js'), relativePath: 'love.js/index.js' },
  { path: join(lovePackage, 'package.json'), relativePath: 'love.js/package.json' },
  ...Object.keys(stock).map((name) => ({ path: join(stockDirectory, name), relativePath: `love.js/${name}` })),
]);
const cacheDirectory = join(cacheRoot, inputDigest);
const cacheManifestPath = join(cacheDirectory, 'manifest.json');
const cacheOutput = join(cacheDirectory, 'output');

function readValidCache() {
  if (process.env.POKEVOXEL_DISABLE_CACHE === '1' || !existsSync(cacheManifestPath)) return null;
  try {
    const manifest = JSON.parse(readFileSync(cacheManifestPath, 'utf8'));
    return manifest.schemaVersion === 1 && manifest.status === 'complete' && manifest.inputDigest === inputDigest
      && manifest.output?.hashes && validatesArtifacts(cacheOutput, manifest.output.hashes) ? manifest : null;
  } catch { return null; }
}

const lease = await acquireLease(join(cacheRoot, 'runtime-build.lease.json'));
try {
  const cached = readValidCache();
  if (cached) {
    const work = mkdtempSync(join(tmpdir(), 'pokevoxel-runtime-cache-'));
    try {
      const candidate = join(work, 'runtime');
      copyDirectory(cacheOutput, candidate);
      publishDirectoryAtomically(candidate, output);
    } finally { rmSync(work, { recursive: true, force: true }); }
    console.log(`Runtime build cache hit: ${inputDigest.slice(0, 12)} (${expected.length} public files).`);
  } else {
    const work = mkdtempSync(join(tmpdir(), 'pokevoxel-runtime-'));
    const stage = join(work, 'stage');
    const candidate = join(work, 'runtime');
    const loveArchive = join(work, 'pokevoxel.love');
    try {
      mkdirSync(stage, { recursive: true });
      cpSync(game, stage, { recursive: true });
      mkdirSync(join(stage, 'mods'), { recursive: true });
      for (const mod of mods) cpSync(mod.path, join(stage, 'mods', mod.id), { recursive: true });
      archiveDirectory(stage, loveArchive);
      execFileSync(process.execPath, [join(lovePackage, 'index.js'), '-t', 'Pokevoxel', '-m', String(memory), loveArchive, candidate], { stdio: 'inherit' });
      rmSync(join(candidate, 'index.html'), { force: true });
      rmSync(join(candidate, 'theme'), { recursive: true, force: true });
      execFileSync(process.execPath, [join(product, 'scripts', 'patch-love-runtime.mjs'), join(stockDirectory, 'love.js'), join(candidate, 'love.js'), join(stockDirectory, 'love.worker.js'), join(candidate, 'love.worker.js')], { stdio: 'inherit' });
      if (!readFileSync(join(candidate, 'game.js'), 'utf8').includes('game.love')) throw new Error('generated game.js does not package the explicit .love archive');
      for (const file of payloadFiles) if (!existsSync(join(candidate, file))) throw new Error(`runtime output missing ${file}`);
      execFileSync(process.execPath, ['--check', join(candidate, 'love.js')]);
      execFileSync(process.execPath, ['--check', join(candidate, 'love.worker.js')]);
      const hashes = fileHashes(candidate, payloadFiles);
      writeFileSync(join(candidate, 'runtime-manifest.json'), JSON.stringify({ schemaVersion: 1, loveJsVersion: '11.4.1', initialMemoryBytes: memory, stock: { loveJsSha256: stock['love.js'], loveWasmSha256: stock['love.wasm'], loveWorkerSha256: stock['love.worker.js'] }, files: Object.fromEntries(payloadFiles.map((file) => [file, { sha256: hashes[file] }])) }, null, 2) + '\n');
      const finalHashes = fileHashes(candidate, expected);
      const cacheWork = mkdtempSync(join(cacheRoot, '.runtime-'));
      try {
        const cacheCandidate = join(cacheWork, 'entry');
        mkdirSync(cacheCandidate, { recursive: true });
        copyDirectory(candidate, join(cacheCandidate, 'output'));
        writeFileSync(join(cacheCandidate, 'manifest.json'), JSON.stringify({ schemaVersion: 1, status: 'complete', inputDigest, output: { hashes: finalHashes } }, null, 2) + '\n');
        rmSync(cacheDirectory, { recursive: true, force: true });
        mkdirSync(cacheRoot, { recursive: true });
        execFileSync('mv', [cacheCandidate, cacheDirectory]);
      } finally { rmSync(cacheWork, { recursive: true, force: true }); }
      publishDirectoryAtomically(candidate, output);
    } finally { rmSync(work, { recursive: true, force: true }); }
    console.log(`Built ROM-free love.js runtime (${memory} byte initial memory) with ${expected.length} public files; cache ${inputDigest.slice(0, 12)}.`);
  }
} finally { releaseLease(lease); }
