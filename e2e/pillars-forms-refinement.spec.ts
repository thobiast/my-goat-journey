import { test, expect, type Page, type Locator } from '@playwright/test';
import en from '../src/i18n/en.json' with { type: 'json' };
import pt from '../src/i18n/pt.json' with { type: 'json' };
import {
  setupScheduledHabits,
  nav,
  onDate,
  readDataset,
  scheduledHabitGoals,
} from './support/habit-fixtures';

test.setTimeout(90_000);
test.use({ actionTimeout: 10_000 });
const evidence = 'artifacts/pillars-refinement/forms';
const longGoal =
  'Walk calmly through my neighborhood, notice the trees and return at my own pace without rushing or comparing myself to anyone else. '
    .repeat(4)
    .trim();

const form = (page: Page) => page.locator('form.habit-form');

const row = (page: Page, goal: string) =>
  page
    .locator('.management-habit')
    .filter({ has: page.getByRole('heading', { name: goal, exact: true }) });

type Copy = typeof en;

async function setup(page: Page, language: 'en' | 'pt') {
  await setupScheduledHabits(page);
  await onDate(page, '2026-09-30');
  if (language === 'pt') {
    await nav(page, en.settingsNav).click();
    await page.getByLabel(en.language, { exact: true }).selectOption('pt');
    await expect(page.getByRole('heading', { name: pt.settings, exact: true })).toBeVisible();
  }
  const copy = language === 'en' ? en : pt;
  await nav(page, copy.pillars).click();
  return copy;
}

async function expand(page: Page, copy: Copy) {
  const group = page.getByRole('region', { name: copy.body, exact: true });
  const trigger = group.getByRole('button', { name: copy.body, exact: true });
  if ((await trigger.getAttribute('aria-expanded')) === 'false') await trigger.click();
  return group;
}

async function create(page: Page, copy: Copy, goal: string) {
  await (
    await expand(page, copy)
  )
    .getByRole('button', { name: copy.addHabit, exact: true })
    .click();
  await page.getByLabel(copy.goal).fill(goal);
}

async function discard(page: Page, copy: Copy) {
  const button = page.getByRole('button', { name: copy.discardChanges, exact: true });
  if (await button.isVisible()) await button.click();
}

async function allDays(page: Page, copy: Copy, selected: boolean) {
  for (const name of copy.weekdays)
    await expect(form(page).getByRole('button', { name, exact: true })).toHaveAttribute(
      'aria-pressed',
      String(selected),
    );
}

async function shortcutCycle(page: Page, copy: Copy) {
  const daily = form(page).getByRole('button', { name: copy.everyDay, exact: true });
  await daily.click();
  await allDays(page, copy, true);
  await expect(daily).toHaveAttribute('aria-pressed', 'true');
  await daily.click();
  await allDays(page, copy, true);
  await form(page).getByRole('button', { name: copy.weekdays[3], exact: true }).click();
  await expect(daily).toHaveAttribute('aria-pressed', 'false');
  await expect(daily).toHaveClass(/secondary/);
  await form(page).getByRole('button', { name: copy.weekdays[3], exact: true }).click();
  await expect(daily).toHaveAttribute('aria-pressed', 'true');
  await expect(daily).not.toHaveClass(/secondary/);
  for (const name of copy.weekdays)
    await form(page).getByRole('button', { name, exact: true }).click();
  await allDays(page, copy, false);
  await expect(daily).toHaveAttribute('aria-pressed', 'false');
  for (const name of copy.weekdays)
    await form(page).getByRole('button', { name, exact: true }).click();
  await expect(daily).toHaveAttribute('aria-pressed', 'true');
}

