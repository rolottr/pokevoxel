import { clearRomBuffer, type RomValidationErrorCode, type RomValidationResult, validateGen1Rom } from './romValidation';
import { LoveRuntimeAdapter } from '../runtime/LoveRuntimeAdapter';
import { LoveRuntimeHost } from '../runtime/LoveRuntimeHost';

export type RomSelectionOutcome =
  | { kind: 'accepted'; version: Extract<RomValidationResult, { ok: true }>['version'] }
  | { kind: 'error'; code: RomValidationErrorCode }
  | { kind: 'stale' };
export type RomValidator = (file: File) => Promise<RomValidationResult>;

/** Latest-selection-wins controller with no DOM, storage, or generic filesystem surface. */
export class RomSelectionController {
  private generation = 0;
  public constructor(
    private readonly host = new LoveRuntimeHost(),
    private readonly validate: RomValidator = validateGen1Rom,
  ) {}

  public get hasPendingRom(): boolean { return this.host.hasPendingRom; }

  public async select(file: File): Promise<RomSelectionOutcome> {
    const generation = ++this.generation;
    this.host.clearPendingRom();
    let result: RomValidationResult;
    try { result = await this.validate(file); }
    catch { result = { ok: false, code: 'unreadable' }; }
    if (generation !== this.generation) {
      if (result.ok) clearRomBuffer(result.buffer);
      return { kind: 'stale' };
    }
    if (!result.ok) {
      this.host.clearPendingRom();
      return { kind: 'error', code: result.code };
    }
    this.host.acceptValidatedRom(result.buffer);
    return { kind: 'accepted', version: result.version };
  }

  public retry(): void { this.cancel(); }
  public cancel(): void { this.generation += 1; this.host.clearPendingRom(); }
  public stage(adapter: LoveRuntimeAdapter): Promise<void> { return this.host.stagePendingRom(adapter); }
}
