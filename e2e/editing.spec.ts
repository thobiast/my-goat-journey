import { expectReview, openReviewSupporting } from './support/management-fixtures';
import { test, expect } from '@playwright/test';
import {
  setupScheduledHabits,
  scheduledHabitGoals,
  nav,
  onDate,
  openHabit,
  readDataset,
  abortNextWrite,
} from './support/habit-fixtures';

test.setTimeout(90_000);
test('Editing preserves Today, commits pending fields and invalidates obsolete Retry', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await onDate(page, '2026-10-02');
  await openHabit(page);
  await page.getByRole('button', { name: 'Edit habit', exact: true }).click();
  await page
    .getByLabel('Habit', { exact: true })
    .fill('Complete my longer walk with a full goal that wraps across narrow screens');
  await expect(
    page
      .locator('form.habit-form')
      .getByText(
        `If saved, changes apply from Sat, Oct 3, 2026. Until then: ${scheduledHabitGoals[1]}.`,
        { exact: true },
      ),
  ).toBeVisible();
  const before = await readDataset(page);
  await abortNextWrite(page);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not save');
  expect(await readDataset(page)).toEqual(before);
  await page.getByLabel('Habit', { exact: true }).fill('Complete my longer walk');
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expectReview(page, scheduledHabitGoals[1]);
  await openReviewSupporting(page);
  await expect(page.getByRole('heading', { name: /Pending changes/ })).toBeVisible();
  const saved = await readDataset(page);
  const h = saved.habits.find((h) => h.id === before.habits[1].id)!;
  expect(h.versions.at(-1)).toMatchObject({
    effectiveFrom: '2026-10-03',
    goal: 'Complete my longer walk',
  });
  await nav(page, 'Today').click();
  await expect(
    page.getByRole('heading', { name: scheduledHabitGoals[1], exact: true }),
  ).toBeVisible();
  await page.reload();
  await openHabit(page);
  await page.getByRole('button', { name: 'Edit pending changes', exact: true }).click();
  await expect(page.getByLabel('Habit', { exact: true })).toHaveValue('Complete my longer walk');
});

test('Combined edit and credited move show persisted separate dates after pending schedule changes', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await onDate(page, '2026-10-02');
  const done = page.getByRole('checkbox', { name: `Done: ${scheduledHabitGoals[1]}`, exact: true });
  await done.click();
  await expect(done).toBeChecked();
  await openHabit(page);
  await page.getByRole('button', { name: 'Edit habit', exact: true }).click();
  await page.getByLabel('Habit', { exact: true }).fill('Walk with my family');
  await page.getByLabel('Pillar', { exact: true }).selectOption('hygiene');
  for (const day of ['Monday', 'Wednesday', 'Friday', 'Tuesday'])
    await page.getByRole('button', { name: day, exact: true }).click();
  await expect(page.getByText(/Today's completion stays in Body.*Oct 6/)).toBeVisible();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await openReviewSupporting(page);
  await expect(page.getByText(/Today's completion stays in Body.*Oct 6/)).toBeVisible({
    timeout: 1500,
  });
  await expect(page.getByRole('heading', { name: /Pending changes.*Oct 3/ })).toBeVisible();
  await page.getByRole('button', { name: 'Edit pending changes', exact: true }).click();
  for (const day of ['Tuesday', 'Thursday'])
    await page.getByRole('button', { name: day, exact: true }).click();
  await expect(page.getByText(/Today's completion stays in Body.*Oct 8/)).toBeVisible();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await openReviewSupporting(page);
  await expect(page.getByText(/Today's completion stays in Body.*Oct 8/)).toBeVisible();
  const saved = await readDataset(page);
  expect(saved.habits[1].memberships.at(-1)).toMatchObject({
    effectiveFrom: '2026-10-08',
    pillarId: 'hygiene',
  });
  expect(
    saved.occurrences.find((o) => o.habitId === saved.habits[1].id && o.date === '2026-10-02'),
  ).toMatchObject({ goal: scheduledHabitGoals[1], pillarId: 'body', done: true });
});
