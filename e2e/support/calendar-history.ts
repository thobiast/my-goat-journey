import { expect, type Page } from '@playwright/test';
import { agenda } from '../../src/domain/agenda';
import { civilDate, parseLocalDate } from '../../src/domain/calendar';
import { updateCompletion } from '../../src/domain/completion';
import { editHabit } from '../../src/domain/lifecycle';
import type { Dataset } from '../../src/domain/types';
import { nav, onDate, readDataset, setupScheduledHabits } from './habit-fixtures';

/** Isolated backup fixture, generated with real domain transitions, never the user's diary. */
export async function restoreCalendarHistory(page: Page): Promise<Dataset> {
  await setupScheduledHabits(page);
  const data: Dataset = await readDataset(page);
  for (const habit of data.habits) {
    habit.createdOn = '2024-01-01';
    habit.versions[0].effectiveFrom = '2024-01-01';
    habit.memberships[0].effectiveFrom = '2024-01-01';
    habit.periods[0].start = '2024-01-01';
  }
  const cursor = parseLocalDate('2024-01-01');
  for (
    let date = civilDate(cursor);
    date <= '2026-03-01';
    cursor.setUTCDate(cursor.getUTCDate() + 1), date = civilDate(cursor)
  ) {
    if (date === '2026-02-02')
      editHabit(
        data,
        data.habits[0].id,
        { pillarId: 'body', goal: 'Read slowly and write a short note', weekdays: [1, 3, 5] },
        new Date(`${date}T12:00:00`),
      );
    for (const item of agenda(data, date)) {
      if ((cursor.getUTCDate() + data.habits.indexOf(item.habit)) % 5 !== 0)
        updateCompletion(data, item.habit.id, date, true, new Date(`${date}T12:00:00`));
    }
  }
  await nav(page, 'Settings').click();
  const { revision: _, ...portable } = data;
  await page.getByLabel('Choose backup file', { exact: true }).setInputFiles({
    name: 'isolated-calendar-history.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        format: 'my-goat-journey-backup',
        formatVersion: 1,
        exportedAt: '2026-03-01T12:00:00.000Z',
        dataset: portable,
      }),
    ),
  });
  await expect(page.getByText('Backup ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Replace current data', exact: true }).click();
  await expect(page.getByText('Backup restored.', { exact: true })).toBeVisible();
  await onDate(page, '2026-03-01');
  // Read back the committed replacement, not just its success message.
  const restored: Dataset = await readDataset(page);
  expect(restored.habits).toEqual(data.habits);
  expect(restored.occurrences).toEqual(data.occurrences);
  return restored;
}
