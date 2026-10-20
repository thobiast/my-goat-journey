import type { LegacyDataset } from '../src/domain/types';
import { test, expect } from '@playwright/test';
import {
  setupScheduledHabits,
  scheduledHabitGoals,
  nav,
  onDate,
  openHabit,
  readDataset,
} from './support/habit-fixtures';

test.setTimeout(90_000);
test('Moving after Undo keeps the locked source and explains today as a goal, not a completion', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await onDate(page, '2026-10-02');
  const done = page.getByRole('checkbox', { name: `Done: ${scheduledHabitGoals[1]}`, exact: true });
  await done.click();
  await expect(done).toBeChecked();
  await done.click();
  await expect(done).not.toBeChecked();
  await openHabit(page);
  await page.getByRole('button', { name: 'Edit habit', exact: true }).click();
  await page.getByLabel('Pillar', { exact: true }).selectOption('mind');
  await expect(page.getByText(/Today's goal stays in Body.*Oct 5/)).toBeVisible({ timeout: 1500 });
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await nav(page, 'Today').click();
  const body = page.getByRole('region', { name: 'Body', exact: true });
  await expect(
    body.getByRole('heading', { name: scheduledHabitGoals[1], exact: true }),
  ).toBeVisible();
  await body.getByRole('checkbox').click();
  await expect(body.getByRole('checkbox')).toBeChecked();
  expect(
    (await readDataset(page)).occurrences.find((o) => o.goal === scheduledHabitGoals[1]),
  ).toMatchObject({ pillarId: 'body', completionProvenance: 'credited' });
});
test('Off-schedule move creates no today commitment and preserves previous correction assignment', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await onDate(page, '2026-10-03');
  await openHabit(page);
  await page.getByRole('button', { name: 'Edit habit', exact: true }).click();
  await page.getByLabel('Pillar', { exact: true }).selectOption('mind');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await nav(page, 'Today').click();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.locator('.header-xp > span[aria-hidden=true]')).toHaveText('0 XP');
  const data = await readDataset(page);
  expect(data.occurrences).toHaveLength(0);
  expect(data.habits[1].memberships.at(-1)).toMatchObject({
    effectiveFrom: '2026-10-05',
    pillarId: 'mind',
  });
  await openHabit(page);
  await expect(page.getByRole('checkbox', { name: /Done: Complete my walk.*Oct 2/ })).toBeVisible();
});
test('Moving a genuine creation-day opportunity remains optional and credits only once', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await openHabit(page);
  await page.getByRole('button', { name: 'Edit habit', exact: true }).click();
  await page.getByLabel('Pillar', { exact: true }).selectOption('mind');
  await expect(
    page.getByText(
      'Today is an optional first opportunity. Leaving it unchecked does not count as a missed goal.',
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await nav(page, 'Today').click();
  const row = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: scheduledHabitGoals[1], exact: true }) });
  await expect(row.getByText('Optional today', { exact: true })).toBeVisible();
  await expect(row.getByText('Required today', { exact: true })).toHaveCount(0);
  await row.getByRole('checkbox').click();
  await expect(row.getByRole('checkbox')).toBeChecked();
  await expect(page.locator('.header-xp > span[aria-hidden=true]')).toHaveText('10 XP');
  const data = await readDataset(page);
  expect(data.occurrences).toHaveLength(1);
  expect(data.occurrences[0]).toMatchObject({ kind: 'optional', pillarId: 'mind', done: true });
});
test('Ambiguous false legacy snapshot stays false in the source, with compatibility feedback and one reward on recheck', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await onDate(page, '2026-10-02');
  const current = await readDataset(page);
  const legacy: LegacyDataset = {
    schemaVersion: 1,
    onboardingComplete: true,
    draft: null,
    settings: current.settings,
    pillars: current.pillars,
    permanentUnlocks: [],
    habits: current.habits.map((h) => ({
      id: h.id,
      createdOn: h.createdOn,
      periods: h.periods,
      versions: h.versions.map((v) => ({ ...v, pillarId: h.memberships[0].pillarId })),
    })),
    occurrences: [
      {
        habitId: current.habits[1].id,
        date: '2026-10-02',
        pillarId: 'body',
        goal: scheduledHabitGoals[1],
        kind: 'required',
        done: false,
        recordedAt: '2026-10-02T12:00:00.000Z',
        timezone: 'UTC',
        offsetMinutes: 0,
      },
    ],
  };
  await page.evaluate(
    (data) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('my-goat-journey');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
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
    legacy,
  );
  await page.reload();
  await openHabit(page);
  await page.getByRole('button', { name: 'Edit habit', exact: true }).click();
  await page.getByLabel('Pillar', { exact: true }).selectOption('mind');
  await expect(page.getByText(/Today stays in Body.*Oct 5/)).toBeVisible();
  await expect(page.getByText(/Today's completion stays/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await nav(page, 'Today').click();
  const body = page.getByRole('region', { name: 'Body', exact: true });
  await body.getByRole('checkbox').click();
  await expect(body.getByRole('checkbox')).toBeChecked();
  await body.getByRole('checkbox').click();
  await expect(body.getByRole('checkbox')).not.toBeChecked();
  await body.getByRole('checkbox').click();
  await expect(body.getByRole('checkbox')).toBeChecked();
  await expect(page.locator('.header-xp > span[aria-hidden=true]')).toHaveText('10 XP');
  const saved = await readDataset(page);
  expect(saved.occurrences).toHaveLength(1);
  expect(saved.occurrences[0]).toMatchObject({ pillarId: 'body', done: true });
  await page.reload();
  expect((await readDataset(page)).occurrences).toEqual(saved.occurrences);
});
