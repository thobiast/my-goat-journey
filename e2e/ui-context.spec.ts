import { backControl } from './support/management-fixtures';
import { test, expect } from '@playwright/test';
import {
  setupScheduledHabits,
  nav,
  openHabit,
  scheduledHabitGoals,
} from './support/habit-fixtures';

test.setTimeout(90_000);
test('History Back restores expanded filter, scroll and focused origin; edit departure requires discard', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await nav(page, 'Progress').click();
  await page
    .locator('summary')
    .filter({ hasText: /^Filters$/ })
    .click();
  await page.getByLabel('Pillar filter', { exact: true }).selectOption('hygiene');
  const trigger = page.getByRole('button', { name: scheduledHabitGoals[3], exact: true });
  await trigger.focus();
  const y = await page.evaluate(() => scrollY);
  await trigger.click();
  await backControl(page).click();
  await expect(trigger).toBeFocused({ timeout: 1500 });
  expect(Math.abs((await page.evaluate(() => scrollY)) - y)).toBeLessThan(3);
  await nav(page, 'Progress').click();
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await openHabit(page);
  await page.getByRole('button', { name: 'Edit habit', exact: true }).click();
  await page.getByLabel('Habit', { exact: true }).fill('Unsaved text');
  await nav(page, 'Today').click();
  await expect(
    page.getByRole('heading', { name: 'Leave without saving?', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.getByLabel('Habit', { exact: true })).toHaveValue('Unsaved text');
  await nav(page, 'Today').click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: scheduledHabitGoals[1], exact: true }),
  ).toBeVisible();
});
