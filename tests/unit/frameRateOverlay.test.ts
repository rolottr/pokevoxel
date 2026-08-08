import { describe, expect, it } from 'vitest';
import type { FrameProbe } from '../../src/runtime/runtimeEvents';
import { fpsFromAverageMs, frameRateTone, frameRateView } from '../../src/ui/FrameRateOverlay';

const probe = (detail: Partial<FrameProbe> = {}): FrameProbe => ({
  frames: 120,
  avgMs: 16.67,
  p99Ms: 24.5,
  worstMs: 41.2,
  avgUpdateMs: 6.1,
  avgDrawMs: 5.4,
  avgPresentMs: 1.2,
  worstUpdateMs: 10,
  worstDrawMs: 12,
  worstPresentMs: 4,
  gcMs: 0.1,
  memKb: 2048,
  drawCalls: 120,
  canvasSwitches: 4,
  meshJobs: 0,
  meshUploads: 0,
  meshMs: 0,
  shadowMs: 0,
  audioQueued: 3,
  ...detail,
});

describe('frame rate overlay', () => {
  it('derives a whole FPS value from the measured average frame time', () => {
    expect(fpsFromAverageMs(16.67)).toBe(60);
    expect(fpsFromAverageMs(33.33)).toBe(30);
    expect(fpsFromAverageMs(0)).toBe(0);
    expect(fpsFromAverageMs(Number.NaN)).toBe(0);
  });

  it('uses p99 timing to flag smooth, warning, and slow windows', () => {
    expect(frameRateTone(18)).toBe('smooth');
    expect(frameRateTone(18.1)).toBe('warning');
    expect(frameRateTone(33)).toBe('warning');
    expect(frameRateTone(33.1)).toBe('slow');
  });

  it('formats the live readings and a waiting state', () => {
    expect(frameRateView()).toEqual({ fps: '--', p99: '--', worst: '--', tone: 'waiting' });
    expect(frameRateView(probe())).toEqual({ fps: '60', p99: '24.5 ms', worst: '41.2 ms', tone: 'warning' });
  });
});
