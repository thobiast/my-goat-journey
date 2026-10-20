import type { Dataset } from '../src/domain/types';
import { test, expect } from '@playwright/test';
import { setupScheduledHabits, nav, readDataset, abortNextWrite } from './support/habit-fixtures';
import { readFile, writeFile } from 'node:fs/promises';

test.setTimeout(90_000);
test('Oversized file is rejected before confirmation and quota-aborted restore preserves committed facts', async ({
  page,
}, testInfo) => {
  await setupScheduledHabits(page);
  await nav(page, 'Settings').click();
  const before = await readDataset(page);
  const oversizedPath = testInfo.outputPath('too-large.json');
  await writeFile(oversizedPath, Buffer.alloc(20 * 1024 * 1024 + 1, 32));
  await page.getByLabel('Choose backup file', { exact: true }).setInputFiles(oversizedPath);
  await expect(page.getByRole('alert')).toContainText('20 MiB');
  await expect(page.getByRole('alert')).toContainText('Choose another backup');
  await expect(page.getByRole('button', { name: 'Replace current data', exact: true })).toHaveCount(
    0,
  );
  expect(await readDataset(page)).toEqual(before);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup', exact: true }).click();
  const download = await pending;
  const bytes = await readFile((await download.path())!);
  await page.getByRole('checkbox', { name: 'Reduce motion', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Reduce motion', exact: true })).toBeChecked();
  const changed = await readDataset(page);
  await page
    .getByLabel('Choose backup file', { exact: true })
    .setInputFiles({ name: 'valid.json', mimeType: 'application/json', buffer: bytes });
  await expect(page.getByText('Backup ready', { exact: true })).toBeVisible();
  await abortNextWrite(page, true);
  await page.getByRole('button', { name: 'Replace current data', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not save');
  expect(await readDataset(page)).toEqual(changed);
  await page.reload();
  expect(await readDataset(page)).toEqual(changed);
});
test('Oversized export creates no download, never truncates text and leaves the diary usable', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('my-goat-journey');
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('dataset', 'readwrite');
          const store = tx.objectStore('dataset');
          const get = store.get('current');
          get.onsuccess = () => {
            // Onboarding committed this fixture; only its unlock text is oversized.
            const data = get.result as Dataset;
            data.permanentUnlocks = [
              { id: 'é'.repeat(11 * 1024 * 1024), unlockedAt: '2026-09-27T12:00:00.000Z' },
            ];
            data.revision++;
            store.put(data, 'current');
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
        request.onerror = () => reject(request.error);
      }),
  );
  await page.reload();
  await nav(page, 'Settings').click();
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.getByRole('button', { name: 'Export backup', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'This backup exceeds the supported 20 MiB limit. Your records are unchanged.',
  );
  expect(downloads).toBe(0);
  const stored = await readDataset(page);
  expect(stored.permanentUnlocks[0].id).toHaveLength(11 * 1024 * 1024);
  await expect(
    page.getByText('Download started. Keep the file safe.', { exact: true }),
  ).toHaveCount(0);
  await nav(page, 'Today').click();
  await expect(page.getByRole('checkbox')).toHaveCount(4);
  await page.reload();
  expect((await readDataset(page)).revision).toBe(stored.revision);
});
