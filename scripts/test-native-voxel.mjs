#!/usr/bin/env node
/** Native Layer 6 retained-mod smoke against the exact locked source contract. */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const product = resolve(dirname(new URL(import.meta.url).pathname), '..');
const love = process.env.POKEVOXEL_NATIVE_LOVE ?? '/opt/homebrew/bin/love';
const timeoutMs = Number(process.env.POKEVOXEL_NATIVE_VOXEL_TIMEOUT_MS ?? 30_000);
const driver = join(product, 'tests', 'native', 'pinned_voxel_driver.lua');
const game = join(product, 'runtime', 'game');
const mod = join(product, 'runtime', 'mods', 'dramatic-shape');
const lock = JSON.parse(readFileSync(join(product, 'upstream-lock.json'), 'utf8'));
const pins = Object.fromEntries((lock.sources ?? []).map((source) => [source.id, source.commit]));
if (!/^[0-9a-f]{40}$/i.test(pins.gen1recomp ?? '') || !/^[0-9a-f]{40}$/i.test(pins['dramatic-shape'] ?? '')) throw new Error('native voxel gate requires both exact upstream-lock pins.');
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 5_000) throw new Error('POKEVOXEL_NATIVE_VOXEL_TIMEOUT_MS must be an integer of at least 5000.');
if (!existsSync(love)) throw new Error('native LÖVE executable is unavailable; set POKEVOXEL_NATIVE_LOVE to an 11.4-compatible executable.');
for (const path of [driver, game, mod]) if (!existsSync(path)) throw new Error(`native voxel gate input is missing: ${path}`);
// Reconciliation is the authoritative proof that this product snapshot is
// derived from the two exact pins; run it before creating a disposable native project.
execFileSync('npm', ['run', 'verify:upstream'], { cwd: product, stdio: 'inherit' });
const root = mkdtempSync(join(tmpdir(), 'pokevoxel-native-voxel-'));
let child;
try {
  cpSync(game, root, { recursive: true });
  cpSync(mod, join(root, 'mods', 'dramatic-shape'), { recursive: true });
  cpSync(driver, join(root, 'voxel_driver.lua'));
  writeFileSync(join(root, 'main.lua'), 'require("voxel_driver")\n');
  const status = await new Promise((resolveExit, rejectExit) => {
    child = spawn(love, ['.'], { cwd: root, stdio: 'inherit', detached: true });
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    }, timeoutMs);
    child.once('error', rejectExit);
    child.once('close', (code, signal) => { clearTimeout(timer); signal ? rejectExit(new Error('native voxel driver was terminated.')) : resolveExit(code ?? 1); });
  });
  if (status !== 0) process.exitCode = status;
} finally {
  if (child?.exitCode === null) { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); } }
  rmSync(root, { recursive: true, force: true });
}
