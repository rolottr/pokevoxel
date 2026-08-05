import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { acquireLease, browserFailureClass, browserRuntimePhase, completeRunManifest, createRunId, failedBrowserTestIds, findFreeLoopbackPort, focusBrowserArguments, recommendedBrowserCommand, releaseLease, relativeFrom, sleep, writeRunManifest } from './lib/harness.mjs';

const product = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const separator = process.argv.indexOf('--');
const rawArgs = separator < 0 ? [] : process.argv.slice(separator + 1);
const privateAudio = process.argv.includes('--private-audio');
const audioScenarios = process.argv.includes('--audio-scenarios');
const voxelScenarios = process.argv.includes('--voxel-scenarios');
const waterScenarios = process.argv.includes('--water-scenarios');
const battleScenarios = process.argv.includes('--battle-scenarios');
const firstPersonScenarios = process.argv.includes('--first-person-scenarios');
const runId = createRunId();
const runRoot = resolve(product, '.pokevoxel-test-data', 'runs', runId);
const outputDir = resolve(runRoot, 'test-results');
const profileDir = resolve(runRoot, 'indexeddb-profile');
const siteDir = resolve(runRoot, 'site');
const testRuntimeDir = resolve(runRoot, 'test-runtime');
const leasePath = resolve(product, '.pokevoxel-test-data', 'browser-lane.lease.json');
const manifestPath = resolve(runRoot, 'manifest.json');
const playwrightCli = resolve(product, 'node_modules', '@playwright', 'test', 'cli.js');
const startedAt = new Date();
const ownedChildren = new Set();
let lease;
let stopping = false;
let manifestWritten = false;
let finalization;
let activeStage = 'lease';
let activeOutput = '';
let activeOutputAt = Date.now();
let activeResult = { code: null, signal: null, timedOut: false };
const cleanupErrors = [];

