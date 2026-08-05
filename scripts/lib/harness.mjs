import { createHash, randomUUID } from 'node:crypto';
import { closeSync, cpSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, relative, resolve } from 'node:path';

export const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

export function createRunId(now = new Date(), id = randomUUID()) {
  return `${now.toISOString().replace(/[-:.TZ]/g, '')}-${id.slice(0, 8)}`;
}

export async function findFreeLoopbackPort(host = '127.0.0.1') {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen({ host, port: 0 }, resolveListen);
  });
  const address = server.address();
  await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  if (!address || typeof address === 'string') throw new Error('Unable to allocate a loopback port.');
  return address.port;
}

/** Build the minimal command line for the run-owned headed focus browser. */
export function focusBrowserArguments(port, profileDir) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error('Focus browser port must be a valid TCP port.');
  if (typeof profileDir !== 'string' || !profileDir) throw new Error('Focus browser profile directory is required.');
  return [
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
    'about:blank',
  ];
}

const browserRunIdPattern = /^\d{17}-[0-9a-f]{8}$/i;

/** Recover stale generated browser state without accepting arbitrary targets. */
export function recoverAbandonedBrowserRuns(runsRoot, overrides = {}) {
  const options = {
    now: () => Date.now(),
    staleAfterMs: 300_000,
    activeLease: false,
    ...overrides,
  };
  if (options.activeLease || !existsSync(runsRoot)) return 0;
  if (!Number.isSafeInteger(options.staleAfterMs) || options.staleAfterMs < 1_000) throw new Error('Abandoned browser run threshold must be at least 1000ms.');
  let recoveredCount = 0;
  for (const entry of readdirSync(runsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !browserRunIdPattern.test(entry.name)) continue;
    const runRoot = resolve(runsRoot, entry.name);
    const manifestPath = resolve(runRoot, 'manifest.json');
    try {
      const manifestStat = lstatSync(manifestPath);
      if (!manifestStat.isFile()) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (manifest.runId !== entry.name || manifest.finishedAt || Number.isInteger(manifest.exitStatus)) continue;
      if (!Number.isSafeInteger(manifest.port) || !Array.isArray(manifest.testArgs)) continue;
      const startedAt = Date.parse(manifest.startedAt);
      if (!Number.isFinite(startedAt)) continue;
      const lastActivityAt = Math.max(startedAt, manifestStat.mtimeMs);
      if (options.now() - lastActivityAt < options.staleAfterMs) continue;
      for (const generatedName of ['indexeddb-profile', 'site', 'test-runtime']) {
        rmSync(resolve(runRoot, generatedName), { recursive: true, force: true });
      }
      const artifactsRetained = existsSync(resolve(runRoot, 'test-results'));
      completeRunManifest(manifestPath, {
        finishedAt: new Date(options.now()).toISOString(),
        durationMs: Math.max(0, options.now() - startedAt),
        exitStatus: 1,
        failureStage: 'interrupted',
        failureClass: 'orchestration/lifecycle',
        failedTestIds: [],
        cleanupState: 'recovered-abandoned',
        artifactsRetained,
      });
      recoveredCount += 1;
    } catch {
      // Invalid or concurrently changing run state is not safe to recover.
    }
  }
  return recoveredCount;
}

export function processStartIdentity(pid) {
  try {
    const value = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return value || null;
  } catch {
    return null;
  }
}

export function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLease(lockPath) {
  try {
    return JSON.parse(readFileSync(lockPath, 'utf8'));
  } catch {
    return null;
  }
}

function isStaleLease(lockPath, lease, options) {
  const age = options.now() - statSync(lockPath).mtimeMs;
  if (!lease || !Number.isInteger(lease.pid)) return age >= options.staleAfterMs;
  if (!options.isAlive(lease.pid)) return true;
  const actualStart = options.startIdentity(lease.pid);
  return Boolean(lease.processStartIdentity && actualStart && lease.processStartIdentity !== actualStart);
}

/** Acquire the sole browser lane using an atomic, PID-bound lease. */
export async function acquireLease(lockPath, overrides = {}) {
  const options = {
    timeoutMs: 60_000,
    pollMs: 250,
    staleAfterMs: 300_000,
    now: () => Date.now(),
    isAlive: processIsAlive,
    startIdentity: processStartIdentity,
    pid: process.pid,
    token: randomUUID(),
    ...overrides,
  };
  mkdirSync(dirname(lockPath), { recursive: true });
  const deadline = options.now() + options.timeoutMs;
  const lease = {
    version: 1,
    pid: options.pid,
    processStartIdentity: options.startIdentity(options.pid),
    token: options.token,
    acquiredAt: new Date(options.now()).toISOString(),
  };

  while (true) {
    try {
      const descriptor = openSync(lockPath, 'wx', 0o600);
      try {
        writeFileSync(descriptor, `${JSON.stringify(lease)}\n`, 'utf8');
      } finally {
        closeSync(descriptor);
      }
      return { ...lease, lockPath };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = readLease(lockPath);
      if (isStaleLease(lockPath, existing, options)) {
        rmSync(lockPath, { force: true });
        continue;
      }
      if (options.now() >= deadline) throw new Error(`Timed out waiting for browser lane lease after ${options.timeoutMs}ms.`);
      await sleep(options.pollMs);
    }
  }
}

export function releaseLease(lease) {
  if (!lease?.lockPath || !existsSync(lease.lockPath)) return;
  const current = readLease(lease.lockPath);
  if (current?.token === lease.token) rmSync(lease.lockPath, { force: true });
}

