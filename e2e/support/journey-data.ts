import { expect, type Page } from '@playwright/test';
import type { Dataset, LegacyDataset } from '../../src/domain/types';

// Valid isolated completion facts, never fabricated XP or level fields.
export function journeyFixture(xp: number): LegacyDataset {
  const date = '2026-10-03';
  const pillars = ['mind', 'body', 'nutrition', 'hygiene'] as const;
  return {
    schemaVersion: 1,
    onboardingComplete: true,
    draft: null,
    settings: { language: 'en', reducedMotion: false },
    pillars: pillars.map((id) => ({ id, name: id, defaultKey: id })),
    habits: Array.from({ length: Math.max(4, xp / 10) }, (_, i) => ({
      id: `trail-${i}`,
      createdOn: date,
      periods: [{ id: `activation-${i}`, start: date }],
      versions: [
        {
          effectiveFrom: date,
          goal: `Isolated commitment ${i}`,
          pillarId: pillars[i % 4],
          weekdays: [0, 1, 2, 3, 4, 5, 6],
        },
      ],
    })),
    occurrences: Array.from({ length: xp / 10 }, (_, i) => ({
      habitId: `trail-${i}`,
      date,
      pillarId: pillars[i % 4],
      goal: `Isolated commitment ${i}`,
      kind: 'optional',
      done: true,
      recordedAt: `${date}T12:00:00.000Z`,
      timezone: 'UTC',
      offsetMinutes: 0,
    })),
    permanentUnlocks: [],
  };
}

export async function seedJourney(page: Page, xp: number) {
  await page.clock.install({ time: new Date('2026-10-03T12:00:00') });
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  await page.evaluate(
    (data) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('my-goat-journey');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('dataset', 'readwrite');
          tx.objectStore('dataset').put(data, 'current');
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
    journeyFixture(xp),
  );
  await page.reload();
  await page.getByRole('navigation').getByRole('button', { name: 'Journey', exact: true }).click();
}

export async function storedJourney(page: Page): Promise<Dataset> {
  return page.evaluate(
    () =>
      new Promise<Dataset>((resolve, reject) => {
        const open = indexedDB.open('my-goat-journey');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const get = db.transaction('dataset').objectStore('dataset').get('current');
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
