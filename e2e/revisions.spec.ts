import { test, expect } from '@playwright/test';
import { setupScheduledHabits, openHabit, nav, readDataset } from './support/habit-fixtures';

test.setTimeout(90_000);
test('Other-tab committed changes invalidate stale forms and require review without blind Retry', async ({
  page,
  context,
}) => {
  await setupScheduledHabits(page);
  await openHabit(page);
  await page.getByRole('button', { name: 'Edit habit', exact: true }).click();
  await page.getByLabel('Habit', { exact: true }).fill('Old tab text');
  const other = await context.newPage();
  await other.clock.install({ time: new Date('2026-09-27T12:00:00') });
  await other.goto('./');
  await nav(other, 'Settings').click();
  await other.getByLabel('Language', { exact: true }).selectOption('pt');
  await expect(other.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
  await expect(page.getByLabel(/^(Habit|Hábito)$/)).toHaveCount(0, { timeout: 2000 });
  await expect(page.getByRole('alert')).toContainText('Seus dados mudaram');
  await expect(page.getByRole('button', { name: 'Tentar novamente', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Recarregar', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const saved = await readDataset(page);
  expect(saved.habits[1].versions).toHaveLength(1);
  await page.reload();
  expect((await readDataset(page)).habits).toEqual(saved.habits);
});

test('Other-tab reset invalidates deletion confirmation and old drafts cannot resurrect the diary', async ({
  page,
  context,
}) => {
  await setupScheduledHabits(page);
  await nav(page, 'Settings').click();
  await page.getByRole('button', { name: 'Delete all data…', exact: true }).click();
  const other = await context.newPage();
  await other.clock.install({ time: new Date('2026-09-27T12:00:00') });
  await other.goto('./');
  await nav(other, 'Settings').click();
  await other.getByRole('button', { name: 'Delete all data…', exact: true }).click();
  await other.getByRole('button', { name: 'Delete all data', exact: true }).click();
  await expect(other.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete all data', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  const reset = await readDataset(page);
  expect(reset.habits).toHaveLength(0);
  expect(reset.draft).toBeNull();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByLabel('What do you want to do?')).toHaveValue('');
  await page.getByLabel('What do you want to do?').fill('A new diary goal');
  await expect(page.getByText('Draft saved', { exact: true })).toBeVisible();
  const fresh = await readDataset(page);
  expect(fresh.habits).toHaveLength(0);
  expect(fresh.draft!.goals[0].goal).toBe('A new diary goal');
  expect(fresh.draft!.goals.slice(1).map((g) => g.goal)).toEqual(['', '', '']);
  await page.reload();
  await expect(page.getByLabel('What do you want to do?')).toHaveValue('A new diary goal');
});
