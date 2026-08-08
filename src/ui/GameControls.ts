export type ControlItem = Readonly<{
  label: string;
  keys: readonly string[];
  description: string;
}>;

export type ControlSection = Readonly<{
  title: string;
  items: readonly ControlItem[];
}>;

export const CAMERA_LADDER = ['OFF', '15°', '35°', '50°', '75°', '1ST', '3RD'] as const;

export const QUICK_CONTROLS: readonly ControlItem[] = [
  { label: 'Move', keys: ['WASD', 'Arrows'], description: 'Walk or navigate menus.' },
  { label: 'A', keys: ['Z', 'Enter', 'Space'], description: 'Confirm or interact.' },
  { label: 'B', keys: ['X', 'Backspace'], description: 'Cancel or go back.' },
  { label: 'Save / load', keys: ['F1', 'F2'], description: 'Save or reload the ordinary game save.' },
  { label: 'Camera', keys: ['3'], description: 'Cycle the voxel camera ladder.' },
  { label: 'Zoom', keys: ['Q', 'E', 'Wheel'], description: 'Zoom the active 3D camera.' },
] as const;

export const CONTROL_SECTIONS: readonly ControlSection[] = [
  {
    title: 'Keyboard',
    items: [
      { label: 'Move', keys: ['WASD', 'Arrow keys'], description: 'Walk and navigate menus. In 1ST and 3RD, movement follows the camera.' },
      { label: 'A / confirm', keys: ['Z', 'Enter', 'Space'], description: 'Interact, choose, and advance text.' },
      { label: 'B / cancel', keys: ['X', 'Backspace'], description: 'Cancel or return.' },
      { label: 'Start', keys: ['Escape', 'Numpad Enter'], description: 'Open or close the game menu.' },
      { label: 'Select', keys: ['Tab', 'Left Shift', 'Right Shift'], description: 'Game Boy Select; in the overworld it also cycles the voxel camera.' },
      { label: 'Save / load', keys: ['F1', 'F2'], description: 'Write the ordinary save or reload it after the overworld is live.' },
      { label: 'Logic speed', keys: ['1'], description: 'Cycle game logic speed without changing audio speed.' },
      { label: 'Colors', keys: ['2'], description: 'Cycle the retained color modes.' },
      { label: 'Survey zoom', keys: ['-', '=', '4'], description: 'Step out, step in, or cycle the overworld survey zoom.' },
      { label: 'FPS monitor', keys: ['F8'], description: 'Show or hide live FPS, p99, and worst-frame timing.' },
      { label: 'Audio A/B', keys: ['F9'], description: 'Switch the live session between remastered HD and original 8BIT synthesis.' },
      { label: 'Mod options', keys: ['F10'], description: 'Open or close the built-in mod manager and its options.' },
    ],
  },
  {
    title: 'Voxel & cameras',
    items: [
      { label: 'Voxel camera', keys: ['3', 'Select'], description: `Cycle ${CAMERA_LADDER.join(' → ')} in the overworld.` },
      { label: 'FULL preset', keys: ['Options'], description: 'The full diorama preset is available from options only; the camera hotkey intentionally skips it.' },
      { label: 'Voxel grid', keys: ['5'], description: 'Cycle the voxel edge grid.' },
      { label: 'Tilt-shift pipeline', keys: ['6'], description: 'Cycle the tilt-shift presentation pipeline.' },
      { label: 'World curve', keys: ['7'], description: 'Cycle world curvature.' },
      { label: 'Staged 3D battles', keys: ['8'], description: 'Cycle staged 3D battle presentation.' },
      { label: 'Water rendering', keys: ['9'], description: 'Cycle the retained water presentation.' },
      { label: 'Free look', keys: ['Mouse', 'Right stick', '1-finger drag'], description: 'Look around in 1ST, 3RD, and staged battles; the mouse uses relative look in free cameras.' },
      { label: 'Camera zoom', keys: ['Q', 'E', 'Wheel', 'Stick clicks', 'Pinch'], description: 'Zoom survey, 3RD, or staged-battle cameras. 1ST intentionally has no zoom.' },
      { label: 'Mouse actions', keys: ['Left click', 'Right click'], description: 'While 1ST or 3RD captures the mouse, click for A and right-click for B.' },
    ],
  },
  {
    title: 'Controller',
    items: [
      { label: 'Move', keys: ['D-pad', 'Left stick'], description: 'Walk and navigate; free-camera modes use analog camera-relative movement.' },
      { label: 'Game Boy buttons', keys: ['A', 'B', 'Start', 'Back'], description: 'Confirm, cancel, Start, and Select using the detected controller layout.' },
      { label: 'Camera cycle', keys: ['Select'], description: 'Cycle the voxel camera ladder while in the overworld.' },
      { label: 'Look', keys: ['Right stick'], description: 'Look around in 1ST, 3RD, and staged battles.' },
      { label: 'Zoom', keys: ['Left-stick click', 'Right-stick click'], description: 'Zoom out or in for 3RD and staged-battle cameras.' },
      { label: 'Speed', keys: ['L1 / L2', 'R1 / R2'], description: 'Cycle logic speed down or up.' },
      { label: 'Display chords', keys: ['Select+A', 'Select+B', 'Select+Y', 'Select+X', 'Select+L'], description: 'Colors, voxel camera, voxel grid, tilt-shift, and world curve respectively.' },
    ],
  },
  {
    title: 'Touch',
    items: [
      { label: 'Game controls', keys: ['On-screen pad'], description: 'Use the movable D-pad, A, B, Start, and Select overlay.' },
      { label: 'Look / orbit', keys: ['1-finger drag'], description: 'Drag open screen to look in 1ST or 3RD, or orbit a staged battle.' },
      { label: 'Zoom', keys: ['2-finger pinch'], description: 'Pinch the survey, 3RD, or staged-battle camera.' },
    ],
  },
] as const;

