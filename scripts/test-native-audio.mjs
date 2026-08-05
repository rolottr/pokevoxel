#!/usr/bin/env node
/**
 * Opt-in native Yellow audio gate. It verifies the user-provided ROM without
 * copying it, then runs the pinned Gen1Recomp driver after its private
 * generated cache is restored or prepared. This is outside public verify.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sleep } from './lib/harness.mjs';

const product = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = resolve(product, '..');
const sourceRepo = resolve(workspace, 'gen1recomp');
const pinnedWorktree = resolve(workspace, '.omx', 'tmp', 'pokevoxel-native-audio-gen1recomp');
const nativeDriver = resolve(product, 'tests', 'native', 'pinned_yellow_audio_driver.lua');
const love = process.env.POKEVOXEL_NATIVE_LOVE ?? '/opt/homebrew/bin/love';
// Resolve before switching the child process to the sibling source checkout:
// callers commonly supply a path relative to this product directory.
const romPath = process.env.POKEVOXEL_TEST_ROM_PATH
  ? resolve(process.cwd(), process.env.POKEVOXEL_TEST_ROM_PATH)
  : undefined;
const canonicalBytes = 1_048_576;
const canonicalSha1 = 'cc7d03262ebfaf2f06772c1a480c7d9d5f4a38e1';
const identity = process.env.POKEVOXEL_NATIVE_AUDIO_IDENTITY ?? 'pokevoxel-native-audio-yellow';
const timeoutMs = Number(process.env.POKEVOXEL_NATIVE_AUDIO_TIMEOUT_MS ?? 180_000);
let activeChild;
let stopping;

function fail(message) {
  process.stderr.write(`native audio gate: ${message}\n`);
  process.exit(1);
}

async function sha1(path) {
  return new Promise((resolveDigest, reject) => {
    const hash = createHash('sha1');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolveDigest(hash.digest('hex')));
  });
}

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function signalOwnedChild(child, signal) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  try { process.kill(-child.pid, signal); }
  catch { child.kill(signal); }
}

async function stopOwnedChild(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (stopping) return stopping;
  stopping = (async () => {
    const exited = new Promise((resolveExit) => child.once('close', resolveExit));
    signalOwnedChild(child, 'SIGTERM');
    await Promise.race([exited, sleep(5_000)]);
    if (child.exitCode === null && child.signalCode === null) {
      signalOwnedChild(child, 'SIGKILL');
      await Promise.race([exited, sleep(1_000)]);
    }
  })();
  try { await stopping; }
  finally { stopping = undefined; }
}

/** Use the exact lock pin even when the adjacent developer checkout advanced. */
function resolvePinnedSource() {
  const lock = JSON.parse(readFileSync(resolve(product, 'upstream-lock.json'), 'utf8'));
  const pin = lock.sources?.find((entry) => entry.id === 'gen1recomp')?.commit;
  if (!/^[0-9a-f]{40}$/i.test(pin ?? '')) fail('upstream lock has no valid Gen1Recomp pin.');
  if (!existsSync(sourceRepo)) fail('pinned Gen1Recomp sibling checkout is unavailable.');
  try {
    if (git(sourceRepo, ['rev-parse', 'HEAD']) === pin) return sourceRepo;
    if (existsSync(pinnedWorktree)) {
      try { if (git(pinnedWorktree, ['rev-parse', 'HEAD']) === pin) return pinnedWorktree; }
      catch { /* stale directory is recreated below */ }
      try { execFileSync('git', ['-C', sourceRepo, 'worktree', 'remove', '--force', pinnedWorktree], { stdio: 'ignore' }); }
      catch { rmSync(pinnedWorktree, { recursive: true, force: true }); }
    }
    // A prior generated worktree may already be gone while its Git metadata
    // remains registered. Prune only those missing worktrees before re-adding
    // this exact locked pin.
    execFileSync('git', ['-C', sourceRepo, 'worktree', 'prune'], { stdio: 'ignore' });
    mkdirSync(resolve(workspace, '.omx', 'tmp'), { recursive: true });
    execFileSync('git', ['-C', sourceRepo, 'worktree', 'add', '--detach', pinnedWorktree, pin], { stdio: 'ignore' });
    if (git(pinnedWorktree, ['rev-parse', 'HEAD']) !== pin) fail('pinned Gen1Recomp worktree does not match upstream lock.');
    return pinnedWorktree;
  } catch {
    fail('could not materialize the pinned Gen1Recomp source.');
  }
}

function runDriver(source) {
  return new Promise((resolveExit, reject) => {
    const child = spawn(love, ['.'], {
      cwd: source,
      env: {
        ...process.env,
        // Keep this dedicated identity across runs: the initial upstream
        // import builds only its private generated cache, and later runs use
        // that cache without re-reading or duplicating the ROM.
        POKEPORT_IDENTITY: identity,
        POKEPORT_IMPORT_ROM: romPath,
        POKEPORT_VERSION: 'yellow',
        POKEPORT_DRIVER: nativeDriver,
        POKEPORT_AUDIO_EXHAUSTIVE: '1',
        POKEPORT_TOUCH: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    activeChild = child;
    const privateName = romPath.split(/[\\/]/).at(-1);
    const redact = (chunk) => String(chunk).split(romPath).join('[private ROM]')
      .split(privateName).join('[private ROM]');
    child.stdout.on('data', (chunk) => process.stdout.write(redact(chunk)));
    child.stderr.on('data', (chunk) => process.stderr.write(redact(chunk)));
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      stopOwnedChild(child).catch(reject);
    }, timeoutMs);
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      if (activeChild === child) activeChild = undefined;
      if (timedOut) reject(new Error('pinned Gen1Recomp audio driver timed out and was terminated.'));
      else if (signal) reject(new Error('pinned Gen1Recomp audio driver was terminated.'));
      else resolveExit(code ?? 1);
    });
  });
}

for (const [signal, exitCode] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
  process.once(signal, () => {
    stopOwnedChild(activeChild).finally(() => process.exit(exitCode));
  });
}

if (!romPath) fail('POKEVOXEL_TEST_ROM_PATH is required for this opt-in gate.');
if (!/^[A-Za-z0-9_-]{1,64}$/.test(identity)) fail('POKEVOXEL_NATIVE_AUDIO_IDENTITY is invalid.');
if (!existsSync(romPath) || !statSync(romPath).isFile()) fail('configured private ROM is not readable.');
if (statSync(romPath).size !== canonicalBytes) fail('configured private ROM does not have the canonical size.');
if (await sha1(romPath) !== canonicalSha1) fail('configured private ROM does not have the canonical digest.');
if (!existsSync(love)) fail('native LÖVE executable is unavailable; set POKEVOXEL_NATIVE_LOVE to a LÖVE 11.4 executable.');
const source = resolvePinnedSource();
if (!existsSync(nativeDriver)) fail('product-owned pinned Yellow audio driver is unavailable.');

if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 30_000) fail('POKEVOXEL_NATIVE_AUDIO_TIMEOUT_MS must be an integer of at least 30000.');
try {
  const status = await runDriver(source);
  if (status !== 0) process.exit(status);
} catch (error) {
  fail(error instanceof Error ? error.message : 'pinned Gen1Recomp audio driver could not start.');
}
