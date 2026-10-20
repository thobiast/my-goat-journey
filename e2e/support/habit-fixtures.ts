import { expect, type Page } from '@playwright/test';
import type { Dataset } from '../../src/domain/types';
import { expectReview, openReviewSupporting } from './management-fixtures';

export const scheduledHabitGoals = [
  'Read ten pages',
  'Complete my walk',
  'Prepare my snack',
  'Complete my care',
];

export const nav = (page: Page, name: string) =>
  page.getByRole('navigation').getByRole('button', { name, exact: true });

export async function setupScheduledHabits(page: Page) {
  await page.clock.install({ time: new Date('2026-09-27T12:00:00') });
  await page.goto('./');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  for (const [index, goal] of scheduledHabitGoals.entries()) {
    await expect(
      page.getByRole('heading', {
        name: ['Mind', 'Body', 'Nutrition', 'Hygiene'][index],
        exact: true,
      }),
    ).toBeVisible();
    await page.getByLabel('What do you want to do?').fill(goal);
    for (const day of ['Sunday', 'Tuesday', 'Thursday', 'Saturday'])
      await page.getByRole('button', { name: day, exact: true }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Start my journey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
}

export async function onDate(page: Page, date: string) {
  await page.clock.setSystemTime(new Date(`${date}T12:00:00`));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

export async function readDataset(page: Page) {
  return page.evaluate(
    () =>
      new Promise<Dataset>((resolve, reject) => {
        const request = indexedDB.open('my-goat-journey');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('dataset');
          const get = tx.objectStore('dataset').get('current');
          get.onerror = () => {
            db.close();
            reject(get.error);
          };
          get.onsuccess = () => {
            db.close();
            // Ordinary callers await fixture initialization (and legacy migration) in the UI.
            // Only that stored schema-2 record is asserted here; no validation or repair.
            resolve(get.result as Dataset);
          };
        };
      }),
  );
}

export async function abortNextWrite(page: Page, quota = false) {
  await page.evaluate((quota) => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      IDBObjectStore.prototype.put = put;
      if (quota) throw new DOMException('Injected quota failure', 'QuotaExceededError');
      const result = put.apply(this, args);
      this.transaction.abort();
      return result;
    };
  }, quota);
}

export async function openHabit(page: Page, goal = scheduledHabitGoals[1]) {
  await nav(page, 'Progress').click();
  const row = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: goal, exact: true }) });
  await row.getByRole('button', { name: goal, exact: true }).click();
  await expectReview(page, goal);
  await openReviewSupporting(page);
}
