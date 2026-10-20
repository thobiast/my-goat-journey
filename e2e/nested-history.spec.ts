import { backControl, expectReview } from './support/management-fixtures';
import { test, expect } from '@playwright/test';
import {
  setupScheduledHabits,
  scheduledHabitGoals,
  nav,
  onDate,
  readDataset,
} from './support/habit-fixtures';

test.setTimeout(90_000);
test('Nested calendar day and habit history retain Progress navigation and both Back origins', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await onDate(page, '2026-10-02');
  const done = page.getByRole('checkbox', { name: `Done: ${scheduledHabitGoals[1]}`, exact: true });
  await done.click();
  await expect(done).toBeChecked();
  await onDate(page, '2026-10-03');
  await nav(page, 'Progress').click();
  await page.getByRole('tab', { name: 'Pillars', exact: true }).click();
  const origin = page
    .locator('article.consistency-card.body')
    .locator('[data-calendar-date="2026-10-02"]');
  await origin.scrollIntoViewIfNeeded();
  const progressY = await page.evaluate(() => scrollY);
  await origin.click();
  const day = page.locator('main.progress-day-page');
  await expect(
    day.getByRole('heading', { name: 'Friday, October 2, 2026', level: 1, exact: true }),
  ).toBeVisible();
  await expect(day.locator('.day-state')).toContainText('1/1 habits completed');
  const row = day
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: scheduledHabitGoals[1], exact: true }) });
  await expect(row.getByText('Completed', { exact: true })).toBeVisible();
  const habitOrigin = row.getByRole('button', { name: 'Manage habit', exact: true });
  const saved = await readDataset(page);
  await expect(habitOrigin).toHaveAttribute('data-history-id', `${saved.habits[1].id}:2026-10-02`);
  await habitOrigin.scrollIntoViewIfNeeded();
  const dayY = await page.evaluate(() => scrollY);
  await habitOrigin.click();
  await expectReview(page, scheduledHabitGoals[1]);
  await expect(nav(page, 'Progress')).toHaveAttribute('aria-current', 'page');
  await backControl(page).click();
  await expect(
    day.getByRole('heading', { name: 'Friday, October 2, 2026', level: 1, exact: true }),
  ).toBeVisible();
  await expect(habitOrigin).toBeFocused();
  expect(await page.evaluate(() => scrollY)).toBe(dayY);
  expect(await readDataset(page)).toEqual(saved);
  await page.getByRole('button', { name: 'Back to Progress', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Progress', level: 1, exact: true }),
  ).toBeVisible();
  await expect(origin).toBeFocused();
  expect(await page.evaluate(() => scrollY)).toBe(progressY);
  await expect(page.getByRole('tab', { name: 'Pillars', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByLabel('Pillar filter', { exact: true })).toHaveCount(0);
});
