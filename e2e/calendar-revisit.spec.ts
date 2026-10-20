import { openReviewSupporting } from './support/management-fixtures';
import { test, expect } from '@playwright/test';
import {
  setupScheduledHabits,
  nav,
  onDate,
  openHabit,
  readDataset,
  scheduledHabitGoals,
} from './support/habit-fixtures';
import { readFile } from 'node:fs/promises';

test.setTimeout(60_000);

test('Friday edit then Saturday completion then Friday revisit cannot overwrite recorded Saturday or its 10 XP', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await setupScheduledHabits(page);
  await onDate(page, '2026-10-02');
  await openHabit(page);
  await page.getByRole('button', { name: 'Edit habit', exact: true }).click();
  await page.getByLabel('Habit', { exact: true }).fill('Saturday exact walk');
  await expect(page.getByRole('button', { name: 'Every day', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('button', { name: 'Every day', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Every day', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await openReviewSupporting(page);
  await expect(page.getByRole('heading', { name: /Pending changes/ })).toBeVisible();
  await onDate(page, '2026-10-03');
  await nav(page, 'Today').click();
  const done = page.getByRole('checkbox', { name: 'Done: Saturday exact walk', exact: true });
  await done.click();
  await expect(done).toBeChecked();
  const before = await readDataset(page);
  const id = before.habits[1].id;
  expect(before.occurrences.filter((o) => o.habitId === id)).toHaveLength(1);
  await openHabit(page, 'Saturday exact walk');
  await expect(page.getByText('10 XP', { exact: true })).toBeVisible();
  await onDate(page, '2026-10-02');
  await nav(page, 'Progress').click();
  await openHabit(page, scheduledHabitGoals[1]);
  await page.getByRole('button', { name: 'Edit pending changes', exact: true }).click();
  for (const day of ['Sunday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'])
    await page.getByRole('button', { name: day, exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('saved history');
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  expect(await readDataset(page)).toEqual(before);
  await page.reload();
  expect(await readDataset(page)).toEqual(before);
  await onDate(page, '2026-10-03');
  await nav(page, 'Today').click();
  await expect(
    page.getByRole('checkbox', { name: 'Done: Saturday exact walk', exact: true }),
  ).toBeChecked();
  await openHabit(page, 'Saturday exact walk');
  await expect(page.getByText('10 XP', { exact: true })).toBeVisible();
  await nav(page, 'Settings').click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup', exact: true }).click();
  const download = await pending;
  const exported = JSON.parse((await readFile((await download.path())!)).toString('utf8'));
  const { revision: _revision, ...facts } = before;
  expect(exported.dataset).toEqual(facts);
  expect(errors).toEqual([]);
});