function redacted(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/(?:[A-Za-z]:)?(?:\/[^\s"']+)+/g, '<path>')
    .replace(/(?:Pokemon|pok[eé]mon)[^\n"']*/gi, '<private-rom>');
}

export function redactHarnessEvidence(value) { return redacted(String(value ?? '')); }

export function failedBrowserTestIds(output) {
  return [...new Set([...String(output ?? '').matchAll(/(tests\/browser\/[^\s:]+\.spec\.[cm]?[jt]s(?::\d+(?::\d+)?)?(?:\s+[›>][^\n]*)?)/g)].map((match) => match[1].trim()))];
}

export function browserRuntimePhase(output) {
  return redacted(String(output ?? '')).match(/(?:runtime[ _-]?phase|phase|"scene")\s*[":=]+\s*"?([\w-]+)/i)?.[1]?.toLowerCase() ?? null;
}

export function browserFailureClass(stage, output, timedOut = false) {
  if (timedOut) return 'orchestration/timeout';
  if (/lease|cleanup|lock/i.test(stage)) return 'orchestration/lifecycle';
  if (/ECONN|EADDRINUSE|ENOENT|browser.*(?:missing|unavailable)/i.test(String(output ?? ''))) return 'environment/external';
  if (/build|runtime|audit/i.test(stage)) return 'product/runtime';
  return 'evaluator/test';
}

export function recommendedBrowserCommand(failedTestIds = []) {
  const test = failedTestIds[0]?.split(/\s+[›>]/)[0]?.replace(/:\d+(?::\d+)?$/, '');
  return test ? `npm run check:resume -- --changed ${test}` : 'npm run check:resume -- --changed <relevant-path>';
}

/** Persist operational evidence without copying environment variables or ROM identifiers. */
export function writeRunManifest(manifestPath, details) {
  const safe = {
    version: 1,
    runId: String(details.runId),
    startedAt: String(details.startedAt),
    port: Number(details.port),
    privateAudio: Boolean(details.privateAudio),
    outputDir: redacted(String(details.outputDir)),
    testArgs: Array.isArray(details.testArgs) ? details.testArgs.map((argument) => redacted(String(argument))) : [],
  };
  if (details.finishedAt) safe.finishedAt = String(details.finishedAt);
  if (Number.isFinite(details.durationMs)) safe.durationMs = Math.max(0, Number(details.durationMs));
  if (Number.isInteger(details.exitStatus)) safe.exitStatus = details.exitStatus;
  if (details.failureStage) safe.failureStage = String(details.failureStage);
  if (details.cleanupState) safe.cleanupState = String(details.cleanupState);
  if (Array.isArray(details.failedTestIds)) safe.failedTestIds = details.failedTestIds.map((id) => redacted(String(id)));
  if (details.failureClass) safe.failureClass = String(details.failureClass);
  if (details.runtimePhase) safe.runtimePhase = String(details.runtimePhase);
  if (details.signal) safe.signal = String(details.signal);
  if (Array.isArray(details.cleanupErrors) && details.cleanupErrors.length) safe.cleanupErrors = details.cleanupErrors.map((error) => redacted(String(error)));
  if (details.recommendedNextCommand) safe.recommendedNextCommand = redacted(String(details.recommendedNextCommand));
  if (details.artifactsRetained !== undefined) safe.artifactsRetained = Boolean(details.artifactsRetained);
  const serialized = `${JSON.stringify(safe, null, 2)}\n`;
  if (/POKEVOXEL_TEST_ROM_PATH|\.gbc?\b/i.test(serialized)) throw new Error('Refusing to write private ROM details to run manifest.');
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, serialized, { encoding: 'utf8', mode: 0o600 });
  return safe;
}

export function completeRunManifest(manifestPath, outcome) {
  const existing = readLease(manifestPath);
  if (!existing) throw new Error('Cannot complete a missing browser run manifest.');
  return writeRunManifest(manifestPath, { ...existing, ...outcome });
}

export function relativeFrom(root, candidate) {
  return relative(root, resolve(candidate)) || '.';
}

function collectFiles(root, prefix = '') {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = `${prefix}${entry.name}`;
    const path = resolve(root, entry.name);
    return entry.isDirectory() ? collectFiles(path, `${relativePath}/`) : entry.isFile() ? [{ path, relativePath }] : [];
  }).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function filesInDirectory(root, prefix = '') { return collectFiles(root, prefix); }

export function digestPaths(paths) {
  const hash = createHash('sha256');
  for (const { path, relativePath } of [...paths].sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
    hash.update(relativePath).update('\0').update(readFileSync(path)).update('\0');
  }
  return hash.digest('hex');
}

export function digestDirectory(root) {
  return digestPaths(collectFiles(root));
}

export function fileHashes(root, names) {
  return Object.fromEntries(names.map((name) => [name, createHash('sha256').update(readFileSync(resolve(root, name))).digest('hex')]));
}

export function validatesArtifacts(root, hashes) {
  try {
    const names = Object.keys(hashes).sort();
    const actualNames = collectFiles(root).map((entry) => entry.relativePath).sort();
    return JSON.stringify(actualNames) === JSON.stringify(names)
      && names.every((name) => existsSync(resolve(root, name)) && fileHashes(root, [name])[name] === hashes[name]);
  } catch {
    return false;
  }
}

/** Replace a public directory only after a complete candidate is ready; restore the prior output on publication failure. */
export function publishDirectoryAtomically(candidate, output) {
  const backup = `${output}.previous-${process.pid}-${Date.now()}`;
  const hadOutput = existsSync(output);
  mkdirSync(dirname(output), { recursive: true });
  try {
    if (hadOutput) renameSync(output, backup);
    renameSync(candidate, output);
    if (hadOutput) rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (hadOutput && !existsSync(output) && existsSync(backup)) renameSync(backup, output);
    throw error;
  }
}

export function copyDirectory(source, destination) {
  rmSync(destination, { recursive: true, force: true });
  cpSync(source, destination, { recursive: true });
}
