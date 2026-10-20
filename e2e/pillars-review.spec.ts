import {
  backControl,
  expandFixturePillars,
  expectReview,
  openReviewSupporting,
} from './support/management-fixtures';
import { test, expect } from '@playwright/test';
import {
  setupScheduledHabits,
  scheduledHabitGoals,
  nav,
  onDate,
  readDataset,
} from './support/habit-fixtures';

test('revisited tracked date after pillar removal keeps history discoverable and editing noncrashing without changing facts', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await setupScheduledHabits(page);
  await onDate(page, '2026-10-02');
  await nav(page, 'Pillars').click();
  await expandFixturePillars(page);
  const row = page
    .locator('.management-habit')
    .filter({ has: page.getByRole('heading', { name: scheduledHabitGoals[0], exact: true }) });
  await row
    .getByRole('button', { name: `Actions for habit: ${scheduledHabitGoals[0]}`, exact: true })
    .click();
  await page
    .locator('[data-action-surface]')
    .getByRole('button', { name: 'Archive habit', exact: true })
    .click();
  await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
  const mind = page.getByRole('region', { name: 'Mind', exact: true });
  await mind.getByRole('button', { name: 'Actions for pillar: Mind', exact: true }).click();
  await page
    .locator('[data-action-surface]')
    .getByRole('button', { name: 'Remove from active pillars', exact: true })
    .click();
  await page.getByRole('button', { name: 'Confirm removal', exact: true }).click();
  await expect(mind).toHaveCount(0);
  const saved = await readDataset(page);
  await onDate(page, '2026-09-30');
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await expect(
    row.getByRole('heading', { name: scheduledHabitGoals[0], exact: true }),
  ).toBeVisible();
  await expect(row.getByRole('button', { name: 'Reactivate habit', exact: true })).toHaveCount(0);
  await row.getByRole('button', { name: 'Review completions', exact: true }).click();
  await expectReview(page, scheduledHabitGoals[0]);
  await expect(page.getByRole('button', { name: 'Edit habit', exact: true })).toHaveCount(0);
  await expect(backControl(page)).toHaveText('← Archived');
  await backControl(page).click();
  await expect(row.getByRole('button', { name: 'Review completions', exact: true })).toBeFocused();
  // Historical editing remains available from Progress, not duplicated in list-origin review.
  await nav(page, 'Progress').click();
  await page.getByRole('button', { name: scheduledHabitGoals[0], exact: true }).click();
  await openReviewSupporting(page);
  await page.getByRole('button', { name: 'Edit habit', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Edit habit', exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.getByText(/These dates already have saved history/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expectReview(page, scheduledHabitGoals[0]);
  await backControl(page).click();
  await expect(
    page.getByRole('heading', { name: 'Progress', exact: true, level: 1 }),
  ).toBeVisible();
  await nav(page, 'Pillars').click();
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Archived', exact: true, level: 1 }),
  ).toBeVisible();
  expect(await readDataset(page)).toEqual(saved);
  expect(errors).toEqual([]);
});

test('saving a new pillar reveals and focuses its management control without resetting collapsed groups', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await nav(page, 'Pillars').click();
  await expandFixturePillars(page);
  const mind = page.getByRole('region', { name: 'Mind', exact: true });
  await mind.getByRole('button', { name: 'Mind', exact: true }).click();
  await page.getByRole('button', { name: 'New pillar', exact: true }).click();
  await page.getByLabel('Pillar name', { exact: true }).fill('Quiet practice');
  await page.getByRole('button', { name: 'Save pillar', exact: true }).click();
  const created = page.getByRole('region', { name: 'Quiet practice', exact: true });
  const changed = created.locator('.pillar-disclosure');
  await expect(changed).toHaveAttribute('aria-expanded', 'false');
  await expect(
    created.getByRole('button', { name: 'Actions for pillar: Quiet practice', exact: true }),
  ).toBeVisible();
  await expect(changed).toBeFocused();
  await expect(mind.getByRole('button', { name: 'Mind', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect
    .poll(async () => {
      const box = await changed.boundingBox();
      const bar = await page.getByRole('navigation').boundingBox();
      return !!box && !!bar && box.y >= 0 && box.y + box.height <= bar.y;
    })
    .toBe(true);
});

test('habit editing visually separates secondary Cancel from the primary Save action', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await nav(page, 'Pillars').click();
  await expandFixturePillars(page);
  const body = page.getByRole('region', { name: 'Body', exact: true });
  await body.getByRole('button', { name: 'Edit', exact: true }).click();

  const background = (name: string) =>
    page
      .getByRole('button', { name, exact: true })
      .evaluate((node) => getComputedStyle(node).backgroundColor);

  expect(await background('Cancel')).not.toBe(await background('Save changes'));
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(body.getByRole('button', { name: 'Edit', exact: true })).toBeFocused();
});
