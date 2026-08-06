import type { ShellState } from '../app/PokevoxelApp';
import { ROM_PROFILES, type RomVersion } from '../import/romValidation';
import type { PersistenceErrorCode, PersistenceStatus } from '../persistence/DurableGenerationStore';
import type { AudioRendererPreference } from '../runtime/LoveRuntimeAdapter';
import type { AudioProbe, BattleProbe, BattleReturnProbe, FirstPersonParityProbe, FirstPersonProbe, FirstPersonReleaseProbe, PersistenceSummary, VoxelOcclusionProbe, VoxelProbe, WaterProbe } from '../runtime/runtimeEvents';

export type WelcomeScreenOptions = {
  model: { state: ShellState; gameVersion?: RomVersion; error?: string; errorCode?: string; progress?: number; audioState?: string; audioResumeFailed?: boolean; cacheRestored?: boolean; titleReady?: boolean; newGameStarted?: boolean; overworldReady?: boolean; persistenceStatus?: PersistenceStatus; persistenceErrorCode?: PersistenceErrorCode; persistenceRestored?: boolean; persistenceCommittedSummary?: PersistenceSummary; persistenceRestoredSummary?: PersistenceSummary; persistenceResumedSummary?: PersistenceSummary; audioProbe?: AudioProbe; voxelProbe?: VoxelProbe; voxelOcclusionProbe?: VoxelOcclusionProbe; waterProbe?: WaterProbe; battleProbe?: BattleProbe; battleReturnProbe?: BattleReturnProbe; firstPersonProbe?: FirstPersonProbe; firstPersonReleaseProbe?: FirstPersonReleaseProbe; firstPersonParityProbe?: FirstPersonParityProbe; overworldInputReady?: boolean; battleInputPhase?: 'none' | 'menu' | 'move' | 'messages'; storageWarning?: string };
  onFile: (file: File) => void;
  onReset: () => void;
  onClearAcceptedRom: () => void;
  onClearRebuildableCache: () => void;
  onStartGame: () => void;
  onReenableAudio: () => void;
  audioRenderer: AudioRendererPreference;
  onAudioRendererChange: (renderer: AudioRendererPreference) => void;
};

function editionLabel(version: RomVersion | undefined): string { return ROM_PROFILES.find((profile) => profile.id === version)?.label ?? 'Gen I'; }
function statusCopy(state: ShellState, version: RomVersion | undefined): string {
  if (state === 'validating') return 'Checking your file locally…';
  if (state === 'importing') return 'Preparing your game locally…';
  if (state === 'cache-ready') return 'Import complete. Start when you are ready.';
  if (state === 'starting') return `Starting Pokémon ${editionLabel(version)}…`;
  return 'Choose your own Pokémon Red, Blue, or Yellow ROM to begin.';
}

function progressValue(progress: number | undefined): number {
  return Math.max(0, Math.min(100, Math.round((progress ?? 0) * 100)));
}

