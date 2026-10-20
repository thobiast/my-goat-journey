import { test, expect } from '@playwright/test';
import { openReviewSupporting } from './support/management-fixtures';
import {
  setupScheduledHabits,
  openHabit,
  onDate,
  nav,
  readDataset,
} from './support/habit-fixtures';

test('A recorded first-due period with no occurrence rows survives a conflicting revisited-date edit', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await onDate(page, '2026-10-04');
  await openHabit(page);
  await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
  await page
    .locator('.habit-management .confirmation')
    .getByRole('button', { name: 'Archive habit', exact: true })
    .click();
  await page.getByRole('button', { name: 'Reactivate habit', exact: true }).click();
  await page
    .locator('.habit-management .confirmation')
    .getByRole('button', { name: 'Reactivate habit', exact: true })
    .click();
  await onDate(page, '2026-10-05');
  // Due reconciliation remounts review disclosures after committing the period.
  await expect
    .poll(async () => (await readDataset(page)).habits[1].periods.at(-1)!.start)
    .toBe('2026-10-05');
  await openReviewSupporting(page);
  await expect(page.getByText('Active', { exact: true })).toBeVisible();
  const before = await readDataset(page);
  expect(before.occurrences).toEqual([]);
  expect(before.habits[1].periods.at(-1)!.start).toBe('2026-10-05');
  await onDate(page, '2026-10-02');
  await openReviewSupporting(page);
  await page.getByRole('button', { name: 'Edit habit', exact: true }).click();
  await page.getByRole('button', { name: 'Monday', exact: true }).click();
  await page.getByRole('button', { name: 'Friday', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('These dates already have saved history.');
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  expect(await readDataset(page)).toEqual(before);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await nav(page, 'Settings').click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(
    /^my-goat-journey-backup-2026-10-02_\d{2}-\d{2}\.json$/,
  );
});