for (const language of ['en', 'pt'] as const) {
  test(`${language}: creation/edit shortcut, validation, drafts, cancel and current schedule`, async ({
    page,
  }) => {
    const copy = await setup(page, language);
    const before = await readDataset(page);
    await create(page, copy, 'New daily habit');
    await expect(form(page).getByText(copy.creationOptionalHelp, { exact: true })).toBeVisible();
    await shortcutCycle(page, copy);
    expect(await readDataset(page)).toEqual(before);
    for (const name of copy.weekdays)
      await form(page).getByRole('button', { name, exact: true }).click();
    await form(page).getByRole('button', { name: copy.saveHabit, exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(copy.goalError);
    expect(await readDataset(page)).toEqual(before);
    await form(page).getByRole('button', { name: copy.everyDay, exact: true }).click();
    await form(page).getByRole('button', { name: copy.saveHabit, exact: true }).click();
    await expect(row(page, 'New daily habit')).toBeVisible();
    const created = await readDataset(page);
    const habit = created.habits.at(-1)!;
    expect(habit.versions.at(-1)!.weekdays).toEqual([0, 1, 2, 3, 4, 5, 6]);
    await row(page, 'New daily habit')
      .getByRole('button', { name: copy.edit, exact: true })
      .click();
    const note = form(page)
      .locator('p')
      .filter({ hasText: copy.habitEditUntil.split('{values}')[0] });
    const nextDate = language === 'en' ? 'Thu, Oct 1, 2026' : 'qui., 1 de out. de 2026';
    const untilSchedule = copy.habitEditUntil.replace('{values}', copy.everyDay);
    await expect(page.getByLabel(copy.habitFieldLabel, { exact: true })).toHaveValue(
      'New daily habit',
    );
    await expect(page.getByLabel(copy.pillar, { exact: true })).toHaveValue('body');
    await allDays(page, copy, true);
    await expect(form(page)).not.toContainText(`${copy.today}:`);
    await expect(note).toHaveCount(0);
    // Reselecting an already daily schedule is a true no-op: Cancel stays quiet.
    await form(page).getByRole('button', { name: copy.everyDay, exact: true }).click();
    await form(page).getByRole('button', { name: copy.cancel, exact: true }).click();
    await expect(page.getByRole('button', { name: copy.discardChanges, exact: true })).toHaveCount(
      0,
    );
    await row(page, 'New daily habit')
      .getByRole('button', { name: copy.edit, exact: true })
      .click();
    await shortcutCycle(page, copy);
    await form(page).getByRole('button', { name: copy.weekdays[3], exact: true }).click();
    await expect(note).toHaveText(
      `${copy.habitEditIfSaved.replace('{date}', nextDate)} ${untilSchedule}`,
    );
    await expect(note).not.toContainText('New daily habit');
    await expect(note).not.toContainText(copy.body);
    expect(await readDataset(page)).toEqual(created);
    for (const day of copy.weekdays.filter((_, index) => index !== 3))
      await form(page).getByRole('button', { name: day, exact: true }).click();
    await form(page).getByRole('button', { name: copy.saveChanges, exact: true }).click();
    await expect(form(page).getByRole('alert')).toHaveText(copy.goalError);
    expect(await readDataset(page)).toEqual(created);
    await form(page).getByRole('button', { name: copy.everyDay, exact: true }).click();
    await form(page).getByRole('button', { name: copy.weekdays[3], exact: true }).click();
    await form(page).getByRole('button', { name: copy.saveChanges, exact: true }).click();
    await expect(row(page, 'New daily habit')).toBeVisible();
    const saved = await readDataset(page);
    expect(saved.habits.at(-1)!.versions.at(-1)).toMatchObject({
      effectiveFrom: '2026-10-01',
      weekdays: [0, 1, 2, 4, 5, 6],
    });
    expect(saved.habits.at(-1)!.versions[0]).toEqual(habit.versions[0]);
    await row(page, 'New daily habit')
      .getByRole('button', { name: copy.edit, exact: true })
      .click();
    await expect(note).toHaveText(
      `${copy.habitEditScheduled.replace('{date}', nextDate)} ${untilSchedule}`,
    );
    await page.getByLabel(copy.habitFieldLabel, { exact: true }).fill('Discarded change');
    await form(page).getByRole('button', { name: copy.cancel, exact: true }).click();
    await discard(page, copy);
    expect(await readDataset(page)).toEqual(saved);
    await create(page, copy, 'Discarded creation');
    await form(page).getByRole('button', { name: copy.cancel, exact: true }).click();
    await expect(
      page.getByRole('button', { name: copy.discardChanges, exact: true }),
    ).toBeVisible();
    await discard(page, copy);
    expect(await readDataset(page)).toEqual(saved);
  });
  test(`${language}: move-only guidance keeps conditional and credited source dates separate`, async ({
    page,
  }) => {
    const copy = await setup(page, language);
    await expand(page, copy);
    await row(page, scheduledHabitGoals[1])
      .getByRole('button', { name: copy.edit, exact: true })
      .click();
    await page.getByLabel(copy.pillar, { exact: true }).selectOption('mind');
    await expect(
      form(page)
        .locator('p')
        .filter({ hasText: copy.habitEditUntil.split('{values}')[0] }),
    ).toHaveCount(0);
    await expect(
      form(page).getByText(
        language === 'en'
          ? /Complete this habit today to count in Mind/
          : /Conclua este hábito hoje para contar em Mente/,
      ),
    ).toBeVisible();
    await form(page).getByRole('button', { name: copy.cancel, exact: true }).click();
    await discard(page, copy);
    await nav(page, copy.today).click();
    const mission = page
      .locator('.today-goal')
      .filter({ has: page.getByRole('heading', { name: scheduledHabitGoals[1], exact: true }) });
    await mission.getByRole('checkbox').click();
    await expect(mission.getByRole('checkbox')).toBeChecked();
    const credited = await readDataset(page);
    await nav(page, copy.pillars).click();
    await expand(page, copy);
    await row(page, scheduledHabitGoals[1])
      .getByRole('button', { name: copy.edit, exact: true })
      .click();
    await page.getByLabel(copy.pillar, { exact: true }).selectOption('mind');
    await expect(
      form(page)
        .locator('p')
        .filter({ hasText: copy.habitEditUntil.split('{values}')[0] }),
    ).toHaveCount(0);
    await expect(
      form(page).getByText(
        language === 'en'
          ? /Today's completion stays in Body/
          : /A conclusão de hoje permanece em Corpo/,
      ),
    ).toBeVisible();
    await expect(form(page)).toContainText(language === 'en' ? 'Oct 2, 2026' : '2 de out. de 2026');
    expect(await readDataset(page)).toEqual(credited);
  });
}

async function layout(page: Page, copy: Copy, text: number, width: number, editing = false) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const textarea = page.getByLabel(editing ? copy.habitFieldLabel : copy.goal, { exact: true });
  await expect(textarea).toHaveValue(longGoal);
  expect(await textarea.getAttribute('rows')).toBe('3');
  expect(await textarea.evaluate((node) => getComputedStyle(node).resize)).toBe('vertical');
  expect(await textarea.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBe(
    (16 * text) / 100,
  );
  expect(await textarea.evaluate((node) => getComputedStyle(node).whiteSpace)).toBe('pre-wrap');
  for (const control of [
    ...(await form(page).getByRole('button').all()),
    page.getByLabel(copy.pillar, { exact: true }),
  ]) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  }
}

async function visibleAboveNavigation(page: Page, control: Locator) {
  await control.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  const box = await control.boundingBox();
  const bottom = await page.getByRole('navigation').boundingBox();
  expect(box).not.toBeNull();
  expect(bottom).not.toBeNull();
  // Scrolling rounds fractional CSS coordinates; accept at most half a pixel
  // while independently verifying the action remains unobstructed and clickable.
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(bottom!.y + 0.5);
  expect(
    await control.evaluate((node) => {
      const r = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    }),
  ).toBe(true);
}

test.describe('Responsive creation/editing forms', () => {
  test.use({ hasTouch: true });
  for (const language of ['en', 'pt'] as const)
    for (const width of [320, 375, 390, 393, 402, 430, 440, 1280])
      for (const text of [100, 200]) {
        test(`${language} ${width}px text${text}: long goals, keyboard, touch and revised form evidence`, async ({
          page,
        }) => {
          await page.setViewportSize({ width, height: 900 });
          const copy = await setup(page, language);
          await create(page, copy, longGoal);
          await page.addStyleTag({
            content: `html {font-size:${text}%;} nav {padding-bottom:32px !important;}`,
          });
          const stem = `${language}-${width}-text${text}`;
          await layout(page, copy, text, width);
          await page.evaluate(() => scrollTo(0, 0));
          await page.screenshot({ path: `${evidence}/creation-${stem}.png`, fullPage: true });
          const textarea = page.getByLabel(copy.goal);
          await textarea.focus();
          await page.keyboard.press('Control+End');
          expect(
            await textarea.evaluate((node) => (node as HTMLTextAreaElement).selectionStart),
          ).toBe(longGoal.length);
          await page.keyboard.press('Control+Home');
          await expect(textarea).toHaveValue(longGoal);
          const daily = form(page).getByRole('button', { name: copy.everyDay, exact: true });
          await daily.focus();
          await page.keyboard.press('Space');
          await allDays(page, copy, true);
          const wednesday = form(page).getByRole('button', { name: copy.weekdays[3], exact: true });
          await wednesday.tap();
          await expect(daily).toHaveAttribute('aria-pressed', 'false');
          await wednesday.tap();
          await expect(daily).toHaveAttribute('aria-pressed', 'true');
          await visibleAboveNavigation(page, daily);
          await page.screenshot({ path: `${evidence}/creation-frequency-${stem}.png` });
          await form(page).getByRole('button', { name: copy.saveHabit, exact: true }).click();
          await expect(row(page, longGoal)).toBeVisible();
          expect((await readDataset(page)).habits.at(-1)!.versions[0].goal).toBe(longGoal);
          await row(page, longGoal).getByRole('button', { name: copy.edit, exact: true }).click();
          await layout(page, copy, text, width, true);
          await expect(page.getByLabel(copy.pillar, { exact: true })).toHaveValue('body');
          await allDays(page, copy, true);
          await expect(form(page)).not.toContainText(`${copy.today}:`);
          await expect(
            form(page)
              .locator('p')
              .filter({ hasText: copy.habitEditUntil.split('{values}')[0] }),
          ).toHaveCount(0);
          await page.evaluate(() => scrollTo(0, 0));
          await page.screenshot({ path: `${evidence}/editing-${stem}.png`, fullPage: true });
          await visibleAboveNavigation(
            page,
            form(page).getByRole('button', { name: copy.everyDay, exact: true }),
          );
          await page.screenshot({ path: `${evidence}/editing-frequency-${stem}.png` });
          await visibleAboveNavigation(
            page,
            form(page).getByRole('button', { name: copy.saveChanges, exact: true }),
          );
          await expect(
            form(page).getByRole('button', { name: copy.cancel, exact: true }),
          ).toHaveClass(/secondary/);
          await form(page).getByRole('button', { name: copy.cancel, exact: true }).click();
          await expect(row(page, longGoal)).toBeVisible();
        });
      }
});
