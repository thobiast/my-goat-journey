import { test, expect } from '@playwright/test';
import {
  setupScheduledHabits,
  nav,
  onDate,
  openHabit,
  readDataset,
  scheduledHabitGoals,
} from './support/habit-fixtures';
import { readFile } from 'node:fs/promises';

test.setTimeout(60_000);

for (const action of ['archive', 'reactivate'] as const) {
  test(`earlier-date ${action} preserves Monday completion and actual periods without Retry`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await setupScheduledHabits(page);
    if (action === 'reactivate') {
      await onDate(page, '2026-10-02');
      await openHabit(page);
      await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Archive this habit?', exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
      await page.getByRole('button', { name: 'Reactivate habit', exact: true }).click();
      await expect(page.getByText(/Resumes on.*Oct 5/)).toBeVisible();
      await page.getByRole('button', { name: 'Reactivate habit', exact: true }).click();
      await expect(page.getByText('Awaiting resumption', { exact: true })).toBeVisible();
    }
    await onDate(page, '2026-10-05');
    await nav(page, 'Today').click();
    const done = page.getByRole('checkbox', {
      name: `Done: ${scheduledHabitGoals[1]}`,
      exact: true,
    });
    await done.click();
    await expect(done).toBeChecked();
    const before = await readDataset(page);
    const habit = before.habits[1];
    expect(habit.periods).toHaveLength(action === 'reactivate' ? 2 : 1);
    expect(habit.pendingReactivation).toBeUndefined();
    expect(
      before.occurrences.find((o) => o.habitId === habit.id && o.date === '2026-10-05'),
    ).toMatchObject({ done: true, assignmentLocked: true, activationId: habit.periods.at(-1)!.id });
    await openHabit(page);
    await expect(page.getByText('10 XP', { exact: true })).toBeVisible();
    await onDate(page, '2026-10-02');
    const name = action === 'archive' ? 'Archive habit' : 'Reactivate habit';
    await page.getByRole('button', { name, exact: true }).click();
    await expect(
      page.getByRole('heading', {
        name: action === 'archive' ? 'Archive this habit?' : 'Reactivate this habit?',
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('These dates already have saved history.');
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
    expect(await readDataset(page)).toEqual(before);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    expect(await readDataset(page)).toEqual(before);
    await onDate(page, '2026-10-05');
    await expect(done).toBeChecked();
    await openHabit(page);
    await expect(page.getByText('10 XP', { exact: true })).toBeVisible();
    expect(await readDataset(page)).toEqual(before);
    await nav(page, 'Settings').click();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export backup', exact: true }).click();
    const download = await pending;
    const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
    const { revision: _revision, ...facts } = before;
    expect(exported.dataset).toEqual(facts);
    expect(errors).toEqual([]);
  });
}
