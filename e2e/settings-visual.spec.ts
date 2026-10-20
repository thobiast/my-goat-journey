import { test, expect } from '@playwright/test';
import { setupScheduledHabits, nav, readDataset, abortNextWrite } from './support/habit-fixtures';
import { readFile } from 'node:fs/promises';

test.setTimeout(90_000);
test('Settings has three localized flat sections with existing actions', async ({ page }) => {
  await setupScheduledHabits(page);
  await nav(page, 'Settings').click();
  await page.setViewportSize({ width: 390, height: 844 });
  const updated = await page.getByRole('heading', { name: 'Preferences', exact: true }).count();
  await page.screenshot({
    path: `artifacts/visual-consistency/settings/${updated ? 'after' : 'before'}-en-390.png`,
    fullPage: true,
  });
  const sections = page.locator('.settings-section');
  await expect(sections).toHaveCount(3);
  for (const [index, title] of ['Preferences', 'Backup & restore', 'Data management'].entries())
    await expect(
      sections.nth(index).getByRole('heading', { level: 2, name: title, exact: true }),
    ).toBeVisible();
  await expect(sections.nth(0).getByLabel('Language', { exact: true })).toBeVisible();
  await expect(
    sections.nth(1).getByRole('button', { name: 'Export backup', exact: true }),
  ).toBeVisible();
  await expect(sections.nth(1).getByLabel('Choose backup file', { exact: true })).toBeVisible();
  await expect(
    sections.nth(2).getByRole('button', { name: 'Delete all data…', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Language', { exact: true }).selectOption('pt');
  for (const [index, title] of [
    'Preferências',
    'Backup e restauração',
    'Gerenciamento de dados',
  ].entries())
    await expect(
      sections.nth(index).getByRole('heading', { level: 2, name: title, exact: true }),
    ).toBeVisible();
});

// Every test uses a fresh Playwright context, never the normal browser diary.
test('Preferences persist on reload without changing diary facts; export is an actual portable backup', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await nav(page, 'Settings').click();
  const before = await readDataset(page);
  await page.getByLabel('Language', { exact: true }).selectOption('pt');
  await expect(page.getByRole('heading', { name: 'Preferências', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Reduzir movimento', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Reduzir movimento', exact: true }),
  ).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true');
  await page.reload();
  await nav(page, 'Ajustes').click();
  await expect(page.getByLabel('Idioma', { exact: true })).toHaveValue('pt');
  await expect(
    page.getByRole('checkbox', { name: 'Reduzir movimento', exact: true }),
  ).toBeChecked();
  const committed = await readDataset(page);
  const { revision: oldRevision, settings: _oldSettings, ...beforeFacts } = before;
  const { revision, settings, ...afterFacts } = committed;
  expect(afterFacts).toEqual(beforeFacts);
  expect(settings).toEqual({ language: 'pt', reducedMotion: true });
  expect(revision).toBeGreaterThan(oldRevision);
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00'));
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar backup', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('my-goat-journey-backup-2026-09-27_12-00.json');
  const envelope = JSON.parse((await readFile((await download.path())!)).toString('utf8'));
  const { revision: _localRevision, ...portable } = committed;
  expect(envelope.format).toBe('my-goat-journey-backup');
  expect(envelope.dataset).toEqual(portable);
  expect(envelope.dataset.revision).toBeUndefined();
  expect(await readDataset(page)).toEqual(committed);
});

test('Flat backup review preserves invalid, cancel, atomic abort and exact replacement safeguards', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  const completion = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Read ten pages', exact: true }) })
    .getByRole('checkbox');
  await completion.click();
  await expect(completion).toBeChecked();
  await nav(page, 'Settings').click();
  expect((await readDataset(page)).occurrences).toHaveLength(1);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup', exact: true }).click();
  const download = await pending;
  const bytes = await readFile((await download.path())!);
  await page.getByRole('checkbox', { name: 'Reduce motion', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Reduce motion', exact: true })).toBeChecked();
  const before = await readDataset(page);
  const input = page.getByLabel('Choose backup file', { exact: true });
  await input.setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{}'),
  });
  await expect(page.getByRole('alert')).toContainText('Invalid or unsupported backup');
  expect(await readDataset(page)).toEqual(before);
  await expect(page.getByRole('button', { name: 'Replace current data', exact: true })).toHaveCount(
    0,
  );

  const choose = () =>
    input.setInputFiles({
      name: 'private-backup-with-a-long-file-name-for-mobile-review.json',
      mimeType: 'application/json',
      buffer: bytes,
    });

  await choose();
  await expect(page.getByRole('heading', { name: 'Backup ready', exact: true })).toBeVisible();
  const confirmation = page.locator('.settings-section .confirmation');
  expect(
    await confirmation.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.backgroundColor, style.borderLeftWidth, style.borderRadius];
    }),
  ).toEqual(['rgba(0, 0, 0, 0)', '0px', '0px']);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await readDataset(page)).toEqual(before);
  await choose();
  await expect(page.getByRole('heading', { name: 'Backup ready', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('button', { name: 'Replace current data', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: 'artifacts/visual-consistency/settings/after-restore-review-en-390.png',
  });
  await abortNextWrite(page);
  await page.getByRole('button', { name: 'Replace current data', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not save');
  expect(await readDataset(page)).toEqual(before);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('Backup restored.', { exact: true })).toBeVisible();
  const after = await readDataset(page);
  const { revision: _revision, ...portable } = after;
  expect(portable).toEqual(JSON.parse(bytes.toString('utf8')).dataset);
  expect(after.revision).toBeGreaterThan(before.revision);
  await page.reload();
  expect(await readDataset(page)).toEqual(after);
});

test('Data management keeps safe focus, cancel, abort and full reset scope', async ({ page }) => {
  await setupScheduledHabits(page);
  await nav(page, 'Settings').click();
  const before = await readDataset(page);
  const trigger = page.getByRole('button', { name: 'Delete all data…', exact: true });
  await trigger.click();
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
  await expect(cancel).toBeFocused();
  await cancel.press('Enter');
  await expect(trigger).toBeFocused();
  expect(await readDataset(page)).toEqual(before);
  await trigger.press('Enter');
  await expect(cancel).toBeFocused();
  await abortNextWrite(page);
  await page.getByRole('button', { name: 'Delete all data', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not save');
  expect(await readDataset(page)).toEqual(before);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  const reset = await readDataset(page);
  expect(reset.settings).toEqual({ language: 'en', reducedMotion: false });
  expect(reset.onboardingComplete).toBe(false);
  expect(reset.draft).toBeNull();
  expect(reset.habits).toEqual([]);
  expect(reset.occurrences).toEqual([]);
  expect(reset.permanentUnlocks).toEqual([]);
  expect(reset.revision).toBeGreaterThan(before.revision);
  await page.reload();
  expect(await readDataset(page)).toEqual(reset);
});

test('A backup reviewed before a preference write is stale and cannot replace committed facts', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await nav(page, 'Settings').click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup', exact: true }).click();
  const download = await pending;
  const bytes = await readFile((await download.path())!);
  await page.getByLabel('Choose backup file', { exact: true }).setInputFiles({
    name: 'reviewed-before-write.json',
    mimeType: 'application/json',
    buffer: bytes,
  });
  await expect(page.getByRole('heading', { name: 'Backup ready', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Reduce motion', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Reduce motion', exact: true })).toBeChecked();
  const committed = await readDataset(page);
  await page.getByRole('button', { name: 'Replace current data', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Your data changed');
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  expect(await readDataset(page)).toEqual(committed);
  await page.reload();
  expect(await readDataset(page)).toEqual(committed);
});

test('Portuguese enlarged sections and keyboard focus fit narrow and short viewports above fixed navigation', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await nav(page, 'Settings').click();
  await page.getByLabel('Language', { exact: true }).selectOption('pt');
  await expect(page.getByRole('heading', { name: 'Preferências', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 720 });
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });

  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

  await expect.poll(fits).toBe(true);
  for (const section of await page.locator('.settings-section').all()) {
    const box = await section.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  }
  await page.screenshot({
    path: 'artifacts/visual-consistency/settings/after-pt-text200-320.png',
    fullPage: true,
  });
  const language = page.getByLabel('Idioma', { exact: true });
  await language.focus();
  await expect(language).toBeFocused();
  await language.press('Tab');
  await expect(
    page.getByRole('checkbox', { name: 'Reduzir movimento', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Exportar backup', exact: true })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 430 });
  await page.keyboard.press('Tab');
  const file = page.getByLabel('Escolher arquivo de backup', { exact: true });
  await expect(file).toBeFocused();
  await file.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => {
      const box = await file.boundingBox();
      const navBox = await page.getByRole('navigation').boundingBox();
      return box!.y >= 0 && box!.y + box!.height <= navBox!.y;
    })
    .toBe(true);
  await expect.poll(fits).toBe(true);
  await page.screenshot({
    path: 'artifacts/visual-consistency/settings/after-pt-text200-short-file-focus-390.png',
  });
  await page.keyboard.press('Tab');
  const trigger = page.getByRole('button', { name: 'Apagar todos os dados…', exact: true });
  await expect(trigger).toBeFocused();
  await trigger.press('Enter');
  const cancel = page.getByRole('button', { name: 'Cancelar', exact: true });
  await expect(cancel).toBeFocused();
  await cancel.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => {
      const box = await cancel.boundingBox();
      const navBox = await page.getByRole('navigation').boundingBox();
      return box!.y >= 0 && box!.y + box!.height <= navBox!.y;
    })
    .toBe(true);
  await page.screenshot({
    path: 'artifacts/visual-consistency/settings/after-pt-text200-short-delete-focus-390.png',
  });
  await cancel.press('Enter');
  await expect(trigger).toBeFocused();
});
