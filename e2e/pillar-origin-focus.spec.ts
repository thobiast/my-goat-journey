import { backControl, expandFixturePillars } from './support/management-fixtures';
import { test, expect } from '@playwright/test';
import { setupScheduledHabits, nav } from './support/habit-fixtures';

test('Pillar management history Back restores the exact View progress origin and scroll', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await nav(page, 'Pillars').click();
  await expandFixturePillars(page);
  const mind = page.getByRole('region', { name: 'Mind', exact: true });
  const origin = mind.getByRole('button', { name: 'Actions for pillar: Mind', exact: true });
  await origin.scrollIntoViewIfNeeded();
  await origin.click();
  const viewStreaks = page
    .locator('[data-action-surface]')
    .getByRole('button', { name: 'View pillar streaks', exact: true });
  await viewStreaks.scrollIntoViewIfNeeded();
  const y = await page.evaluate(() => scrollY);
  await viewStreaks.click();
  await expect(page.locator('.pillar-history-day')).toHaveCount(1);
  await backControl(page).click();
  await expect(origin).toBeFocused({ timeout: 1500 });
  expect(await page.evaluate(() => scrollY)).toBe(y);
  await expect(nav(page, 'Pillars')).toHaveAttribute('aria-current', 'page');
});
