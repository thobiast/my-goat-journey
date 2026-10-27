import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseBackup, serializeBackup, validateDataset } from '../src/data/backup';
import en from '../src/i18n/en.json' with { type: 'json' };
import pt from '../src/i18n/pt.json' with { type: 'json' };
import {
  nav,
  onDate,
  openHabit,
  readDataset,
  scheduledHabitGoals,
  setupScheduledHabits,
} from './support/habit-fixtures';
import { expectReview, openReviewSupporting } from './support/management-fixtures';

// All setup and mutations use the real UI; only inspection reads raw IndexedDB.
// No development-module browser imports: this also runs against compiled assets.
test.use({ timezoneId: 'UTC', locale: 'en-US' });
test.setTimeout(90_000);

const goal = scheduledHabitGoals[0];
const literalDraft = "  Read $& notes $$ $` $' {values}  ";
const scheduledDays = [1, 3, 5];

async function move(page: Page, pillarId: string) {
  await openHabit(page, goal);
  await page.getByRole('button', { name: en.editHabit, exact: true }).click();
  await expect(page.getByLabel(en.habitFieldLabel, { exact: true })).toHaveValue(goal);
  await page.getByLabel(en.pillar, { exact: true }).selectOption(pillarId);
  await page.getByRole('button', { name: en.saveChanges, exact: true }).click();
  await expectReview(page, goal);
}

async function expectWeekdays(page: Page, copy: typeof en, selected: number[]) {
  for (const [day, name] of copy.weekdays.entries()) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute(
      'aria-pressed',
      String(selected.includes(day)),
    );
  }
  await expect(page.getByRole('button', { name: copy.everyDay, exact: true })).toHaveAttribute(
    'aria-pressed',
    String(selected.length === 7),
  );
}

