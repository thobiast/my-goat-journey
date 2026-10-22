import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { civilHistory } from '../tests/helpers/civil-history';
import { nav, readDataset } from './support/habit-fixtures';
import en from '../src/i18n/en.json' with { type: 'json' };
import pt from '../src/i18n/pt.json' with { type: 'json' };

async function seedFictionalHistory(page: Page, data = civilHistory()) {
  await page.evaluate(async (data) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('my-goat-journey');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('dataset', 'readwrite');
      tx.objectStore('dataset').put(data, 'current');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  }, data);
}

for (const timezoneId of ['UTC', 'Pacific/Apia']) {
  test.describe(`civil history in ${timezoneId}`, () => {
    test.use({ timezoneId });
    for (const language of ['en', 'pt'] as const) {
      test(`historical Friday labels, calendar navigation and native backup roundtrip (${language})`, async ({
        page,
      }, testInfo) => {
        const instant = '2011-12-31T00:30:00.000Z';
        await page.clock.install({ time: new Date(instant) });
        await page.clock.setFixedTime(new Date(instant));
        await page.goto('./');
        await expect(page.getByRole('button', { name: en.start, exact: true })).toBeVisible();
        const data = civilHistory();
        data.settings.language = language;
        // Isolated new browser context only: model already-stored UTC facts after travel.
        await seedFictionalHistory(page, data);
        await page.reload();
        const copy = language === 'en' ? en : pt;
        const shortDate = language === 'en' ? 'Fri, Dec 30, 2011' : 'sex., 30 de dez. de 2011';
        const fullDate =
          language === 'en' ? 'Friday, December 30, 2011' : 'sexta-feira, 30 de dezembro de 2011';
        await expect(page.locator('.today-header time')).toHaveAttribute('datetime', '2011-12-31');
        await expect(page.locator('.header-xp-value')).toHaveText('10 XP');
        await nav(page, copy.progress).click();
        const cell = page.locator('[data-calendar-date="2011-12-30"]').first();
        await expect(cell).toHaveAccessibleName(`${fullDate} · ${copy.progressCompleted}`);
        await expect(cell.locator('.day-number')).toHaveText('30');
        const dates = await page
          .locator('.consistency-card')
          .first()
          .locator('[data-calendar-date]')
          .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.calendarDate));
        expect(dates).toEqual(['2011-12-29', '2011-12-30']);
        await page.screenshot({ path: testInfo.outputPath('civil-history.png'), fullPage: true });
        await cell.click();
        await expect(page.locator('.day-navigation p')).toHaveText(shortDate);
        await page.getByRole('button', { name: copy.previousDay, exact: true }).click();
        await expect(page.locator('.day-navigation p')).toContainText(
          language === 'en' ? 'Dec 29, 2011' : '29 de dez. de 2011',
        );
        await page.getByRole('button', { name: copy.nextDay, exact: true }).click();
        await expect(page.locator('.day-navigation p')).toHaveText(shortDate);
        await expect(page.getByRole('checkbox')).toBeChecked();
        await page.getByRole('button', { name: copy.manageHabit, exact: true }).click();
        await expect(page.locator('time[datetime="2011-12-30"]')).toHaveText(shortDate);
        await nav(page, copy.settingsNav).click();
        const downloading = page.waitForEvent('download');
        await page.getByRole('button', { name: copy.exportBackup, exact: true }).click();
        const download = await downloading;
        const bytes = await readFile((await download.path())!);
        const { revision: _revision, ...portable } = data;
        expect(JSON.parse(bytes.toString('utf8'))).toEqual({
          format: 'my-goat-journey-backup',
          formatVersion: 1,
          exportedAt: instant,
          dataset: portable,
        });
        await page.getByLabel(copy.chooseBackup, { exact: true }).setInputFiles({
          name: 'fictional-history.json',
          mimeType: 'application/json',
          buffer: bytes,
        });
        await expect(
          page.getByRole('heading', { name: copy.backupReady, exact: true }),
        ).toBeVisible();
        await page.getByRole('button', { name: copy.replaceData, exact: true }).click();
        await expect(page.getByText(copy.backupRestored, { exact: true })).toBeVisible();
        const restored = await readDataset(page);
        expect(restored).toEqual({ ...data, revision: restored.revision });
        expect(restored.revision).toBeGreaterThan(data.revision);
        await page.reload();
        await expect(page.locator('.header-xp-value')).toHaveText('10 XP');
        expect(await readDataset(page)).toEqual(restored);
        await nav(page, copy.progress).click();
        await expect(
          page.locator('[data-calendar-date="2011-12-30"]').first(),
        ).toHaveAccessibleName(`${fullDate} · ${copy.progressCompleted}`);
      });
    }
  });
}

for (const timezoneId of ['UTC', 'Pacific/Apia', 'America/New_York', 'Asia/Tokyo']) {
  test.describe(`device Today in ${timezoneId}`, () => {
    test.use({ timezoneId });
    test('Today uses the local day near UTC midnight and refreshes at local midnight', async ({
      page,
    }) => {
      const instant = new Date('2026-10-22T00:30:00.000Z');
      await page.clock.install({ time: instant });
      await page.clock.pauseAt(instant);
      await page.goto('./');
      await expect(page.getByRole('button', { name: en.start, exact: true })).toBeVisible();
      // Use a short fictional history; the same instant legitimately has a different Today in NY.
      const data = civilHistory();
      data.habits[0].createdOn = '2026-10-20';
      data.habits[0].versions[0].effectiveFrom = '2026-10-20';
      data.habits[0].memberships[0].effectiveFrom = '2026-10-20';
      data.habits[0].periods[0].start = '2026-10-20';
      data.occurrences = [];
      await seedFictionalHistory(page, data);
      await page.reload();
      await expect(page.locator('.today-header time')).toHaveAttribute(
        'datetime',
        timezoneId === 'America/New_York' ? '2026-10-21' : '2026-10-22',
      );
      const localMidnight = await page.evaluate(() =>
        new Date('2026-10-22T23:59:59.000').toISOString(),
      );
      await page.clock.setSystemTime(new Date(localMidnight));
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await expect(page.locator('.today-header time')).toHaveAttribute('datetime', '2026-10-22');
      await page.clock.runFor(2000);
      await expect(page.locator('.today-header time')).toHaveAttribute('datetime', '2026-10-23');
      expect(await readDataset(page)).toEqual(data);
    });
  });
}
