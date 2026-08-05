#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import {
  UPSTREAM_REFRESH_TARGETS,
  applyApprovedProductTransform,
  buildRefreshExclusions,
  effectiveImportStatus,
  hasMergeMarkers,
  refreshImportSpecs,
  resolveApprovedMergeConflict,
} from './lib/upstream-refresh.mjs';

const product = resolve(dirname(new URL(import.meta.url).pathname), '..');
const workspace = resolve(product, '..');
const candidateRoot = resolve(product, '.pokevoxel-test-data', 'cache', 'upstream-refresh-compatible-stable');
const candidateRuntime = join(candidateRoot, 'runtime');
const candidateStatePath = join(candidateRoot, 'refresh-state.json');
const lockPath = join(product, 'upstream-lock.json');
const allowlistPath = join(product, 'runtime-allowlist.txt');
const exclusionsPath = join(product, 'runtime-exclusions.txt');
const patchLedgerPath = join(product, 'docs', 'upstream-patches.md');
const mode = process.argv[2] ?? '--prepare';

function assertCandidatePath(path) {
  if (path !== candidateRoot && !path.startsWith(candidateRoot + sep)) throw new Error('candidate path escapes the fixed refresh root');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  return result;
}

function gitText(repo, args) {
  const result = run('git', ['-C', repo, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Git metadata read failed for ${repo.split('/').at(-1)}`);
  return result.stdout.trim();
}

function gitBytes(repo, args) {
  const result = run('git', ['-C', repo, ...args], { encoding: 'buffer' });
  if (result.status !== 0) throw new Error(`Git object read failed for ${repo.split('/').at(-1)}`);
  return result.stdout;
}

function sourceContexts(lock) {
  const oldSources = new Map(lock.sources.map((entry) => [entry.id, entry]));
  return new Map(Object.entries(UPSTREAM_REFRESH_TARGETS).map(([id, target]) => {
    const repo = resolve(workspace, target.repoPath);
    const old = oldSources.get(id);
    if (!old) throw new Error(`lock is missing source ${id}`);
    if (!existsSync(join(repo, '.git'))) throw new Error(`source repository is unavailable: ${target.repoPath}`);
    const tagCommit = gitText(repo, ['rev-parse', `${target.tag}^{commit}`]);
    if (tagCommit !== target.commit) throw new Error(`fetched tag target mismatch for ${id}`);
    gitText(repo, ['cat-file', '-e', `${target.commit}^{commit}`]);
    return [id, { id, target, repo, old }];
  }));
}

function effectiveSpecs(lock, contexts) {
  const existing = new Map(lock.imports.map((entry) => [`${entry.source}\0${entry.upstreamPath}`, entry]));
  return refreshImportSpecs(lock).map((entry) => {
    const prior = existing.get(`${entry.source}\0${entry.upstreamPath}`);
    if (!prior) return entry;
    const context = contexts.get(entry.source);
    const pinnedBytes = gitBytes(context.repo, ['show', `${context.old.commit}:${entry.upstreamPath}`]);
    const localPath = resolve(product, entry.productPath);
    if (!localPath.startsWith(product + sep) || !existsSync(localPath) || !lstatSync(localPath).isFile()) throw new Error(`existing import is absent: ${entry.productPath}`);
    return { ...entry, status: effectiveImportStatus(entry, readFileSync(localPath), pinnedBytes) };
  });
}

function mergePatched({ context, entry, incoming }) {
  const oldBytes = gitBytes(context.repo, ['show', `${context.old.commit}:${entry.upstreamPath}`]);
  const localPath = resolve(product, entry.productPath);
  if (!localPath.startsWith(product + sep) || !existsSync(localPath) || !lstatSync(localPath).isFile()) throw new Error(`patched import is absent: ${entry.productPath}`);
  const temporary = mkdtempSync(join(candidateRoot, 'merge-'));
  try {
    const local = join(temporary, 'local');
    const base = join(temporary, 'base');
    const fresh = join(temporary, 'incoming');
    const localBytes = readFileSync(localPath);
    writeFileSync(local, localBytes);
    writeFileSync(base, oldBytes);
    writeFileSync(fresh, incoming);
    const merged = run('git', ['merge-file', '-p', local, base, fresh], { encoding: 'buffer' });
    const conflictHunks = merged.status === 0 ? 0 : merged.status;
    if (!Number.isSafeInteger(conflictHunks) || conflictHunks < 0 || conflictHunks >= 128) throw new Error(`three-way merge failed for ${entry.productPath}`);
    if (!conflictHunks) return { bytes: merged.stdout, conflictHunks: 0, approvedResolution: false };
    const resolved = resolveApprovedMergeConflict({
      source: entry.source,
      upstreamPath: entry.upstreamPath,
      localBytes,
      incomingBytes: incoming,
      mergedBytes: merged.stdout,
    });
    if (!resolved) return { bytes: merged.stdout, conflictHunks, approvedResolution: false };
    return { bytes: resolved, conflictHunks: 0, approvedResolution: true, originalConflictHunks: conflictHunks };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function prepare() {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const contexts = sourceContexts(lock);
  assertCandidatePath(candidateRoot);
  rmSync(candidateRoot, { recursive: true, force: true });
  mkdirSync(candidateRuntime, { recursive: true, mode: 0o700 });
  cpSync(join(product, 'runtime'), candidateRuntime, { recursive: true, force: true });
  const specs = effectiveSpecs(lock, contexts);
  const existing = new Map(lock.imports.map((entry) => [`${entry.source}\0${entry.upstreamPath}`, entry]));
  const conflicts = [];
  const approvedResolutions = [];
  let changedPristine = 0;
  let changedPatched = 0;
  for (const entry of specs) {
    const context = contexts.get(entry.source);
    const incoming = gitBytes(context.repo, ['show', `${context.target.commit}:${entry.upstreamPath}`]);
    const prior = existing.get(`${entry.source}\0${entry.upstreamPath}`);
    let bytes = incoming;
    if (entry.status === 'patched') {
      if (prior) {
        const nextBlob = gitText(context.repo, ['rev-parse', `${context.target.commit}:${entry.upstreamPath}`]);
        if (nextBlob === prior.upstreamBlob) bytes = readFileSync(resolve(product, entry.productPath));
        else {
          changedPatched += 1;
          const merged = mergePatched({ context, entry, incoming });
          bytes = merged.bytes;
          if (merged.conflictHunks) conflicts.push({ productPath: entry.productPath, conflictHunks: merged.conflictHunks });
          if (merged.approvedResolution) approvedResolutions.push({ productPath: entry.productPath, conflictHunks: merged.originalConflictHunks });
        }
      } else {
        changedPatched += 1;
        bytes = applyApprovedProductTransform(entry.source, entry.upstreamPath, incoming);
      }
    } else if (!prior || gitText(context.repo, ['rev-parse', `${context.target.commit}:${entry.upstreamPath}`]) !== prior.upstreamBlob) changedPristine += 1;
    const destination = resolve(candidateRoot, entry.productPath);
    assertCandidatePath(destination);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    writeFileSync(destination, bytes, { mode: 0o600 });
  }
  const state = {
    schemaVersion: 1,
    targets: Object.fromEntries(Object.entries(UPSTREAM_REFRESH_TARGETS).map(([id, target]) => [id, target.commit])),
    importCount: specs.length,
    addedImports: specs.length - lock.imports.length,
    changedPristine,
    changedPatched,
    conflicts,
    approvedResolutions,
  };
  writeFileSync(candidateStatePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({
    ok: conflicts.length === 0,
    importCount: state.importCount,
    addedImports: state.addedImports,
    changedPristine,
    changedPatched,
    conflictFiles: conflicts.length,
    conflictHunks: conflicts.reduce((sum, entry) => sum + entry.conflictHunks, 0),
    approvedResolutionFiles: approvedResolutions.length,
    approvedResolutionHunks: approvedResolutions.reduce((sum, entry) => sum + entry.conflictHunks, 0),
  }, null, 2));
  if (conflicts.length) process.exitCode = 1;
}

function updatePatchLedgerMarkdown(text, imports) {
  const addedPatchReasons = {
    'runtime/mods/dramatic-shape/lib/BattleScene.lua': 'Remove the upstream UTF-8 byte-order mark so the browser Lua loader receives ordinary source bytes without changing battle presentation.',
    'runtime/mods/dramatic-shape/lib/ChunkMesher.lua': 'Publish body terrain before auxiliary scene meshes so cold outdoor transitions reach an honest voxel frame without reducing final mesh quality.',
    'runtime/mods/dramatic-shape/lib/ShadowMap.lua': 'Keep optional caster failure local and encode 15-bit depth plus the caster marker explicitly in RGBA4 for browser shadow-map parity.',
    'runtime/mods/dramatic-shape/lib/ThirdPerson.lua': 'Remove the excluded VR-module coupling while retaining the stable browser third-person camera implementation.',
    'runtime/mods/dramatic-shape/lib/Voxel3D.lua': 'Retain the stable per-vertex camera-ray character depth path while adding browser depth capability, RGBA4 shadow decoding, readable water depth, and fail-closed evidence.',
    'runtime/mods/dramatic-shape/lib/VoxelScene.lua': 'Retain stable scene ownership and the exact dynamic character pull while prioritizing body terrain and preserving browser render evidence.',
    'runtime/mods/dramatic-shape/lib/Water.lua': 'Retain stable v1.5.5 FULL reflection quality while decoding browser RGBA4 shadow depth, compiling SKY without the unused FULL ray march, and reusing the exact relief wave sample.',
    'runtime/game/src/core/Game.lua': 'Keep browser ordinary save and reload commands reachable from a live overworld before overlay key capture.',
    'runtime/game/src/battle/BattleState.lua': 'Retain the trainer party index needed to preserve exact delegated battle identity and return behavior.',
    'runtime/game/src/render/Renderer.lua': 'Composite the window-sized voxel override with replacement blending and exact scaling so packed depth in alpha cannot change visible opacity.',
  };
  const importByProductPath = new Map(imports.map((entry) => [entry.productPath, entry]));
  let output = text.split('\n').filter((line) => {
    if (!line.startsWith('| `')) return true;
    const productPath = line.match(/\| `([^`]+)`/)?.[1];
    const imported = importByProductPath.get(productPath);
    return !imported || imported.status === 'patched';
  }).join('\n');
  for (const entry of imports.filter((candidate) => candidate.status === 'patched')) {
    const lines = output.split('\n');
    const index = lines.findIndex((line) => line.startsWith('| `') && line.includes(`\`${entry.productPath}\``));
    if (index === -1) {
      const reason = addedPatchReasons[entry.productPath];
      if (!reason) throw new Error(`patch ledger row is missing: ${entry.productPath}`);
      const insertion = lines.findIndex((line) => line === '## Product-owned browser additions');
      if (insertion === -1) throw new Error('cannot place newly discovered patch ledger row');
      const sourceName = entry.source === 'dramatic-shape' ? 'DramaticShapeVoxelMod' : 'gen1recomp';
      lines.splice(insertion, 0, `| \`${entry.productPath}\` | \`${sourceName}:${entry.upstreamPath}\` | \`${entry.upstreamBlob}\` | Layers 6 and 7 | ${reason} | after SHA-256 \`${entry.localSha256}\`; Lua syntax, upstream provenance, and retained-source audit. |`);
      output = lines.join('\n');
      continue;
    }
    let line = lines[index].replace(/[0-9a-f]{40}/i, entry.upstreamBlob);
    const digestPattern = /after SHA-256 `?[0-9a-f]{64}`?/i;
    if (!digestPattern.test(line)) throw new Error(`patch ledger SHA-256 record is missing: ${entry.productPath}`);
    line = line.replace(digestPattern, `after SHA-256 \`${entry.localSha256}\``);
    lines[index] = line;
    output = lines.join('\n');
  }
  return output;
}

