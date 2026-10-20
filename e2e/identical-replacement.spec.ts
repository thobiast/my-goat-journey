import { expectReview } from './support/management-fixtures';
import { test, expect } from '@playwright/test';
import {
  setupScheduledHabits,
  nav,
  openHabit,
  readDataset,
  scheduledHabitGoals,
  abortNextWrite,
} from './support/habit-fixtures';

type ReplacementProbeWindow = Window & { __replacementWrites?: number };

test.setTimeout(60_000);

test('identical confirmed replacement writes once, advances revision and discards a peer old-revision editor', async ({
  page,
  context,
}) => {
  await setupScheduledHabits(page);
  const done = page.getByRole('checkbox', { name: `Done: ${scheduledHabitGoals[1]}`, exact: true });
  await done.click();
  await expect(done).toBeChecked();
  await openHabit(page);
  await page.getByRole('button', { name: 'Edit habit', exact: true }).click();
  await page.getByLabel('Habit', { exact: true }).fill('Obsolete unsaved form');
  const before = await readDataset(page);
  const { revision: _revision, ...facts } = before;
  const peer = await context.newPage();
  await peer.clock.install({ time: new Date('2026-09-27T12:00:00') });
  await peer.goto('./');
  await nav(peer, 'Settings').click();

  const choose = () =>
    peer.getByLabel('Choose backup file', { exact: true }).setInputFiles({
      name: 'identical.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'my-goat-journey-backup',
          formatVersion: 1,
          exportedAt: '2026-09-27T12:00:00.000Z',
          dataset: facts,
        }),
      ),
    });

  await choose();
  await expect(peer.getByText('Backup ready', { exact: true })).toBeVisible();
  await abortNextWrite(peer);
  await peer.getByRole('button', { name: 'Replace current data', exact: true }).click();
  await expect(peer.getByRole('alert')).toContainText('Could not save');
  expect(await readDataset(peer)).toEqual(before);
  await expect(page.getByLabel('Habit', { exact: true })).toHaveValue('Obsolete unsaved form');
  await peer.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as ReplacementProbeWindow).__replacementWrites = 0;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      (window as ReplacementProbeWindow).__replacementWrites!++;
      return original.apply(this, args);
    };
  });
  await peer.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(peer.getByText('Backup restored.', { exact: true })).toBeVisible();
  const after = await readDataset(peer);
  expect(after).toEqual({ ...before, revision: before.revision + 1 });
  expect(await peer.evaluate(() => (window as ReplacementProbeWindow).__replacementWrites)).toBe(1);
  await expectReview(page, scheduledHabitGoals[1]);
  await expect(page.getByLabel('Habit', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  expect(await readDataset(page)).toEqual(after);
  await peer.reload();
  expect(await readDataset(peer)).toEqual(after);
  await page.reload();
  expect(await readDataset(page)).toEqual(after);
});
