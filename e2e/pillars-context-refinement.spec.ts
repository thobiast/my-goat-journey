import { test, expect, type Page } from '@playwright/test';
import {
  setupScheduledHabits,
  scheduledHabitGoals,
  nav,
  onDate,
  readDataset,
} from './support/habit-fixtures';
import en from '../src/i18n/en.json' with { type: 'json' };
import pt from '../src/i18n/pt.json' with { type: 'json' };
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

test.setTimeout(90_000);
test.use({ actionTimeout: 10_000 });

const group = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

const disclosure = (page: Page, name: string) =>
  group(page, name).getByRole('button', { name, exact: true });

const row = (page: Page, goal: string) =>
  page
    .locator('.management-habit')
    .filter({ has: page.getByRole('heading', { name: goal, exact: true }) });

const actions = (page: Page) => page.locator('[data-action-surface]');

async function expectCollapsed(page: Page) {
  for (const name of ['Mind', 'Body', 'Nutrition', 'Hygiene'])
    await expect(disclosure(page, name)).toHaveAttribute('aria-expanded', 'false');
}

test('Fresh Pillars entry collapses all stable groups; independent expansion survives a child return but not navigation entry', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await nav(page, 'Pillars').click();
  await expectCollapsed(page);
  await disclosure(page, 'Mind').click();
  await disclosure(page, 'Body').click();
  await expect(disclosure(page, 'Mind')).toHaveAttribute('aria-expanded', 'true');
  await expect(disclosure(page, 'Body')).toHaveAttribute('aria-expanded', 'true');
  await row(page, scheduledHabitGoals[1])
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(disclosure(page, 'Mind')).toHaveAttribute('aria-expanded', 'true');
  await expect(disclosure(page, 'Body')).toHaveAttribute('aria-expanded', 'true');
  await expect(
    row(page, scheduledHabitGoals[1]).getByRole('button', { name: 'Edit', exact: true }),
  ).toBeFocused();
  await nav(page, 'Today').click();
  await nav(page, 'Pillars').click();
  await expectCollapsed(page);
  await disclosure(page, 'Body').click();
  await disclosure(page, 'Mind').click();
  await disclosure(page, 'Body').click();
  await expect(disclosure(page, 'Mind')).toHaveAttribute('aria-expanded', 'true');
  await expect(disclosure(page, 'Body')).toHaveAttribute('aria-expanded', 'false');
});

