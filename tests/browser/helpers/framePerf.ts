import type { Page } from '@playwright/test';

/** Mirrors the closed frame-probe schema in src/runtime/runtimeEvents.ts. */
export type FrameProbe = Readonly<{
  frames: number; avgMs: number; p99Ms: number; worstMs: number;
  avgUpdateMs: number; avgDrawMs: number; avgPresentMs: number;
  worstUpdateMs: number; worstDrawMs: number; worstPresentMs: number;
  gcMs: number; memKb: number; drawCalls: number; canvasSwitches: number;
  meshJobs: number; meshUploads: number; meshMs: number; shadowMs: number; audioQueued: number;
}>;

export type LongTaskSummary = Readonly<{ count: number; totalMs: number; worstMs: number }>;
export type RafSummary = Readonly<{ frames: number; p95Ms: number; p99Ms: number; worstMs: number; over25Ms: number; over50Ms: number }>;
export type FramePerfEvidence = Readonly<{ label: string; probes: FrameProbe[]; longTasks: LongTaskSummary; raf: RafSummary }>;

type LongTaskWindow = Window & { __pokevoxelLongTasks?: { count: number; totalMs: number; worstMs: number } };

async function resetLongTaskObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const host = window as LongTaskWindow & { __pokevoxelLongTaskObserver?: PerformanceObserver };
    host.__pokevoxelLongTasks = { count: 0, totalMs: 0, worstMs: 0 };
    if (host.__pokevoxelLongTaskObserver) return;
    const observer = new PerformanceObserver((list) => {
      const bucket = (window as LongTaskWindow).__pokevoxelLongTasks;
      if (!bucket) return;
      for (const entry of list.getEntries()) {
        bucket.count += 1;
        bucket.totalMs += entry.duration;
        bucket.worstMs = Math.max(bucket.worstMs, entry.duration);
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
    host.__pokevoxelLongTaskObserver = observer;
  });
}

/** Hold arrow keys in a loop until the deadline, like a player walking. */
export async function walkArrows(page: Page, deadlineAt: number): Promise<void> {
  const directions = ['ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowRight'];
  let index = 0;
  await page.locator('canvas').focus();
  while (Date.now() < deadlineAt) {
    const key = directions[index % directions.length]!;
    index += 1;
    await page.keyboard.down(key);
    await page.waitForTimeout(450);
    await page.keyboard.up(key);
    await page.waitForTimeout(60);
  }
}

/**
 * Sample the Lua frame probe, main-thread long tasks, and rAF pacing for one
 * labelled window while an optional activity (walking, key storms) runs.
 */
export async function collectFramePerf(page: Page, label: string, durationMs: number, activity?: (deadlineAt: number) => Promise<void>): Promise<FramePerfEvidence> {
  await resetLongTaskObserver(page);
  const rafPromise = page.evaluate(async (ms: number) => {
    const samples: number[] = [];
    let before = performance.now();
    const until = before + ms;
    while (performance.now() < until) {
      await new Promise<void>((resolve) => requestAnimationFrame((now) => {
        samples.push(now - before);
        before = now;
        resolve();
      }));
    }
    samples.sort((left, right) => left - right);
    const at = (q: number): number => samples[Math.min(samples.length - 1, Math.floor(samples.length * q))] ?? 0;
    return {
      frames: samples.length,
      p95Ms: at(0.95),
      p99Ms: at(0.99),
      worstMs: samples[samples.length - 1] ?? 0,
      over25Ms: samples.filter((sample) => sample > 25).length,
      over50Ms: samples.filter((sample) => sample > 50).length,
    };
  }, durationMs);
  const deadlineAt = Date.now() + durationMs;
  const activityDone = activity ? activity(deadlineAt) : Promise.resolve();
  const probes: FrameProbe[] = [];
  const seen = new Set<string>();
  while (Date.now() < deadlineAt) {
    const marker = page.getByTestId('frame-probe');
    if (await marker.isVisible()) {
      const raw = await marker.innerText();
      if (raw && !seen.has(raw)) { seen.add(raw); probes.push(JSON.parse(raw) as FrameProbe); }
    }
    await page.waitForTimeout(350);
  }
  await activityDone;
  const raf = await rafPromise;
  const longTasks = await page.evaluate(() => (window as LongTaskWindow).__pokevoxelLongTasks ?? { count: 0, totalMs: 0, worstMs: 0 });
  return { label, probes, longTasks, raf };
}

/** One machine-greppable evidence line per window; contains no paths. */
export function reportFramePerf(evidence: FramePerfEvidence): void {
  console.log(`POKEVOXEL_PERF_EVIDENCE ${JSON.stringify(evidence)}`);
}

/** Log the sanitized shell state and bounded runtime diagnostics. */
export async function dumpSceneContext(page: Page, label = 'final'): Promise<void> {
  const context = await page.evaluate(() => {
    const host = window as Window & { Module?: { pokevoxelRuntimeDiagnostics?: unknown } };
    const diagnostics = Array.isArray(host.Module?.pokevoxelRuntimeDiagnostics)
      ? (host.Module?.pokevoxelRuntimeDiagnostics as unknown[]).filter((value): value is string => typeof value === 'string')
      : [];
    return { shellState: document.querySelector('[data-testid="pokevoxel-app"]')?.getAttribute('data-shell-state') ?? 'unknown', diagnostics };
  }).catch(() => ({ shellState: 'page-unavailable', diagnostics: [] as string[] }));
  console.log(`POKEVOXEL_PERF_CONTEXT ${JSON.stringify({ label, ...context })}`);
}

/** On scene-entry failure, log the sanitized shell context before rethrowing. */
export async function withSceneDiagnostics<T>(page: Page, step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    await dumpSceneContext(page, 'failure');
    throw error;
  }
}
