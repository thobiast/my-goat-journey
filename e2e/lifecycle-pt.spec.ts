import { openReviewSupporting } from './support/management-fixtures';
import { test, expect } from '@playwright/test';
import {
  setupScheduledHabits,
  nav,
  onDate,
  scheduledHabitGoals,
  readDataset,
} from './support/habit-fixtures';

test.setTimeout(90_000);
test('Portuguese archived, awaiting, cancelled and first-due active states remain distinct', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await onDate(page, '2026-10-02');
  await nav(page, 'Settings').click();
  await page.getByLabel('Language', { exact: true }).selectOption('pt');
  await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
  await nav(page, 'Progresso').click();
  await page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: scheduledHabitGoals[1], exact: true }) })
    .getByRole('button', { name: scheduledHabitGoals[1], exact: true })
    .click();
  await openReviewSupporting(page);
  await page.getByRole('button', { name: 'Arquivar hábito', exact: true }).click();
  await page.getByRole('button', { name: 'Arquivar hábito', exact: true }).click();
  await expect(page.getByText('Arquivado', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reativar hábito', exact: true }).click();
  await page.getByRole('button', { name: 'Reativar hábito', exact: true }).click();
  await expect(page.getByText('Aguardando retomada', { exact: true })).toBeVisible();
  await expect(page.getByText(/Retoma em.*5 de out/)).toBeVisible();
  await page.screenshot({
    path: 'artifacts/habit-management/screenshots/awaiting-pt-360.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Arquivar hábito', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Cancelar a retomada?', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Manter retomada', exact: true }).click();
  await expect(page.getByText('Aguardando retomada', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Arquivar hábito', exact: true }).click();
  await page.getByRole('button', { name: 'Arquivar hábito', exact: true }).click();
  await expect(page.getByText('Arquivado', { exact: true })).toBeVisible();
  await expect(page.getByText(/Retoma em/)).toHaveCount(0);
  expect((await readDataset(page)).habits[1].periods).toHaveLength(1);
  await page.getByRole('button', { name: 'Reativar hábito', exact: true }).click();
  await page.getByRole('button', { name: 'Reativar hábito', exact: true }).click();
  await onDate(page, '2026-10-05');
  await openReviewSupporting(page);
  await expect(page.getByText('Ativo', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({
    path: 'artifacts/habit-management/screenshots/active-resumed-pt-360.png',
    fullPage: true,
  });
});