function appendKeys(target: HTMLElement, keys: readonly string[]): void {
  keys.forEach((key, index) => {
    if (index > 0) {
      const separator = document.createElement('span');
      separator.className = 'control-key-separator';
      separator.setAttribute('aria-hidden', 'true');
      separator.textContent = '/';
      target.append(separator);
    }
    const keycap = document.createElement('kbd');
    keycap.textContent = key;
    target.append(keycap);
  });
}

function renderControlItem(item: ControlItem): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'control-row';
  const heading = document.createElement('dt');
  heading.textContent = item.label;
  const keys = document.createElement('span');
  keys.className = 'control-keys';
  appendKeys(keys, item.keys);
  heading.append(keys);
  const description = document.createElement('dd');
  description.textContent = item.description;
  row.append(heading, description);
  return row;
}

export function createGameControls(canvas: HTMLCanvasElement): HTMLElement {
  const controls = document.createElement('aside');
  controls.className = 'game-controls';
  controls.dataset.testid = 'game-controls';
  controls.setAttribute('aria-label', 'Game controls');
  controls.hidden = true;

  const label = document.createElement('p');
  label.className = 'game-controls__label';
  label.textContent = 'PLAY GUIDE';

  const quick = document.createElement('div');
  quick.className = 'quick-controls';
  quick.dataset.testid = 'quick-controls';
  QUICK_CONTROLS.forEach((item) => {
    const shortcut = document.createElement('span');
    shortcut.className = 'quick-control';
    const name = document.createElement('strong');
    name.textContent = item.label;
    const keys = document.createElement('span');
    keys.className = 'quick-control__keys';
    appendKeys(keys, item.keys);
    shortcut.append(name, keys);
    quick.append(shortcut);
  });

  const details = document.createElement('details');
  details.className = 'all-controls';
  const summary = document.createElement('summary');
  summary.textContent = 'All controls';
  const panel = document.createElement('div');
  panel.className = 'all-controls__panel';
  const intro = document.createElement('p');
  intro.className = 'all-controls__intro';
  intro.textContent = 'Default mappings · Rebind Game Boy buttons from Options → Controls';
  panel.append(intro);
  for (const section of CONTROL_SECTIONS) {
    const block = document.createElement('section');
    block.className = 'control-section';
    const title = document.createElement('h2');
    title.textContent = section.title;
    const list = document.createElement('dl');
    section.items.forEach((entry) => list.append(renderControlItem(entry)));
    block.append(title, list);
    panel.append(block);
  }
  details.append(summary, panel);
  controls.append(label, quick, details);

  controls.addEventListener('click', () => {
    queueMicrotask(() => canvas.focus({ preventScroll: true }));
  });
  return controls;
}
