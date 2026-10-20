import { expectReview, openReviewSupporting } from './support/management-fixtures';
import { test, expect } from '@playwright/test';
import {
  setupScheduledHabits,
  scheduledHabitGoals,
  nav,
  onDate,
  openHabit,
} from './support/habit-fixtures';

test.setTimeout(90_000);
test('Read-only archival exemption uses natural EN/PT status and help, never another completion opportunity', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await onDate(page, '2026-10-02');
  await openHabit(page);
  await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
  await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
  await onDate(page, '2026-10-03');
  await expect(page.getByRole('heading', { name: /· Exempt$/ })).toBeVisible();
  await expect(
    page.getByText('This habit was archived that day, so it was no longer required.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Oct 2/ })).toHaveCount(0);
  await page.getByRole('heading', { name: /· Exempt$/ }).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: 'artifacts/habit-management/screenshots/exempt-en-360-viewport.png',
  });
  await nav(page, 'Settings').click();
  await page.getByLabel('Language', { exact: true }).selectOption('pt');
  await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
  // Reopen the archived identity through supported Progress navigation, not main Settings Back.
  await nav(page, 'Progresso').click();
  const filters = page.locator('.progress-filters');
  if ((await filters.getAttribute('open')) === null)
    await filters.locator(':scope > summary').click();
  await filters.getByRole('button', { name: 'Arquivados', exact: true }).click();
  await page.getByRole('button', { name: scheduledHabitGoals[1], exact: true }).click();
  await expectReview(page, scheduledHabitGoals[1]);
  await openReviewSupporting(page);
  await expect(
    page
      .locator('.history-row')
      .filter({ has: page.locator('time[datetime="2026-10-02"]') })
      .getByRole('checkbox'),
  ).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /· Dispensado$/ })).toBeVisible();
  await expect(
    page.getByText('Este hábito foi arquivado nesse dia e deixou de ser obrigatório.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('heading', { name: /· Dispensado$/ }).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: 'artifacts/habit-management/screenshots/exempt-pt-360-viewport.png',
  });
});
