import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { developmentModuleUrl } from './support/development-module';
import { openReviewSupporting } from './support/management-fixtures';
import {
  setupScheduledHabits,
  nav,
  openHabit,
  readDataset,
  scheduledHabitGoals,
} from './support/habit-fixtures';
import en from '../src/i18n/en.json' with { type: 'json' };

test.setTimeout(90_000);

for (const reconcile of [false, true]) {
  test(`Fresh export cannot authorize a stale habit editor after an unnotified replacement (reconcile: ${reconcile})`, async ({
    page,
  }) => {
    test.skip(
      (process.env.BASE_URL ?? '').includes('runtime'),
      'A second Repository without notification requires development modules',
    );
    await setupScheduledHabits(page);
    await nav(page, en.settingsNav).click();
    const before = await readDataset(page);
    const modulePath = await developmentModuleUrl(page, '/src/data/database.ts');
    const replaced = await page.evaluate(
      async ({ modulePath, reconcile }) => {
        const { Repository }: typeof import('../src/data/database') = await import(modulePath);
        const other = new Repository();
        try {
          let current = await other.load(new Date());
          if (reconcile) {
            current = await other.archiveHabit(current.habits[0].id, new Date(), current.revision);
            current = await other.reactivateHabit(
              current.habits[0].id,
              new Date(),
              current.revision,
            );
          }
          const candidate = structuredClone(current);
          candidate.habits[1].versions[0].goal = 'Restored fictional commitment';
          candidate.habits[1].versions[0].weekdays = [2];
          // Repository replacement is real and revision-guarded. Notifications belong
          // to App, so this independent instance deliberately delivers none.
          return await other.replaceDataset(candidate, current.revision, new Date());
        } finally {
          await other.close();
        }
      },
      { modulePath, reconcile },
    );
    expect(replaced.revision).toBe(before.revision + (reconcile ? 3 : 1));
    expect(replaced.habits.map((habit) => habit.id)).toEqual(
      before.habits.map((habit) => habit.id),
    );
    expect(await readDataset(page)).toEqual(replaced);

    if (reconcile) {
      expect(replaced.habits[0].pendingReactivation).toBeDefined();
      // No resume/focus event: export's own load must materialize the due period.
      await page.clock.setFixedTime(new Date('2026-09-28T12:00:00'));
    }
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: en.exportBackup, exact: true }).click();
    const download = await pending;
    const backup = JSON.parse(await readFile((await download.path())!, 'utf8'));
    const exported = await readDataset(page);
    expect(exported.revision).toBe(replaced.revision + (reconcile ? 1 : 0));
    if (reconcile) {
      expect(exported.habits[0].pendingReactivation).toBeUndefined();
      expect(exported.habits[0].periods).toHaveLength(replaced.habits[0].periods.length + 1);
      expect(exported.habits[0].periods.at(-1)?.start).toBe('2026-09-28');
    } else {
      expect(exported).toEqual(replaced);
    }
    const { revision: _revision, ...portable } = exported;
    expect(backup.dataset).toEqual(portable);
    expect(exported.habits[1]).toEqual(replaced.habits[1]);

    // Prove the interface is still A, not merely that B was exported.
    await openHabit(page);
    await page.getByRole('button', { name: en.editHabit, exact: true }).click();
    const input = page.getByLabel('Habit', { exact: true });
    await expect(input).toHaveValue(scheduledHabitGoals[1]);
    await expect(page.getByRole('button', { name: 'Monday', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const literal = 'Only the fictional goal was edited';
    await input.fill(literal);
    await page.getByRole('button', { name: en.saveChanges, exact: true }).click();
    // Await the completed Save, whether it succeeds incorrectly or rejects safely.
    await expect
      .poll(async () => (await input.count()) === 0 || (await page.getByRole('alert').count()) > 0)
      .toBe(true);
    expect(await readDataset(page)).toEqual(exported);
    await expect(page.getByRole('alert')).toContainText(en.staleError);
    await expect(input).toHaveValue(literal);
    await expect(page.getByRole('button', { name: en.retry, exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: en.reload, exact: true }).click();
    await expect(input).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Restored fictional commitment', exact: true }),
    ).toBeVisible();
    expect(await readDataset(page)).toEqual(exported);
    await openReviewSupporting(page);
    await page.getByRole('button', { name: en.editHabit, exact: true }).click();
    await expect(input).toHaveValue('Restored fictional commitment');
    await expect(page.getByRole('button', { name: 'Tuesday', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('button', { name: 'Monday', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await input.fill(literal);
    await page.getByRole('button', { name: en.saveChanges, exact: true }).click();
    await expect(input).toHaveCount(0);
    const saved = await readDataset(page);
    expect(saved.revision).toBe(exported.revision + 1);
    expect(saved.habits[1].versions.at(-1)).toMatchObject({ goal: literal, weekdays: [2] });
    expect(saved.habits[1].versions.slice(0, -1)).toEqual(replaced.habits[1].versions);
    expect(saved.habits.filter((habit) => habit.id !== exported.habits[1].id)).toEqual(
      exported.habits.filter((habit) => habit.id !== exported.habits[1].id),
    );
  });
}

test('Same-instance export retains the revision needed for an ordinary goal-only edit', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await nav(page, en.settingsNav).click();
  const before = await readDataset(page);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: en.exportBackup, exact: true }).click();
  const download = await pending;
  const backup = JSON.parse(await readFile((await download.path())!, 'utf8'));
  const { revision: _revision, ...portable } = before;
  expect(backup.dataset).toEqual(portable);
  expect(await readDataset(page)).toEqual(before);
  await openHabit(page);
  await page.getByRole('button', { name: en.editHabit, exact: true }).click();
  const input = page.getByLabel('Habit', { exact: true });
  const literal = 'An ordinary fictional goal-only edit';
  await input.fill(literal);
  await page.getByRole('button', { name: en.saveChanges, exact: true }).click();
  await expect(input).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const saved = await readDataset(page);
  expect(saved.revision).toBe(before.revision + 1);
  expect(saved.habits[1].versions.at(-1)).toMatchObject({ goal: literal, weekdays: [1, 3, 5] });
  expect(saved.habits[1].versions.slice(0, -1)).toEqual(before.habits[1].versions);
  expect(saved.occurrences).toEqual(before.occurrences);
  await page.reload();
  expect(await readDataset(page)).toEqual(saved);
});
