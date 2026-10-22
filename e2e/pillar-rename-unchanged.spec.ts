import { test, expect, type Page } from '@playwright/test';
import { nav, readDataset, setupScheduledHabits } from './support/habit-fixtures';
import en from '../src/i18n/en.json' with { type: 'json' };
import pt from '../src/i18n/pt.json' with { type: 'json' };

async function rename(page: Page, copy: typeof en, name: string) {
  await page
    .getByRole('region', { name, exact: true })
    .getByRole('button', { name: copy.pillarActions.replace('{pillar}', () => name), exact: true })
    .click();
  await page
    .locator('[data-action-surface]')
    .getByRole('button', { name: copy.renamePillar, exact: true })
    .click();
  await expect(page.getByLabel(copy.pillarName, { exact: true })).toBeVisible();
}

function trigger(page: Page, copy: typeof en, name: string) {
  return page.getByRole('button', {
    name: copy.pillarActions.replace('{pillar}', () => name),
    exact: true,
  });
}

for (const language of ['en', 'pt'] as const) {
  const copy = language === 'en' ? en : pt;
  test(`unchanged default rename preserves localization, revision and return focus ${language}`, async ({
    page,
  }) => {
    await setupScheduledHabits(page);
    if (language === 'pt') {
      await nav(page, en.settingsNav).click();
      await page.getByLabel(en.language, { exact: true }).selectOption('pt');
      await expect(page.getByRole('heading', { name: pt.settings, exact: true })).toBeVisible();
    }
    await nav(page, copy.pillars).click();
    const before = await readDataset(page);
    expect(before.pillars.find((pillar) => pillar.id === 'mind')).not.toHaveProperty(
      'nameOverride',
    );
    await rename(page, copy, copy.mind);
    await page.getByRole('button', { name: copy.saveChanges, exact: true }).click();
    await expect(trigger(page, copy, copy.mind)).toBeFocused();
    expect(await readDataset(page)).toEqual(before);

    // Editing and reverting also leaves the original localized default untouched.
    await rename(page, copy, copy.mind);
    await page.getByLabel(copy.pillarName, { exact: true }).fill('Temporary draft');
    await page.getByLabel(copy.pillarName, { exact: true }).fill(copy.mind);
    await page.getByRole('button', { name: copy.saveChanges, exact: true }).click();
    await expect(trigger(page, copy, copy.mind)).toBeFocused();
    expect(await readDataset(page)).toEqual(before);

    const other = language === 'en' ? pt : en;
    await nav(page, copy.settingsNav).click();
    await page
      .getByLabel(copy.language, { exact: true })
      .selectOption(language === 'en' ? 'pt' : 'en');
    await expect(page.getByRole('heading', { name: other.settings, exact: true })).toBeVisible();
    await nav(page, other.pillars).click();
    await expect(page.getByRole('region', { name: other.mind, exact: true })).toBeVisible();
    const after = await readDataset(page);
    expect(after.pillars).toEqual(before.pillars);
    expect(after.revision).toBe(before.revision + 1);
    await page.reload();
    await nav(page, other.pillars).click();
    await expect(page.getByRole('region', { name: other.mind, exact: true })).toBeVisible();
    expect(await readDataset(page)).toEqual(after);
  });

  test(`unchanged overrides and custom names stay literal; intentional rename and cancel retain their contracts ${language}`, async ({
    page,
  }) => {
    await setupScheduledHabits(page);
    if (language === 'pt') {
      await nav(page, en.settingsNav).click();
      await page.getByLabel(en.language, { exact: true }).selectOption('pt');
      await expect(page.getByRole('heading', { name: pt.settings, exact: true })).toBeVisible();
    }
    await nav(page, copy.pillars).click();
    const literal = '  My literal practice  ';
    const initial = await readDataset(page);
    await rename(page, copy, copy.mind);
    await page.getByLabel(copy.pillarName, { exact: true }).fill(literal);
    await page.getByRole('button', { name: copy.saveChanges, exact: true }).click();
    await expect(trigger(page, copy, literal.trim())).toBeFocused();
    const renamed = await readDataset(page);
    expect(renamed.revision).toBe(initial.revision + 1);
    expect(renamed.pillars.find((pillar) => pillar.id === 'mind')!.nameOverride).toBe(literal);
    await page.getByRole('button', { name: copy.newPillar, exact: true }).click();
    await page.getByLabel(copy.pillarName, { exact: true }).fill('Fictional custom');
    await page.getByRole('button', { name: copy.savePillar, exact: true }).click();
    await expect(page.getByRole('region', { name: 'Fictional custom', exact: true })).toBeVisible();
    const before = await readDataset(page);
    for (const name of [literal, 'Fictional custom']) {
      await rename(page, copy, name.trim());
      // Playwright normalizes accessible whitespace, but the input/storage remain literal.
      await expect(page.getByLabel(copy.pillarName, { exact: true })).toHaveValue(name);
      await page.getByRole('button', { name: copy.saveChanges, exact: true }).click();
      await expect(trigger(page, copy, name.trim())).toBeFocused();
      expect(await readDataset(page)).toEqual(before);
      await rename(page, copy, name.trim());
      await page.getByRole('button', { name: copy.cancel, exact: true }).click();
      await expect(trigger(page, copy, name.trim())).toBeFocused();
      expect(await readDataset(page)).toEqual(before);
    }
    // Whitespace is literal, not a new normalization-based no-change rule.
    await rename(page, copy, literal.trim());
    await page.getByLabel(copy.pillarName, { exact: true }).fill(`${literal} `);
    await page.getByRole('button', { name: copy.saveChanges, exact: true }).click();
    await expect(trigger(page, copy, literal.trim())).toBeFocused();
    const whitespaceEdit = await readDataset(page);
    expect(whitespaceEdit.revision).toBe(before.revision + 1);
    expect(whitespaceEdit.pillars.find((pillar) => pillar.id === 'mind')!.nameOverride).toBe(
      `${literal} `,
    );
    const other = language === 'en' ? pt : en;
    await nav(page, copy.settingsNav).click();
    await page
      .getByLabel(copy.language, { exact: true })
      .selectOption(language === 'en' ? 'pt' : 'en');
    await expect(page.getByRole('heading', { name: other.settings, exact: true })).toBeVisible();
    await nav(page, other.pillars).click();
    for (const name of [literal.trim(), 'Fictional custom'])
      await expect(page.getByRole('region', { name, exact: true })).toBeVisible();
    expect((await readDataset(page)).pillars).toEqual(whitespaceEdit.pillars);
  });
}