test('Quiet contextual Back respects dirty Keep editing and Discard without leaking fresh-entry intent', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await nav(page, 'Pillars').click();
  await disclosure(page, 'Mind').click();
  await disclosure(page, 'Body').click();
  await row(page, scheduledHabitGoals[1])
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  const back = page.locator('main > header .quiet-back');
  await expect(back).toHaveText('← Pillars');
  expect(
    await back.evaluate(
      (node) =>
        node.getBoundingClientRect().bottom <=
        node.parentElement!.querySelector('h1')!.getBoundingClientRect().top,
    ),
  ).toBe(true);
  await page.getByLabel('Habit', { exact: true }).fill('Draft only');
  await nav(page, 'Pillars').click();
  await expect(page.getByText('Leave without saving?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await back.click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(disclosure(page, 'Mind')).toHaveAttribute('aria-expanded', 'true');
  await expect(disclosure(page, 'Body')).toHaveAttribute('aria-expanded', 'true');
  await row(page, scheduledHabitGoals[1])
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await page.getByLabel('Habit', { exact: true }).fill('Another unsaved draft');
  await nav(page, 'Pillars').click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expectCollapsed(page);
  await disclosure(page, 'Body').click();
  await row(page, scheduledHabitGoals[1])
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(disclosure(page, 'Body')).toHaveAttribute('aria-expanded', 'true');
  expect((await readDataset(page)).habits[1].versions).toHaveLength(1);
  await group(page, 'Body').getByRole('button', { name: 'Add habit', exact: true }).click();
  await page.getByLabel('What do you want to do?').fill('Unsaved creation');
  await page.locator('.quiet-back').click();
  await expect(page.getByText('Leave without saving?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.getByLabel('What do you want to do?')).toHaveValue('Unsaved creation');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(disclosure(page, 'Body')).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'New pillar', exact: true }).click();
  await page.getByLabel('Pillar name').fill('Unsaved pillar');
  await page.locator('.quiet-back').click();
  await expect(page.getByText('Leave without saving?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(disclosure(page, 'Body')).toHaveAttribute('aria-expanded', 'true');
});

test('Created pillars stay collapsed and locatable; saving moves or creations does not expand a collapsed destination', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await nav(page, 'Pillars').click();
  await disclosure(page, 'Mind').click();
  await page.getByRole('button', { name: 'New pillar', exact: true }).click();
  await page.getByLabel('Pillar name').fill('Quiet creativity');
  await page.getByRole('button', { name: 'Save pillar', exact: true }).click();
  await expect(disclosure(page, 'Quiet creativity')).toHaveAttribute('aria-expanded', 'false');
  await expect(disclosure(page, 'Quiet creativity')).toBeFocused();
  await expect(disclosure(page, 'Mind')).toHaveAttribute('aria-expanded', 'true');
  await group(page, 'Quiet creativity')
    .getByRole('button', { name: 'Actions for pillar: Quiet creativity', exact: true })
    .click();
  await actions(page).getByRole('button', { name: 'Rename pillar', exact: true }).click();
  await page.getByLabel('Pillar name').fill('Creative practice');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(disclosure(page, 'Creative practice')).toHaveAttribute('aria-expanded', 'false');
  await expect(disclosure(page, 'Mind')).toHaveAttribute('aria-expanded', 'true');
  await row(page, scheduledHabitGoals[0])
    .getByRole('button', { name: `Actions for habit: ${scheduledHabitGoals[0]}`, exact: true })
    .click();
  await actions(page).getByRole('button', { name: 'Move to another pillar', exact: true }).click();
  await page.getByLabel('Pillar', { exact: true }).selectOption('body');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(disclosure(page, 'Body')).toHaveAttribute('aria-expanded', 'false');
  await expect(disclosure(page, 'Body')).toBeFocused();
  await expect(disclosure(page, 'Mind')).toHaveAttribute('aria-expanded', 'true');
  await group(page, 'Mind').getByRole('button', { name: 'Add habit', exact: true }).click();
  await page.getByLabel('Pillar', { exact: true }).selectOption('body');
  await page.getByLabel('What do you want to do?').fill('Take a quiet walk');
  await page.getByRole('button', { name: 'Save habit', exact: true }).click();
  await expect(disclosure(page, 'Body')).toHaveAttribute('aria-expanded', 'false');
  await expect(disclosure(page, 'Body')).toBeFocused();
  await disclosure(page, 'Body').click();
  await expect(row(page, 'Take a quiet walk')).toBeVisible();
});

test('Review makes dated corrections primary and older history read-only, without duplicate Pillars management; Progress retains secondary commands', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await onDate(page, '2026-10-02');
  await nav(page, 'Pillars').click();
  await disclosure(page, 'Body').click();
  await row(page, scheduledHabitGoals[1])
    .getByRole('button', { name: `Actions for habit: ${scheduledHabitGoals[1]}`, exact: true })
    .click();
  await actions(page).getByRole('button', { name: 'Review completions', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Review completions', level: 1, exact: true }),
  ).toBeFocused();
  await expect(page.locator('main > header .review-goal')).toHaveText(scheduledHabitGoals[1]);
  await expect(page.locator('main > header .brand')).toHaveCount(0);
  await expect(page.locator('.quiet-back')).toHaveText('← Pillars');
  await expect(page.locator('.review-management')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit habit', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Archive habit', exact: true })).toHaveCount(0);
  const editable = page.locator('.correction-row');
  await expect(editable).toHaveCount(2);
  await expect(editable.locator('time')).toHaveText(['Fri, Oct 2, 2026', 'Wed, Sep 30, 2026']);
  await expect(page.locator('.history-row:not(.correction-row) input')).toHaveCount(0);
  await expect(page.locator('.history-row:not(.correction-row)').first()).toContainText('Sep 28');
  const supporting = page.locator('.review-supporting');
  await expect(supporting).not.toHaveAttribute('open', '');
  expect(
    await supporting.evaluate(
      (node) =>
        !!(
          node.compareDocumentPosition(document.querySelector('.correction-row')!) &
          Node.DOCUMENT_POSITION_PRECEDING
        ),
    ),
  ).toBe(true);
  const before = await readDataset(page);
  await editable.first().getByRole('checkbox').click();
  await expect(editable.first().getByRole('checkbox')).toBeChecked();
  await supporting.locator('summary').click();
  const xpAfter = await supporting.locator('.review-xp').innerText();
  expect(parseInt(xpAfter)).toBeGreaterThan(0);
  await editable.first().getByRole('checkbox').click();
  await expect(editable.first().getByRole('checkbox')).not.toBeChecked();
  await expect(supporting.locator('.review-xp')).toHaveText('0 XP');
  expect((await readDataset(page)).permanentUnlocks).toEqual(before.permanentUnlocks);
  await page.locator('.quiet-back').click();
  await expect(disclosure(page, 'Body')).toHaveAttribute('aria-expanded', 'true');
  await expect(
    row(page, scheduledHabitGoals[1]).getByRole('button', {
      name: `Actions for habit: ${scheduledHabitGoals[1]}`,
      exact: true,
    }),
  ).toBeFocused();
  await nav(page, 'Progress').click();
  await page.getByRole('button', { name: scheduledHabitGoals[1], exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Review completions', level: 1, exact: true }),
  ).toBeVisible();
  await expect(page.locator('.quiet-back')).toHaveText('← Progress');
  await page.locator('.review-management > summary').click();
  await expect(page.getByRole('button', { name: 'Edit habit', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Archive habit', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit habit', exact: true }).click();
  await expect(page.locator('.quiet-back')).toHaveText('← Review completions');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Review completions', level: 1, exact: true }),
  ).toBeVisible();
});

test('Keep editing cancels a deferred Back restoration as well as the departure itself', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await setupScheduledHabits(page);
  await onDate(page, '2026-10-02');
  await nav(page, 'Pillars').click();
  for (const name of ['Mind', 'Body', 'Nutrition', 'Hygiene']) await disclosure(page, name).click();
  const edit = row(page, scheduledHabitGoals[3]).getByRole('button', { name: 'Edit', exact: true });
  await edit.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await edit.click();
  await page.getByLabel('Habit', { exact: true }).fill('Uncommitted changes');
  await page.locator('.quiet-back').click();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await nav(page, 'Today').click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', level: 1, exact: true })).toBeFocused();
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

const longGoal =
  'Walk calmly through my neighborhood, notice the trees and return at my own pace without rushing or comparing myself to anyone else';
const longPillar = 'Creative practice, music and quiet time to reflect on my day';
for (const language of ['en', 'pt'] as const)
  for (const width of [320, 375, 390, 393, 402, 430, 440, 1280])
    for (const text of [100, 200])
      test(`Refinement captures ${language} ${width}px text${text}`, async ({ page }) => {
        const copy = language === 'en' ? en : pt;
        const paths: string[] = [];
        const stem = `${language}-${width}-text${text}`;
        await page.setViewportSize({ width, height: 900 });
        await setupScheduledHabits(page);
        await onDate(page, '2026-10-02');
        await nav(page, 'Pillars').click();
        await page.getByRole('button', { name: en.newPillar, exact: true }).click();
        await page.getByLabel(en.pillarName).fill(longPillar);
        await page.getByRole('button', { name: en.savePillar, exact: true }).click();
        await disclosure(page, 'Body').click();
        await group(page, 'Body').getByRole('button', { name: en.addHabit, exact: true }).click();
        await page.getByLabel(en.goal).fill(longGoal);
        await page.getByRole('button', { name: en.saveHabit, exact: true }).click();
        if (language === 'pt') {
          await nav(page, 'Settings').click();
          await page.getByLabel('Language', { exact: true }).selectOption('pt');
        }
        await nav(page, copy.pillars).click();
        await page.addStyleTag({ content: `html {font-size:${text}%;}` });

        async function capture(screen: string, fullPage = true) {
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
          await expect(nav(page, copy.pillars)).toHaveAttribute('aria-current', 'page');
          const small = await page
            .locator('main button:visible, main summary:visible')
            .evaluateAll((nodes) =>
              nodes
                .filter((node) => {
                  const r = node.getBoundingClientRect();
                  return r.width < 43 || r.height < 43;
                })
                .map((node) => node.textContent),
            );
          expect(small).toEqual([]);
          const path = `artifacts/pillars-refinement/context/screenshots/${screen}-${stem}.png`;
          await page.screenshot({ path, fullPage });
          paths.push(path);
        }

        for (const name of [copy.mind, copy.body, copy.nutrition, copy.hygiene, longPillar])
          await expect(disclosure(page, name)).toHaveAttribute('aria-expanded', 'false');
        await capture('collapsed');
        await disclosure(page, copy.body).focus();
        await page.keyboard.press('Enter');
        await expect(disclosure(page, copy.body)).toHaveAttribute('aria-expanded', 'true');
        await expect(disclosure(page, copy.mind)).toHaveAttribute('aria-expanded', 'false');
        await expect(
          row(page, longGoal).getByRole('heading', { name: longGoal, exact: true }),
        ).toHaveText(longGoal);
        await capture('partial');
        const edit = row(page, longGoal).getByRole('button', { name: copy.edit, exact: true });
        await edit.focus();
        await page.keyboard.press('Enter');
        await expect(page.getByLabel(copy.habitFieldLabel, { exact: true })).toHaveValue(longGoal);
        await capture('edit');
        await page.locator('.quiet-back').focus();
        await page.keyboard.press('Enter');
        await expect(edit).toBeFocused();
        await expect(disclosure(page, copy.body)).toHaveAttribute('aria-expanded', 'true');
        await row(page, longGoal)
          .getByRole('button', { name: copy.habitActions.replace('{goal}', longGoal), exact: true })
          .click();
        await actions(page)
          .getByRole('button', { name: copy.reviewCompletions, exact: true })
          .click();
        await expect(
          page.getByRole('heading', { name: copy.reviewCompletions, level: 1, exact: true }),
        ).toBeFocused();
        await expect(page.locator('.review-goal')).toHaveText(longGoal);
        await expect(page.locator('.review-management')).toHaveCount(0);
        await expect(page.locator('.brand')).toHaveCount(0);
        await capture('review');
        const check = page.locator('.correction-row').getByRole('checkbox').first();
        await check.scrollIntoViewIfNeeded();
        expect(
          await check.evaluate(
            (node) =>
              node.getBoundingClientRect().bottom <=
              document.querySelector('.bottom-nav')!.getBoundingClientRect().top,
          ),
        ).toBe(true);
        await capture('review-correction-viewport', false);
        await page.locator('.quiet-back').click();
        await group(page, copy.body)
          .getByRole('button', { name: copy.addHabit, exact: true })
          .click();
        await page.getByLabel(copy.goal).fill(longGoal);
        await capture('create');
        await page.getByRole('button', { name: copy.cancel, exact: true }).click();
        await page.getByRole('button', { name: copy.discardChanges, exact: true }).click();
        await page.getByRole('button', { name: copy.newPillar, exact: true }).click();
        await capture('pillar-create');
        const manifest = `artifacts/pillars-refinement/context/captures/${stem}.json`;
        mkdirSync(dirname(manifest), { recursive: true });
        writeFileSync(manifest, JSON.stringify({ language, width, text, paths }, null, 2));
      });

for (const language of ['en', 'pt'] as const)
  test(`Contextual Back restores scroll and focus across Today creation, Pillars streaks and Archived review ${language}`, async ({
    page,
  }) => {
    const copy = language === 'en' ? en : pt;
    await page.setViewportSize({ width: 390, height: 740 });
    await setupScheduledHabits(page);
    await onDate(page, '2026-10-02');
    if (language === 'pt') {
      await nav(page, 'Settings').click();
      await page.getByLabel('Language', { exact: true }).selectOption('pt');
      await nav(page, copy.today).click();
    }
    const add = page.getByRole('button', { name: copy.addHabit, exact: true });
    await add.scrollIntoViewIfNeeded();
    const todayY = await page.evaluate(() => scrollY);
    await add.click();
    await expect(page.getByRole('button', { name: `← ${copy.today}`, exact: true })).toBeVisible();
    await page.getByRole('button', { name: copy.cancel, exact: true }).click();
    await expect(add).toBeFocused();
    expect(Math.abs((await page.evaluate(() => scrollY)) - todayY)).toBeLessThan(3);
    await nav(page, copy.pillars).click();
    for (const name of [copy.mind, copy.body, copy.nutrition, copy.hygiene])
      await disclosure(page, name).click();
    const menu = group(page, [copy.mind, copy.body, copy.nutrition, copy.hygiene][3]).getByRole(
      'button',
      {
        name: copy.pillarActions.replace(
          '{pillar}',
          [copy.mind, copy.body, copy.nutrition, copy.hygiene][3],
        ),
        exact: true,
      },
    );
    await menu.scrollIntoViewIfNeeded();
    const listY = await page.evaluate(() => scrollY);
    await menu.click();
    await actions(page).getByRole('button', { name: copy.viewPillarStreaks, exact: true }).click();
    await expect(page.locator('.quiet-back')).toHaveText(`← ${copy.pillars}`);
    const history = page
      .locator('.pillar-history-day')
      .last()
      .getByRole('button', { name: copy.viewHistory, exact: true })
      .first();
    await history.scrollIntoViewIfNeeded();
    const historyY = await page.evaluate(() => scrollY);
    await history.click();
    await expect(
      page.getByRole('heading', { name: copy.reviewCompletions, level: 1, exact: true }),
    ).toBeVisible();
    await expect(page.locator('.review-management')).toHaveCount(0);
    await expect(page.locator('.quiet-back')).toHaveText(`← ${copy.viewPillarStreaks}`);
    await page.locator('.quiet-back').click();
    await expect(history).toBeFocused();
    expect(Math.abs((await page.evaluate(() => scrollY)) - historyY)).toBeLessThan(3);
    await page.locator('.quiet-back').click();
    await expect(menu).toBeFocused();
    expect(Math.abs((await page.evaluate(() => scrollY)) - listY)).toBeLessThan(3);
    for (const name of [copy.mind, copy.body, copy.nutrition, copy.hygiene])
      await expect(disclosure(page, name)).toHaveAttribute('aria-expanded', 'true');
    const habitMenu = row(page, scheduledHabitGoals[3]).getByRole('button', {
      name: copy.habitActions.replace('{goal}', scheduledHabitGoals[3]),
      exact: true,
    });
    await habitMenu.click();
    await actions(page).getByRole('button', { name: copy.archiveHabit, exact: true }).click();
    await page.getByRole('button', { name: copy.archiveHabit, exact: true }).click();
    await page.getByRole('button', { name: copy.archivedHabits, exact: true }).click();
    const review = row(page, scheduledHabitGoals[3]).getByRole('button', {
      name: copy.reviewCompletions,
      exact: true,
    });
    await review.click();
    await expect(page.locator('.quiet-back')).toHaveText(`← ${copy.archivedHabits}`);
    await expect(page.locator('.review-management')).toHaveCount(0);
    await page.locator('.quiet-back').click();
    await expect(review).toBeFocused();
    await page.locator('.quiet-back').click();
    for (const name of [copy.mind, copy.body, copy.nutrition, copy.hygiene])
      await expect(disclosure(page, name)).toHaveAttribute('aria-expanded', 'true');
  });
