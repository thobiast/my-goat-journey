import { test, expect } from '@playwright/test';
import { setupScheduledHabits, nav, onDate } from './support/habit-fixtures';

test.setTimeout(90_000);
test('Mobile long goals, corrections and Settings remain reachable at phone widths and enlarged EN/PT text', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await onDate(page, '2026-10-02');
  await page.getByRole('button', { name: 'Add habit', exact: true }).click();
  const goal =
    'Walk calmly through my neighborhood, notice the trees and return at my own pace without rushing or comparing myself to anyone else';
  await page.getByLabel('What do you want to do?').fill(goal);
  await page.getByRole('button', { name: 'Save habit', exact: true }).click();
  for (const language of ['en', 'pt'] as const) {
    await nav(page, language === 'en' ? 'Settings' : 'Settings').click();
    if (language === 'pt') {
      await page.getByLabel('Language', { exact: true }).selectOption('pt');
      await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
    }
    await expect(page.locator('.delete-section')).toHaveCSS('border-top-style', 'solid');
    for (const width of [320, 360, 390])
      for (const size of ['100%', '200%']) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate((size) => {
          document.documentElement.style.fontSize = size;
        }, size);
        await nav(page, language === 'en' ? 'Progress' : 'Progresso').click();
        const row = page
          .locator('article')
          .filter({ has: page.getByRole('heading', { name: goal, exact: true }) });
        await expect(row.getByRole('heading', { name: goal, exact: true })).toHaveText(goal);
        await row.getByRole('button', { name: goal, exact: true }).click();
        const checkbox = page
          .getByRole('checkbox', {
            name: new RegExp(`${language === 'en' ? 'Done' : 'Feito'}: Walk calmly.*`),
          })
          .first();
        await checkbox.scrollIntoViewIfNeeded();
        const box = await checkbox.locator('..').boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        await checkbox.focus();
        await page.keyboard.press('Space');
        await expect(checkbox).toBeChecked();
        await expect(checkbox).toBeEnabled();
        await expect(checkbox).toBeFocused();
        await page.keyboard.press('Space');
        await expect(checkbox).not.toBeChecked();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path: `artifacts/habit-management/screenshots/detail-${language}-${width}-${size === '200%' ? 'text200' : 'normal'}-viewport.png`,
        });
        await nav(page, language === 'en' ? 'Settings' : 'Ajustes').click();
        const deletion = page.getByRole('button', {
          name: language === 'en' ? 'Delete all data…' : 'Apagar todos os dados…',
          exact: true,
        });
        await deletion.scrollIntoViewIfNeeded();
        const rect = await deletion.boundingBox();
        const bar = await page.getByRole('navigation').boundingBox();
        expect(rect!.y + rect!.height).toBeLessThanOrEqual(bar!.y);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path: `artifacts/habit-management/screenshots/settings-${language}-${width}-${size === '200%' ? 'text200' : 'normal'}-bottom.png`,
        });
      }
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '100%';
    });
  }
});
