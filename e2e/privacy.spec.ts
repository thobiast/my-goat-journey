import { test, expect } from '@playwright/test';
import { setupScheduledHabits, nav, readDataset, abortNextWrite } from './support/habit-fixtures';

test.setTimeout(90_000);
test('Separate deletion cancel and abort preserve facts; confirmed reset returns fresh English onboarding', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await nav(page, 'Settings').click();
  await page.getByLabel('Language', { exact: true }).selectOption('pt');
  await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Apagar todos os dados…', exact: true }),
  ).toBeVisible({ timeout: 1500 });
  const before = await readDataset(page);
  await page.getByRole('button', { name: 'Apagar todos os dados…', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancelar', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  expect(await readDataset(page)).toEqual(before);
  await page.getByRole('button', { name: 'Apagar todos os dados…', exact: true }).click();
  await abortNextWrite(page);
  await page.getByRole('button', { name: 'Apagar todos os dados', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Não foi possível salvar');
  expect(await readDataset(page)).toEqual(before);
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  const reset = await readDataset(page);
  expect(reset.settings).toEqual({ language: 'en', reducedMotion: false });
  expect(reset.onboardingComplete).toBe(false);
  expect(reset.draft).toBeNull();
  expect(reset.habits).toEqual([]);
  expect(reset.occurrences).toEqual([]);
  expect(reset.permanentUnlocks).toEqual([]);
  expect(reset.revision).toBeGreaterThan(before.revision);
  await page.reload();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByLabel('What do you want to do?')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
});
