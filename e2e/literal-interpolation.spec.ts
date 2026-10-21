import { test, expect, type Page } from '@playwright/test';
import { nav, onDate, readDataset, setupScheduledHabits } from './support/habit-fixtures';
import en from '../src/i18n/en.json' with { type: 'json' };
import pt from '../src/i18n/pt.json' with { type: 'json' };

const goal = "Practice $& $$ $` $' literally";
const target = "Destination $& $$ $` $'";

async function literalFixture(page: Page, language: 'en' | 'pt') {
  await setupScheduledHabits(page);
  await nav(page, en.pillars).click();
  const mind = page.getByRole('region', { name: en.mind, exact: true });
  await mind.getByRole('button', { name: 'Actions for pillar: Mind', exact: true }).click();
  await page
    .locator('[data-action-surface]')
    .getByRole('button', { name: en.renamePillar, exact: true })
    .click();
  await page.getByLabel(en.pillarName, { exact: true }).fill(target);
  await page.getByRole('button', { name: en.saveChanges, exact: true }).click();
  await expect(page.getByRole('region', { name: target, exact: true })).toBeVisible();
  const body = page.getByRole('region', { name: en.body, exact: true });
  await body.locator('.pillar-disclosure').click();
  await body.getByRole('button', { name: en.edit, exact: true }).click();
  await page.locator('#goal').fill(goal);
  await page.getByRole('button', { name: en.saveChanges, exact: true }).click();
  await expect(
    page.getByRole('heading', { name: en.pillars, exact: true, level: 1 }),
  ).toBeVisible();
  await onDate(page, '2026-10-02');
  if (language === 'pt') {
    await nav(page, en.settingsNav).click();
    await page.getByLabel(en.language, { exact: true }).selectOption('pt');
    await expect(page.getByRole('heading', { name: pt.settings, exact: true })).toBeVisible();
    await nav(page, pt.pillars).click();
    await page
      .getByRole('region', { name: pt.body, exact: true })
      .locator('.pillar-disclosure')
      .click();
  }
}

for (const language of ['en', 'pt'] as const) {
  const copy = language === 'en' ? en : pt;
  test(`Management actions preserve literal goal and pillar accessible names ${language}`, async ({
    page,
  }) => {
    await literalFixture(page, language);
    const before = await readDataset(page);
    const pillarTrigger = page.getByRole('button', {
      name: copy.pillarActions.replace('{pillar}', () => target),
      exact: true,
    });
    await expect(pillarTrigger).toBeVisible();
    await pillarTrigger.click();
    const panel = page.getByRole('dialog', {
      name: copy.pillarActions.replace('{pillar}', () => target),
      exact: true,
    });
    await expect(panel.getByRole('heading', { name: target, exact: true })).toBeVisible();
    await panel.getByRole('button', { name: copy.closeActions, exact: true }).click();
    const habitTrigger = page.getByRole('button', {
      name: copy.habitActions.replace('{goal}', () => goal),
      exact: true,
    });
    await expect(habitTrigger).toBeVisible();
    await habitTrigger.click();
    await expect(
      page
        .getByRole('dialog', {
          name: copy.habitActions.replace('{goal}', () => goal),
          exact: true,
        })
        .getByRole('heading', { name: goal, exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await readDataset(page)).toEqual(before);
    expect(before.habits[1].versions.at(-1)!.goal).toBe(goal);
    expect(before.pillars.find((pillar) => pillar.id === 'mind')!.nameOverride).toBe(target);
  });

  test(`Today move participation preserves literal pillar text and goal names ${language}`, async ({
    page,
  }) => {
    await literalFixture(page, language);
    const body = page.getByRole('region', { name: copy.body, exact: true });
    await body.getByRole('button', { name: copy.edit, exact: true }).click();
    await page.locator('#pillar').selectOption('mind');
    await page.getByRole('button', { name: copy.saveChanges, exact: true }).click();
    await nav(page, copy.today).click();
    const before = await readDataset(page);
    const row = page
      .locator('.today-goal')
      .filter({ has: page.getByRole('heading', { name: goal, exact: true }) });
    await expect(
      row.getByRole('checkbox', { name: `${copy.done}: ${goal}`, exact: true }),
    ).toBeVisible();
    await expect(
      row.getByText(
        copy.countsWhenDone.replace('{target}', () => target),
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: target, exact: true })).toBeVisible();
    expect(await readDataset(page)).toEqual(before);
    expect(before.habits[1].versions.at(-1)!.goal).toBe(goal);
    expect(before.pillars.find((pillar) => pillar.id === 'mind')!.nameOverride).toBe(target);
  });
}
