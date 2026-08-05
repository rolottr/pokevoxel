#!/usr/bin/env node
/**
 * Audits the allowlisted upstream snapshot. This deliberately reconciles only
 * the pinned commits; it is a provenance gate, not an upstream updater.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { digestPaths, filesInDirectory } from './lib/harness.mjs';

const product = resolve(dirname(new URL(import.meta.url).pathname), '..');
const workspace = resolve(product, '..');
const lockPath = join(product, 'upstream-lock.json');
const allowlistPath = join(product, 'runtime-allowlist.txt');
const exclusionsPath = join(product, 'runtime-exclusions.txt');
const patchLedgerPath = join(product, 'docs', 'upstream-patches.md');
const provenanceCacheRoot = join(product, '.pokevoxel-test-data', 'cache', 'verify-upstream');
const errors = [];
const warnings = [];
const fail = (message) => errors.push(message);
const warn = (message) => warnings.push(message);

function relativeProduct(path) {
  const result = relative(product, path).split(sep).join('/');
  if (result.startsWith('../') || result === '..' || isAbsolute(result)) throw new Error(`path escapes product: ${path}`);
  return result;
}
function cleanRelative(path, label) {
  if (typeof path !== 'string' || !path.trim()) throw new Error(`${label} must be a non-empty string`);
  const value = path.replaceAll('\\', '/').replace(/^\.\//, '');
  if (value.includes('\0') || value.startsWith('/') || value.split('/').includes('..')) throw new Error(`${label} is not a safe relative path: ${path}`);
  return value;
}
function sha256Bytes(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function sha256File(path) { return sha256Bytes(readFileSync(path)); }
function git(repo, args, encoding = 'utf8') {
  try { return execFileSync('git', ['-C', repo, ...args], { encoding, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 }); }
  catch (error) { throw new Error(`git -C ${repo} ${args.join(' ')} failed: ${error.stderr?.toString().trim() || error.message}`); }
}
function gitBytes(repo, args) {
  try { return execFileSync('git', ['-C', repo, ...args], { encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 }); }
  catch (error) { throw new Error(`git -C ${repo} ${args.join(' ')} failed: ${error.stderr?.toString().trim() || error.message}`); }
}
function walk(directory) {
  if (!existsSync(directory)) return [];
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walk(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}
function walkDirectories(directory) {
  if (!existsSync(directory)) return [];
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(path, ...walkDirectories(path));
  }
  return result;
}
function readLines(path) {
  if (!existsSync(path)) { fail(`missing required file: ${relativeProduct(path)}`); return []; }
  return readFileSync(path, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
}
function readAllowlist(path) {
  return readLines(path).map((line, index) => {
    const columns = line.split('\t');
    if (columns.length < 4) { fail(`runtime allowlist line ${index + 1} must contain sourceId, upstreamPath, productPath, upstreamBlob`); return undefined; }
    return { source: columns[0], upstreamPath: columns[1], productPath: columns[2], blob: columns[3] };
  }).filter(Boolean);
}
function readExclusions(path) {
  return readLines(path).map((line, index) => {
    const columns = line.split('\t');
    if (columns.length < 3) { fail(`runtime exclusions line ${index + 1} must contain sourceId, upstreamPath, reason`); return undefined; }
    return { source: columns[0], upstreamPath: columns[1], reason: columns.slice(2).join(' ') };
  }).filter(Boolean);
}
function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('**', '\u0000').replaceAll('*', '[^/]*').replaceAll('\u0000', '.*');
  return new RegExp(`^${escaped}$`);
}
function matchesAny(path, patterns) { return patterns.some((pattern) => globToRegExp(pattern).test(path)); }
function sourceName(entry) { return entry.source ?? entry.sourceId ?? entry.upstream ?? entry.repositoryId; }
function upstreamPath(entry) { return entry.upstreamPath ?? entry.path ?? entry.sourcePath; }
function destinationPath(entry) { return entry.destination ?? entry.destinationPath ?? entry.productPath ?? entry.localPath ?? entry.target; }
function upstreamBlob(entry) { return entry.upstreamBlob ?? entry.blob ?? entry.blobHash ?? entry.gitBlob; }
function localHash(entry) { return entry.sha256 ?? entry.localSha256 ?? entry.productSha256; }
function parseSources(lock) {
  const raw = lock.sources ?? lock.upstreams;
  if (!raw) throw new Error('upstream-lock.json requires a sources (or upstreams) collection');
  const records = Array.isArray(raw) ? raw : Object.entries(raw).map(([id, value]) => ({ id, ...value }));
  const result = new Map();
  for (const source of records) {
    const id = source.id ?? source.name ?? source.source;
    const commit = source.commit ?? source.pin ?? source.revision;
    if (!id || typeof id !== 'string') throw new Error('every source needs id/name');
    if (!/^[0-9a-f]{40}$/i.test(commit ?? '')) throw new Error(`source ${id} must have a full 40-character commit pin`);
    const configured = source.repoPath ?? source.worktree ?? source.localPath ?? source.localRepository ?? source.path;
    const fallback = /dramatic|voxel/i.test(id) ? 'DramaticShapeVoxelMod' : /gen1|recomp|game/i.test(id) ? 'gen1recomp' : undefined;
    const repo = configured ? resolve(workspace, configured) : fallback ? resolve(workspace, fallback) : undefined;
    if (!repo || !existsSync(repo)) throw new Error(`source ${id} has no usable local sibling worktree (set repoPath)`);
    if (!source.repository && !source.url && !source.remote) throw new Error(`source ${id} is missing repository/url provenance`);
    if (!source.license && !source.licensePath && !source.notice) throw new Error(`source ${id} is missing license/notice inventory`);
    result.set(id, { ...source, id, commit: commit.toLowerCase(), repo });
  }
  return result;
}
function provenanceInput(lock, sources) {
  const pins = [...sources.values()].map((source) => `${source.id}:${source.commit}:${git(source.repo, ['rev-parse', `${source.commit}^{commit}`]).trim()}`).sort().join('\n');
  const base = digestPaths([
    ...filesInDirectory(join(product, 'runtime'), 'runtime/'),
    { path: resolve(product, 'scripts', 'verify-upstream.mjs'), relativePath: 'scripts/verify-upstream.mjs' },
    { path: resolve(product, 'scripts', 'lib', 'harness.mjs'), relativePath: 'scripts/lib/harness.mjs' },
    { path: lockPath, relativePath: 'upstream-lock.json' },
    { path: allowlistPath, relativePath: 'runtime-allowlist.txt' },
    { path: exclusionsPath, relativePath: 'runtime-exclusions.txt' },
    { path: patchLedgerPath, relativePath: 'docs/upstream-patches.md' },
  ]);
  return createHash('sha256').update(base).update('\0').update(pins).digest('hex');
}
function cachedVerification(inputDigest) {
  if (process.env.POKEVOXEL_DISABLE_CACHE === '1') return false;
  const path = join(provenanceCacheRoot, `${inputDigest}.json`);
  try {
    const cache = JSON.parse(readFileSync(path, 'utf8'));
    return cache.schemaVersion === 1 && cache.status === 'complete' && cache.inputDigest === inputDigest
      && cache.output?.runtimeDigest === digestPaths(filesInDirectory(join(product, 'runtime'), 'runtime/'));
  } catch { return false; }
}
function writeVerificationCache(inputDigest) {
  mkdirSync(provenanceCacheRoot, { recursive: true });
  writeFileSync(join(provenanceCacheRoot, `${inputDigest}.json`), JSON.stringify({
    schemaVersion: 1, status: 'complete', inputDigest,
    output: { runtimeDigest: digestPaths(filesInDirectory(join(product, 'runtime'), 'runtime/')) },
  }, null, 2) + '\n');
}
function parsePatchLedger() {
  if (!existsSync(patchLedgerPath)) { fail('missing required patch ledger: docs/upstream-patches.md'); return new Map(); }
  const text = readFileSync(patchLedgerPath, 'utf8');
  if (!/upstream|patch/i.test(text)) fail('docs/upstream-patches.md does not identify itself as an upstream patch ledger');
  // JSON records embedded in Markdown are supported, as are rows with product path and a 40-char upstream blob.
  const records = new Map();
  for (const match of text.matchAll(/\{[^{}]*?(?:"(?:destination|productPath|path)"\s*:\s*"([^"]+)")[^{}]*?(?:"(?:upstreamBlob|blob|baseBlob)"\s*:\s*"([0-9a-f]{40})")[^{}]*?\}/gi)) records.set(match[1], match[2].toLowerCase());
  for (const line of text.split(/\r?\n/)) {
    const blobs = line.match(/[0-9a-f]{40}/ig);
    const paths = line.match(/(?:runtime\/(?:game|mods\/dramatic-shape)\/)[A-Za-z0-9._/@+\- ]+/g);
    if (blobs?.length && paths?.length) records.set(paths[0].trim(), blobs[0].toLowerCase());
  }
  return records;
}
function main() {
  if (!existsSync(lockPath)) throw new Error('missing required file: upstream-lock.json');
  let lock;
  try { lock = JSON.parse(readFileSync(lockPath, 'utf8')); } catch (error) { throw new Error(`upstream-lock.json is invalid JSON: ${error.message}`); }
  if (!Number.isInteger(lock.schemaVersion) || lock.schemaVersion < 1) throw new Error('upstream-lock.json requires an integer schemaVersion >= 1');
  const sources = parseSources(lock);
  const inputDigest = provenanceInput(lock, sources);
  if (cachedVerification(inputDigest)) {
    console.log(`Upstream verification cache hit: ${inputDigest.slice(0, 12)}.`);
    return;
  }
  const imports = lock.imports ?? lock.files ?? lock.importedFiles;
  if (!Array.isArray(imports) || !imports.length) throw new Error('upstream-lock.json requires a non-empty imports/files array');
  const exclusions = lock.exclusions ?? lock.excludedPaths;
  if (!Array.isArray(exclusions) || !exclusions.length) throw new Error('upstream-lock.json requires a non-empty exclusions/excludedPaths array');
  const licenseInventory = lock.licenseInventory ?? lock.licenses ?? lock.notices;
  if (!licenseInventory || (Array.isArray(licenseInventory) && !licenseInventory.length)) throw new Error('upstream-lock.json requires a non-empty licenseInventory/licenses/notices');
  const allowlistEntries = readAllowlist(allowlistPath);
  const exclusionsFile = readExclusions(exclusionsPath);
  const allowlines = allowlistEntries.map((entry) => entry.productPath);
  if (!allowlines.length) fail('runtime-allowlist.txt must contain at least one allowed runtime path');
  if (!exclusionsFile.length) fail('runtime-exclusions.txt must contain explicit exclusions');
  const productAdditions = lock.productAdditions ?? [];
  if (!Array.isArray(productAdditions)) fail('productAdditions must be an array');
  const allowlistByDestination = new Map(allowlistEntries.map((entry) => [entry.productPath, entry]));
  const patchLedger = parsePatchLedger();
  // The lock is a complete classification of each pinned source tree, not a partial
  // copy list. Validate this before reading product files so omissions are actionable.
  const importedBySourcePath = new Map();
  const excludedBySourcePath = new Map();
  const sourceKey = (id, path) => `${id}\u0000${path}`;
  for (const entry of imports) {
    try {
      const id = sourceName(entry);
      if (!sources.has(id)) throw new Error(`import refers to unknown source: ${String(id)}`);
      const path = cleanRelative(upstreamPath(entry), `import ${id} upstream path`);
      const key = sourceKey(id, path);
      if (importedBySourcePath.has(key)) throw new Error(`duplicate import classification: ${id}:${path}`);
      importedBySourcePath.set(key, entry);
    } catch (error) { fail(error.message); }
  }
  for (const entry of exclusions) {
    try {
      const id = sourceName(entry);
      if (!sources.has(id)) throw new Error(`exclusion refers to unknown source: ${String(id)}`);
      const path = cleanRelative(upstreamPath(entry), `exclusion ${id} upstream path`);
      const key = sourceKey(id, path);
      if (excludedBySourcePath.has(key)) throw new Error(`duplicate exclusion classification: ${id}:${path}`);
      if (importedBySourcePath.has(key)) throw new Error(`import/exclusion overlap: ${id}:${path}`);
      excludedBySourcePath.set(key, entry);
    } catch (error) { fail(error.message); }
  }
  for (const source of sources.values()) {
    let treePaths;
    try { treePaths = git(source.repo, ['ls-tree', '-r', '--name-only', source.commit]).split(/\r?\n/).filter(Boolean); }
    catch (error) { fail(`cannot list pinned tree for ${source.id}: ${error.message}`); continue; }
    for (const path of treePaths) {
      const key = sourceKey(source.id, path);
      const classifications = Number(importedBySourcePath.has(key)) + Number(excludedBySourcePath.has(key));
      if (classifications !== 1) fail(`pinned tree path is not classified exactly once: ${source.id}:${path}`);
    }
  }
  if (!Array.isArray(licenseInventory)) fail('licenseInventory/licenses/notices must be an array');
  else {
    const licensedSources = new Set();
    for (const notice of licenseInventory) {
      try {
        const id = sourceName(notice);
        if (!sources.has(id)) throw new Error(`license inventory refers to unknown source: ${String(id)}`);
        const destination = cleanRelative(destinationPath(notice), `license notice ${id} product path`);
        const sourcePath = cleanRelative(upstreamPath(notice), `license notice ${id} upstream path`);
        const imported = importedBySourcePath.get(sourceKey(id, sourcePath));
        if (!imported || destinationPath(imported) !== destination) throw new Error(`license notice is not a real imported file: ${id}:${destination}`);
        if (String(upstreamBlob(notice)).toLowerCase() !== String(upstreamBlob(imported)).toLowerCase()) throw new Error(`license notice upstream blob does not match import: ${id}:${destination}`);
        if (String(localHash(notice)).toLowerCase() !== String(localHash(imported)).toLowerCase()) throw new Error(`license notice SHA-256 does not match import: ${id}:${destination}`);
        const local = resolve(product, destination);
        if (!existsSync(local) || sha256File(local) !== String(localHash(notice)).toLowerCase()) throw new Error(`license notice is absent or hash-mismatched: ${destination}`);
        licensedSources.add(id);
      } catch (error) { fail(error.message); }
    }
    for (const id of sources.keys()) if (!licensedSources.has(id)) fail(`source ${id} has no license inventory record`);
  }
  const seenDestinations = new Set();
  const expectedRuntime = new Set();
  const reconciliationRoot = existsSync(join(workspace, '.omx', 'tmp')) ? join(workspace, '.omx', 'tmp') : tmpdir();
  const candidate = mkdtempSync(join(reconciliationRoot, 'pokevoxel-reconcile-'));
  try {
    for (const entry of imports) {
      if (!entry || typeof entry !== 'object') { fail('import record must be an object'); continue; }
      try {
        const id = sourceName(entry);
        const source = sources.get(id);
        if (!source) throw new Error(`unknown source ${String(id)}`);
        const sourcePath = cleanRelative(upstreamPath(entry), `import ${id} upstream path`);
        const destination = cleanRelative(destinationPath(entry), `import ${id}:${sourcePath} destination`);
        if (!destination.startsWith('runtime/')) throw new Error(`destination must be under runtime/: ${destination}`);
        if (seenDestinations.has(destination)) throw new Error(`duplicate imported destination: ${destination}`);
        seenDestinations.add(destination); expectedRuntime.add(destination);
        const declaredBlob = upstreamBlob(entry);
        if (!/^[0-9a-f]{40}$/i.test(declaredBlob ?? '')) throw new Error(`import ${destination} is missing a 40-character upstream blob`);
        const actualBlob = git(source.repo, ['rev-parse', `${source.commit}:${sourcePath}`]).trim().toLowerCase();
        if (actualBlob !== declaredBlob.toLowerCase()) throw new Error(`import ${destination} upstream blob mismatch: lock=${declaredBlob}, pin=${actualBlob}`);
        const upstreamBytes = gitBytes(source.repo, ['show', `${source.commit}:${sourcePath}`]);
        const candidatePath = resolve(candidate, destination);
        if (!candidatePath.startsWith(candidate + sep)) throw new Error(`candidate path escapes reconciliation directory: ${destination}`);
        mkdirSync(dirname(candidatePath), { recursive: true });
        writeFileSync(candidatePath, upstreamBytes);
        const local = resolve(product, destination);
        if (!existsSync(local) || !lstatSync(local).isFile()) throw new Error(`imported runtime file is absent: ${destination}`);
        const localDigest = sha256File(local);
        if (localHash(entry) && localDigest !== String(localHash(entry)).toLowerCase()) throw new Error(`import ${destination} local SHA-256 does not match lock`);
        const upstreamDigest = sha256Bytes(upstreamBytes);
        const ledgerBlob = patchLedger.get(destination);
        if (localDigest !== upstreamDigest && ledgerBlob !== actualBlob) throw new Error(`modified import lacks patch-ledger coverage: ${destination} (base ${actualBlob})`);
        if (ledgerBlob && ledgerBlob !== actualBlob) throw new Error(`patch ledger base blob is stale for ${destination}: ledger=${ledgerBlob}, pin=${actualBlob}`);
        const allowlistEntry = allowlistByDestination.get(destination);
        if (!allowlistEntry) throw new Error(`import is absent from runtime allowlist: ${destination}`);
        if (allowlistEntry.source !== id || allowlistEntry.upstreamPath !== sourcePath || allowlistEntry.blob.toLowerCase() !== actualBlob) throw new Error(`allowlist provenance does not match lock for ${destination}`);
      } catch (error) { fail(error.message); }
    }
    for (const addition of productAdditions) {
      const destination = cleanRelative(destinationPath(addition), 'product addition destination');
      const local = resolve(product, destination);
      const declared = localHash(addition);
      if (!destination.startsWith('runtime/') || !existsSync(local) || !declared || sha256File(local) !== String(declared).toLowerCase()) fail(`invalid product-owned addition: ${destination}`);
      expectedRuntime.add(destination);
      const allowed = allowlistByDestination.get(destination);
      if (!allowed || allowed.source !== 'product' || allowed.blob.toLowerCase() !== String(declared).toLowerCase()) fail(`product addition is absent from allowlist: ${destination}`);
    }
    if (allowlistEntries.length !== imports.length + productAdditions.length) fail(`runtime allowlist entry count (${allowlistEntries.length}) differs from imports/additions (${imports.length + productAdditions.length})`);
    for (const entry of allowlistEntries) if (!expectedRuntime.has(entry.productPath)) fail(`runtime allowlist entry is not a lock import/addition: ${entry.productPath}`);
    if (exclusionsFile.length !== exclusions.length) fail(`runtime exclusions entry count (${exclusionsFile.length}) differs from lock exclusions (${exclusions.length})`);
    for (const entry of exclusionsFile) if (!exclusions.some((locked) => sourceName(locked) === entry.source && upstreamPath(locked) === entry.upstreamPath)) fail(`runtime exclusions entry is not a lock exclusion: ${entry.source}:${entry.upstreamPath}`);
    for (const path of walk(join(product, 'runtime'))) {
      const rel = relativeProduct(path);
      if (!expectedRuntime.has(rel)) fail(`runtime file is not an imported allowlisted provenance entry: ${rel}`);
      if (!matchesAny(rel, allowlines)) fail(`runtime file is outside runtime allowlist: ${rel}`);
    }
    for (const exclusion of exclusions) {
      const value = typeof exclusion === 'string' ? exclusion : exclusion.upstreamPath ?? exclusion.path ?? exclusion.pattern;
      if (!value) { fail('exclusion record requires path or pattern'); continue; }
      const normalized = String(value).replace(/^\.\//, '');
      if (!exclusionsFile.some((line) => line.upstreamPath === normalized)) fail(`lock exclusion is not documented in runtime-exclusions.txt: ${normalized}`);
      if (normalized.startsWith('runtime/') && walk(join(product, 'runtime')).some((path) => matchesAny(relativeProduct(path), [normalized]))) fail(`excluded path is present in runtime: ${normalized}`);
    }
    for (const required of ['VR', 'Horde', 'Discord', 'OpenXR', 'updater']) {
      if (!exclusionsFile.some((line) => `${line.upstreamPath} ${line.reason}`.toLowerCase().includes(required.toLowerCase()))) fail(`runtime-exclusions.txt must explicitly cover ${required}`);
    }
    const requiredRetained = [
      'runtime/game/src/core/Game.lua',
      'runtime/game/src/import/CacheFs.lua',
      'runtime/mods/dramatic-shape/lib/FirstPerson.lua',
      'runtime/mods/dramatic-shape/lib/FreeMove.lua',
      'runtime/mods/dramatic-shape/lib/Mat4.lua',
      'runtime/mods/dramatic-shape/lib/VoxelScene.lua',
    ];
    for (const retained of requiredRetained) {
      if (!expectedRuntime.has(retained) || !existsSync(resolve(product, retained))) fail(`required retained browser runtime file is absent: ${retained}`);
    }
    const rootGit = resolve(product, '.git');
    for (const directory of walkDirectories(product)) if (basename(directory) === '.git' && resolve(directory) !== rootGit) fail(`nested .git directory is forbidden: ${relativeProduct(directory)}`);
    for (const path of walk(join(product, 'runtime'))) {
      const rel = relativeProduct(path);
      if (/\.(?:gb|gbc|gba|nds|sav|srm|love)$/i.test(rel)) fail(`private ROM/save or generated .love artifact is forbidden: ${rel}`);
      if (/(?:^|\/)(?:cache|generated|screenshots?|traces?|idbfs)(?:\/|$)/i.test(rel)) fail(`generated/private runtime material is forbidden: ${rel}`);
      if (/(?:^|\/)(?:pisco|vr(?:xr|gl|rig)?|horde(?:exitprompt|gameover|gun|hud|mobs|sfx)?|discordpresence|saveeditor|nativepicker|updater)(?:\.lua|\/|$)/i.test(rel)) fail(`excluded desktop/demo module or asset is present: ${rel}`);
      const text = readFileSync(path).toString('utf8');
      // Pristine retained files may mention desktop modules in comments or dead upstream branches. Product patches remove executable use later.
      if (/\bpisco\b/i.test(text)) fail(`Pisco content is forbidden in runtime source: ${rel}`);
      if (/(?:\/Users\/|[A-Z]:\\Users\\|\/home\/[^/]+\/)/.test(text)) fail(`local absolute path in ${rel}`);
    }
    // Candidate must be byte-identical to each unpatched import. Patched files are listed as reconciliation conflicts.
    for (const destination of expectedRuntime) {
      if (productAdditions.some((entry) => destinationPath(entry) === destination)) continue;
      const local = resolve(product, destination); const regenerated = resolve(candidate, destination);
      if (!existsSync(regenerated)) { fail(`dry-run candidate missing: ${destination}`); continue; }
      if (sha256File(local) !== sha256File(regenerated) && !patchLedger.has(destination)) fail(`dry-run reconciliation found unexplained pristine drift: ${destination}`);
    }
  } finally { rmSync(candidate, { recursive: true, force: true }); }
  if (warnings.length) for (const warning of warnings) console.warn(`WARN  ${warning}`);
  if (errors.length) {
    console.error(`Upstream verification failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):`);
    for (const error of errors) console.error(` - ${error}`);
    process.exitCode = 1;
  } else {
    writeVerificationCache(inputDigest);
    console.log(`Upstream verification passed: ${imports.length} imported files, ${sources.size} pinned sources, same-pin dry-run cleaned up.`);
  }
}
try { main(); } catch (error) { console.error(`Upstream verification failed: ${error.message}`); process.exitCode = 1; }