for (const language of ['en', 'pt'] as const) {
  test(`${language}: historical edit cannot restore participation in a removed pillar`, async ({
    page,
  }, testInfo) => {
    const copy = language === 'en' ? en : pt;
    await setupScheduledHabits(page);
    await onDate(page, '2026-10-02');
    await move(page, 'hygiene');
    await onDate(page, '2026-10-03');
    // Cancel Friday's conditional move, then request a different future owner.
    await move(page, 'mind');
    await move(page, 'body');

    await openHabit(page, goal);
    const friday = page.locator('.correction-row').filter({
      has: page.locator('time[datetime="2026-10-02"]'),
    });
    await expect(friday).toContainText(en.hygiene);
    const done = friday.getByRole('checkbox');
    await expect(done).not.toBeChecked();
    await done.click();
    await expect(done).toBeChecked();

    await nav(page, en.pillars).click();
    await page.getByRole('button', { name: 'Actions for pillar: Mind', exact: true }).click();
    await page
      .locator('[data-action-surface]')
      .getByRole('button', { name: en.removePillar, exact: true })
      .click();
    await expect(page.getByRole('button', { name: en.confirmRemoval, exact: true })).toBeVisible();
    await page.getByRole('button', { name: en.confirmRemoval, exact: true }).click();
    await expect(page.getByRole('region', { name: en.mind, exact: true })).toHaveCount(0);

    if (language === 'pt') {
      await nav(page, en.settingsNav).click();
      await page.getByLabel(en.language, { exact: true }).selectOption('pt');
      await expect(page.getByRole('heading', { name: pt.settings, exact: true })).toBeVisible();
      await expect.poll(async () => (await readDataset(page)).settings.language).toBe('pt');
    }

    const before = await readDataset(page);
    await testInfo.attach('before-historical-edit.json', {
      body: JSON.stringify(before, null, 2),
      contentType: 'application/json',
    });
    // Establish a valid, exportable baseline rather than an already-invalid fixture.
    expect(validateDataset(before)).toEqual(before);
    const baselineBackup = await parseBackup(
      serializeBackup(before, new Date('2026-10-03T12:00:00Z')),
    );
    expect({ ...baselineBackup.dataset, revision: before.revision }).toEqual(before);
    expect(before.settings.language).toBe(language);
    expect(before.pillars.find((pillar) => pillar.id === 'mind')?.removedOn).toBe('2026-10-03');
    const habit = before.habits.find((item) => item.versions[0].goal === goal)!;
    expect(habit.versions.at(-1)).toMatchObject({ goal, weekdays: scheduledDays });
    expect(habit.pendingMove).toEqual({ requestedOn: '2026-10-03', pillarId: 'body' });
    expect(habit.memberships.at(-1)).toEqual({ effectiveFrom: '2026-10-05', pillarId: 'body' });
    expect(before.occurrences.filter((item) => item.habitId === habit.id)).toMatchObject([
      { date: '2026-10-02', pillarId: 'hygiene', done: true, assignmentLocked: true },
    ]);

    await onDate(page, '2026-10-02');
    await nav(page, copy.progress).click();
    await page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: goal, exact: true }) })
      .getByRole('button', { name: goal, exact: true })
      .click();
    await expectReview(page, goal);
    await openReviewSupporting(page);
    await page.getByRole('button', { name: copy.editHabit, exact: true }).click();
    await expect(
      page.getByRole('heading', { name: copy.editHabit, level: 1, exact: true }),
    ).toBeVisible();
    const goalField = page.getByLabel(copy.habitFieldLabel, { exact: true });
    const pillar = page.getByLabel(copy.pillar, { exact: true });
    // The editor loads the saved future Body intent, not Friday's credited Hygiene.
    await expect(goalField).toHaveValue(goal);
    await expect(pillar).toHaveValue('body');
    await expectWeekdays(page, copy, scheduledDays);
    expect(await readDataset(page)).toEqual(before);

    await goalField.fill(literalDraft);
    await page.getByRole('button', { name: copy.everyDay, exact: true }).click();
    await page.getByRole('button', { name: copy.saveChanges, exact: true }).click();
    try {
      await expect(page.getByRole('alert')).toHaveText(copy.historicalConflict);
    } finally {
      // Preserve the actual committed facts even when unchanged production fails RED.
      await testInfo.attach('after-historical-edit.json', {
        body: JSON.stringify(await readDataset(page), null, 2),
        contentType: 'application/json',
      });
    }
    await expect(goalField).toHaveValue(literalDraft);
    await expect(pillar).toHaveValue('body');
    await expectWeekdays(page, copy, [0, 1, 2, 3, 4, 5, 6]);
    await expect(page.getByRole('button', { name: copy.retry, exact: true })).toHaveCount(0);
    expect(await readDataset(page)).toEqual(before);
    await page.screenshot({ path: testInfo.outputPath('historical-conflict.png'), fullPage: true });

    await page.getByRole('button', { name: copy.cancel, exact: true }).click();
    const discard = page.getByRole('dialog', { name: copy.unsavedChanges, exact: true });
    await expect(discard).toBeVisible();
    await discard.getByRole('button', { name: copy.keepEditing, exact: true }).click();
    await expect(discard).not.toBeVisible();
    await expect(goalField).toHaveValue(literalDraft);
    await expect(pillar).toHaveValue('body');
    await expectWeekdays(page, copy, [0, 1, 2, 3, 4, 5, 6]);
    expect(await readDataset(page)).toEqual(before);

    await page.getByRole('button', { name: copy.cancel, exact: true }).click();
    await expect(discard).toBeVisible();
    await discard.getByRole('button', { name: copy.discardChanges, exact: true }).click();
    await expectReview(page, goal);
    expect(await readDataset(page)).toEqual(before);

    await nav(page, copy.settingsNav).click();
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: copy.exportBackup, exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(
      /^my-goat-journey-backup-2026-10-02_\d{2}-\d{2}\.json$/,
    );
    const bytes = await readFile((await download.path())!);
    // Parse the real downloaded bytes in the runner using the production validator.
    const parsed = await parseBackup(new Blob([new Uint8Array(bytes)]));
    expect({ ...parsed.dataset, revision: before.revision }).toEqual(before);
    const envelope = JSON.parse(bytes.toString('utf8'));
    expect(envelope.dataset).not.toHaveProperty('revision');
    expect(await readDataset(page)).toEqual(before);

    await page.reload();
    await expect(
      page.getByRole('heading', { name: copy.today, level: 1, exact: true }),
    ).toBeVisible();
    const reopened = await readDataset(page);
    await testInfo.attach('after-reload.json', {
      body: JSON.stringify(reopened, null, 2),
      contentType: 'application/json',
    });
    expect(reopened).toEqual(before);
    expect(validateDataset(reopened)).toEqual(before);
  });
}
