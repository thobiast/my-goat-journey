import { test, expect } from '@playwright/test';
import {
  setupScheduledHabits,
  scheduledHabitGoals,
  nav,
  onDate,
  openHabit,
  readDataset,
} from './support/habit-fixtures';

test.setTimeout(90_000);
for (const done of [false, true])
  test(`Today removes ${done ? 'retains completed' : 'unfinished'} archived participation without an invalid checkbox`, async ({
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
    await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
    await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
    await nav(page, 'Today').click();
    const row = page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: scheduledHabitGoals[1], exact: true }) });
    if (done) {
      await expect(row.getByRole('checkbox')).toBeChecked();
      await expect(row.getByText('Archived', { exact: true })).toBeVisible({ timeout: 1500 });
      await expect(page.locator('.today-count')).toHaveText('1 of 4 habits completed');
      await row.getByRole('checkbox').click();
      await expect(row).toHaveCount(0);
    } else {
      await expect(row).toHaveCount(0, { timeout: 1500 });
      await expect(page.locator('.today-count')).toHaveText('0 of 3 habits completed');
    }
    await expect(page.locator('.summary-tile.body')).toContainText('No habits scheduled today');
    await expect(page.getByRole('alert')).toHaveCount(0);
    const saved = await readDataset(page);
    expect(
      saved.occurrences.find((o) => o.habitId === saved.habits[1].id && o.date === '2026-10-02'),
    ).toMatchObject({ exempt: true, done: false });
    await page.reload();
    await expect(
      page.getByRole('checkbox', { name: `Done: ${scheduledHabitGoals[1]}`, exact: true }),
    ).toHaveCount(0);
  });