const timeout = (name, fallback, minimum = 1_000) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${name} must be an integer of at least ${minimum}.`);
  return value;
};
const STAGE_WALL_TIMEOUT_MS = timeout('POKEVOXEL_BROWSER_STAGE_WALL_TIMEOUT_MS', 180_000, 5_000);
const STAGE_IDLE_TIMEOUT_MS = timeout('POKEVOXEL_BROWSER_STAGE_IDLE_TIMEOUT_MS', 60_000, 5_000);

function command(name, args, environment, options = {}) {
  const processChild = spawn(name, args, {
    cwd: product,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: options.detached !== false,
  });
  ownedChildren.add(processChild);
  processChild.once('exit', () => ownedChildren.delete(processChild));
  return processChild;
}

function observeLongRunningChild(name, processChild) {
  activeStage = name;
  activeOutput = '';
  activeOutputAt = Date.now();
  activeResult = { code: null, signal: null, timedOut: false };
  const copy = (chunk, target) => {
    const text = String(chunk);
    target.write(text);
    activeOutput = `${activeOutput}${text}`.slice(-8_000);
    activeOutputAt = Date.now();
  };
  processChild.stdout?.on('data', (chunk) => copy(chunk, process.stdout));
  processChild.stderr?.on('data', (chunk) => copy(chunk, process.stderr));
  processChild.once('exit', (code, signal) => { activeResult = { code, signal, timedOut: false }; });
}

async function runStage(name, processChild, wallTimeoutMs = STAGE_WALL_TIMEOUT_MS, idleTimeoutMs = STAGE_IDLE_TIMEOUT_MS) {
  activeStage = name;
  activeOutput = '';
  activeOutputAt = Date.now();
  let lastOutputAt = Date.now();
  const copy = (chunk, target) => {
    const text = String(chunk);
    target.write(text);
    activeOutput = `${activeOutput}${text}`.slice(-8_000);
    lastOutputAt = Date.now();
    activeOutputAt = lastOutputAt;
  };
  processChild.stdout?.on('data', (chunk) => copy(chunk, process.stdout));
  processChild.stderr?.on('data', (chunk) => copy(chunk, process.stderr));
  return new Promise((resolveExit, rejectExit) => {
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearInterval(watchdog);
      clearTimeout(wallTimer);
      activeResult = result;
      resolveExit(result);
    };
    let timeoutResult = null;
    const terminateForTimeout = (kind) => {
      if (settled || timeoutResult) return;
      activeOutput = `${activeOutput}\n${name} ${kind} timeout after ${kind === 'wall' ? wallTimeoutMs : idleTimeoutMs}ms.`;
      timeoutResult = { code: null, signal: 'SIGTERM', timedOut: true, timeoutKind: kind };
      signalOwnedChild(processChild, 'SIGTERM');
      setTimeout(() => signalOwnedChild(processChild, 'SIGKILL'), 5_000).unref();
    };
    const wallTimer = setTimeout(() => terminateForTimeout('wall'), wallTimeoutMs);
    const watchdog = setInterval(() => { if (Date.now() - lastOutputAt >= idleTimeoutMs) terminateForTimeout('idle'); }, Math.min(1_000, idleTimeoutMs));
    processChild.once('error', (error) => { if (settled) return; settled = true; clearInterval(watchdog); clearTimeout(wallTimer); rejectExit(error); });
    processChild.once('exit', (code, signal) => settle(timeoutResult ?? { code, signal, timedOut: false }));
  });
}

function signalOwnedChild(processChild, signal) {
  if (!processChild?.pid || processChild.exitCode !== null || processChild.signalCode !== null) return;
  try {
    process.kill(-processChild.pid, signal);
  } catch {
    processChild.kill(signal);
  }
}

async function stopOwnedChild(ownedChild) {
  if (!ownedChild?.pid || ownedChild.exitCode !== null || ownedChild.signalCode !== null) return;
  const exited = new Promise((resolveExit) => ownedChild.once('exit', resolveExit));
  signalOwnedChild(ownedChild, 'SIGTERM');
  await Promise.race([exited, sleep(5_000)]);
  if (ownedChild.exitCode === null && ownedChild.signalCode === null) {
    signalOwnedChild(ownedChild, 'SIGKILL');
    await Promise.race([exited, sleep(1_000)]);
  }
}

async function waitForFocusBrowser(endpoint, processChild, wallTimeoutMs = timeout('POKEVOXEL_FOCUS_BROWSER_READY_WALL_TIMEOUT_MS', 30_000, 5_000), idleTimeoutMs = timeout('POKEVOXEL_FOCUS_BROWSER_READY_IDLE_TIMEOUT_MS', 30_000, 5_000)) {
  activeStage = 'focus-browser-ready';
  const started = Date.now();
  while (Date.now() - started < wallTimeoutMs) {
    if (processChild.exitCode !== null || processChild.signalCode !== null) throw new Error('The owned focus browser exited before its CDP endpoint became ready.');
    try {
      const response = await fetch(`${endpoint}/json/version`);
      if (response.ok && (await response.json())?.webSocketDebuggerUrl) return;
    } catch {
      // The owned browser may still be binding its loopback debugger endpoint.
    }
    if (Date.now() - activeOutputAt >= idleTimeoutMs) throw new Error(`Focus browser produced no output or CDP response within ${idleTimeoutMs}ms.`);
    await sleep(150);
  }
  throw new Error(`Focus browser did not become ready within ${wallTimeoutMs}ms.`);
}

async function waitForServer(baseURL, timeoutMs = timeout('POKEVOXEL_PREVIEW_READY_WALL_TIMEOUT_MS', 30_000, 5_000), idleTimeoutMs = timeout('POKEVOXEL_PREVIEW_READY_IDLE_TIMEOUT_MS', 30_000, 5_000)) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseURL}/`);
      if (response.ok) return;
    } catch {
      // The preview process may still be binding the selected loopback port.
    }
    if (Date.now() - activeOutputAt >= idleTimeoutMs) throw new Error(`Preview server produced no output within ${idleTimeoutMs}ms.`);
    await sleep(150);
  }
  throw new Error(`Preview server did not become ready within ${timeoutMs}ms.`);
}

