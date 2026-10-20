import { openReviewSupporting } from './support/management-fixtures';
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
for (const done of [false, true])
  test(`Archive ${done ? 'completed' : 'pending'} habit, request and cancel resumption without phantom facts`, async ({
    page,
  }) => {
    await setupScheduledHabits(page);
    await onDate(page, '2026-10-02');
    if (done) {
      const c = page.getByRole('checkbox', {
        name: `Done: ${scheduledHabitGoals[1]}`,
        exact: true,
      });
      await c.click();
      await expect(c).toBeChecked();
    }
    await openHabit(page);
    await expect(page.getByRole('button', { name: 'Archive habit', exact: true })).toBeVisible({
      timeout: 1500,
    });
    await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Archive this habit?', exact: true }),
    ).toBeFocused();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Archive habit', exact: true })).toBeFocused();
    const before = await readDataset(page);
    await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
    await abortNextWrite(page);
    await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Could not save');
    expect(await readDataset(page)).toEqual(before);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Reactivate habit', exact: true })).toBeVisible();
    const archived = await readDataset(page);
    const habit = archived.habits[1];
    expect(habit.periods.at(-1)).toMatchObject({ end: '2026-10-02', archivedOn: '2026-10-02' });
    expect(
      archived.occurrences.find((o) => o.habitId === habit.id && o.date === '2026-10-02'),
    ).toMatchObject({ done, exempt: true });
    await page.getByRole('button', { name: 'Reactivate habit', exact: true }).click();
    await expect(page.getByText(/Resumes on.*Oct 5/)).toBeVisible();
    await page.getByRole('button', { name: 'Reactivate habit', exact: true }).click();
    await expect(page.getByText('Awaiting resumption', { exact: true })).toBeVisible();
    await expect(page.getByText('Streak 0 · Best 1', { exact: true })).toHaveCount(done ? 1 : 0);
    const awaiting = await readDataset(page);
    expect(awaiting.habits[1].periods).toEqual(habit.periods);
    expect(awaiting.occurrences).toEqual(archived.occurrences);
    await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Cancel resumption?', exact: true }),
    ).toBeFocused();
    await abortNextWrite(page);
    await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Could not save');
    expect(await readDataset(page)).toEqual(awaiting);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Reactivate habit', exact: true })).toBeVisible();
    const cancelled = await readDataset(page);
    expect(cancelled.habits[1].pendingReactivation).toBeUndefined();
    expect(cancelled.habits[1].periods).toEqual(habit.periods);
    expect(cancelled.occurrences).toEqual(archived.occurrences);
    await page.screenshot({
      path: `artifacts/habit-management/screenshots/archive-${done ? 'completed' : 'pending'}-en.png`,
      fullPage: true,
    });
    await page.reload();
    await nav(page, 'Progress').click();
    await page
      .locator('summary')
      .filter({ hasText: /^Filters$/ })
      .click();
    await page.getByRole('button', { name: 'Archived', exact: true }).click();
    await page.getByRole('button', { name: scheduledHabitGoals[1], exact: true }).click();
    await openReviewSupporting(page);
    await expect(page.getByRole('button', { name: 'Reactivate habit', exact: true })).toBeVisible();
  });

test('Awaiting edits update due date; first due reconciles a required period without a false cross-tab alert', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await onDate(page, '2026-10-02');
  const done = page.getByRole('checkbox', { name: `Done: ${scheduledHabitGoals[1]}`, exact: true });
  await done.click();
  await expect(done).toBeChecked();
  await openHabit(page);
  await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
  await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
  await page.getByRole('button', { name: 'Reactivate habit', exact: true }).click();
  await page.getByRole('button', { name: 'Reactivate habit', exact: true }).click();
  await onDate(page, '2026-10-03');
  await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
  await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
  const cancelled = await readDataset(page);
  expect(cancelled.habits[1].periods).toHaveLength(1);
  expect(cancelled.habits[1].pendingReactivation).toBeUndefined();
  await page.getByRole('button', { name: 'Reactivate habit', exact: true }).click();
  await page.getByRole('button', { name: 'Reactivate habit', exact: true }).click();
  await page.getByRole('button', { name: 'Edit habit', exact: true }).click();
  for (const day of ['Monday', 'Wednesday', 'Friday', 'Tuesday'])
    await page.getByRole('button', { name: day, exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await openReviewSupporting(page);
  await expect(page.getByText(/Resumes on.*Oct 6/)).toBeVisible();
  await onDate(page, '2026-10-06');
  await expect
    .poll(async () => (await readDataset(page)).habits[1].periods.at(-1)!.start)
    .toBe('2026-10-06');
  await openReviewSupporting(page);
  await expect(page.getByText('Active', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const active = await readDataset(page);
  expect(active.habits[1].pendingReactivation).toBeUndefined();
  expect(active.habits[1].periods.at(-1)).toMatchObject({ start: '2026-10-06' });
  await nav(page, 'Today').click();
  const row = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: scheduledHabitGoals[1], exact: true }) });
  await expect(row.getByText('Optional today', { exact: true })).toHaveCount(0);
  await row.getByRole('checkbox').click();
  await expect(row.getByRole('checkbox')).toBeChecked();
  await openHabit(page);
  await expect(page.getByText('Streak 1 · Best 1', { exact: true })).toBeVisible();
  await expect(page.getByText('20 XP', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
  await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
  const archived = await readDataset(page);
  expect(archived.habits[1].periods.at(-1)).toMatchObject({
    start: '2026-10-06',
    end: '2026-10-06',
  });
  const correction = page.getByRole('checkbox', { name: /Done: Complete my walk.*Oct 6/ });
  await correction.click();
  await expect(correction).not.toBeChecked();
  await correction.click();
  await expect(correction).toBeChecked();
  await page.reload();
  expect((await readDataset(page)).habits[1].periods).toEqual(archived.habits[1].periods);
});
