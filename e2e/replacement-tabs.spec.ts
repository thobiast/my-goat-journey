import { test, expect } from '@playwright/test';
import { setupScheduledHabits, nav, openHabit, readDataset } from './support/habit-fixtures';

test.setTimeout(90_000);
test('Another tab replacement closes a detail whose identity no longer exists', async ({
  page,
  context,
}) => {
  await setupScheduledHabits(page);
  await openHabit(page);
  const other = await context.newPage();
  await other.clock.install({ time: new Date('2026-09-27T12:00:00') });
  await other.goto('./');
  await nav(other, 'Settings').click();
  const { revision: _revision, ...facts } = await readDataset(other);
  for (const habit of facts.habits) habit.id = `new-${habit.id}`;
  const envelope = {
    format: 'my-goat-journey-backup',
    formatVersion: 1,
    exportedAt: '2026-09-27T12:00:00.000Z',
    dataset: facts,
  };
  await other.getByLabel('Choose backup file', { exact: true }).setInputFiles({
    name: 'replacement.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(envelope)),
  });
  await expect(other.getByText('Backup ready', { exact: true })).toBeVisible();
  await other.getByRole('button', { name: 'Replace current data', exact: true }).click();
  await expect(other.getByText('Backup restored.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible({
    timeout: 1500,
  });
  expect((await readDataset(page)).habits.every((h) => h.id.startsWith('new-'))).toBe(true);
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
});
