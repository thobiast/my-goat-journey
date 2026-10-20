import { backControl, expandFixturePillars, expectReview } from './support/management-fixtures';
import { test, expect } from '@playwright/test';
import { setupScheduledHabits, nav, onDate, scheduledHabitGoals } from './support/habit-fixtures';

test.setTimeout(90_000);
test('Pillar management links share habit history; pillar Progress keeps dated contributions independent of active filters', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await onDate(page, '2026-10-02');
  await nav(page, 'Pillars').click();
  await expandFixturePillars(page);
  const body = page.getByRole('region', { name: 'Body', exact: true });
  const habit = body
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: scheduledHabitGoals[1], exact: true }) });
  const more = habit.getByRole('button', {
    name: `Actions for habit: ${scheduledHabitGoals[1]}`,
    exact: true,
  });
  await more.click();
  await page
    .locator('[data-action-surface]')
    .getByRole('button', { name: 'Review completions', exact: true })
    .click();
  await expectReview(page, scheduledHabitGoals[1]);
  await expect(nav(page, 'Pillars')).toHaveAttribute('aria-current', 'page');
  await expect(backControl(page)).toHaveText('← Pillars');
  await backControl(page).click();
  await expect(page.getByRole('heading', { name: 'Pillars', exact: true, level: 1 })).toBeVisible();
  await expect(more).toBeFocused();
  await body.getByRole('button', { name: 'Actions for pillar: Body', exact: true }).click();
  await page
    .locator('[data-action-surface]')
    .getByRole('button', { name: 'View pillar streaks', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible();
  await expect(page.getByText('Missed', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(scheduledHabitGoals[1], { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel('Pillar filter', { exact: true })).toHaveCount(0);
});
