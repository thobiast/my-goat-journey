import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import en from '../src/i18n/en.json' with { type: 'json' };
import pt from '../src/i18n/pt.json' with { type: 'json' };
import {
  setupScheduledHabits,
  scheduledHabitGoals,
  onDate,
  nav,
  readDataset,
} from './support/habit-fixtures';
import { openReviewSupporting } from './support/management-fixtures';

test.use({ timezoneId: 'UTC' });
test.setTimeout(90_000);

async function edit(page: Page, copy: typeof en) {
  await nav(page, copy.progress).click();
  await page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: scheduledHabitGoals[0], exact: true }) })
    .getByRole('button', { name: scheduledHabitGoals[0], exact: true })
    .click();
  await openReviewSupporting(page);
  await page.getByRole('button', { name: copy.editHabit, exact: true }).click();
  await expect(page.getByLabel(copy.habitFieldLabel, { exact: true })).toBeVisible();
}

for (const language of ['en', 'pt'] as const) {
  test(`${language}: retained future destination explains and saves a real revisited goal edit`, async ({
    page,
  }, testInfo) => {
    await setupScheduledHabits(page);
    await onDate(page, '2026-10-02');
    const original = await readDataset(page);
    await expect(
      page
        .getByRole('region', { name: en.mind, exact: true })
        .getByRole('heading', { name: scheduledHabitGoals[0], exact: true }),
    ).toBeVisible();
    await onDate(page, '2026-10-03');
    await edit(page, en);
    await page.getByLabel(en.pillar, { exact: true }).selectOption('body');
    await page.getByRole('button', { name: en.saveChanges, exact: true }).click();
    await expect(page.locator('form.habit-form')).toHaveCount(0);
    const pending = await readDataset(page);
    expect(pending.habits[0].pendingMove).toEqual({ requestedOn: '2026-10-03', pillarId: 'body' });
    expect(pending.habits[0].memberships).toEqual([
      ...original.habits[0].memberships,
      { effectiveFrom: '2026-10-05', pillarId: 'body' },
    ]);
    expect(pending.occurrences).toEqual(original.occurrences);
    if (language === 'pt') {
      await nav(page, en.settingsNav).click();
      await page.getByLabel(en.language, { exact: true }).selectOption('pt');
      await expect(page.getByRole('heading', { name: pt.settings, exact: true })).toBeVisible();
    }
    const copy = language === 'en' ? en : pt;
    await onDate(page, '2026-10-02');
    await edit(page, copy);
    await expect(page.getByLabel(copy.pillar, { exact: true })).toHaveValue('body');
    const before = await readDataset(page);
    await page.evaluate(() => {
      const probe = { count: 0 };
      Object.assign(window, { editPreviewWrites: probe });
      const nativePut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args: Parameters<typeof nativePut>) {
        probe.count += 1;
        return nativePut.apply(this, args);
      };
    });
    const writes = () =>
      page.evaluate(
        () =>
          (window as Window & { editPreviewWrites?: { count: number } }).editPreviewWrites!.count,
      );
    // An unchanged Save is departure, not a command to move Friday's obligation.
    await page.getByRole('button', { name: copy.saveChanges, exact: true }).click();
    await expect(page.locator('form.habit-form')).toHaveCount(0);
    expect(await readDataset(page)).toEqual(before);
    expect(await writes()).toBe(0);
    await edit(page, copy);
    const literal = "  Read $& notes $$ $` $' {values}  ";
    const goal = page.getByLabel(copy.habitFieldLabel, { exact: true });
    await goal.fill(literal);
    await nav(page, copy.today).click();
    await page.getByRole('button', { name: copy.keepEditing, exact: true }).click();
    await expect(goal).toHaveValue(literal);
    await expect(page.getByLabel(copy.pillar, { exact: true })).toHaveValue('body');
    expect(await readDataset(page)).toEqual(before);
    expect(await writes()).toBe(0);
    const explanation =
      language === 'en'
        ? 'Today stays in Mind. This habit moves to Body on Mon, Oct 5, 2026.'
        : 'Hoje permanece em Mente. Este hábito muda para Corpo em seg., 5 de out. de 2026.';
    const previewText = await page.locator('form.habit-form').innerText();
    await page.screenshot({ path: testInfo.outputPath('editor.png'), fullPage: true });
    await page
      .locator('form.habit-form > p')
      .filter({
        hasText:
          language === 'en'
            ? /^(Today stays|Complete this habit today)/
            : /^(Hoje permanece|Conclua este hábito hoje)/,
      })
      .evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: testInfo.outputPath('editor-explanation.png') });
    await expect.soft(page.locator('form.habit-form')).toContainText(explanation);
    await expect
      .soft(page.locator('form.habit-form'))
      .not.toContainText(
        language === 'en'
          ? 'Complete this habit today to count in Body.'
          : 'Conclua este hábito hoje para contar em Corpo.',
      );
    await page.getByRole('button', { name: copy.saveChanges, exact: true }).click();
    await expect(page.locator('form.habit-form')).toHaveCount(0);
    const saved = await readDataset(page);
    expect(await writes()).toBe(1);
    expect(saved).toEqual({
      ...before,
      revision: before.revision + 1,
      habits: before.habits.map((habit, index) =>
        index
          ? habit
          : {
              ...habit,
              versions: [
                ...habit.versions,
                { effectiveFrom: '2026-10-03', goal: literal, weekdays: [1, 3, 5] },
              ],
            },
      ),
    });
    const evidence = testInfo.outputPath('facts.json');
    await writeFile(
      evidence,
      JSON.stringify({ original, pending, before, previewText, saved }, null, 2),
    );
    await testInfo.attach('facts.json', { path: evidence, contentType: 'application/json' });
    await nav(page, copy.today).click();
    const mind = page.getByRole('region', { name: copy.mind, exact: true });
    await expect(
      mind.getByRole('heading', { name: scheduledHabitGoals[0], exact: true }),
    ).toBeVisible();
    await expect(mind.getByRole('checkbox')).not.toBeChecked();
    await expect(page.locator('.today-count')).toHaveText(
      copy.todayCompletionCount.replace('{done}', '0').replace('{total}', '4'),
    );
    await expect(
      page
        .getByRole('region', { name: copy.body, exact: true })
        .getByRole('heading', { name: scheduledHabitGoals[0], exact: true }),
    ).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('saved-friday.png'), fullPage: true });
    await page.reload();
    await expect(page.getByRole('heading', { name: copy.today, exact: true })).toBeVisible();
    expect(await readDataset(page)).toEqual(saved);
    await onDate(page, '2026-10-05');
    await expect(
      page
        .getByRole('region', { name: copy.body, exact: true })
        .getByRole('heading', { name: literal.trim(), exact: true }),
    ).toBeVisible();
    const due = await readDataset(page);
    expect(due.habits[0].pendingMove).toBeUndefined();
    expect(due.habits[0].memberships).toEqual(saved.habits[0].memberships);
    expect(due.occurrences).toEqual(saved.occurrences);
    expect(due.revision).toBe(saved.revision + 1);
  });

  test(`${language}: cancelling a conditional move explains today without a fictitious future move`, async ({
    page,
  }, testInfo) => {
    await setupScheduledHabits(page);
    const original = await readDataset(page);
    await onDate(page, '2026-10-02');
    await edit(page, en);
    await page.getByLabel(en.pillar, { exact: true }).selectOption('body');
    await page.getByRole('button', { name: en.saveChanges, exact: true }).click();
    await expect(page.locator('form.habit-form')).toHaveCount(0);
    if (language === 'pt') {
      await nav(page, en.settingsNav).click();
      await page.getByLabel(en.language, { exact: true }).selectOption('pt');
      await expect(page.getByRole('heading', { name: pt.settings, exact: true })).toBeVisible();
    }
    const copy = language === 'en' ? en : pt;
    await edit(page, copy);
    const before = await readDataset(page);
    const literal = '  Cancellation $& goal $$  ';
    await page.getByLabel(copy.habitFieldLabel, { exact: true }).fill(literal);
    await page.getByLabel(copy.pillar, { exact: true }).selectOption('mind');
    const form = page.locator('form.habit-form');
    const previewText = await form.innerText();
    await expect.soft(form).toContainText(copy.countsWhenDone.replace('{target}', copy.mind));
    await expect
      .soft(form)
      .not.toContainText(
        language === 'en' ? 'Otherwise, it moves on' : 'Caso contrário, a mudança começa',
      );
    await page.screenshot({ path: testInfo.outputPath('cancellation-editor.png'), fullPage: true });
    await form
      .locator(':scope > p')
      .filter({
        hasText: /^(Counts in|Conta em|Complete this habit today|Conclua este hábito hoje)/,
      })
      .evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: testInfo.outputPath('cancellation-explanation.png') });
    expect(await readDataset(page)).toEqual(before);
    await page.getByRole('button', { name: copy.saveChanges, exact: true }).click();
    await expect(form).toHaveCount(0);
    const saved = await readDataset(page);
    const id = before.habits[0].id;
    const { pendingMove: _pendingMove, ...habit } = before.habits[0];
    expect(saved).toEqual({
      ...before,
      revision: before.revision + 1,
      habits: before.habits.map((value) =>
        value.id !== id
          ? value
          : {
              ...habit,
              memberships: original.habits[0].memberships,
              versions: [
                ...habit.versions,
                { effectiveFrom: '2026-10-03', goal: literal, weekdays: [1, 3, 5] },
              ],
            },
      ),
      occurrences: before.occurrences.map((value) =>
        value.habitId === id ? { ...value, pillarId: 'mind' } : value,
      ),
    });
    await writeFile(
      testInfo.outputPath('cancellation-facts.json'),
      JSON.stringify({ before, previewText, saved }, null, 2),
    );
    await nav(page, copy.today).click();
    const row = page.getByRole('region', { name: copy.mind, exact: true }).locator('article');
    await expect(
      row.getByRole('heading', { name: scheduledHabitGoals[0], exact: true }),
    ).toBeVisible();
    await expect(
      row.getByText(copy.countsWhenDone.replace('{target}', copy.mind), { exact: true }),
    ).toBeVisible();
    await expect(row.getByRole('checkbox')).not.toBeChecked();
    await page.screenshot({ path: testInfo.outputPath('cancellation-saved.png'), fullPage: true });
    await page.reload();
    await expect(page.getByRole('heading', { name: copy.today, exact: true })).toBeVisible();
    expect(await readDataset(page)).toEqual(saved);
    await onDate(page, '2026-10-05');
    await expect(
      page
        .getByRole('region', { name: copy.mind, exact: true })
        .getByRole('heading', { name: literal.trim(), exact: true }),
    ).toBeVisible();
    expect(await readDataset(page)).toEqual(saved);
  });
}
