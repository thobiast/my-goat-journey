import { backControl } from './support/management-fixtures';
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
test('Progress corrects Friday and Wednesday with exact 40 to 20 to 40 XP and committed retry', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  for (const date of ['2026-09-28', '2026-09-30', '2026-10-02']) {
    await onDate(page, date);
    const done = page.getByRole('checkbox', {
      name: `Done: ${scheduledHabitGoals[1]}`,
      exact: true,
    });
    await done.click();
    await expect(done).toBeChecked();
  }
  await expect(page.locator('.header-xp > span[aria-hidden=true]')).toHaveText('40 XP');
  await expect(nav(page, 'Progress')).toBeVisible({ timeout: 1500 });
  await openHabit(page);
  const controls = page.getByRole('checkbox');
  await expect(controls).toHaveCount(2);
  const previous = page.getByRole('checkbox', { name: /Done: Complete my walk.*Sep 30/ });
  await expect(previous).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Sep 28/ })).toHaveCount(0);
  const before = await readDataset(page);
  await previous.click();
  await expect(previous).not.toBeChecked();
  await expect(page.getByText('20 XP', { exact: true })).toBeVisible();
  await expect(page.getByText('Streak 1 · Best 1', { exact: true })).toBeVisible();
  await abortNextWrite(page);
  await previous.click();
  await expect(page.getByRole('alert')).toContainText('Could not save');
  await expect(previous).not.toBeChecked();
  await expect(page.getByText('20 XP', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(previous).toBeChecked();
  await expect(page.getByText('40 XP', { exact: true })).toBeVisible();
  await expect(page.getByText('Streak 3 · Best 3', { exact: true })).toBeVisible();
  const after = await readDataset(page);
  expect(after.occurrences).toEqual(before.occurrences);
  expect(after.permanentUnlocks).toEqual(before.permanentUnlocks);
  await page.screenshot({
    path: 'artifacts/habit-management/screenshots/corrections-en-360.png',
    fullPage: true,
  });
  await onDate(page, '2026-10-03');
  await expect(page.getByRole('checkbox')).toHaveCount(1);
  await expect(page.getByRole('checkbox', { name: /Oct 2/ })).toBeChecked();
  await page.reload();
  await expect(page.locator('.header-xp > span[aria-hidden=true]')).toHaveText('40 XP');
});

test('Progress filters preserve origin and five localized destinations fit narrow enlarged text', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await nav(page, 'Progress').click();
  await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible();
  const filters = page
    .locator('details')
    .filter({ has: page.locator('summary').filter({ hasText: /^Filters$/ }) });
  await expect(filters).not.toHaveAttribute('open');
  await filters.locator('summary').click();
  await page.getByLabel('Pillar filter', { exact: true }).selectOption('body');
  await expect(page.getByText('Active · Body', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: scheduledHabitGoals[1], exact: true }).click();
  await backControl(page).click();
  await expect(page.getByText('Active · Body', { exact: true })).toBeVisible();
  await expect(filters).toHaveAttribute('open');
  await page.getByRole('tab', { name: 'Pillars', exact: true }).click();
  await expect(page.getByLabel('Pillar filter', { exact: true })).toHaveCount(0);
  await nav(page, 'Settings').click();
  await page.getByLabel('Language', { exact: true }).selectOption('pt');
  await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
  await nav(page, 'Progresso').click();
  for (const size of ['100%', '200%']) {
    await page.evaluate((size) => {
      document.documentElement.style.fontSize = size;
    }, size);
    await page.setViewportSize({ width: 320, height: 800 });
    const navigation = page.getByRole('navigation');
    await expect(navigation.getByRole('button')).toHaveCount(5);
    for (const name of ['Hoje', 'Pilares', 'Jornada', 'Progresso', 'Ajustes']) {
      const box = await nav(page, name).boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
      await expect(nav(page, name)).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(navigation.locator('[aria-current=page]')).toHaveCount(1);
    await page.screenshot({
      path: `artifacts/habit-management/screenshots/progress-pt-${size === '200%' ? 'text200' : 'normal'}-320.png`,
    });
  }
});
