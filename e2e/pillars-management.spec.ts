import {
  backControl,
  expandFixturePillars,
  expectReview,
  openReviewSupporting,
} from './support/management-fixtures';
import { test, expect, type Page } from '@playwright/test';
import {
  setupScheduledHabits,
  scheduledHabitGoals,
  nav,
  onDate,
  readDataset,
  abortNextWrite,
} from './support/habit-fixtures';

test.setTimeout(90_000);
test.use({ actionTimeout: 10_000 });

const group = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

const row = (page: Page, goal: string) =>
  page
    .locator('.management-habit')
    .filter({ has: page.getByRole('heading', { name: goal, exact: true }) });

test('List offers direct editing and returns to its collapsed groups and focus', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await nav(page, 'Pillars').click();
  await expandFixturePillars(page);
  await expect(page.getByText('Organize your pillars and habits.', { exact: true })).toBeVisible();
  await expect(
    group(page, 'Body').getByRole('heading', { name: scheduledHabitGoals[1], exact: true }),
  ).toBeVisible();
  await group(page, 'Mind').getByRole('button', { name: 'Mind', exact: true }).click();
  await expect(
    group(page, 'Mind').getByRole('button', { name: 'Mind', exact: true }),
  ).toHaveAttribute('aria-expanded', 'false');
  await row(page, scheduledHabitGoals[1])
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Edit habit', level: 1 })).toBeVisible();
  await expect(nav(page, 'Pillars')).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    group(page, 'Mind').getByRole('button', { name: 'Mind', exact: true }),
  ).toHaveAttribute('aria-expanded', 'false');
  await expect(
    row(page, scheduledHabitGoals[1]).getByRole('button', { name: 'Edit', exact: true }),
  ).toBeFocused();
});

test('Contextual creation keeps pillar selection and Cancel, Save and Back return to the list', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await nav(page, 'Pillars').click();
  await expandFixturePillars(page);
  await group(page, 'Mind').getByRole('button', { name: 'Mind', exact: true }).click();
  await group(page, 'Body').getByRole('button', { name: 'Add habit', exact: true }).click();
  await expect(page.getByLabel('Pillar', { exact: true })).toHaveValue('body');
  await expect(page.locator('main > header .brand')).toHaveCount(0);
  await expect(nav(page, 'Pillars')).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    group(page, 'Mind').getByRole('button', { name: 'Mind', exact: true }),
  ).toHaveAttribute('aria-expanded', 'false');
  await group(page, 'Body').getByRole('button', { name: 'Add habit', exact: true }).click();
  await page.getByLabel('What do you want to do?').fill('Stretch gently after my walk');
  await page.getByRole('button', { name: 'Save habit', exact: true }).click();
  await expect(row(page, 'Stretch gently after my walk')).toBeVisible();
  const created = (await readDataset(page)).habits.at(-1)!;
  expect(created.memberships[0].pillarId).toBe('body');
  await row(page, 'Stretch gently after my walk')
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await page.getByLabel('Habit', { exact: true }).fill('Stretch and breathe');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(row(page, 'Stretch gently after my walk')).toContainText(/Sep 28/);
  const saved = await readDataset(page);
  expect(saved.habits.at(-1)!.id).toBe(created.id);
  expect(saved.habits.at(-1)!.versions.at(-1)).toMatchObject({
    goal: 'Stretch and breathe',
    effectiveFrom: '2026-09-28',
  });
  await group(page, 'Body').getByRole('button', { name: 'Add habit', exact: true }).click();
  await backControl(page).click();
  await expect(
    group(page, 'Body').getByRole('button', { name: 'Add habit', exact: true }),
  ).toBeFocused();
});

