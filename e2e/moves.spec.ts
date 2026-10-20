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
for (const credited of [false, true])
  test(`Move ${credited ? 'after credit' : 'before credit'} preserves dated history and habit obligations`, async ({
    page,
  }) => {
    await setupScheduledHabits(page);
    await onDate(page, '2026-10-02');
    if (credited) {
      const checkbox = page.getByRole('checkbox', {
        name: `Done: ${scheduledHabitGoals[1]}`,
        exact: true,
      });
      await checkbox.click();
      await expect(checkbox).toBeChecked();
    }
    await openHabit(page);
    await page.getByRole('button', { name: 'Edit habit', exact: true }).click();
    await page.getByLabel('Pillar', { exact: true }).selectOption('mind');
    await expect(
      page.getByText(
        credited
          ? /Today's completion stays in Body.*Oct 5/
          : /Complete this habit today to count in Mind.*Oct 5/,
      ),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await nav(page, 'Today').click();
    const row = page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: scheduledHabitGoals[1], exact: true }) });
    const todayPillar = page.locator('section.today-pillar').filter({ has: row });
    await expect(todayPillar).toHaveAttribute('aria-label', credited ? 'Body' : 'Mind');
    if (!credited) {
      await expect(row.getByText('Required today', { exact: true })).toBeVisible();
      await expect(row.getByText('Counts in Mind when done.', { exact: true })).toBeVisible();
      await expect(row.getByText('Optional today', { exact: true })).toHaveCount(0);
      await expect(page.locator('.today-count')).toHaveText('0 of 4 habits completed');
    }
    const done = row.getByRole('checkbox');
    if (!credited) {
      await done.click();
      await expect(done).toBeChecked();
    }
    await done.click();
    await expect(done).not.toBeChecked();
    await done.click();
    await expect(done).toBeChecked();
    const saved = await readDataset(page);
    const moved = saved.occurrences.filter(
      (o) => o.habitId === saved.habits[1].id && o.date === '2026-10-02',
    );
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({
      pillarId: credited ? 'body' : 'mind',
      done: true,
      pillarParticipation: credited ? 'required' : 'on-completion',
    });
    await page.screenshot({
      path: `artifacts/habit-management/screenshots/move-${credited ? 'credited' : 'conditional'}-en.png`,
      fullPage: true,
    });
    await page.reload();
    expect((await readDataset(page)).occurrences).toEqual(saved.occurrences);
  });