function externalIconLink(label: string, href: string, testId: string, icon: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'panel-icon-link';
  link.dataset.testid = testId;
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', label);
  link.title = label;
  link.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="${icon}"/></svg>`;
  return link;
}

export function persistenceStatusCopy(status: PersistenceStatus | undefined): string {
  if (status === 'saving') return 'Saving...';
  if (status === 'saved') return 'Saved';
  if (status === 'failed') return 'Save failed';
  return 'Not saved yet';
}
export function shouldOfferCacheRecovery(code: PersistenceErrorCode | undefined): boolean {
  return code === 'PERSISTENCE_QUOTA_EXCEEDED' || code === 'PERSISTENCE_PERMISSION_DENIED';
}

export function renderWelcomeScreen({ model, onFile, onReset, onClearAcceptedRom, onClearRebuildableCache, onStartGame, onReenableAudio, audioRenderer, onAudioRendererChange }: WelcomeScreenOptions): HTMLElement {
  const shell = document.createElement('main');
  shell.className = `welcome-shell shell-${model.state}`;
  shell.dataset.shellState = model.state;
  if (model.firstPersonReleaseProbe) {
    const probe = document.createElement('p'); probe.className = 'visually-hidden'; probe.dataset.testid = 'first-person-release-probe';
    probe.textContent = JSON.stringify(model.firstPersonReleaseProbe); shell.append(probe);
  }

  if (model.state === 'playing') {
    shell.classList.add('runtime-handoff');
    const audio = document.createElement('p');
    audio.className = 'visually-hidden';
    audio.dataset.testid = 'audio-state';
    audio.textContent = model.audioState ?? 'running';
    const persistence = document.createElement('p');
    persistence.className = 'persistence-indicator'; persistence.dataset.testid = 'persistence-status'; persistence.setAttribute('aria-live', 'polite');
    persistence.textContent = persistenceStatusCopy(model.persistenceStatus);
    shell.append(audio, persistence);
    if (model.newGameStarted || model.titleReady) {
      const ready = document.createElement('p');
      ready.className = 'visually-hidden';
      ready.dataset.testid = model.newGameStarted ? 'yellow-new-game-started' : 'yellow-runtime-title-ready';
      ready.setAttribute('aria-live', 'polite');
      ready.textContent = model.newGameStarted ? 'A new game has started.' : `Pokémon ${editionLabel(model.gameVersion)} title is ready.`;
      shell.append(ready);
    }
    if (model.audioResumeFailed) {
      const reenable = document.createElement('button'); reenable.type = 'button'; reenable.className = 'reenable-audio'; reenable.dataset.testid = 'reenable-audio'; reenable.textContent = 'Enable audio'; reenable.addEventListener('click', onReenableAudio); shell.append(reenable);
    }
    if (model.battleInputPhase) { const phaseMarker = document.createElement('p'); phaseMarker.className = 'visually-hidden'; phaseMarker.dataset.testid = 'battle-input-phase'; phaseMarker.textContent = model.battleInputPhase; shell.append(phaseMarker); }
    if (model.overworldInputReady !== undefined) { const readyMarker = document.createElement('p'); readyMarker.className = 'visually-hidden'; readyMarker.dataset.testid = 'overworld-input-ready'; readyMarker.textContent = String(model.overworldInputReady); shell.append(readyMarker); }
    if (model.audioProbe) {
      const probe = document.createElement('p'); probe.className = 'visually-hidden'; probe.dataset.testid = 'audio-probe';
      probe.textContent = JSON.stringify(model.audioProbe); shell.append(probe);
    }
    if (model.voxelProbe) {
      const probe = document.createElement('p'); probe.className = 'visually-hidden'; probe.dataset.testid = 'voxel-probe';
      probe.textContent = JSON.stringify(model.voxelProbe); shell.append(probe);
    }
    if (model.voxelOcclusionProbe) {
      const probe = document.createElement('p'); probe.className = 'visually-hidden'; probe.dataset.testid = 'voxel-occlusion-probe';
      probe.textContent = JSON.stringify(model.voxelOcclusionProbe); shell.append(probe);
    }
    if (model.waterProbe) {
      const probe = document.createElement('p'); probe.className = 'visually-hidden'; probe.dataset.testid = 'water-probe';
      probe.textContent = JSON.stringify(model.waterProbe); shell.append(probe);
    }
    if (model.battleProbe) {
      const probe = document.createElement('p'); probe.className = 'visually-hidden'; probe.dataset.testid = 'battle-probe';
      probe.textContent = JSON.stringify(model.battleProbe); shell.append(probe);
    }
    if (model.battleReturnProbe) {
      const probe = document.createElement('p'); probe.className = 'visually-hidden'; probe.dataset.testid = 'battle-return-probe';
      probe.textContent = JSON.stringify(model.battleReturnProbe); shell.append(probe);
    }
    if (model.firstPersonProbe) {
      const probe = document.createElement('p'); probe.className = 'visually-hidden'; probe.dataset.testid = 'first-person-probe';
      probe.textContent = JSON.stringify(model.firstPersonProbe); shell.append(probe);
    }
    if (model.firstPersonParityProbe) {
      const probe = document.createElement('p'); probe.className = 'visually-hidden'; probe.dataset.testid = 'first-person-parity-probe';
      probe.textContent = JSON.stringify(model.firstPersonParityProbe); shell.append(probe);
    }
    if (shouldOfferCacheRecovery(model.persistenceErrorCode)) {
      const recovery = document.createElement('button'); recovery.type = 'button'; recovery.className = 'quiet-button'; recovery.dataset.testid = 'clear-rebuildable-cache'; recovery.textContent = 'Clear rebuildable game cache'; recovery.addEventListener('click', onClearRebuildableCache); shell.append(recovery);
    }
    if (model.persistenceRestored) {
      const restored = document.createElement('span'); restored.hidden = true; restored.dataset.testid = 'persistence-restored'; shell.append(restored);
    }
    if (model.overworldReady) {
      const overworld = document.createElement('p'); overworld.className = 'visually-hidden'; overworld.dataset.testid = 'overworld-ready'; overworld.textContent = 'Overworld ready.'; shell.append(overworld);
    }
    for (const summary of [model.persistenceCommittedSummary, model.persistenceRestoredSummary, model.persistenceResumedSummary]) {
      if (!summary) continue;
      const marker = document.createElement('p'); marker.className = 'visually-hidden'; marker.dataset.testid = `persistence-summary-${summary.phase}`;
      marker.textContent = JSON.stringify(summary);
      shell.append(marker);
    }
    return shell;
  }

  const panel = document.createElement('section');
  panel.className = 'welcome-panel';
  panel.setAttribute('aria-labelledby', 'welcome-title');

  const panelTools = document.createElement('nav');
  panelTools.className = 'panel-tools';
  panelTools.setAttribute('aria-label', 'Pokevoxel links');
  panelTools.append(
    externalIconLink('Pokevoxel on GitHub', 'https://github.com/rolottr/pokevoxel', 'github-link', 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.835 2.809 1.305 3.495.998.108-.776.418-1.305.762-1.604-2.665-.305-5.466-1.332-5.466-5.931 0-1.31.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.51 11.51 0 0 1 12 6.847c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.61-2.805 5.624-5.475 5.921.43.371.823 1.102.823 2.222 0 1.606-.014 2.898-.014 3.293 0 .322.216.694.825.576C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12'),
    externalIconLink('rolottr on X', 'https://x.com/rolottr', 'x-link', 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z'),
  );

  if (model.state === 'cache-ready') {
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'start-over-icon';
    reset.dataset.testid = 'start-over';
    reset.setAttribute('aria-label', 'Start over');
    reset.title = 'Start over';
    reset.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 4v6h6M5.6 15.5A7 7 0 1 0 6 7.4L4 10"/></svg>';
    reset.addEventListener('click', onClearAcceptedRom);
    panelTools.append(reset);
  }
  panel.append(panelTools);

  const brand = document.createElement('header');
  brand.className = 'brand-lockup';
  brand.dataset.testid = 'pokevoxel-logo';
  const brandVoxel = document.createElement('span');
  brandVoxel.className = 'brand-voxel';
  brandVoxel.setAttribute('aria-hidden', 'true');
  brandVoxel.innerHTML = '<i></i><i></i><i></i>';
  const brandCopy = document.createElement('div');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'LOCAL CARTRIDGE CLUB · BROWSER EDITION';
  const title = document.createElement('h1');
  title.id = 'welcome-title';
  title.innerHTML = 'POKE<span>VOXEL</span>';
  brandCopy.append(eyebrow, title);
  brand.append(brandVoxel, brandCopy);
  const privacy = document.createElement('p');
  privacy.className = 'privacy-note';
  privacy.dataset.testid = 'privacy-copy';
  privacy.textContent = 'Your ROM stays on this device. Validation and import run locally. Your ROM is never uploaded or durably stored as raw bytes.';

  const picker = document.createElement('label');
  picker.className = 'rom-picker';
  picker.dataset.testid = 'rom-drop-target';
  picker.tabIndex = 0;
  picker.htmlFor = 'gen1-rom-input';
  picker.setAttribute('role', 'button');
  picker.setAttribute('aria-describedby', 'rom-requirements rom-privacy');
  const input = document.createElement('input');
  input.id = 'gen1-rom-input';
  input.type = 'file';
  input.accept = '.gb,.gbc,application/octet-stream';
  input.className = 'visually-hidden';
  input.tabIndex = -1;
  input.dataset.testid = 'rom-file-input';
  const disabled = model.state === 'validating' || model.state === 'importing' || model.state === 'cache-ready' || model.state === 'starting';
  input.disabled = disabled;
  picker.setAttribute('aria-disabled', String(disabled));
  input.addEventListener('change', () => { const file = input.files?.item(0); if (file) onFile(file); });
  const pickerArt = document.createElement('span');
  pickerArt.className = 'cartridge-mark'; pickerArt.setAttribute('aria-hidden', 'true'); pickerArt.innerHTML = '<i>R</i><i>B</i><i>Y</i>';
  const pickerText = document.createElement('span');
  pickerText.className = 'picker-text'; pickerText.innerHTML = '<strong>Select your Gen I ROM</strong><small>Red, Blue, or Yellow · or drop it here</small>';
  picker.append(input, pickerArt, pickerText);
  const drop = (event: DragEvent) => { event.preventDefault(); picker.classList.remove('is-dragging'); const file = event.dataTransfer?.files.item(0); if (file && !disabled) onFile(file); };
  picker.addEventListener('dragover', (event) => { if (!disabled) { event.preventDefault(); picker.classList.add('is-dragging'); } });
  picker.addEventListener('dragleave', () => picker.classList.remove('is-dragging'));
  picker.addEventListener('drop', drop);
  picker.addEventListener('keydown', (event) => { if (!disabled && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); input.click(); } });

  const requirements = document.createElement('p');
  requirements.id = 'rom-requirements'; requirements.className = 'requirements'; requirements.textContent = 'Required: an original 1 MiB US Pokémon Red, Blue, or Yellow Game Boy ROM.';
  const hashes = document.createElement('ul');
  hashes.className = 'rom-sha-list';
  hashes.dataset.testid = 'rom-sha-list';
  hashes.setAttribute('aria-label', 'Supported canonical ROM SHA-1 fingerprints');
  for (const profile of ROM_PROFILES) {
    const item = document.createElement('li');
    item.className = `rom-sha rom-sha--${profile.id}`;
    const label = document.createElement('span'); label.textContent = `Pokémon ${profile.label}`;
    const digest = document.createElement('code'); digest.textContent = profile.sha1;
    item.append(label, digest); hashes.append(item);
  }
  const audioChoice = document.createElement('label');
  audioChoice.className = 'audio-driver-choice';
  audioChoice.htmlFor = 'pokeaudio-hd-choice';
  const audioInput = document.createElement('input');
  audioInput.id = 'pokeaudio-hd-choice';
  audioInput.type = 'checkbox';
  audioInput.checked = audioRenderer === 'pokeaudio-hd';
  audioInput.disabled = model.state === 'starting';
  audioInput.dataset.testid = 'hd-audio-checkbox';
  audioInput.addEventListener('change', () => onAudioRendererChange(audioInput.checked ? 'pokeaudio-hd' : 'stock'));
  const audioCopy = document.createElement('span');
  const audioTitle = document.createElement('strong');
  audioTitle.textContent = 'Use PokeAudio HD';
  const audioHelp = document.createElement('small');
  audioHelp.textContent = 'Uncheck for the original 8BIT audio driver.';
  audioCopy.append(audioTitle, audioHelp);
  audioChoice.append(audioInput, audioCopy);
  const status = document.createElement('p');
  status.className = 'shell-status';
  status.dataset.testid = model.state === 'error' ? 'import-error' : 'app-state';
  if (model.errorCode) status.dataset.errorCode = model.errorCode;
  status.setAttribute('aria-live', 'polite');
  status.textContent = model.error ?? (model.state === 'cache-ready' && model.cacheRestored ? `Your saved Pokémon ${editionLabel(model.gameVersion)} game files are ready. Start when you are ready.` : statusCopy(model.state, model.gameVersion));

  const actions = document.createElement('div'); actions.className = 'shell-actions';
  if (model.state === 'importing') {
    const progress = document.createElement('progress'); progress.className = 'import-progress'; progress.dataset.testid = 'import-progress'; progress.max = 100; progress.value = progressValue(model.progress); progress.setAttribute('aria-label', `Import progress ${progress.value}%`); actions.append(progress);
    const clear = document.createElement('button'); clear.type = 'button'; clear.textContent = 'Cancel import'; clear.addEventListener('click', onClearAcceptedRom); actions.append(clear);
  }
  if (model.state === 'cache-ready') {
    const committed = document.createElement('span'); committed.hidden = true; committed.dataset.testid = model.cacheRestored ? 'cache-restored' : 'cache-committed'; actions.append(committed);
    if (model.persistenceRestored) { const restored = document.createElement('span'); restored.hidden = true; restored.dataset.testid = 'persistence-restored'; actions.append(restored); }
    const start = document.createElement('button'); start.type = 'button'; start.className = 'start-game'; start.textContent = 'Start game'; start.addEventListener('click', onStartGame); actions.append(start);
  }
  if (model.state === 'starting') {
    const audio = document.createElement('p'); audio.className = 'audio-state'; audio.dataset.testid = 'audio-state'; audio.setAttribute('aria-live', 'polite'); audio.textContent = model.audioState ?? 'resuming'; actions.append(audio);
  }
  if (model.storageWarning) {
    const warning = document.createElement('p'); warning.className = 'storage-warning'; warning.dataset.testid = 'storage-warning'; warning.setAttribute('role', 'status'); warning.textContent = model.storageWarning; actions.append(warning);
  }
  if (model.state === 'error') {
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Choose another file'; retry.addEventListener('click', onReset); actions.append(retry);
    if (model.errorCode === 'storage-unavailable') {
      const clearCache = document.createElement('button'); clearCache.type = 'button'; clearCache.className = 'quiet-button'; clearCache.dataset.testid = 'clear-rebuildable-cache'; clearCache.textContent = 'Clear rebuildable game cache'; clearCache.addEventListener('click', onClearRebuildableCache); actions.append(clearCache);
    }
  }
  const footer = document.createElement('p'); footer.id = 'rom-privacy'; footer.className = 'footer-note'; footer.textContent = 'No account. No cloud library. No bundled game data.';
  panel.append(brand, privacy, picker, requirements, hashes, audioChoice, status, actions, footer);
  shell.append(panel);
  return shell;
}
