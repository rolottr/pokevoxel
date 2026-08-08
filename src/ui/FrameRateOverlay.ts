import type { FrameProbe } from '../runtime/runtimeEvents';

export type FrameRateTone = 'waiting' | 'smooth' | 'warning' | 'slow';

export type FrameRateView = Readonly<{
  fps: string;
  p99: string;
  worst: string;
  tone: FrameRateTone;
}>;

export function fpsFromAverageMs(avgMs: number): number {
  return Number.isFinite(avgMs) && avgMs > 0 ? Math.round(1000 / avgMs) : 0;
}

export function frameRateTone(p99Ms: number): Exclude<FrameRateTone, 'waiting'> {
  if (p99Ms <= 18) return 'smooth';
  if (p99Ms <= 33) return 'warning';
  return 'slow';
}

export function frameRateView(probe?: FrameProbe): FrameRateView {
  if (!probe) return { fps: '--', p99: '--', worst: '--', tone: 'waiting' };
  return {
    fps: String(fpsFromAverageMs(probe.avgMs)),
    p99: `${probe.p99Ms.toFixed(1)} ms`,
    worst: `${probe.worstMs.toFixed(1)} ms`,
    tone: frameRateTone(probe.p99Ms),
  };
}

function metric(label: string, slot: string): HTMLElement {
  const row = document.createElement('p');
  row.className = 'fps-overlay__metric';
  const name = document.createElement('span');
  name.textContent = label;
  const value = document.createElement('strong');
  value.dataset.slot = slot;
  value.textContent = '--';
  row.append(name, value);
  return row;
}

export function createFrameRateOverlay(): HTMLElement {
  const overlay = document.createElement('aside');
  overlay.className = 'fps-overlay';
  overlay.dataset.testid = 'fps-overlay';
  overlay.dataset.tone = 'waiting';
  overlay.setAttribute('aria-label', 'Frame rate monitor');
  overlay.hidden = true;

  const headline = document.createElement('p');
  headline.className = 'fps-overlay__headline';
  const value = document.createElement('strong');
  value.dataset.slot = 'fps';
  value.textContent = '--';
  const unit = document.createElement('span');
  unit.textContent = 'FPS';
  headline.append(value, unit);

  const details = document.createElement('div');
  details.className = 'fps-overlay__details';
  details.append(metric('P99', 'p99'), metric('WORST', 'worst'));
  overlay.append(headline, details);
  return overlay;
}

export function updateFrameRateOverlay(overlay: HTMLElement, probe: FrameProbe | undefined, visible: boolean): void {
  const view = frameRateView(probe);
  overlay.hidden = !visible;
  overlay.dataset.tone = view.tone;
  overlay.querySelector<HTMLElement>('[data-slot="fps"]')!.textContent = view.fps;
  overlay.querySelector<HTMLElement>('[data-slot="p99"]')!.textContent = view.p99;
  overlay.querySelector<HTMLElement>('[data-slot="worst"]')!.textContent = view.worst;
}
