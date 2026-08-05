/** The browser runtime owns this one canvas for the life of the app. */
export type RuntimeScreen = { element: HTMLElement; canvas: HTMLCanvasElement };

export function createRuntimeScreen(): RuntimeScreen {
  const element = document.createElement('section');
  element.className = 'runtime-stage';
  element.setAttribute('aria-label', 'Game runtime');

  const canvas = document.createElement('canvas');
  canvas.id = 'canvas'; // Required by pinned love.js audio auto-resume listener.
  canvas.className = 'runtime-canvas';
  canvas.width = 1024;
  canvas.height = 768;
  // Keyboard gameplay must be reachable without a pointer; a bare canvas
  // cannot retain focus, so browser key events otherwise stay on the page.
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Pokevoxel game canvas');
  canvas.setAttribute('aria-hidden', 'true');
  element.append(canvas);
  return { element, canvas };
}

/** @deprecated Layer 1 compatibility helper; new callers retain createRuntimeScreen(). */
export function renderRuntimeScreen(state: string): HTMLElement {
  const screen = createRuntimeScreen();
  screen.element.dataset.state = state;
  screen.canvas.setAttribute('aria-hidden', state === 'playing' ? 'false' : 'true');
  return screen.element;
}