async function main() {
  if ([audioScenarios, voxelScenarios, waterScenarios, battleScenarios, firstPersonScenarios].filter(Boolean).length > 1) throw new Error('select only one isolated scenario runtime.');
  if ((audioScenarios || voxelScenarios || waterScenarios || battleScenarios || firstPersonScenarios) && !privateAudio) throw new Error('isolated scenario runtimes require --private-audio.');
  if (privateAudio && !process.env.POKEVOXEL_TEST_ROM_PATH) throw new Error('Private browser lanes require POKEVOXEL_TEST_ROM_PATH.');
  lease = await acquireLease(leasePath);
  const port = await findFreeLoopbackPort();
  const baseURL = `http://127.0.0.1:${port}`;
  if (privateAudio) mkdirSync(profileDir, { recursive: true });
  writeRunManifest(manifestPath, {
    runId,
    startedAt: new Date().toISOString(),
    port,
    privateAudio,
    outputDir: relativeFrom(product, outputDir),
    testArgs: rawArgs,
  });
  manifestWritten = true;

  const environment = {
    ...process.env,
    POKEVOXEL_BASE_URL: baseURL,
    POKEVOXEL_PREVIEW_PORT: String(port),
    POKEVOXEL_TEST_OUTPUT_DIR: outputDir,
    POKEVOXEL_TEST_RUN_ID: runId,
    POKEVOXEL_TEST_PROFILE_DIR: profileDir,
    POKEVOXEL_PRIVATE_AUDIO: privateAudio ? '1' : '0',
    POKEVOXEL_AUDIO_SCENARIOS: audioScenarios ? '1' : '0',
    POKEVOXEL_VOXEL_SCENARIOS: voxelScenarios ? '1' : '0',
    POKEVOXEL_WATER_SCENARIOS: waterScenarios ? '1' : '0',
    POKEVOXEL_BATTLE_SCENARIOS: battleScenarios ? '1' : '0',
    POKEVOXEL_FIRST_PERSON_SCENARIOS: firstPersonScenarios ? '1' : '0',
  };

  if ((audioScenarios || voxelScenarios || waterScenarios || battleScenarios || firstPersonScenarios) && process.env.POKEVOXEL_SKIP_RUNTIME_BUILD !== '1') {
    const runtimeBuild = command('npm', ['run', 'build:runtime'], environment);
    const result = await runStage('runtime-build', runtimeBuild);
    if (result.code !== 0) throw new Error(`Production runtime build failed with ${result.code ?? result.signal}.`);
  }
  if (process.env.POKEVOXEL_SKIP_CLIENT_BUILD !== '1') {
    const build = command('npm', ['run', 'build:client'], environment);
    const result = await runStage('client-build', build);
    if (result.code !== 0) throw new Error(`Client build failed with ${result.code ?? result.signal}.`);
  }

  let previewDirectory;
  if (audioScenarios || voxelScenarios || waterScenarios || battleScenarios || firstPersonScenarios) {
    const scenario = audioScenarios ? 'audio' : (voxelScenarios ? 'voxel' : (waterScenarios ? 'water' : (battleScenarios ? 'battle' : 'first-person')));
    const builder = command(process.execPath, [resolve(product, 'scripts', 'build-test-runtime.mjs'), '--scenario', scenario, '--output', testRuntimeDir], environment);
    const built = await runStage('test-runtime-build', builder);
    if (built.code !== 0) throw new Error(`Test runtime build failed with ${built.code ?? built.signal}.`);
    const audit = command(process.execPath, [resolve(product, 'scripts', 'audit-test-runtime.mjs'), '--runtime', testRuntimeDir], environment);
    const audited = await runStage('test-runtime-audit', audit);
    if (audited.code !== 0) throw new Error(`Test runtime audit failed with ${audited.code ?? audited.signal}.`);
    rmSync(siteDir, { recursive: true, force: true });
    cpSync(resolve(product, 'dist'), siteDir, { recursive: true });
    rmSync(resolve(siteDir, 'runtime'), { recursive: true, force: true });
    cpSync(testRuntimeDir, resolve(siteDir, 'runtime'), { recursive: true });
    previewDirectory = siteDir;
  }

  const previewArgs = ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(port)];
  if (previewDirectory) previewArgs.push('--outDir', previewDirectory);
  const preview = command('npm', previewArgs, environment);
  observeLongRunningChild('preview-ready', preview);
  await waitForServer(baseURL);
  let focusBrowser;
  if (firstPersonScenarios) {
    const focusBrowserPort = await findFreeLoopbackPort();
    const focusBrowserEndpoint = `http://127.0.0.1:${focusBrowserPort}`;
    focusBrowser = command(chromium.executablePath(), focusBrowserArguments(focusBrowserPort, profileDir), environment);
    observeLongRunningChild('focus-browser-ready', focusBrowser);
    await waitForFocusBrowser(focusBrowserEndpoint, focusBrowser);
    environment.POKEVOXEL_FOCUS_BROWSER_CDP_ENDPOINT = focusBrowserEndpoint;
  }
  const playwrightArgs = [playwrightCli, 'test', ...rawArgs];
  if (privateAudio && !rawArgs.some((argument) => argument.startsWith('--workers'))) playwrightArgs.push('--workers=1');
  const test = command(process.execPath, playwrightArgs, environment);
  const result = await runStage('playwright', test, timeout('POKEVOXEL_PLAYWRIGHT_WALL_TIMEOUT_MS', 300_000, 5_000), timeout('POKEVOXEL_PLAYWRIGHT_IDLE_TIMEOUT_MS', 90_000, 5_000));
  if (preview.exitCode !== null) throw new Error('Preview server exited before browser tests completed.');
  if (focusBrowser && (focusBrowser.exitCode !== null || focusBrowser.signalCode !== null)) throw new Error('Focus browser exited before browser tests completed.');
  return result.code ?? 1;
}

