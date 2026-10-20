import { backControl } from './support/management-fixtures';
import { test, expect } from '@playwright/test';
import { setupScheduledHabits, openHabit, nav, readDataset } from './support/habit-fixtures';
import { readFile } from 'node:fs/promises';

test.setTimeout(90_000);
test('Replacing with different identities clears old detail context before explicit primary navigation', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await openHabit(page);
  await nav(page, 'Settings').click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup', exact: true }).click();
  const download = await pending;
  const envelope = JSON.parse((await readFile((await download.path())!)).toString('utf8'));
  for (const habit of envelope.dataset.habits) habit.id = `restored-${habit.id}`;
  await page.getByLabel('Choose backup file', { exact: true }).setInputFiles({
    name: 'different-diary.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(envelope)),
  });
  await expect(page.getByText('Backup ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Replace current data', exact: true }).click();
  await expect(page.getByText('Backup restored.', { exact: true })).toBeVisible();
  await expect(backControl(page)).toHaveCount(0);
  await nav(page, 'Today').click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible({
    timeout: 1500,
  });
  const restored = await readDataset(page);
  expect(restored.habits.every((h) => h.id.startsWith('restored-'))).toBe(true);
  const { revision: _revision, ...facts } = restored;
  expect(facts).toEqual(envelope.dataset);
  await openHabit(page);
  await backControl(page).click();
  await expect(
    page.getByRole('heading', { name: 'Progress', exact: true, level: 1 }),
  ).toBeVisible();
  expect(await readDataset(page)).toEqual(restored);
});
