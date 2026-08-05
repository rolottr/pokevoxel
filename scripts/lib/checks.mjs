import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const forbidden = /(?:^|\/)(?:\.pokevoxel-test-data|dist|public\/runtime|runtime-cache|cache|node_modules|\.git)(?:\/|$)|\.(?:gb|gbc|gba|sav|srm|love)$/i;
const directoryRoots = [['src/', 'source'], ['runtime/', 'runtime'], ['scripts/', 'scripts'], ['tests/', 'tests'], ['docs/', 'docs']];
const exactRoots = new Map([['package.json', 'config'], ['package-lock.json', 'config'], ['tsconfig.json', 'config'], ['vite.config.ts', 'config'], ['playwright.config.ts', 'config'], ['vitest.config.ts', 'config'], ['upstream-lock.json', 'config'], ['runtime-allowlist.txt', 'config'], ['runtime-exclusions.txt', 'config'], ['README.md', 'docs'], ['index.html', 'source'], ['.gitignore', 'config']]);
const browserScripts = {
  'audio-browser': ['--private-audio', '--audio-scenarios'],
  'voxel-browser': ['--private-audio', '--voxel-scenarios'],
  'water-browser': ['--private-audio', '--water-scenarios'],
  'battle-browser': ['--private-audio', '--battle-scenarios'],
  'first-person-browser': ['--private-audio', '--first-person-scenarios'],
};

export function classifyChangedPaths(paths) {
  if (!paths?.length) throw new Error('edit requires one or more --changed repo-relative-path values.');
  return paths.map((path) => {
    if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..') || forbidden.test(path)) throw new Error(`unsafe changed path: ${path}`);
    const category = exactRoots.get(path) ?? directoryRoots.find(([prefix]) => path.startsWith(prefix))?.[1];
    if (!category) throw new Error(`unmapped changed path: ${path}`);
    return { path, category };
  });
}

const defaultRelevantPaths = ['src/', 'runtime/', 'scripts/', 'tests/', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'playwright.config.ts', 'vitest.config.ts'];
const stage = (name, command, args = [], env = {}, relevantPaths = defaultRelevantPaths) => ({ name, command, args, env, relevantPaths });
const fresh = { POKEVOXEL_DISABLE_CACHE: '1' };
const prebuilt = { POKEVOXEL_SKIP_CLIENT_BUILD: '1' };