test('More actions move credited habits truthfully, archive and review from Archived without changing origin', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await onDate(page, '2026-10-02');
  const done = page.getByRole('checkbox', { name: `Done: ${scheduledHabitGoals[1]}`, exact: true });
  await done.click();
  await expect(done).toBeChecked();
  const before = await readDataset(page);
  await nav(page, 'Pillars').click();
  await expandFixturePillars(page);
  // This legacy move flow deliberately selects an expanded destination fixture.
  await expect(group(page, 'Mind').locator('.pillar-disclosure')).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await row(page, scheduledHabitGoals[1])
    .getByRole('button', { name: `Actions for habit: ${scheduledHabitGoals[1]}`, exact: true })
    .click();
  await page
    .locator('[data-action-surface]')
    .getByRole('button', { name: 'Move to another pillar', exact: true })
    .click();
  await expect(page.getByLabel('Pillar', { exact: true })).toBeFocused();
  await page.getByLabel('Pillar', { exact: true }).selectOption('mind');
  await expect(page.getByText(/Today's completion stays in Body.*Oct 5/)).toBeVisible();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(
    group(page, 'Mind').getByRole('heading', { name: scheduledHabitGoals[1], exact: true }),
  ).toBeVisible();
  await expect(
    row(page, scheduledHabitGoals[1]).getByRole('button', { name: 'Edit', exact: true }),
  ).toBeFocused();
  await expect(row(page, scheduledHabitGoals[1])).toContainText(/Oct 5/);
  const moved = await readDataset(page);
  expect(moved.habits[1].id).toBe(before.habits[1].id);
  expect(moved.occurrences).toEqual(before.occurrences);
  await row(page, scheduledHabitGoals[1])
    .getByRole('button', { name: `Actions for habit: ${scheduledHabitGoals[1]}`, exact: true })
    .click();
  await page
    .locator('[data-action-surface]')
    .getByRole('button', { name: 'Archive habit', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Archive this habit?', exact: true }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    row(page, scheduledHabitGoals[1]).getByRole('button', {
      name: `Actions for habit: ${scheduledHabitGoals[1]}`,
      exact: true,
    }),
  ).toBeFocused();
  await row(page, scheduledHabitGoals[1])
    .getByRole('button', { name: `Actions for habit: ${scheduledHabitGoals[1]}`, exact: true })
    .click();
  await page
    .locator('[data-action-surface]')
    .getByRole('button', { name: 'Archive habit', exact: true })
    .click();
  await abortNextWrite(page);
  await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not save');
  expect(await readDataset(page)).toEqual(moved);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(row(page, scheduledHabitGoals[1])).toHaveCount(0);
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await expect(row(page, scheduledHabitGoals[1])).toBeVisible();
  await expect(nav(page, 'Pillars')).toHaveAttribute('aria-current', 'page');
  await row(page, scheduledHabitGoals[1])
    .getByRole('button', { name: 'Review completions', exact: true })
    .click();
  await expectReview(page, scheduledHabitGoals[1]);
  await expect(backControl(page)).toHaveText('← Archived');
  await backControl(page).click();
  await expect(
    page.getByRole('heading', { name: 'Archived', exact: true, level: 1 }),
  ).toBeVisible();
  await expect(
    row(page, scheduledHabitGoals[1]).getByRole('button', {
      name: 'Review completions',
      exact: true,
    }),
  ).toBeFocused();
  await row(page, scheduledHabitGoals[1])
    .getByRole('button', { name: 'Reactivate habit', exact: true })
    .click();
  await expect(page.getByText(/Resumes on.*Oct 5/)).toBeVisible();
  await page.getByRole('button', { name: 'Reactivate habit', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Archived', exact: true, level: 1 }),
  ).toBeVisible();
  await expect(row(page, scheduledHabitGoals[1])).toHaveCount(0);
  const resumed = await readDataset(page);
  expect(resumed.habits[1].pendingReactivation).toBeDefined();
  expect(
    resumed.occurrences.filter(
      (o) => o.habitId === resumed.habits[1].id && o.date === '2026-10-02',
    ),
  ).toHaveLength(1);
});

