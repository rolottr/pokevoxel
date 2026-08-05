import { expect, test } from '@playwright/test';
import { expectNoRawRomInIndexedDb } from './privateRomAudit';

test('rejects IndexedDB keys and values that end in ROM extensions without inspecting ROM bytes', async ({ page }) => {
  await page.goto('/');
  const databaseName = 'pokevoxel-private-audit-fixture';
  await page.evaluate(async (name) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('fixture');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('fixture', 'readwrite');
      transaction.objectStore('fixture').put({ path: 'generated/forbidden.gbc' }, 'also-forbidden.gb');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, databaseName);

  await expect(expectNoRawRomInIndexedDb(page)).rejects.toThrow();
  await page.evaluate((name) => indexedDB.deleteDatabase(name), databaseName);
});