export function planChecks({ tier, changed = [], goal }) {
  if (!['edit', 'goal', 'merge', 'full'].includes(tier)) throw new Error(`unknown check tier: ${tier}`);
  if (tier === 'edit') {
    const classified = classifyChangedPaths(changed);
    const syntax = classified
      .filter((entry) => entry.category === 'scripts' && entry.path.endsWith('.mjs'))
      .map((entry) => stage(`syntax:${entry.path}`, process.execPath, ['--check', entry.path], {}, [entry.path]));
    const targetedUnitFiles = new Set(classified.filter((entry) => entry.path.startsWith('tests/unit/') && entry.path.endsWith('.test.ts')).map((entry) => entry.path));
    const touchesChecks = changed.some((path) => path === 'scripts/run-checks.mjs' || path === 'scripts/lib/checks.mjs');
    const touchesBrowserHarness = changed.some((path) => path === 'scripts/run-browser-lane.mjs' || path === 'scripts/lib/harness.mjs' || path === 'playwright.config.ts');
    if (touchesChecks) targetedUnitFiles.add('tests/unit/runChecks.test.ts');
    if (touchesBrowserHarness) targetedUnitFiles.add('tests/unit/browserHarness.test.ts');
    const targetedRelevantPaths = new Set([...targetedUnitFiles, ...changed]);
    if (touchesChecks || targetedUnitFiles.has('tests/unit/runChecks.test.ts')) ['scripts/run-checks.mjs', 'scripts/lib/checks.mjs', 'tests/unit/runChecks.test.ts'].forEach((path) => targetedRelevantPaths.add(path));
    if (touchesBrowserHarness || targetedUnitFiles.has('tests/unit/browserHarness.test.ts')) ['scripts/run-browser-lane.mjs', 'scripts/lib/harness.mjs', 'playwright.config.ts', 'tests/unit/browserHarness.test.ts'].forEach((path) => targetedRelevantPaths.add(path));
    const targetedUnit = targetedUnitFiles.size
      ? [stage('targeted-unit', 'npm', ['run', 'test:unit', '--', ...targetedUnitFiles], {}, [...targetedRelevantPaths])]
      : [];
    const needsTypecheck = classified.some((entry) => entry.path.endsWith('.ts') || entry.path === 'tsconfig.json' || entry.path === 'vite.config.ts' || entry.path === 'playwright.config.ts' || entry.path === 'vitest.config.ts');
    const typecheck = needsTypecheck ? [stage('typecheck', 'npm', ['run', 'typecheck'], {}, changed)] : [];
    return { tier, goal: null, cachePolicy: 'default', stages: [...syntax, ...targetedUnit, ...typecheck] };
  }
  if (tier === 'goal') {
    if (!['G006', 'G007', 'G008', 'G009', 'G010'].includes(goal)) throw new Error('goal requires supported --goal G006, G007, G008, G009, or G010.');
    if (goal === 'G010') return { tier, goal, cachePolicy: 'default', stages: [stage('typecheck', 'npm', ['run', 'typecheck']), stage('first-person-unit', 'npm', ['run', 'test:unit', '--', 'tests/unit/layer7FirstPersonSourceContracts.test.ts', 'tests/unit/runtimeEvents.test.ts', 'tests/unit/testRuntimeArtifact.test.ts']), stage('first-person-browser', 'npm', ['run', 'test:browser:first-person:focused'])] };
    if (goal === 'G009') return { tier, goal, cachePolicy: 'default', stages: [stage('typecheck', 'npm', ['run', 'typecheck']), stage('battle-unit', 'npm', ['run', 'test:unit', '--', 'tests/unit/layer7BattleSourceContracts.test.ts', 'tests/unit/runtimeEvents.test.ts', 'tests/unit/testRuntimeArtifact.test.ts']), stage('battle-native', 'npm', ['run', 'test:native-battle'], {}, ['scripts/test-native-battle.mjs', 'tests/native/pinned_battle_driver.lua', 'runtime/']), stage('battle-browser', 'npm', ['run', 'test:browser:battle:focused'])] };
    if (goal === 'G008') return { tier, goal, cachePolicy: 'default', stages: [stage('typecheck', 'npm', ['run', 'typecheck']), stage('water-unit', 'npm', ['run', 'test:unit', '--', 'tests/unit/layer7WaterSourceContracts.test.ts', 'tests/unit/runtimeEvents.test.ts']), stage('water-browser', 'npm', ['run', 'test:browser:water:focused'])] };
    if (goal === 'G007') return { tier, goal, cachePolicy: 'default', stages: [stage('typecheck', 'npm', ['run', 'typecheck']), stage('voxel-unit', 'npm', ['run', 'test:unit', '--', 'tests/unit/layer6VoxelSourceContracts.test.ts', 'tests/unit/runtimeEvents.test.ts', 'tests/unit/testRuntimeArtifact.test.ts']), stage('voxel-browser', 'npm', ['run', 'test:browser:voxel:focused']), stage('native-voxel', 'npm', ['run', 'test:native-voxel'])] };
    return { tier, goal, cachePolicy: 'default', stages: [stage('typecheck', 'npm', ['run', 'typecheck']), stage('audio-unit', 'npm', ['run', 'test:unit', '--', 'tests/unit/layer5AudioSourceContracts.test.ts', 'tests/unit/runtimeEvents.test.ts', 'tests/unit/audioHarnessRewrite.test.ts', 'tests/unit/testRuntimeArtifact.test.ts']), stage('audio-browser', 'npm', ['run', 'test:browser:audio:focused']), stage('native-audio', 'npm', ['run', 'test:native-audio'])] };
  }
  const common = [stage('upstream', 'npm', ['run', 'verify:upstream']), stage('runtime', 'npm', ['run', 'build:runtime']), stage('typecheck', 'npm', ['run', 'typecheck']), stage('unit', 'npm', ['run', 'test:unit']), stage('lua', 'npm', ['run', 'test:lua']), stage('client', 'npm', ['run', 'build:client']), stage('dist-audit', 'npm', ['run', 'audit:dist'])];
  if (tier === 'merge') return { tier, goal: null, cachePolicy: 'default', stages: [...common, stage('browser-public', 'npm', ['run', 'test:browser'], prebuilt)] };
  return { tier, goal: null, cachePolicy: 'fresh', stages: [{ ...common[0], env: fresh }, common[2], common[3], common[4], stage('browser-matrix', 'npm', ['run', 'test:browser:full'], fresh), stage('native-audio', 'npm', ['run', 'test:native-audio'], fresh)] };
}

