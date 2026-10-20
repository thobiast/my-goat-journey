import { test, expect } from '@playwright/test';
import { calculateProgress } from '../src/domain/progress';
import {
  calendarDays,
  periodStats,
  periodWindow,
  type Interval,
} from '../src/features/progress/calendar';
import { nav, scheduledHabitGoals } from './support/habit-fixtures';
import { restoreCalendarHistory } from './support/calendar-history';

test.setTimeout(120_000);

test('All interval arrows preserve live streaks across full historical months years and leap days', async ({
  page,
}) => {
  const data = await restoreCalendarHistory(page);
  await nav(page, 'Progress').click();
  const main = page.locator('main.progress-page');
  const goal = 'Read slowly and write a short note';
  const habit = main
    .locator('article.consistency-card')
    .filter({ has: page.getByRole('heading', { name: goal, exact: true, level: 2 }) });
  const metric = calculateProgress(data, '2026-03-01').habits[data.habits[0].id];
  for (const interval of ['7d', '1m', '3m', '12m', '24m'] as Interval[]) {
    await main.getByRole('button', { name: interval, exact: true }).click();
    await expect(main.getByRole('button', { name: 'Next period', exact: true })).toBeDisabled();
    for (const offset of [0, 1]) {
      if (offset) await main.getByRole('button', { name: 'Previous period', exact: true }).click();
      const window = periodWindow('2026-03-01', interval, offset);
      const expected = periodStats(
        calendarDays(data, { kind: 'habit', id: data.habits[0].id }, window),
      );
      await expect(habit.locator('.period-fraction')).toHaveText(
        `${expected.completed}/${expected.eligible} days completed`,
      );
      await expect(habit.locator('[data-live-streak=current]')).toHaveText(
        new RegExp(`^${metric.current}\\s+completion${metric.current === 1 ? '' : 's'}$`),
      );
      await expect(habit.locator('[data-live-streak=best]')).toHaveText(
        new RegExp(`^${metric.best}\\s+completion${metric.best === 1 ? '' : 's'}$`),
      );
      await expect(main.locator('[data-calendar-date="2026-03-01"]')).toHaveCount(0);
      await expect(habit.locator(`[data-calendar-date="${window.historyEnd}"]`)).toBeVisible();
    }
    await main.getByRole('button', { name: 'Next period', exact: true }).click();
    await expect(main.getByRole('button', { name: 'Next period', exact: true })).toBeDisabled();
  }
  await main.getByRole('button', { name: 'Previous period', exact: true }).click();
  await expect(habit.locator('[data-calendar-date="2024-02-29"]')).toHaveAttribute(
    'data-state',
    'unscheduled',
  );
  await habit.locator('[data-calendar-date="2024-02-29"]').click();
  await expect(
    page.getByRole('heading', { name: 'Thursday, February 29, 2024', exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.locator('main.progress-day-page')).toContainText(scheduledHabitGoals[0]);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to Progress', exact: true }).click();
  await main.getByRole('button', { name: '3m', exact: true }).click();
  await main.getByRole('tab', { name: 'Pillars', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'artifacts/progress-redesign/screenshots/dense-pillars-en-390.png',
    fullPage: true,
  });
  await main.getByRole('tab', { name: 'Habits', exact: true }).click();
  await habit.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: 'artifacts/progress-redesign/screenshots/dense-habits-en-390.png',
  });
});
