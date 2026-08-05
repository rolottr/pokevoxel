export const CANONICAL_ROM_SIZE = 1_048_576;
export const CANONICAL_YELLOW_SIZE = CANONICAL_ROM_SIZE;
export const YELLOW_ROM_SIZE = CANONICAL_ROM_SIZE;
export const CANONICAL_RED_SHA1 = 'ea9bcae617fdf159b045185467ae58b2e4a48b9a';
export const CANONICAL_BLUE_SHA1 = 'd7037c83e1ae5b39bde3c30787637ba1d4c48ce2';
export const CANONICAL_YELLOW_SHA1 = 'cc7d03262ebfaf2f06772c1a480c7d9d5f4a38e1';

export const ROM_PROFILES = [
  { id: 'red', label: 'Red', sha1: CANONICAL_RED_SHA1 },
  { id: 'blue', label: 'Blue', sha1: CANONICAL_BLUE_SHA1 },
  { id: 'yellow', label: 'Yellow', sha1: CANONICAL_YELLOW_SHA1 },
] as const;
export type RomVersion = (typeof ROM_PROFILES)[number]['id'];

export type RomValidationErrorCode = 'unreadable' | 'wrong-size' | 'wrong-digest';
export type RomValidationResult = { ok: true; version: RomVersion; buffer: ArrayBuffer } | { ok: false; code: RomValidationErrorCode };
export type DigestFunction = (algorithm: AlgorithmIdentifier, data: BufferSource) => Promise<ArrayBuffer>;
export type RomValidationOptions = { digest?: DigestFunction };

const messages: Record<RomValidationErrorCode, string> = {
  unreadable: 'This file could not be read locally. Choose an original Pokémon Red, Blue, or Yellow ROM and try again.',
  'wrong-size': 'This is not a supported 1 MiB Pokémon Red, Blue, or Yellow ROM.',
  'wrong-digest': 'This file is not a canonical supported Pokémon Red, Blue, or Yellow ROM.',
};
export function romValidationMessage(code: RomValidationErrorCode): string { return messages[code]; }
export function clearRomBuffer(buffer: ArrayBuffer | undefined): void { if (buffer) new Uint8Array(buffer).fill(0); }
export const releaseRomBuffer = clearRomBuffer;

function hexDigest(buffer: ArrayBuffer): string { return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }

/** Size first; then SHA-1 in local memory. Successful callers own the buffer. */
export async function validateGen1Rom(file: Pick<File, 'size' | 'arrayBuffer'>, options: RomValidationOptions = {}): Promise<RomValidationResult> {
  if (file.size !== CANONICAL_ROM_SIZE) return { ok: false, code: 'wrong-size' };
  let bytes: ArrayBuffer;
  try { bytes = await file.arrayBuffer(); } catch { return { ok: false, code: 'unreadable' }; }
  try {
    const digest = options.digest ?? crypto.subtle.digest.bind(crypto.subtle);
    const sha1 = hexDigest(await digest('SHA-1', bytes));
    const profile = ROM_PROFILES.find((candidate) => candidate.sha1 === sha1);
    if (!profile) {
      clearRomBuffer(bytes);
      return { ok: false, code: 'wrong-digest' };
    }
    return { ok: true, version: profile.id, buffer: bytes };
  } catch {
    clearRomBuffer(bytes);
    return { ok: false, code: 'unreadable' };
  }
}
