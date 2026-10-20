import {
  backControl,
  expandFixturePillars,
  expectReview,
  openReviewSupporting,
} from './support/management-fixtures';
import type { Dataset } from '../src/domain/types';
import { test, expect } from '@playwright/test';
import {
  setupScheduledHabits,
  scheduledHabitGoals,
  nav,
  onDate,
  readDataset,
} from './support/habit-fixtures';

test('Supported future-created backup stays readable without premature tracking or state changes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await setupScheduledHabits(page);
  await nav(page, 'Settings').click();
  const original = await readDataset(page);
  // The portable fixture deliberately removes the device-local revision.
  const future: Omit<Dataset, 'revision'> & { revision?: number } = structuredClone(original);
  delete future.revision;
  for (const habit of future.habits) {
    habit.createdOn = '2026-10-05';
    habit.versions[0].effectiveFrom = '2026-10-05';
    habit.memberships[0].effectiveFrom = '2026-10-05';
    habit.periods[0].start = '2026-10-05';
  }
  const file = Buffer.from(
    JSON.stringify({
      format: 'my-goat-journey-backup',
      formatVersion: 1,
      exportedAt: '2026-10-05T12:00:00.000Z',
      dataset: future,
    }),
  );
  await page
    .getByLabel('Choose backup file', { exact: true })
    .setInputFiles({ name: 'future.json', mimeType: 'application/json', buffer: file });
  await expect(page.getByText('Backup ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Replace current data', exact: true }).click();
  await expect(page.getByText('Backup restored.', { exact: true })).toBeVisible();
  const { revision: _revision, ...restored } = await readDataset(page);
  expect(restored).toEqual(future);
  await nav(page, 'Today').click();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.locator('.header-xp > span[aria-hidden=true]')).toHaveText('0 XP');
  await nav(page, 'Progress').click();
  const row = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: scheduledHabitGoals[1], exact: true }) });
  await expect(row).toBeVisible({ timeout: 1500 });
  await expect(row).toContainText('Waiting to start');
  await expect(row).toContainText('Starts on Mon, Oct 5, 2026');
  await row.getByRole('button', { name: scheduledHabitGoals[1], exact: true }).click();
  await openReviewSupporting(page);
  await expectReview(page, scheduledHabitGoals[1]);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Archive habit', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reactivate habit', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit habit', exact: true })).toHaveCount(0);
  await expect(page.getByText(/This view is read-only/)).toBeVisible();
  const before = await readDataset(page);
  await backControl(page).click();
  expect(await readDataset(page)).toEqual(before);
  await nav(page, 'Pillars').click();
  await expandFixturePillars(page);
  const management = page
    .getByRole('region', { name: 'Body', exact: true })
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: scheduledHabitGoals[1], exact: true }) });
  await expect(management).toContainText('Starts on Mon, Oct 5, 2026');
  await expect(management.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await management
    .getByRole('button', { name: `Actions for habit: ${scheduledHabitGoals[1]}`, exact: true })
    .click();
  await expect(page.locator('[data-action-surface]')).toBeVisible();
  await expect(
    page
      .locator('[data-action-surface]')
      .getByRole('button', { name: 'Archive habit', exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator('[data-action-surface]')
      .getByRole('button', { name: 'Move to another pillar', exact: true }),
  ).toHaveCount(0);
  await page
    .locator('[data-action-surface]')
    .getByRole('button', { name: 'Review completions', exact: true })
    .click();
  await openReviewSupporting(page);
  await expect(page.getByText('Waiting to start', { exact: true })).toBeVisible();
  expect(await readDataset(page)).toEqual(before);
  await onDate(page, '2026-10-05');
  await nav(page, 'Today').click();
  await expect(
    page.getByRole('checkbox', { name: `Done: ${scheduledHabitGoals[1]}`, exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('An open editor safely becomes read-only if local date moves before habit creation', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await setupScheduledHabits(page);
  await nav(page, 'Progress').click();
  await page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: scheduledHabitGoals[1], exact: true }) })
    .getByRole('button', { name: scheduledHabitGoals[1], exact: true })
    .click();
  await openReviewSupporting(page);
  await page.getByRole('button', { name: 'Edit habit', exact: true }).click();
  await page.getByLabel('Habit', { exact: true }).fill('Unsaved draft must not be applied');
  const before = await readDataset(page);
  await onDate(page, '2026-09-26');
  await expectReview(page, scheduledHabitGoals[1]);
  await expect(page.getByLabel('Habit', { exact: true })).toHaveCount(0);
  expect(await readDataset(page)).toEqual(before);
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit habit', exact: true })).toHaveCount(0);
  await openReviewSupporting(page);
  await expect(page.getByText('Waiting to start', { exact: true })).toBeVisible();
  await onDate(page, '2026-09-27');
  await openReviewSupporting(page);
  await page.getByRole('button', { name: 'Edit habit', exact: true }).click();
  await expect(page.getByLabel('Habit', { exact: true })).toHaveValue(scheduledHabitGoals[1]);
  expect(await readDataset(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test('Portuguese before-creation history keeps saved future records without early XP or actions', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await setupScheduledHabits(page);
  await onDate(page, '2026-10-05');
  await page.getByRole('button', { name: 'Add habit', exact: true }).click();
  const goal = 'Minha meta literal: <amanhã> & cuidado';
  await page.getByLabel('What do you want to do?').fill(goal);
  await page.getByRole('button', { name: 'Save habit', exact: true }).click();
  const checkbox = page.getByRole('checkbox', { name: `Done: ${goal}`, exact: true });
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await nav(page, 'Settings').click();
  await page.getByLabel('Language', { exact: true }).selectOption('pt');
  await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
  const before = await readDataset(page);
  const habit = before.habits.at(-1)!;
  expect(before.occurrences.some((o) => o.habitId === habit.id && o.done)).toBe(true);
  await onDate(page, '2026-09-26');
  await nav(page, 'Hoje').click();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.locator('.header-xp > span[aria-hidden=true]')).toHaveText('0 XP');
  await nav(page, 'Progresso').click();
  const row = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: goal, exact: true }) });
  await expect(row).toContainText('Aguardando início');
  await expect(row).toContainText('Começa em seg., 5 de out. de 2026');
  await row.getByRole('button', { name: goal, exact: true }).click();
  await openReviewSupporting(page);
  await expectReview(page, goal);
  await expect(page.getByText(/Esta tela é somente leitura/)).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  for (const name of ['Editar hábito', 'Arquivar hábito', 'Reativar hábito'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  expect(await readDataset(page)).toEqual(before);
  await onDate(page, '2026-10-05');
  await nav(page, 'Hoje').click();
  await expect(page.getByRole('checkbox', { name: `Feito: ${goal}`, exact: true })).toBeChecked();
  expect(await readDataset(page)).toEqual(before);
  expect(errors).toEqual([]);
});
