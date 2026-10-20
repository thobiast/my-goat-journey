import { test, expect } from '@playwright/test';
import { setupScheduledHabits, nav, readDataset } from './support/habit-fixtures';
import { readFile } from 'node:fs/promises';

test.setTimeout(90_000);
test('Settings exports an actual private backup with exact committed facts and portable revision', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await nav(page, 'Settings').click();
  await expect(page.getByRole('button', { name: 'Export backup', exact: true })).toBeVisible({
    timeout: 1500,
  });
  const before = await readDataset(page);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup', exact: true }).click();
  const download = await pending;
  const bytes = await readFile((await download.path())!);
  const backup = JSON.parse(bytes.toString('utf8'));
  expect(backup.format).toBe('my-goat-journey-backup');
  expect(backup.dataset.revision).toBeUndefined();
  const { revision: _revision, ...facts } = before;
  expect(backup.dataset).toEqual(facts);
  await expect(
    page.getByText('Download started. Keep the file safe.', { exact: true }),
  ).toBeVisible();
  expect(await readDataset(page)).toEqual(before);
  await page.screenshot({
    path: 'artifacts/habit-management/screenshots/settings-en-360.png',
    fullPage: true,
  });
});
