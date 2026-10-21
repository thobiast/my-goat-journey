import { test, expect } from '@playwright/test';
import {
  nav,
  onDate,
  readDataset,
  scheduledHabitGoals,
  setupScheduledHabits,
} from './support/habit-fixtures';
import en from '../src/i18n/en.json' with { type: 'json' };
import pt from '../src/i18n/pt.json' with { type: 'json' };

for (const language of ['en', 'pt'] as const) {
  test(`Pillar history header omits daily status but preserves dated states and live streaks ${language}`, async ({
    page,
  }) => {
    const copy = language === 'en' ? en : pt;
    await setupScheduledHabits(page);
    await onDate(page, '2026-09-30');
    const done = page.getByRole('checkbox', {
      name: `Done: ${scheduledHabitGoals[1]}`,
      exact: true,
    });
    await done.click();
    await expect(done).toBeChecked();
    await onDate(page, '2026-10-02');
    if (language === 'pt') {
      await nav(page, en.settings).click();
      await page.getByLabel(en.language, { exact: true }).selectOption(language);
      await expect(page.getByRole('heading', { name: pt.settings, exact: true })).toBeVisible();
    }
    await nav(page, copy.pillars).click();
    const name = copy.body;
    await page
      .getByRole('region', { name, exact: true })
      .getByRole('button', {
        name: copy.pillarActions.replace('{pillar}', () => name),
        exact: true,
      })
      .click();
    await page
      .locator('[data-action-surface]')
      .getByRole('button', {
        name: copy.viewPillarStreaks,
        exact: true,
      })
      .click();
    await expect(page.getByRole('heading', { name: copy.history, exact: true })).toBeVisible();
    const before = await readDataset(page);
    const header = page.locator('.pillar-header');
    await expect(header.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(header.locator('svg')).toHaveCount(1);
    await expect(header.locator('p')).toHaveText([
      copy.streakCompact.replace('{current}', '1').replace('{best}', '1'),
    ]);
    const day = (date: string) =>
      page.locator('.pillar-history-day').filter({
        has: page.locator(`time[datetime="${date}"]`),
      });
    const count = (done: string) =>
      copy.requiredCount.replace('{done}', done).replace('{total}', '1');
    await expect(day('2026-10-02').locator(':scope > p')).toHaveText([copy.pending, count('0')]);
    await expect(day('2026-09-30').locator(':scope > p')).toHaveText([copy.complete, count('1')]);
    await expect(day('2026-09-28').locator(':scope > p')).toHaveText([copy.missed, count('0')]);
    await expect(day('2026-09-27').locator(':scope > p')).toHaveText([copy.neutral]);
    expect(await readDataset(page)).toEqual(before);
  });
}
