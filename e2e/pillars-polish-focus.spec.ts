import { expandFixturePillars } from './support/management-fixtures';
import { test, expect } from '@playwright/test';
import {
  setupScheduledHabits,
  scheduledHabitGoals,
  nav,
  readDataset,
} from './support/habit-fixtures';

test('desktop focus exit dismisses the popover without stealing focus from an outside control', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await setupScheduledHabits(page);
  await nav(page, 'Pillars').click();
  await expandFixturePillars(page);
  const before = await readDataset(page);
  const trigger = page.getByRole('button', {
    name: `Actions for habit: ${scheduledHabitGoals[1]}`,
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const surface = page.locator('[data-action-surface]');
  await expect(
    surface.getByRole('button', { name: 'Move to another pillar', exact: true }),
  ).toBeFocused();
  // An explicit focus exit (including assistive-technology navigation) must not
  // restore the invoker and steal the user's new focus destination.
  const destination = page.getByRole('button', { name: 'New pillar', exact: true });
  await destination.focus();
  await expect(surface).toHaveCount(0);
  await expect(destination).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await expect(surface).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(surface).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await readDataset(page)).toEqual(before);
});
