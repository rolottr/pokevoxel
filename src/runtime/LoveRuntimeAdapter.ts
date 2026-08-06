import { clearRomBuffer } from '../import/romValidation';

export const STAGED_ROM_PATH = '/tmp/pokevoxel-rom.gb';
export const ROM_STAGING_PATH = STAGED_ROM_PATH;
export const AUDIO_RENDERERS = ['pokeaudio-hd', 'stock'] as const;
export type AudioRendererPreference = (typeof AUDIO_RENDERERS)[number];
const PERSISTENT_MOUNT_PATH = '/home/web_user/love';
export type FixedStageWriter = (data: Uint8Array) => Promise<void> | void;
type LegacyCapability = { stageFile: (path: typeof STAGED_ROM_PATH, data: ArrayBuffer) => Promise<void> | void };

/** The six, and only six, capabilities exposed by the patched runtime. */
export type LoveRuntimeCapabilities = {
  stageRom: (bytes: Uint8Array) => Promise<void>;
  persistentFsReady: () => Promise<void>;
  syncPersistentFs: (requestId: number) => Promise<void>;
  resumeAudio: () => Promise<void>;
  signalStart: (renderer: AudioRendererPreference) => Promise<void> | void;
  signalFocus: (focused: boolean) => Promise<void> | void;
  dispose: () => void;
};

/** Only exposes fixed-destination ROM staging and the browser runtime lifecycle. */
export class LoveRuntimeAdapter {
  private readonly stage?: FixedStageWriter | LegacyCapability;
  private readonly capabilities?: LoveRuntimeCapabilities;

  public constructor(value: FixedStageWriter | LegacyCapability | LoveRuntimeCapabilities) {
    if (typeof value === 'object' && 'persistentFsReady' in value) this.capabilities = value as LoveRuntimeCapabilities;
    else this.stage = value as FixedStageWriter | LegacyCapability;
  }

  public async stageRom(buffer: ArrayBuffer): Promise<void> {
    if (STAGED_ROM_PATH.startsWith(`${PERSISTENT_MOUNT_PATH}/`)) throw new Error('ROM staging must stay outside persistent storage.');
    try {
      if (this.capabilities) await this.capabilities.stageRom(new Uint8Array(buffer));
      else if (typeof this.stage === 'function') await this.stage(new Uint8Array(buffer));
      else if (this.stage) await this.stage.stageFile(STAGED_ROM_PATH, buffer);
      else throw new Error('Runtime staging capability is unavailable.');
    } finally { clearRomBuffer(buffer); }
  }

  public persistentFsReady(): Promise<void> { return this.capabilities?.persistentFsReady() ?? Promise.resolve(); }
  public syncPersistentFs(requestId: number): Promise<void> {
    if (!Number.isSafeInteger(requestId) || requestId < 1) return Promise.reject(new Error('POKEVOXEL_SYNC_REQUEST_INVALID'));
    return this.capabilities?.syncPersistentFs(requestId) ?? Promise.resolve();
  }
  public async resumeAudio(): Promise<void> { await this.capabilities?.resumeAudio(); }
  public async signalStart(renderer: AudioRendererPreference): Promise<void> {
    if (!AUDIO_RENDERERS.includes(renderer)) throw new Error('POKEVOXEL_AUDIO_RENDERER_INVALID');
    await this.capabilities?.signalStart(renderer);
  }
  public async signalFocus(focused: boolean): Promise<void> { await this.capabilities?.signalFocus(focused); }
  public dispose(): void { this.capabilities?.dispose(); }
}
