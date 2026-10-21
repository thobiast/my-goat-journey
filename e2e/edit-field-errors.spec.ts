import { test, expect, type Page } from '@playwright/test';
import en from '../src/i18n/en.json' with { type: 'json' };
import pt from '../src/i18n/pt.json' with { type: 'json' };
import { nav, readDataset } from './support/habit-fixtures';
import { openReviewSupporting } from './support/management-fixtures';

test.setTimeout(60_000);
const originalGoal = 'Read a fictional story';

async function setupEditor(page: Page, language: 'en' | 'pt') {
  const copy = language === 'en' ? en : pt;
  await page.clock.install({ time: new Date('2026-10-07T12:00:00') });
  await page.goto('./');
  await page.getByLabel('Language', { exact: true }).selectOption(language);
  await page.getByRole('button', { name: copy.start, exact: true }).click();
  await expect(page.getByRole('heading', { name: copy.mind, exact: true })).toBeVisible();
  await page.getByLabel(copy.goal, { exact: true }).fill(originalGoal);
  await page.getByRole('button', { name: copy.continue, exact: true }).click();
  for (const name of [copy.body, copy.nutrition, copy.hygiene]) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: copy.onboardingSkip, exact: true }).click();
  }
  await page.getByRole('button', { name: copy.finalize, exact: true }).click();
  await expect(page.getByRole('heading', { name: copy.today, exact: true })).toBeVisible();
  await nav(page, copy.progress).click();
  await page.getByRole('button', { name: originalGoal, exact: true }).click();
  await openReviewSupporting(page);
  await page.getByRole('button', { name: copy.editHabit, exact: true }).click();
  await expect(page.getByLabel(copy.habitFieldLabel, { exact: true })).toHaveValue(originalGoal);
  return copy;
}

async function watchDatasetWrites(page: Page) {
  await page.evaluate(() => {
    const probe = window as typeof window & { __editorWrites: number };
    probe.__editorWrites = 0;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      if (this.name === 'dataset') probe.__editorWrites += 1;
      return put.apply(this, args);
    };
  });
}

async function datasetWrites(page: Page) {
  return page.evaluate(() => (window as typeof window & { __editorWrites: number }).__editorWrites);
}

