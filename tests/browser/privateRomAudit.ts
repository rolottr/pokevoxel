import { expect, type Page } from '@playwright/test';

const CANONICAL_ROM_BYTES = 1_048_576;
const CANONICAL_ROM_SHA1 = 'cc7d03262ebfaf2f06772c1a480c7d9d5f4a38e1';
const STAGED_ROM_PATH = '/tmp/pokevoxel-rom.gb';

/** Empty IDBFS mounts and generated cache data are allowed; raw ROM bytes are not. */
export async function expectNoRawRomInIndexedDb(page: Page, privatePath?: string): Promise<void> {
  const hasRawRom = await page.evaluate(async ({ privatePath, sha1, stagedPath, canonicalBytes }) => {
    const privateName = privatePath?.split(/[\\/]/).at(-1) ?? '';
    const forbiddenText = (value: string) => /\.(?:gb|gbc)$/i.test(value) || value.includes(stagedPath) || value.includes(sha1)
      || (!!privatePath && value.includes(privatePath)) || (!!privateName && value.includes(privateName));
    const seen = new WeakSet<object>();
    const inspect = (value: unknown, depth = 0): boolean => {
      if (typeof value === 'string') return forbiddenText(value);
      if (value instanceof ArrayBuffer) return value.byteLength === canonicalBytes;
      if (ArrayBuffer.isView(value)) return value.byteLength === canonicalBytes;
      if (value instanceof Blob) return value.size === canonicalBytes;
      if (!value || typeof value !== 'object' || depth > 5 || seen.has(value)) return false;
      seen.add(value);
      return Object.values(value as Record<string, unknown>).some((entry) => inspect(entry, depth + 1));
    };
    const open = (name: string) => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    for (const { name } of await indexedDB.databases()) {
      if (!name) continue;
      const database = await open(name);
      try {
        for (const storeName of Array.from(database.objectStoreNames)) {
          const store = database.transaction(storeName, 'readonly').objectStore(storeName);
          const readAll = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
            request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
          });
          const [keys, values] = await Promise.all([readAll(store.getAllKeys()), readAll(store.getAll())]);
          if (keys.some((key) => inspect(key)) || values.some((value) => inspect(value))) return true;
        }
      } finally { database.close(); }
    }
    return false;
  }, { privatePath, sha1: CANONICAL_ROM_SHA1, stagedPath: STAGED_ROM_PATH, canonicalBytes: CANONICAL_ROM_BYTES });
  expect(hasRawRom).toBe(false);
}
