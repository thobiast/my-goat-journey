import { test, expect } from '@playwright/test';
import { setupScheduledHabits, nav, readDataset } from './support/habit-fixtures';
import en from '../src/i18n/en.json' with { type: 'json' };
import pt from '../src/i18n/pt.json' with { type: 'json' };

for (const language of ['en', 'pt'] as const)
  test(`restore cancel returns keyboard focus without writing or stealing deletion focus (${language})`, async ({
    page,
  }) => {
    await setupScheduledHabits(page);
    await nav(page, en.settingsNav).click();
    if (language === 'pt') {
      await page.getByLabel(en.language, { exact: true }).selectOption('pt');
      await expect(
        page.getByRole('heading', { name: pt.settings, exact: true, level: 1 }),
      ).toBeVisible();
    }
    const copy = language === 'en' ? en : pt;
    const before = await readDataset(page);
    const { revision: _revision, ...dataset } = before;
    const file = {
      name: 'fictional-focus-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'my-goat-journey-backup',
          formatVersion: 1,
          exportedAt: '2026-09-27T12:00:00.000Z',
          dataset,
        }),
      ),
    };
    const input = page.getByLabel(copy.chooseBackup, { exact: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      await input.setInputFiles(file);
      const confirmation = page.locator('.settings-section .confirmation');
      const cancel = confirmation.getByRole('button', { name: copy.cancel, exact: true });
      await expect(cancel).toBeVisible();
      await cancel.focus();
      await cancel.press('Enter');
      await expect(confirmation).toHaveCount(0);
      await expect(input).toBeFocused();
      expect(await readDataset(page)).toEqual(before);
    }
    await input.setInputFiles(file);
    await expect(page.getByRole('heading', { name: copy.backupReady, exact: true })).toBeVisible();
    await page.getByRole('button', { name: copy.deleteOpen, exact: true }).click();
    const deletion = page.locator('.delete-section .confirmation');
    await expect(deletion.getByRole('button', { name: copy.cancel, exact: true })).toBeFocused();
    expect(await readDataset(page)).toEqual(before);
  });
