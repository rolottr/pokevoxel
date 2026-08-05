#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { buildFailureEvidence, ensureAttemptAllowed, executePlan, failureAttemptMatches, newRunId, normalizeFailureAttempts, planChecks, recordFailure, relevantChangedPaths, resumeStage, sanitizeEvidence, selectLatestFailedManifest, serializeFailureAttempts } from './lib/checks.mjs';

const product = resolve(dirname(new URL(import.meta.url).pathname), '..');
const [requestedTier, ...argumentsList] = process.argv.slice(2);
const values = (flag) => argumentsList.flatMap((value, index) => value === flag && argumentsList[index + 1] && !argumentsList[index + 1].startsWith('--') ? [argumentsList[index + 1]] : []);
const changed = values('--changed'); const goal = values('--goal')[0]; const dryRun = argumentsList.includes('--dry-run');
const runId = newRunId(); const root = join(product, '.pokevoxel-test-data', 'checks'); const manifestPath = join(root, runId, 'manifest.json'); const failuresPath = join(root, 'failures.json'); const started = new Date();
const writeJson = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 }); };
function readFailures() { if (!existsSync(failuresPath)) return []; try { return normalizeFailureAttempts(JSON.parse(readFileSync(failuresPath, 'utf8'))); } catch { throw new Error('failure suppression state is invalid; remove only the corrupted generated file after inspection.'); } }
function latestFailedManifest(requestedGoal) {
  if (!existsSync(root)) throw new Error('no prior failed check manifest exists.');
  const manifests = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name, 'manifest.json')).filter(existsSync).map((path) => JSON.parse(readFileSync(path, 'utf8')));
  return selectLatestFailedManifest(manifests, requestedGoal);
}
function finish(manifest) { manifest.finishedAt = new Date().toISOString(); manifest.durationMs = Date.now() - started.getTime(); manifest.cleanup = 'complete'; writeJson(manifestPath, manifest); }
let activeManifest = null;
try {
  const prior = requestedTier === 'resume' ? latestFailedManifest(goal) : null;
  const basePlan = requestedTier === 'resume' ? planChecks({ tier: prior.originalTier ?? prior.tier, changed: prior.changedPaths ?? [], goal: prior.goal }) : planChecks({ tier: requestedTier, changed, goal });
  let plan = basePlan; let selectedEntry = null;
  if (requestedTier === 'resume') {
    if (!changed.length) throw new Error('resume requires one or more --changed paths for the causal edit.');
    selectedEntry = basePlan.stages.find((entry) => entry.name === prior.failureStage);
    if (!selectedEntry) throw new Error('latest failed stage is not available in its original check plan.');
    const relevant = relevantChangedPaths(selectedEntry, changed);
    if (!relevant.length) throw new Error('resume requires a declared changed path relevant to the failed stage.');
    plan = { ...basePlan, tier: 'resume', stages: [resumeStage(selectedEntry, prior.failedTest)] };
  }
  let records = readFailures();
  const manifest = { schemaVersion: 2, runId, startedAt: started.toISOString(), tier: plan.tier, originalTier: basePlan.tier, goal: basePlan.goal, changedPaths: changed, selectedStages: plan.stages.map((entry) => entry.name), cachePolicy: plan.cachePolicy };
  activeManifest = manifest;
  if (dryRun) { manifest.exit = 0; manifest.dryRun = true; finish(manifest); console.log(JSON.stringify(manifest)); }
  else {
    // A known circuit is checked before starting its stage, so an unchanged retry cannot execute it.
    for (const entry of plan.stages) {
      const previous = records.find((record) => failureAttemptMatches(record, { tier: basePlan.tier, goal: basePlan.goal, stage: entry.name }) && record.count >= 2);
      if (previous) ensureAttemptAllowed(previous, { relevantChanged: relevantChangedPaths(entry, changed) });
    }
    const result = await executePlan(plan); manifest.stages = result.results; manifest.exit = result.failed ? 1 : 0; manifest.failureStage = result.failed;
    for (const passed of result.results.filter((stageResult) => stageResult.exit === 0)) {
      records = records.filter((record) => !failureAttemptMatches(record, { tier: basePlan.tier, goal: basePlan.goal, stage: passed.name }));
    }
    if (result.failed) {
      const evidence = buildFailureEvidence({ plan: basePlan, result, changed });
      const previous = records.find((record) => failureAttemptMatches(record, evidence.identity));
      ensureAttemptAllowed(previous, { relevantChanged: evidence.relevant });
      records = records.filter((record) => !failureAttemptMatches(record, evidence.identity));
      records.push(recordFailure(previous, { stage: result.failed, identity: evidence.identity, relevantPaths: evidence.entry.relevantPaths, changedPaths: changed }));
      Object.assign(manifest, evidence.manifest);
    }
    writeJson(failuresPath, serializeFailureAttempts(records)); finish(manifest); if (manifest.exit) process.exitCode = 1;
  }
} catch (error) {
  const message = sanitizeEvidence(error instanceof Error ? error.message : error);
  if (activeManifest?.failureStage) {
    activeManifest.exit = 1;
    activeManifest.evidencePackagingFailure = { assertionSummary: message };
    finish(activeManifest);
  } else {
    finish({ schemaVersion: 2, runId, startedAt: started.toISOString(), tier: requestedTier ?? null, exit: 1, failureClass: 'selector', failureStage: 'plan', failureIdentity: { stage: 'plan', assertionSummary: message }, recommendedNextCommand: 'npm run check:edit -- --changed <relevant-path>' });
  }
  console.error(message); process.exitCode = 1;
}
