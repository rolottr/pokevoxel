#!/usr/bin/env node
/** Audit generated runtime files and the explicit .love archive without unpacking it. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const product = resolve(dirname(new URL(import.meta.url).pathname), '..');
const output = join(product, 'public', 'runtime');
const expected = new Set(['game.js', 'game.data', 'love.js', 'love.wasm', 'love.worker.js', 'runtime-manifest.json']);
if (!existsSync(output)) throw new Error('public/runtime is missing; run npm run build:runtime first.');
const files = readdirSync(output);
for (const file of files) if (!expected.has(file)) throw new Error(`unexpected public runtime output: ${file}`);
for (const file of expected) if (!existsSync(join(output, file)) || !statSync(join(output, file)).isFile()) throw new Error(`missing runtime output: ${file}`);
const manifest = JSON.parse(readFileSync(join(output, 'runtime-manifest.json'), 'utf8'));
if (manifest.loveJsVersion !== '11.4.1' || manifest.initialMemoryBytes !== 536870912) throw new Error('runtime manifest does not pin love.js@11.4.1 with 512 MiB memory');
if (manifest.stock?.loveJsSha256 !== 'eb20a4d947dc99e08e906e946c5b783e3f542f60a3107167a1e92d07bfe531d4' || manifest.stock?.loveWasmSha256 !== 'f9302c4034de06ead29f6526cc0c61dc73f7fdf7368edb3f568332af587cacf2' || manifest.stock?.loveWorkerSha256 !== '720c1d0160a6fc61c2a7deda7462310eaacdbad5cd559aba46976dfb7dcd4627') throw new Error('runtime manifest has an unexpected stock runtime fingerprint');
const love = readFileSync(join(output, 'love.js'), 'utf8');
for (const token of ['pokevoxelAdapter', 'POKEVOXEL_ROM_STAGE', 'pokevoxelStagedRom', '/tmp/pokevoxel-sync-', '/tmp/pokevoxel-focus-', '/tmp/pokevoxel-audio-renderer', 'POKEVOXEL_AUDIO_RENDERER_INVALID', 'POKEVOXEL_RUNTIME_DISPOSED']) if (!love.includes(token)) throw new Error(`patched love.js is missing required pre-run staging anchor: ${token}`);
if (!love.includes('majorVersion:2') || love.includes('majorVersion:1')) throw new Error('patched love.js does not require a WebGL2 context');
for (const token of ['pokevoxelBindTransport', 'pokevoxelTransportReady', 'pokevoxelPump', 'pokevoxel-probe', 'pokevoxelCommandSlot', 'POKEVOXEL_TRANSPORT_']) if (love.includes(token)) throw new Error(`patched love.js retains obsolete transport machinery: ${token}`);
const game = readFileSync(join(output, 'game.js'), 'utf8');
if (!game.includes('game.love')) throw new Error('game.js does not package a .love archive');
const archive = join(output, 'game.data');
const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
const allowed = new Set();
const collect = (root, prefix) => {
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else allowed.add(`${prefix}${relative(root, path).replaceAll('\\', '/')}`);
    }
  };
  walk(root);
};
collect(join(product, 'runtime', 'game'), '');
collect(join(product, 'runtime', 'mods', 'dramatic-shape'), 'mods/dramatic-shape/');
collect(join(product, 'runtime', 'mods', 'pokeaudio-hd'), 'mods/pokeaudio-hd/');
const count = (name) => entries.filter((entry) => entry === name).length;
if (count('mods/dramatic-shape/manifest.json') !== 1 || count('mods/dramatic-shape/main.lua') !== 1) throw new Error('the .love must contain exactly one built-in dramatic-shape manifest and main.lua');
if (count('mods/pokeaudio-hd/manifest.json') !== 1 || count('mods/pokeaudio-hd/main.lua') !== 1) throw new Error('the .love must contain exactly one built-in pokeaudio-hd manifest and main.lua');
for (const entry of entries) {
  if (entry.startsWith('mods/') && entry !== 'mods/' && !entry.startsWith('mods/dramatic-shape/') && !entry.startsWith('mods/pokeaudio-hd/')) throw new Error(`.love contains an unexpected mod root: ${entry}`);
  if (entry.endsWith('/')) continue;
  if (!allowed.has(entry)) throw new Error(`.love contains a non-allowlisted path: ${entry}`);
  if (/\.(?:gb|gbc|gba|sav|srm)$/i.test(entry)) throw new Error(`.love contains a prohibited game-data artifact: ${entry}`);
  if (/(?:^|\/)(?:tests?|tools?|docs?)(?:\/|$)|(?:vr|horde|pisco)/i.test(entry)) throw new Error(`.love contains an excluded product path: ${entry}`);
}
const archiveText = execFileSync('unzip', ['-p', archive], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 }).toString('latin1');
if (/(?:pisco|pokemon\s*-\s*yellow|\/users\/)/i.test(archiveText)) throw new Error('.love contents contain a forbidden private marker');
// The product fork deletes excluded integrations rather than hiding them
// behind a browser branch. Check names and executable/archive content so a
// future allowlist or packaging change cannot resurrect them.
const forbiddenVoxel = /(?:\b(?:vr|openxr|horde|pisco)\b|lib\/(?:VR|Horde))/i;
if (entries.some((entry) => forbiddenVoxel.test(entry))) throw new Error('.love contains a removed VR/Horde/Pisco integration path');
if (forbiddenVoxel.test(archiveText)) throw new Error('.love contains a removed VR/Horde/Pisco integration symbol');
// The stock wasm has upstream compiler paths and extension strings. Audit the
// product-owned archive and JS glue, not immutable upstream binary internals.
const worker = readFileSync(join(output, 'love.worker.js'), 'utf8');
for (const token of ['pokevoxel-probe', 'pokevoxelPump', 'pokevoxelBindTransport']) if (worker.includes(token)) throw new Error(`worker retains obsolete transport machinery: ${token}`);
for (const token of ['__ATMAIN__', 'pokevoxelStagedRom', 'pokevoxelWriteStagedRom']) if (!love.includes(token)) throw new Error(`patched love.js is missing pre-main staging anchor: ${token}`);
const glue = [readFileSync(join(output, 'game.js'), 'utf8'), love, worker].join('\n');
if (/(?:pokemon\s*-\s*yellow|pisco|\/users\/)/i.test(glue)) throw new Error('runtime JS glue contains a forbidden private marker');
if (/(?:\b(?:openxr|horde|pisco)\b)/i.test(glue)) throw new Error('runtime JS glue contains a removed voxel integration marker');
console.log(`Runtime audit passed: ${files.length} files, patched stock sha256 ${manifest.stock.loveJsSha256}.`);