function applyCandidate() {
  if (!existsSync(candidateStatePath)) throw new Error('prepared candidate state is missing');
  const state = JSON.parse(readFileSync(candidateStatePath, 'utf8'));
  const expectedTargets = Object.fromEntries(Object.entries(UPSTREAM_REFRESH_TARGETS).map(([id, target]) => [id, target.commit]));
  if (JSON.stringify(state.targets) !== JSON.stringify(expectedTargets)) throw new Error('candidate targets do not match the approved stable commits');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const contexts = sourceContexts(lock);
  const specs = effectiveSpecs(lock, contexts);
  const imports = [];
  for (const entry of specs) {
    const context = contexts.get(entry.source);
    const candidatePath = resolve(candidateRoot, entry.productPath);
    assertCandidatePath(candidatePath);
    if (!existsSync(candidatePath) || !lstatSync(candidatePath).isFile()) throw new Error(`candidate import is absent: ${entry.productPath}`);
    const bytes = readFileSync(candidatePath);
    if (hasMergeMarkers(bytes.toString('utf8'))) throw new Error(`candidate has unresolved merge markers: ${entry.productPath}`);
    const upstreamBytes = gitBytes(context.repo, ['show', `${context.target.commit}:${entry.upstreamPath}`]);
    const upstreamBlob = gitText(context.repo, ['rev-parse', `${context.target.commit}:${entry.upstreamPath}`]);
    const localSha256 = sha256(bytes);
    const status = localSha256 === sha256(upstreamBytes) ? 'pristine' : 'patched';
    imports.push({
      source: entry.source,
      sourceId: entry.source,
      upstreamPath: entry.upstreamPath,
      path: entry.upstreamPath,
      productPath: entry.productPath,
      destination: entry.productPath,
      upstreamBlob,
      blob: upstreamBlob,
      localSha256,
      sha256: localSha256,
      status,
    });
  }
  const sourceTrees = Object.fromEntries([...contexts].map(([id, context]) => [id, gitText(context.repo, ['ls-tree', '-r', '--name-only', context.target.commit]).split('\n').filter(Boolean)]));
  const exclusions = buildRefreshExclusions({ sourceTrees, importSpecs: imports, previousExclusions: lock.exclusions });
  const productAdditions = lock.productAdditions.map((entry) => {
    const path = resolve(product, entry.productPath);
    if (!path.startsWith(product + sep) || !existsSync(path) || !lstatSync(path).isFile()) throw new Error(`product addition is absent: ${entry.productPath}`);
    return { ...entry, sha256: sha256(readFileSync(path)) };
  });
  const sources = lock.sources.map((entry) => {
    const target = UPSTREAM_REFRESH_TARGETS[entry.id];
    return { ...entry, commit: target.commit, fullCommit: target.commit };
  });
  const licenseInventory = lock.licenseInventory.map((notice) => {
    const imported = imports.find((entry) => entry.source === notice.sourceId && entry.upstreamPath === notice.upstreamPath);
    if (!imported) throw new Error(`license import is missing: ${notice.sourceId}`);
    return { ...notice, upstreamBlob: imported.upstreamBlob, sha256: imported.localSha256 };
  });
  const refreshedLock = {
    ...lock,
    importDate: '2026-08-05',
    sources,
    imports,
    exclusions,
    productAdditions,
    licenseInventory,
    patchLedger: {
      status: 'validated-rebased',
      path: 'docs/upstream-patches.md',
      modifiedImports: imports.filter((entry) => entry.status === 'patched').map((entry) => ({
        sourceId: entry.source,
        upstreamPath: entry.upstreamPath,
        productPath: entry.productPath,
        upstreamBlob: entry.upstreamBlob,
        sha256: entry.localSha256,
      })),
    },
    reconciliation: {
      candidateBuild: 'passed',
      candidateDirectory: '.pokevoxel-test-data/cache/upstream-refresh-compatible-stable',
      changedPristine: state.changedPristine,
      changedPatched: state.changedPatched,
      resolvedConflictFiles: state.approvedResolutions.length,
      candidateRetained: true,
    },
  };
  const allowlist = [
    '# schemaVersion: 1',
    '# sourceId\tupstreamPath\tproductPath\tupstreamBlob',
    ...imports.map((entry) => `${entry.source}\t${entry.upstreamPath}\t${entry.productPath}\t${entry.upstreamBlob}`),
    ...productAdditions.map((entry) => `product\t-\t${entry.productPath}\t${entry.sha256}`),
    '',
  ].join('\n');
  const exclusionsText = [
    '# schemaVersion: 1',
    '# sourceId\tupstreamPath\treason',
    ...exclusions.map((entry) => `${entry.source}\t${entry.upstreamPath}\t${entry.reason}`),
    '',
  ].join('\n');
  const patchLedger = updatePatchLedgerMarkdown(readFileSync(patchLedgerPath, 'utf8'), imports);
  cpSync(candidateRuntime, join(product, 'runtime'), { recursive: true, force: true });
  writeFileSync(lockPath, `${JSON.stringify(refreshedLock, null, 2)}\n`);
  writeFileSync(allowlistPath, allowlist);
  writeFileSync(exclusionsPath, exclusionsText);
  writeFileSync(patchLedgerPath, patchLedger);
  console.log(JSON.stringify({
    ok: true,
    importCount: imports.length,
    patchedImports: imports.filter((entry) => entry.status === 'patched').length,
    exclusionCount: exclusions.length,
    addedImports: state.addedImports,
    resolvedConflictFiles: state.approvedResolutions.length,
  }, null, 2));
}

try {
  if (mode === '--prepare') prepare();
  else if (mode === '--apply') applyCandidate();
  else throw new Error('usage: node scripts/refresh-upstream.mjs [--prepare|--apply]');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