test('Pillar menu creates and renames stable identities, blocks occupied removal and preserves credited removal history', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await onDate(page, '2026-10-02');
  const done = page.getByRole('checkbox', { name: `Done: ${scheduledHabitGoals[1]}`, exact: true });
  await done.click();
  await expect(done).toBeChecked();
  await nav(page, 'Pillars').click();
  await expandFixturePillars(page);
  await page.getByRole('button', { name: 'New pillar', exact: true }).click();
  await page.getByLabel('Pillar name').fill('Quiet creativity');
  await page.getByRole('button', { name: 'Save pillar', exact: true }).click();
  await expect(group(page, 'Quiet creativity').locator('.pillar-disclosure')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expandFixturePillars(page, ['Quiet creativity']);
  await expect(group(page, 'Quiet creativity')).toContainText('No habits yet.');
  const before = await readDataset(page);
  const id = before.pillars.at(-1)!.id;
  await group(page, 'Quiet creativity')
    .getByRole('button', { name: 'Actions for pillar: Quiet creativity', exact: true })
    .click();
  await page
    .locator('[data-action-surface]')
    .getByRole('button', { name: 'Rename pillar', exact: true })
    .click();
  await page.getByLabel('Pillar name').fill('Creative practice');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(group(page, 'Creative practice')).toBeVisible();
  expect((await readDataset(page)).pillars.at(-1)!.id).toBe(id);
  await group(page, 'Body')
    .getByRole('button', { name: 'Actions for pillar: Body', exact: true })
    .click();
  await page
    .locator('[data-action-surface]')
    .getByRole('button', { name: 'Remove from active pillars', exact: true })
    .click();
  await expect(
    page.getByText('Move or archive the active habits before removing this pillar.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm removal', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Manage habits', exact: true }).click();
  await expect(row(page, scheduledHabitGoals[1])).toBeVisible();
  await row(page, scheduledHabitGoals[1])
    .getByRole('button', { name: `Actions for habit: ${scheduledHabitGoals[1]}`, exact: true })
    .click();
  await page
    .locator('[data-action-surface]')
    .getByRole('button', { name: 'Archive habit', exact: true })
    .click();
  await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
  await group(page, 'Body')
    .getByRole('button', { name: 'Actions for pillar: Body', exact: true })
    .click();
  await page
    .locator('[data-action-surface]')
    .getByRole('button', { name: 'View pillar streaks', exact: true })
    .click();
  await expect(page.getByText('Streak 1 · Best 1', { exact: true })).toBeVisible();
  await expect(nav(page, 'Pillars')).toHaveAttribute('aria-current', 'page');
  await backControl(page).click();
  await group(page, 'Body')
    .getByRole('button', { name: 'Actions for pillar: Body', exact: true })
    .click();
  await page
    .locator('[data-action-surface]')
    .getByRole('button', { name: 'Rename pillar', exact: true })
    .click();
  await page.getByLabel('Pillar name').fill('My movement');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await group(page, 'My movement')
    .getByRole('button', { name: 'Actions for pillar: My movement', exact: true })
    .click();
  await page
    .locator('[data-action-surface]')
    .getByRole('button', { name: 'Remove from active pillars', exact: true })
    .click();
  await page.getByRole('button', { name: 'Confirm removal', exact: true }).click();
  await expect(group(page, 'My movement')).toHaveCount(0);
  const removed = await readDataset(page);
  expect(removed.pillars.find((p) => p.id === 'body')).toMatchObject({
    nameOverride: 'My movement',
    removedOn: '2026-10-02',
  });
  expect(
    removed.occurrences.filter((o) => o.habitId === before.habits[1].id && o.date === '2026-10-02'),
  ).toMatchObject([{ done: true, pillarId: 'body' }]);
  expect(removed.habits).toHaveLength(before.habits.length);
  await nav(page, 'Today').click();
  await expect(group(page, 'My movement').getByRole('checkbox')).toBeChecked();
  await nav(page, 'Progress').click();
  await page.getByRole('tab', { name: 'Pillars', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My movement', exact: true })).toBeVisible();
  await nav(page, 'Pillars').click();
  await expandFixturePillars(page);
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await row(page, scheduledHabitGoals[1])
    .getByRole('button', { name: 'Reactivate habit', exact: true })
    .click();
  await expect(
    page
      .locator('p')
      .filter({ hasText: 'Choose an active pillar before reactivating this habit.' }),
  ).toBeVisible();
  await expect(
    page
      .getByLabel('Pillar', { exact: true })
      .getByRole('option', { name: 'My movement', exact: true }),
  ).toHaveCount(0);
  await page.getByLabel('Pillar', { exact: true }).selectOption('mind');
  await abortNextWrite(page);
  await page.getByRole('button', { name: 'Reactivate habit', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not save');
  expect(await readDataset(page)).toEqual(removed);
  await page.getByLabel('Pillar', { exact: true }).selectOption('nutrition');
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reactivate habit', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Archived', exact: true, level: 1 }),
  ).toBeVisible();
  const resumed = await readDataset(page);
  expect(resumed.habits[1].id).toBe(before.habits[1].id);
  expect(resumed.habits[1].pendingReactivation).toBeDefined();
  expect(resumed.habits[1].memberships.at(-1)!.pillarId).toBe('nutrition');
  expect(resumed.occurrences).toEqual(removed.occurrences);
  await page.reload();
  await nav(page, 'Pillars').click();
  await expandFixturePillars(page);
  await expect(group(page, 'Body')).toHaveCount(0);
});

test('Management success is transient and Archived retains its independent scroll and focus context', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await setupScheduledHabits(page);
  await nav(page, 'Pillars').click();
  await expandFixturePillars(page);
  await group(page, 'Hygiene')
    .getByRole('button', { name: 'Actions for pillar: Hygiene', exact: true })
    .click();
  await page
    .locator('[data-action-surface]')
    .getByRole('button', { name: 'Rename pillar', exact: true })
    .click();
  await page.getByLabel('Pillar name').fill('My daily care');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expandFixturePillars(page, ['My daily care']);
  await expect(page.getByRole('status')).toContainText('Pillar saved.');
  await page.clock.runFor(5000);
  await expect(page.getByRole('status')).toBeEmpty();
  await expect(
    group(page, 'My daily care').getByRole('button', { name: 'My daily care', exact: true }),
  ).toContainText('1 active habit');
  // Archive two rows so the archived list has its own independent origin.
  for (const goal of [scheduledHabitGoals[0], scheduledHabitGoals[3]]) {
    await row(page, goal)
      .getByRole('button', { name: `Actions for habit: ${goal}`, exact: true })
      .click();
    await page
      .locator('[data-action-surface]')
      .getByRole('button', { name: 'Archive habit', exact: true })
      .click();
    await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Archived', exact: true }).scrollIntoViewIfNeeded();
  const listY = await page.evaluate(() => scrollY);
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await row(page, scheduledHabitGoals[3])
    .getByRole('button', { name: 'Review completions', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Edit habit', exact: true })
    .count()
    .then((n) => expect(n).toBe(0));
  await backControl(page).click();
  await expect(
    row(page, scheduledHabitGoals[3]).getByRole('button', {
      name: 'Review completions',
      exact: true,
    }),
  ).toBeFocused();
  await backControl(page).click();
  await expect(page.getByRole('button', { name: 'Archived', exact: true })).toBeFocused();
  expect(Math.abs((await page.evaluate(() => scrollY)) - listY)).toBeLessThan(3);
});

test('Historical review can reactivate a removed-source habit into an active destination and future-date prompts recover read-only', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await nav(page, 'Pillars').click();
  await expandFixturePillars(page);
  await row(page, scheduledHabitGoals[1])
    .getByRole('button', { name: `Actions for habit: ${scheduledHabitGoals[1]}`, exact: true })
    .click();
  await page
    .locator('[data-action-surface]')
    .getByRole('button', { name: 'Archive habit', exact: true })
    .click();
  await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
  await group(page, 'Body')
    .getByRole('button', { name: 'Actions for pillar: Body', exact: true })
    .click();
  await page
    .locator('[data-action-surface]')
    .getByRole('button', { name: 'Remove from active pillars', exact: true })
    .click();
  await page.getByRole('button', { name: 'Confirm removal', exact: true }).click();
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await row(page, scheduledHabitGoals[1])
    .getByRole('button', { name: 'Review completions', exact: true })
    .click();
  await expectReview(page, scheduledHabitGoals[1]);
  for (const name of ['Edit habit', 'Archive habit', 'Reactivate habit'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(backControl(page)).toHaveText('← Archived');
  await backControl(page).click();
  // Legacy historical management still lives in Progress's secondary controls.
  await nav(page, 'Progress').click();
  await page
    .locator('summary')
    .filter({ hasText: /^Filters$/ })
    .click();
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await page.getByRole('button', { name: scheduledHabitGoals[1], exact: true }).click();
  await openReviewSupporting(page);
  await page.getByRole('button', { name: 'Reactivate habit', exact: true }).click();
  await expect(page.getByLabel('Pillar', { exact: true })).toBeVisible();
  await page.getByLabel('Pillar', { exact: true }).selectOption('mind');
  await page.getByRole('button', { name: 'Reactivate habit', exact: true }).click();
  await expect(page.getByText('Awaiting resumption', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
  await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
  await backControl(page).click();
  await nav(page, 'Pillars').click();
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await row(page, scheduledHabitGoals[1])
    .getByRole('button', { name: 'Reactivate habit', exact: true })
    .click();
  const before = await readDataset(page);
  await onDate(page, '2026-09-26');
  await expectReview(page, scheduledHabitGoals[1]);
  await openReviewSupporting(page);
  await expect(page.getByRole('button', { name: 'Reactivate habit', exact: true })).toHaveCount(0);
  await expect(page.getByText('Waiting to start', { exact: true })).toBeVisible();
  expect(await readDataset(page)).toEqual(before);
});

test('General Add habit uses an active pillar after a default was removed', async ({ page }) => {
  await setupScheduledHabits(page);
  await nav(page, 'Pillars').click();
  await expandFixturePillars(page);
  await row(page, scheduledHabitGoals[0])
    .getByRole('button', { name: `Actions for habit: ${scheduledHabitGoals[0]}`, exact: true })
    .click();
  await page
    .locator('[data-action-surface]')
    .getByRole('button', { name: 'Archive habit', exact: true })
    .click();
  await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
  await group(page, 'Mind')
    .getByRole('button', { name: 'Actions for pillar: Mind', exact: true })
    .click();
  await page
    .locator('[data-action-surface]')
    .getByRole('button', { name: 'Remove from active pillars', exact: true })
    .click();
  await page.getByRole('button', { name: 'Confirm removal', exact: true }).click();
  await nav(page, 'Today').click();
  await page.getByRole('button', { name: 'Add habit', exact: true }).click();
  await expect(page.getByLabel('Pillar', { exact: true })).toHaveValue('body');
  await page.getByLabel('What do you want to do?').fill('Choose a new activity');
  await page.getByRole('button', { name: 'Save habit', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Choose a new activity', exact: true }),
  ).toBeVisible();
  expect((await readDataset(page)).habits.at(-1)!.memberships[0].pillarId).toBe('body');
});

test('An empty active routine routes Add habit to pillar creation instead of a broken selection', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await nav(page, 'Pillars').click();
  await expandFixturePillars(page);
  for (const [index, name] of ['Mind', 'Body', 'Nutrition', 'Hygiene'].entries()) {
    await row(page, scheduledHabitGoals[index])
      .getByRole('button', {
        name: `Actions for habit: ${scheduledHabitGoals[index]}`,
        exact: true,
      })
      .click();
    await page
      .locator('[data-action-surface]')
      .getByRole('button', { name: 'Archive habit', exact: true })
      .click();
    await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
    await group(page, name)
      .getByRole('button', { name: `Actions for pillar: ${name}`, exact: true })
      .click();
    await page
      .locator('[data-action-surface]')
      .getByRole('button', { name: 'Remove from active pillars', exact: true })
      .click();
    await page.getByRole('button', { name: 'Confirm removal', exact: true }).click();
  }
  await nav(page, 'Today').click();
  await page.getByRole('button', { name: 'Add habit', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'New pillar', exact: true, level: 1 }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true, level: 1 })).toBeVisible();
});

const longGoal =
  'Walk calmly through my neighborhood, notice the trees and return at my own pace without rushing or comparing myself to anyone else';
const longPillar = 'Creative practice, music and quiet time to reflect on my day';
const screenshots = 'artifacts/pillars-management/ui/screenshots';
for (const language of ['en', 'pt'] as const)
  for (const width of [390, 1280])
    for (const text of [100, 200])
      test(`Management captures ${language} ${width}px text${text} with long goals`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await setupScheduledHabits(page);
        await nav(page, 'Pillars').click();
        await expandFixturePillars(page);
        await page.getByRole('button', { name: 'New pillar', exact: true }).click();
        await page.getByLabel('Pillar name').fill(longPillar);
        await page.getByRole('button', { name: 'Save pillar', exact: true }).click();
        await group(page, 'Body').getByRole('button', { name: 'Add habit', exact: true }).click();
        await page.getByLabel('What do you want to do?').fill(longGoal);
        await page.getByRole('button', { name: 'Save habit', exact: true }).click();
        await row(page, scheduledHabitGoals[2])
          .getByRole('button', {
            name: `Actions for habit: ${scheduledHabitGoals[2]}`,
            exact: true,
          })
          .click();
        await page
          .locator('[data-action-surface]')
          .getByRole('button', { name: 'Archive habit', exact: true })
          .click();
        await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
        if (language === 'pt') {
          await nav(page, 'Settings').click();
          await page.getByLabel('Language', { exact: true }).selectOption('pt');
          await expect(
            page.getByRole('heading', { name: 'Configurações', exact: true }),
          ).toBeVisible();
        }
        const labels =
          language === 'en'
            ? {
                pillars: 'Pillars',
                body: 'Body',
                edit: 'Edit',
                manage: `Actions for pillar: ${longPillar}`,
                rename: 'Rename pillar',
                cancel: 'Cancel',
                archived: 'Archived',
                back: 'Back',
                goal: 'Habit',
                more: `Actions for habit: ${longGoal}`,
              }
            : {
                pillars: 'Pilares',
                body: 'Corpo',
                edit: 'Editar',
                manage: `Ações do pilar: ${longPillar}`,
                rename: 'Renomear pilar',
                cancel: 'Cancelar',
                archived: 'Arquivados',
                back: 'Voltar',
                goal: 'Hábito',
                more: `Ações do hábito: ${longGoal}`,
              };
        await nav(page, labels.pillars).click();
        await expandFixturePillars(page);
        await page.addStyleTag({ content: `html {font-size:${text}%;}` });
        const stem = `${language}-${width}-text${text}`;

        async function capture(screen: string, fullPage = true) {
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
          await expect(nav(page, labels.pillars)).toHaveAttribute('aria-current', 'page');
          const small = await page.locator('main button:visible').evaluateAll((nodes) =>
            nodes
              .filter((node) => {
                const r = node.getBoundingClientRect();
                return r.width < 43 || r.height < 43;
              })
              .map((n) => n.textContent),
          );
          expect(small).toEqual([]);
          await page.screenshot({ path: `${screenshots}/${screen}-${stem}.png`, fullPage });
        }

        await page.evaluate(() => scrollTo(0, 0));
        await capture('main-list');
        await group(page, labels.body)
          .getByRole('button', { name: labels.body, exact: true })
          .scrollIntoViewIfNeeded();
        await capture('populated-expanded', false);
        await row(page, longGoal)
          .getByRole('heading', { name: longGoal, exact: true })
          .evaluate((node) => node.scrollIntoView({ block: 'start' }));
        await capture('long-goal-viewport', false);
        await expect(group(page, labels.body)).toContainText(
          language === 'en' ? '2 active habits' : '2 hábitos ativos',
        );
        await expect(
          row(page, longGoal).getByRole('heading', { name: longGoal, exact: true }),
        ).toHaveText(longGoal);
        await row(page, longGoal).getByRole('button', { name: labels.more, exact: true }).focus();
        await page.keyboard.press('Enter');
        await expect(
          row(page, longGoal).getByRole('button', { name: labels.more, exact: true }),
        ).toHaveAttribute('aria-expanded', 'true');
        await page.keyboard.press('Escape');
        await expect(
          row(page, longGoal).getByRole('button', { name: labels.more, exact: true }),
        ).toBeFocused();
        await row(page, longGoal).getByRole('button', { name: labels.edit, exact: true }).click();
        await expect(page.getByLabel(labels.goal, { exact: true })).toHaveValue(longGoal);
        await capture('habit-editing');
        await page.locator('fieldset').scrollIntoViewIfNeeded();
        await capture('editor-weekdays-viewport', false);
        await page.getByRole('button', { name: labels.cancel, exact: true }).click();
        await group(page, longPillar)
          .getByRole('button', { name: labels.manage, exact: true })
          .click();
        await page
          .locator('[data-action-surface]')
          .getByRole('button', { name: labels.rename, exact: true })
          .click();
        await capture('pillar-management');
        await page.getByRole('button', { name: labels.cancel, exact: true }).click();
        await page.getByRole('button', { name: labels.archived, exact: true }).click();
        await capture('archived');
        await expect(row(page, scheduledHabitGoals[2])).toBeVisible();
      });