export function sanitizeEvidence(value) {
  return String(value ?? '').replace(/POKEVOXEL_TEST_ROM_PATH\s*=\s*[^\s]+/gi, 'POKEVOXEL_TEST_ROM_PATH=[redacted]').replace(/\b[^\s/\\"']+\.(?:gb|gbc|gba|sav|srm)\b/gi, '[private-file]').replace(/(?:[A-Za-z]:)?(?:\/[^\s"']+)+/g, '<path>').replace(/\b(?:pid|port)\s*[:=]?\s*\d+\b/gi, (match) => match.replace(/\d+$/, '<number>')).replace(/\b\d+(?:\.\d+)?(?:ms|s)\b/g, '<duration>');
}
export const appendEvidenceTail = (previous, chunk, maximum = 4_000) => `${previous}${sanitizeEvidence(chunk)}`.slice(-maximum);

function assertionSummary(output) {
  return sanitizeEvidence(output).split('\n').map((line) => line.replace(/\x1b\[[0-9;]*m/g, '').trim()).find((line) => /(?:expect\(|expected|actual|assert|error:|failed)/i.test(line))?.replace(/\b\d+\b/g, '<number>').slice(0, 500) || 'unspecified failure';
}
function failedTestId(output) {
  const match = String(output ?? '').match(/(tests\/(?:browser|unit)\/[^\s:]+(?:\.spec|\.test)\.[cm]?[jt]s(?::\d+(?::\d+)?)?(?:\s+[›>][^\n]*)?)/);
  return match?.[1]?.trim() ?? null;
}
function runtimePhase(output) {
  return sanitizeEvidence(output).match(/(?:runtime[ _-]?phase|phase|"scene")\s*[":=]+\s*"?([\w-]+)/i)?.[1]?.toLowerCase() ?? null;
}
export function semanticFailureIdentity({ tier = null, goal = null, stage, output = '', failureClass, failedTest, phase } = {}) {
  const identity = { goal, tier, stage: stage ?? 'unknown', failedTest: failedTest ?? failedTestId(output), failureClass: failureClass ?? classifyFailure(stage, output), assertionSummary: assertionSummary(output), runtimePhase: phase ?? runtimePhase(output) };
  return identity;
}
export const attemptScopeKey = ({ tier, goal, stage, failedTest, failureClass, assertionSummary, runtimePhase }) => JSON.stringify({ tier: tier ?? null, goal: goal ?? null, stage: stage ?? null, failedTest: failedTest ?? null, failureClass: failureClass ?? null, assertionSummary: assertionSummary ?? null, runtimePhase: runtimePhase ?? null });

export function relevantChangedPaths(entry, changed) {
  if (!changed?.length) return [];
  const relevant = entry.relevantPaths ?? defaultRelevantPaths;
  return classifyChangedPaths(changed).map(({ path }) => path).filter((path) => relevant.some((candidate) => candidate.endsWith('/') ? path.startsWith(candidate) : path === candidate));
}
export function ensureAttemptAllowed(previous, options = {}) {
  const count = previous?.count ?? 0;
  if (count < 2) return;
  if (count >= 3) throw new Error('failure circuit reopened with the same semantic failure after a causal edit; stop testing and diagnose the retained evidence.');
  const relevant = options.relevantChanged ?? [];
  if (!relevant.length) throw new Error('refusing a third identical failed attempt; make a causal edit and resume with its relevant --changed path.');
}
export function recordFailure(previous, { stage: stageName, identity, relevantPaths = [], changedPaths = [] }) {
  const resolved = identity ?? {};
  return {
    goal: resolved.goal ?? null,
    tier: resolved.tier ?? null,
    stage: stageName ?? resolved.stage ?? 'unknown',
    failedTest: resolved.failedTest ?? null,
    failureClass: resolved.failureClass ?? 'evaluator/test',
    assertion: resolved.assertionSummary ?? 'unspecified failure',
    runtimePhase: resolved.runtimePhase ?? null,
    count: (previous?.count ?? 0) + 1,
    changedPaths,
    relevantPaths,
    updatedAt: new Date().toISOString(),
  };
}
export function classifyFailure(stageName, output) {
  const text = String(output ?? '');
  if (/timed out|timeout/i.test(text)) return 'orchestration/lifecycle';
  if (/lease|cleanup|lock/i.test(stageName)) return 'orchestration/lifecycle';
  if (/ECONN|EADDRINUSE|ENOENT|browser.*(?:missing|unavailable)|native.*(?:missing|unavailable)|compatible.*(?:love|l.ve).*(?:not found|unavailable)|timed out waiting for browser lane/i.test(text)) return 'environment/external';
  if (/runtime|audit|native/i.test(stageName)) return 'product/runtime';
  return 'evaluator/test';
}
export function resumeStage(entry, failedTest) {
  if (!failedTest || !browserScripts[entry.name]) return entry;
  const file = failedTest.split(/\s+[›>]/)[0].replace(/:(\d+)(?::\d+)?$/, ':$1');
  return stage(entry.name, process.execPath, ['scripts/run-browser-lane.mjs', ...browserScripts[entry.name], '--', file], entry.env, entry.relevantPaths);
}
export function recommendedNextCommand({ goal, failedTest, relevantPaths = [] } = {}) {
  const selected = failedTest?.split(':')[0] ?? relevantPaths[0] ?? 'src/';
  const candidate = selected.endsWith('/') ? `${selected}<causal-file>` : selected;
  return `npm run check:resume --${goal ? ` --goal ${goal}` : ''} --changed ${candidate}`;
}

export function selectLatestFailedManifest(manifests, goal) {
  const candidates = manifests
    .filter((manifest) => manifest?.exit && manifest.failureStage && manifest.failureStage !== 'plan');
  const scoped = candidates
    .filter((manifest) => goal ? manifest.goal === goal : manifest.goal == null)
    .sort((a, b) => String(b.finishedAt ?? '').localeCompare(String(a.finishedAt ?? '')));
  if (scoped[0]) return scoped[0];
  if (!goal && candidates.some((manifest) => manifest.goal != null)) {
    throw new Error('resume of a goal-origin failure requires an explicit --goal.');
  }
  throw new Error(goal ? `no prior failed check manifest exists for goal ${goal}.` : 'no prior failed check manifest exists.');
}

const failureFields = ['goal', 'tier', 'stage', 'failedTest', 'failureClass', 'assertion', 'runtimePhase', 'count', 'changedPaths'];
export function isReadableFailureAttempt(record) {
  return Boolean(record && failureFields.every((field) => Object.hasOwn(record, field))
    && typeof record.stage === 'string'
    && typeof record.failureClass === 'string'
    && typeof record.assertion === 'string'
    && Number.isSafeInteger(record.count)
    && record.count > 0
    && Array.isArray(record.changedPaths));
}
export function normalizeFailureAttempts(value) {
  if (value?.schemaVersion !== 2 || !Array.isArray(value.attempts)) return [];
  return value.attempts.filter(isReadableFailureAttempt);
}
export const serializeFailureAttempts = (attempts) => ({ schemaVersion: 2, attempts: attempts.filter(isReadableFailureAttempt) });

export function failureAttemptMatches(record, identity) {
  const fields = {
    goal: identity.goal,
    tier: identity.tier,
    stage: identity.stage,
    failedTest: identity.failedTest,
    failureClass: identity.failureClass,
    assertion: identity.assertionSummary,
    runtimePhase: identity.runtimePhase,
  };
  return Object.entries(fields).every(([field, expected]) => !Object.hasOwn(identity, field === 'assertion' ? 'assertionSummary' : field)
    || (record?.[field] ?? null) === (expected ?? null));
}

export function buildFailureEvidence({ plan, result, changed = [] }) {
  if (!result.failed) return null;
  const entry = plan.stages.find((candidate) => candidate.name === result.failed);
  if (!entry) throw new Error(`failed stage is not available in the check plan: ${result.failed}`);
  const failureClass = classifyFailure(result.failed, result.output);
  const identity = semanticFailureIdentity({ tier: plan.tier, goal: plan.goal, stage: result.failed, output: result.output, failureClass });
  const relevant = relevantChangedPaths(entry, changed);
  return {
    entry,
    identity,
    relevant,
    manifest: {
      failureClass,
      failureStage: result.failed,
      failureIdentity: identity,
      failedTest: identity.failedTest,
      runtimePhase: identity.runtimePhase,
      recommendedNextCommand: recommendedNextCommand({ goal: plan.goal, failedTest: identity.failedTest, relevantPaths: relevant.length ? relevant : entry.relevantPaths }),
    },
  };
}
export async function executePlan(plan, executor = defaultExecutor) {
  const results = [];
  for (const entry of plan.stages) {
    const started = Date.now(); const result = await executor(entry); const durationMs = Date.now() - started;
    const outputTail = sanitizeEvidence(result.output ?? '').slice(-4_000);
    results.push({ name: entry.name, durationMs, exit: result.exit, outputTail });
    if (result.exit !== 0) return { results, failed: entry.name, output: outputTail };
  }
  return { results, failed: null, output: '' };
}
function defaultExecutor(entry) {
  return new Promise((resolveExecutor, rejectExecutor) => {
    const timeoutValue = (name, fallback) => {
      const value = Number(process.env[name] ?? fallback);
      if (!Number.isSafeInteger(value) || value < 100) throw new Error(`${name} must be an integer of at least 100.`);
      return value;
    };
    const wallTimeoutMs = timeoutValue('POKEVOXEL_CHECK_STAGE_WALL_TIMEOUT_MS', 420_000);
    const idleTimeoutMs = timeoutValue('POKEVOXEL_CHECK_STAGE_IDLE_TIMEOUT_MS', 120_000);
    const child = spawn(entry.command, entry.args, { env: { ...process.env, ...entry.env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let output = ''; let settled = false; let lastOutputAt = Date.now(); let timeoutKind = null;
    const signal = (name) => {
      if (!child.pid || child.exitCode !== null) return;
      try { process.kill(-child.pid, name); } catch { child.kill(name); }
    };
    const finish = (exit, processSignal) => {
      if (settled) return;
      settled = true; clearTimeout(wallTimer); clearInterval(idleTimer); clearTimeout(killTimer); clearTimeout(forceTimer);
      const timeoutEvidence = timeoutKind ? `\n${entry.name} ${timeoutKind} timeout.` : '';
      resolveExecutor({ exit: timeoutKind ? 1 : (exit ?? 1), output: appendEvidenceTail(output, `${timeoutEvidence}${processSignal ? `\nsignal ${processSignal}` : ''}`) });
    };
    const timeOut = (kind) => {
      if (settled || timeoutKind) return;
      timeoutKind = kind; signal('SIGTERM');
      killTimer = setTimeout(() => signal('SIGKILL'), 5_000);
      forceTimer = setTimeout(() => finish(1, 'SIGKILL'), 7_000);
    };
    child.stdout.on('data', (chunk) => { process.stdout.write(chunk); output = appendEvidenceTail(output, chunk); lastOutputAt = Date.now(); });
    child.stderr.on('data', (chunk) => { process.stderr.write(chunk); output = appendEvidenceTail(output, chunk); lastOutputAt = Date.now(); });
    child.on('error', (error) => { if (!settled) { settled = true; clearTimeout(wallTimer); clearInterval(idleTimer); clearTimeout(killTimer); clearTimeout(forceTimer); rejectExecutor(error); } });
    child.on('exit', finish);
    const wallTimer = setTimeout(() => timeOut('wall'), wallTimeoutMs);
    const idleTimer = setInterval(() => { if (Date.now() - lastOutputAt >= idleTimeoutMs) timeOut('idle'); }, Math.min(1_000, idleTimeoutMs));
    let killTimer; let forceTimer;
  });
}
export const newRunId = () => `${Date.now()}-${randomUUID().slice(0, 8)}`;