for (const language of ['en', 'pt'] as const) {
  for (const invalidField of ['goal', 'frequency'] as const) {
    test(`${language}: editor corrects an empty ${invalidField} without writing invalid drafts`, async ({
      page,
    }) => {
      const copy = await setupEditor(page, language);
      const goal = page.getByLabel(copy.habitFieldLabel, { exact: true });
      const frequency = page.getByRole('group', { name: copy.frequency, exact: true });
      const days = frequency.locator('.weekdays button');
      const everyDay = frequency.getByRole('button', { name: copy.everyDay, exact: true });
      const before = await readDataset(page);
      await watchDatasetWrites(page);
      if (invalidField === 'goal') await goal.fill('');
      else for (const day of await days.all()) await day.click();
      await page.getByRole('button', { name: copy.saveChanges, exact: true }).click();
      await expect(invalidField === 'goal' ? goal : days.first()).toBeFocused();
      await expect(invalidField === 'goal' ? goal : frequency).toHaveAttribute(
        'aria-invalid',
        'true',
      );
      await expect(page.getByRole('alert')).toHaveText(
        invalidField === 'goal' ? copy.onboardingGoalError : copy.onboardingDayError,
      );
      await expect(invalidField === 'goal' ? frequency : goal).not.toHaveAttribute(
        'aria-invalid',
        'true',
      );
      expect(await readDataset(page)).toEqual(before);
      expect(await datasetWrites(page)).toBe(0);
      await goal.fill('A corrected literal habit');
      if (invalidField === 'frequency') {
        await expect(everyDay).toHaveAttribute('aria-pressed', 'false');
        for (const day of await days.all()) await day.click();
        await expect(everyDay).toHaveAttribute('aria-pressed', 'true');
        await days.first().click();
        await expect(everyDay).toHaveAttribute('aria-pressed', 'false');
        await everyDay.click();

        await expect(frequency.locator('.weekdays button[aria-pressed="true"]')).toHaveCount(7);
        await everyDay.click();
        await expect(everyDay).toHaveAttribute('aria-pressed', 'true');
      }
      await expect(page.getByRole('alert')).toHaveCount(0);
      expect(await readDataset(page)).toEqual(before);
      expect(await datasetWrites(page)).toBe(0);
      await page.getByRole('button', { name: copy.saveChanges, exact: true }).click();
      await expect(goal).toHaveCount(0);
      expect(await datasetWrites(page)).toBe(1);
      const saved = await readDataset(page);
      expect(saved.habits[0].versions.at(-1)).toMatchObject({
        goal: 'A corrected literal habit',
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        effectiveFrom: '2026-10-08',
      });
      expect(saved.habits[0].versions[0]).toEqual(before.habits[0].versions[0]);
      expect(saved.occurrences).toEqual(before.occurrences);
      await page.reload();
      expect(await readDataset(page)).toEqual(saved);
    });
  }
  test(`${language}: move explanations preserve literal source and target replacement patterns`, async ({
    page,
  }) => {
    const copy = await setupEditor(page, language);
    await page.getByRole('button', { name: copy.cancel, exact: true }).click();
    await nav(page, copy.today).click();
    const done = page.getByRole('checkbox').first();
    await done.click();
    await expect(done).toBeChecked();
    await nav(page, copy.pillars).click();
    const source = "Source $& $$ $` $'";
    const target = "Target $' $` $$ $&";
    for (const [oldName, name] of [
      [copy.mind, source],
      [copy.body, target],
    ]) {
      const group = page.getByRole('region', { name: oldName, exact: true });
      await group.locator('.action-trigger').click();
      await page
        .locator('[data-action-surface]')
        .getByRole('button', { name: copy.renamePillar, exact: true })
        .click();
      await page.getByLabel(copy.pillarName, { exact: true }).fill(name);
      await page.getByRole('button', { name: copy.saveChanges, exact: true }).click();
      await expect(page.getByRole('region', { name, exact: true })).toBeVisible();
    }
    const group = page.getByRole('region', { name: source, exact: true });
    await group.locator('.pillar-disclosure').click();
    await group.getByRole('button', { name: copy.edit, exact: true }).click();
    const before = await readDataset(page);
    await page.getByLabel(copy.pillar, { exact: true }).selectOption('body');
    const date = new Intl.DateTimeFormat(language === 'pt' ? 'pt-BR' : 'en', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date('2026-10-08T12:00:00'));
    const expected = copy.moveCreditedHelp
      .replace('{source}', () => source)
      .replace('{target}', () => target)
      .replace('{date}', () => date);
    await expect(
      page.locator('form.habit-form').getByText(expected, { exact: true }),
    ).toBeVisible();
    expect(await readDataset(page)).toEqual(before);
  });
  test(`${language}: editor describes both invalid fields and focuses the goal before weekdays`, async ({
    page,
  }) => {
    const copy = await setupEditor(page, language);
    const goal = page.getByLabel(copy.habitFieldLabel, { exact: true });
    const frequency = page.getByRole('group', { name: copy.frequency, exact: true });
    const days = frequency.locator('.weekdays button');
    const before = await readDataset(page);
    await watchDatasetWrites(page);
    await goal.fill('   ');
    for (const day of await days.all()) await day.click();
    await page.getByRole('button', { name: copy.saveChanges, exact: true }).click();

    await expect(goal).toBeFocused();
    await expect(goal).toHaveAttribute('aria-invalid', 'true');
    await expect(goal).toHaveAccessibleDescription(`${copy.goalHelp} ${copy.onboardingGoalError}`);
    await expect(frequency).toHaveAttribute('aria-invalid', 'true');
    await expect(frequency).toHaveAccessibleDescription(copy.onboardingDayError);
    await expect(page.getByRole('alert')).toHaveCount(2);
    expect(await readDataset(page)).toEqual(before);
    expect(await datasetWrites(page)).toBe(0);

    await goal.fill('Read a corrected fictional story');
    await expect(goal).not.toHaveAttribute('aria-invalid', 'true');
    await expect(goal).toHaveAccessibleDescription(copy.goalHelp);
    await expect(frequency).toHaveAccessibleDescription(copy.onboardingDayError);
    await page.getByRole('button', { name: copy.saveChanges, exact: true }).click();
    await expect(days.first()).toBeFocused();
    expect(await readDataset(page)).toEqual(before);
    expect(await datasetWrites(page)).toBe(0);
    await days.first().click();
    await expect(frequency).not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: copy.saveChanges, exact: true }).click();
    await expect(goal).toHaveCount(0);
    const saved = await readDataset(page);
    expect(await datasetWrites(page)).toBe(1);
    expect(saved.habits[0].versions.at(-1)).toMatchObject({
      goal: 'Read a corrected fictional story',
      weekdays: [0],
      effectiveFrom: '2026-10-08',
    });
    expect(saved.habits[0].versions[0]).toEqual(before.habits[0].versions[0]);
    expect(saved.occurrences).toEqual(before.occurrences);
    await page.reload();
    expect(await readDataset(page)).toEqual(saved);
  });
}