async function cleanup() {
  if (stopping) return;
  stopping = true;
  await Promise.all([...ownedChildren].map(async (ownedChild) => { try { await stopOwnedChild(ownedChild); } catch (error) { cleanupErrors.push(error instanceof Error ? error.message : String(error)); } }));
  try {
    if (process.env.POKEVOXEL_RETAIN_PRIVATE_PROFILE !== '1') {
      rmSync(profileDir, { recursive: true, force: true });
      rmSync(siteDir, { recursive: true, force: true });
      rmSync(testRuntimeDir, { recursive: true, force: true });
    }
  } catch (error) { cleanupErrors.push(error instanceof Error ? error.message : String(error)); }
  try { releaseLease(lease); } catch (error) { cleanupErrors.push(error instanceof Error ? error.message : String(error)); }
}

function finalize(exitStatus, failureStage) {
  if (finalization) return finalization;
  finalization = (async () => {
    await cleanup();
    if (!exitStatus) rmSync(outputDir, { recursive: true, force: true });
    if (manifestWritten) {
      const failedTestIds = failedBrowserTestIds(activeOutput);
      completeRunManifest(manifestPath, {
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      exitStatus,
      failureStage,
      signal: activeResult.signal,
      failureClass: exitStatus === 0 ? undefined : browserFailureClass(failureStage, activeOutput, activeResult.timedOut),
      failedTestIds,
      runtimePhase: browserRuntimePhase(activeOutput),
      recommendedNextCommand: exitStatus === 0 ? undefined : recommendedBrowserCommand(failedTestIds),
      cleanupErrors,
      cleanupState: cleanupErrors.length ? 'completed-with-errors' : 'complete',
      artifactsRetained: exitStatus !== 0,
      });
    }
  })();
  return finalization;
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.once(signal, () => {
    finalize(128, 'interrupted').finally(() => process.exit(128));
  });
}

try {
  const exitStatus = await main();
  await finalize(exitStatus, exitStatus === 0 ? 'complete' : 'playwright');
  process.exitCode = exitStatus;
} catch (error) {
  await finalize(1, manifestWritten ? 'setup-or-preview' : 'lease');
  console.error(error);
  process.exitCode = 1;
}
