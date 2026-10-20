import { test, expect } from '@playwright/test';
import {
  setupScheduledHabits,
  scheduledHabitGoals,
  nav,
  onDate,
  openHabit,
  readDataset,
  abortNextWrite,
} from './support/habit-fixtures';

test.setTimeout(90_000);

async function completedArchive(page: Parameters<typeof setupScheduledHabits>[0]) {
  await setupScheduledHabits(page);
  await onDate(page, '2026-10-02');
  const done = page.getByRole('checkbox', { name: `Done: ${scheduledHabitGoals[1]}`, exact: true });
  await done.click();
  await expect(done).toBeChecked();
  await openHabit(page);
  await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
  await page
    .locator('.confirmation')
    .getByRole('button', { name: 'Archive habit', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Reactivate habit', exact: true })).toBeVisible();
}

test('Retained completed archive history reports Completed rather than Exempt in the pillar', async ({
  page,
}) => {
  await completedArchive(page);
  await onDate(page, '2026-10-03');
  await nav(page, 'Progress').click();
  await page.getByRole('tab', { name: 'Pillars', exact: true }).click();
  await page
    .locator('article.consistency-card.body')
    .locator('[data-calendar-date="2026-10-02"]')
    .click();
  const day = page.locator('main.progress-day-page');
  await expect(
    day.getByRole('heading', { name: 'Friday, October 2, 2026', level: 1, exact: true }),
  ).toBeVisible();
  await expect(
    day.locator('.day-state').getByRole('heading', { name: 'Completed', exact: true }),
  ).toBeVisible();
  await expect(day.locator('.day-state')).toContainText('1/1 habits completed');
  const row = day
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: scheduledHabitGoals[1], exact: true }) });
  await expect(row.getByText('Completed', { exact: true })).toBeVisible({ timeout: 1500 });
  await expect(row.getByText('Exempt', { exact: true })).toHaveCount(0);
  await expect(
    row.getByText('This habit was archived that day, so it was no longer required.', {
      exact: true,
    }),
  ).toHaveCount(0);
});

test('Read-only completed archived habit row retains credit without exemption help', async ({
  page,
}) => {
  await completedArchive(page);
  await page.getByRole('button', { name: 'Reactivate habit', exact: true }).click();
  await page
    .locator('.confirmation')
    .getByRole('button', { name: 'Reactivate habit', exact: true })
    .click();
  await expect(page.getByText('Awaiting resumption', { exact: true })).toBeVisible();
  await onDate(page, '2026-10-07');
  const row = page
    .locator('article.history-row')
    .filter({ has: page.locator('time[datetime="2026-10-02"]') });
  await expect(row.getByRole('heading')).toContainText('Completed');
  await expect(
    row.getByText('This habit was archived that day, so it was no longer required.', {
      exact: true,
    }),
  ).toHaveCount(0, { timeout: 1500 });
});

test('Successful full deletion announces completion after the reset commits', async ({ page }) => {
  await setupScheduledHabits(page);
  await nav(page, 'Settings').click();
  await page.getByRole('button', { name: 'Delete all data…', exact: true }).click();
  await page.getByRole('button', { name: 'Delete all data', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('All data deleted.', { timeout: 1500 });
  await expect(page.getByRole('status')).toHaveAttribute('aria-live', 'polite');
});

test('PT deletion cancel and failed commit never announce success; retry uses fresh English copy', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await nav(page, 'Settings').click();
  await page.getByLabel('Language', { exact: true }).selectOption('pt');
  await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
  const before = await readDataset(page);
  const success = page
    .getByRole('status')
    .filter({ hasText: /All data deleted\.|Todos os dados foram apagados\./ });
  await page.getByRole('button', { name: 'Apagar todos os dados…', exact: true }).click();
  await expect(success).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(success).toHaveCount(0);
  expect(await readDataset(page)).toEqual(before);
  await page.getByRole('button', { name: 'Apagar todos os dados…', exact: true }).click();
  await abortNextWrite(page);
  await page.getByRole('button', { name: 'Apagar todos os dados', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Não foi possível salvar');
  await expect(success).toHaveCount(0);
  expect(await readDataset(page)).toEqual(before);
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('All data deleted.', { timeout: 1500 });
  await expect(page.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  const reset = await readDataset(page);
  expect(reset.settings.language).toBe('en');
  expect(reset.onboardingComplete).toBe(false);
  expect(reset.habits).toEqual([]);
});
