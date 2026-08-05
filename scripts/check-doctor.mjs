#!/usr/bin/env node
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recoverAbandonedBrowserRuns } from './lib/harness.mjs';

const product = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const goalIndex = args.indexOf('--goal');
const goal = goalIndex >= 0 ? args[goalIndex + 1] : undefined;
const failures = [];
const warnings = [];
const recovered = [];

function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function recoverOrphanedProjectPreviews() {
  let rows;
  try { rows = execFileSync('ps', ['-axo', 'pid=,ppid=,pgid=,command='], { encoding: 'utf8' }); }
  catch { warnings.push('preview-process-scan-unavailable'); return; }
  const processes = rows.split('\n').map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean).map((match) => ({ pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), command: match[4] }));
  const orphanedGroups = new Set(processes.filter((entry) => entry.ppid === 1 && entry.pid === entry.pgid).map((entry) => entry.pgid));
  const projectGroups = new Set(processes.filter((entry) => entry.command.includes(`${product}/node_modules/.bin/vite preview`) && orphanedGroups.has(entry.pgid)).map((entry) => entry.pgid));
  for (const pgid of projectGroups) {
    try { process.kill(-pgid, 'SIGTERM'); }
    catch { warnings.push('orphaned-preview-cleanup-failed'); }
  }
  if (projectGroups.size) recovered.push(`orphaned-project-previews:${projectGroups.size}`);
}

recoverOrphanedProjectPreviews();

const chromeCandidates = [
  process.env.POKEVOXEL_CHROME_BINARY,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
if (!chromeCandidates.some(existsSync)) failures.push('chrome-unavailable');

if (goalIndex >= 0 && !goal) failures.push('missing-goal');
else if (goal && !['G006', 'G007', 'G008', 'G009', 'G010'].includes(goal)) failures.push('unsupported-goal');
if (goal) {
  const rom = process.env.POKEVOXEL_TEST_ROM_PATH;
  if (!rom || !existsSync(rom)) failures.push('private-rom-unavailable');
  else if (statSync(rom).size !== 1_048_576) failures.push('private-rom-wrong-size');
}

if (goal === 'G006' || goal === 'G007' || goal === 'G009') {
  const loveCandidates = [
    process.env.POKEVOXEL_NATIVE_LOVE,
    '/Applications/love.app/Contents/MacOS/love',
    '/opt/homebrew/bin/love',
  ].filter(Boolean);
  if (!loveCandidates.some(existsSync)) failures.push('native-love-unavailable');
}

const leasePath = resolve(product, '.pokevoxel-test-data', 'browser-lane.lease.json');
if (existsSync(leasePath)) {
  try {
    const lease = JSON.parse(readFileSync(leasePath, 'utf8'));
    if (alive(Number(lease.pid))) failures.push('browser-lane-active');
    else {
      rmSync(leasePath, { force: true });
      recovered.push('stale-browser-lease');
    }
  } catch {
    failures.push('browser-lease-invalid');
  }
}

if (!existsSync(leasePath)) {
  const recoveredRuns = recoverAbandonedBrowserRuns(resolve(product, '.pokevoxel-test-data', 'runs'));
  if (recoveredRuns) recovered.push(`abandoned-browser-runs:${recoveredRuns}`);
}

const result = {
  ok: failures.length === 0,
  goal: goal ?? null,
  failures,
  warnings,
  recovered,
  next: failures.length ? 'Fix the listed preflight condition; do not run the goal gate.' : 'Run the exact focused repair command.',
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
