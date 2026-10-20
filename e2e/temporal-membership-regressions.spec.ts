import { test, expect } from '@playwright/test';
import {
  setupScheduledHabits,
  onDate,
  openHabit,
  nav,
  readDataset,
} from './support/habit-fixtures';
import en from '../src/i18n/en.json' with { type: 'json' };

test.setTimeout(60_000);
const goal = 'Read ten pages';

async function move(page: Parameters<typeof openHabit>[0], date: string, pillarId: string) {
  await onDate(page, date);
  await openHabit(page, goal);
  await page.getByRole('button', { name: en.editHabit, exact: true }).click();
  await page.getByLabel(en.pillar, { exact: true }).selectOption(pillarId);
  await page.getByRole('button', { name: en.saveChanges, exact: true }).click();
  await expect(
    page.getByRole('heading', { name: en.reviewCompletions, level: 1, exact: true }),
  ).toBeVisible();
}

test('native historical first credit preserves the later cancellation and rewards only the dated occurrence', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await move(page, '2026-10-02', 'body');
  await move(page, '2026-10-03', 'mind');
  await openHabit(page, goal);
  const checkbox = page.getByRole('checkbox', { name: /Done: Read ten pages.*Oct 2/ });
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  const credited = await readDataset(page);
  const habit = credited.habits[0];
  expect(
    habit.memberships
      .filter((m: { effectiveFrom: string }) => m.effectiveFrom <= '2026-10-05')
      .at(-1)!.pillarId,
  ).toBe('mind');
  expect(
    credited.occurrences.filter(
      (o: { habitId: string; date: string }) => o.habitId === habit.id && o.date === '2026-10-02',
    ),
  ).toMatchObject([{ pillarId: 'body', done: true }]);
  await checkbox.click();
  await expect(checkbox).not.toBeChecked();
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  const corrected = await readDataset(page);
  expect(corrected.habits[0].memberships).toEqual(habit.memberships);
  expect(
    corrected.occurrences.filter(
      (o: { habitId: string; date: string }) => o.habitId === habit.id && o.date === '2026-10-02',
    ),
  ).toHaveLength(1);
  await onDate(page, '2026-10-05');
  await nav(page, en.today).click();
  await expect(page.locator('.header-xp-value > span')).toHaveText('10 XP');
  const saved = await readDataset(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: en.today, level: 1, exact: true })).toBeVisible();
  expect(await readDataset(page)).toEqual(saved);
});

test('native removal blocks an intermediate future owner in both UI and the committed Repository transaction', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  // Remove the fixture's independent Nutrition obligation before the scenario;
  // otherwise it would conceal the intermediate-owner bug under review.
  await openHabit(page, 'Prepare my snack');
  await page.getByRole('button', { name: en.archiveHabit, exact: true }).click();
  await page
    .locator('.confirmation')
    .getByRole('button', { name: en.archiveHabit, exact: true })
    .click();
  await move(page, '2026-10-03', 'body');
  await onDate(page, '2026-10-05');
  await expect.poll(async () => (await readDataset(page)).habits[0].pendingMove).toBeUndefined();
  await move(page, '2026-10-01', 'nutrition');
  await onDate(page, '2026-10-02');
  await expect.poll(async () => (await readDataset(page)).habits[0].pendingMove).toBeUndefined();
  await onDate(page, '2026-10-01');
  await nav(page, en.pillars).click();
  await page.getByRole('button', { name: 'Actions for pillar: Nutrition', exact: true }).click();
  await page
    .locator('[data-action-surface]')
    .getByRole('button', { name: en.removePillar, exact: true })
    .click();
  await expect(page.getByText(en.pillarOccupied, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: en.confirmRemoval, exact: true })).toHaveCount(0);
  const before = await readDataset(page);
  const message = await page.evaluate(async (revision) => {
    // A fresh Repository connection to this disposable browser diary, not a
    // prototype seam and not a source-dependent interception of the App instance.
    const { Repository } = await import(new URL('src/data/database.ts', document.baseURI).href);
    const repository = new Repository();
    try {
      await repository.removePillar('nutrition', new Date('2026-10-01T12:00:00'), revision);
      return 'unexpected success';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    } finally {
      await repository.close();
    }
  }, before.revision);
  expect(message).toBe('Move or archive all habits first');
  expect(await readDataset(page)).toEqual(before);
});
