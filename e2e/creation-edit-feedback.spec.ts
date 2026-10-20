import { expandFixturePillars } from './support/management-fixtures';
import { test, expect } from '@playwright/test';
import { setupScheduledHabits, nav, onDate, readDataset } from './support/habit-fixtures';

test('Creation-day schedule edit updates first-required feedback while Today retains its original goal', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await onDate(page, '2026-09-30');
  await nav(page, 'Pillars').click();
  await expandFixturePillars(page);
  await page
    .getByRole('region', { name: 'Body', exact: true })
    .getByRole('button', { name: 'Add habit', exact: true })
    .click();
  await page.getByLabel('What do you want to do?').fill('Original goal');
  for (const day of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Saturday'])
    await page.getByRole('button', { name: day, exact: true }).click();
  await page.getByRole('button', { name: 'Save habit', exact: true }).click();
  const habit = page
    .getByRole('region', { name: 'Body', exact: true })
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Original goal', exact: true }) });
  const created = (await readDataset(page)).habits.at(-1)!;
  await habit.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Habit', { exact: true }).fill('Future goal');
  await page.getByRole('button', { name: 'Thursday', exact: true }).click();
  await page.getByRole('button', { name: 'Friday', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(habit).toContainText('Future goal');
  await expect(habit).toContainText(/Oct 1/);
  const saved = (await readDataset(page)).habits.at(-1)!;
  expect(saved.id).toBe(created.id);
  expect(saved.versions.at(-1)).toMatchObject({
    goal: 'Future goal',
    weekdays: [4],
    effectiveFrom: '2026-10-01',
  });
  await nav(page, 'Today').click();
  const row = page
    .locator('.today-goal')
    .filter({ has: page.getByRole('heading', { name: 'Original goal', exact: true }) });
  await expect(row.getByText('Optional today', { exact: true })).toBeVisible();
  await expect(row.locator('time[datetime="2026-10-01"]')).toBeVisible();
  await onDate(page, '2026-10-01');
  await expect(
    page.getByRole('checkbox', { name: 'Done: Future goal', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Original goal', exact: true })).toHaveCount(0);
});
