import { test, expect, type Page } from '@playwright/test';
import {
  setupScheduledHabits,
  onDate,
  openHabit,
  nav,
  readDataset,
  abortNextWrite,
} from './support/habit-fixtures';
import { openReviewSupporting } from './support/management-fixtures';
import en from '../src/i18n/en.json' with { type: 'json' };
import pt from '../src/i18n/pt.json' with { type: 'json' };

test.setTimeout(60_000);

async function pendingResume(page: Page) {
  await setupScheduledHabits(page);
  await onDate(page, '2026-10-02');
  await openHabit(page);
  await page.getByRole('button', { name: en.archiveHabit, exact: true }).click();
  await page
    .locator('.confirmation')
    .getByRole('button', { name: en.archiveHabit, exact: true })
    .click();
  await page.getByRole('button', { name: en.reactivateHabit, exact: true }).click();
  await page
    .locator('.confirmation')
    .getByRole('button', { name: en.reactivateHabit, exact: true })
    .click();
  await expect(page.getByText(en.awaiting, { exact: true })).toBeVisible();
  await onDate(page, '2026-10-04');
}

for (const language of ['en', 'pt'] as const)
  test(`local due reconciliation preserves an unrelated dirty pillar draft and explicit Save (${language})`, async ({
    page,
  }) => {
    await pendingResume(page);
    if (language === 'pt') {
      await nav(page, en.settingsNav).click();
      await page.getByLabel(en.language, { exact: true }).selectOption('pt');
      await expect(
        page.getByRole('heading', { name: pt.settings, level: 1, exact: true }),
      ).toBeVisible();
    }
    const copy = language === 'en' ? en : pt;
    await nav(page, copy.pillars).click();
    await page.getByRole('button', { name: copy.newPillar, exact: true }).click();
    const input = page.getByLabel(copy.pillarName, { exact: true });
    const literal = '  Fictional retained pillar 🎵  ';
    await input.fill(literal);
    await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(3, 12));
    const before = await readDataset(page);
    await onDate(page, '2026-10-05');
    await expect
      .poll(async () => (await readDataset(page)).habits[1].periods.at(-1)!.start)
      .toBe('2026-10-05');
    await expect(input).toHaveValue(literal);
    await expect(input).toBeFocused();
    expect(
      await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd]),
    ).toEqual([3, 12]);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const reconciled = await readDataset(page);
    expect(reconciled.revision).toBe(before.revision + 1);
    expect(reconciled.pillars).toEqual(before.pillars);
    await nav(page, copy.today).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: copy.keepEditing, exact: true }).click();
    await expect(input).toHaveValue(literal);
    await page.getByRole('button', { name: copy.savePillar, exact: true }).click();
    await expect(
      page.getByRole('heading', { name: copy.pillars, level: 1, exact: true }),
    ).toBeVisible();
    const saved = await readDataset(page);
    expect(saved.pillars.filter((p: { name: string }) => p.name === literal)).toHaveLength(1);
    expect(saved.revision).toBe(reconciled.revision + 1);
  });

test('failed draft Retry survives local reconciliation and commits the retained input once', async ({
  page,
}) => {
  await pendingResume(page);
  await nav(page, en.pillars).click();
  await page.getByRole('button', { name: en.newPillar, exact: true }).click();
  const input = page.getByLabel(en.pillarName, { exact: true });
  const literal = 'Fictional failed draft retained';
  await input.fill(literal);
  await abortNextWrite(page);
  await page.getByRole('button', { name: en.savePillar, exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(en.saveError);
  const before = await readDataset(page);
  await onDate(page, '2026-10-05');
  await expect.poll(async () => (await readDataset(page)).revision).toBe(before.revision + 1);
  await expect(input).toHaveValue(literal);
  await page.getByRole('button', { name: en.retry, exact: true }).click();
  await expect(
    page.getByRole('heading', { name: en.pillars, exact: true, level: 1 }),
  ).toBeVisible();
  const after = await readDataset(page);
  expect(after.pillars.filter((p: { name: string }) => p.name === literal)).toHaveLength(1);
  expect(after.revision).toBe(before.revision + 2);
});

for (const language of ['en', 'pt'] as const)
  test(`an editor revisiting an archived gap shows read-only history and retains its literal draft (${language})`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await pendingResume(page);
    await onDate(page, '2026-10-05');
    await openHabit(page);
    if (language === 'pt') {
      await nav(page, en.settingsNav).click();
      await page.getByLabel(en.language, { exact: true }).selectOption('pt');
      await expect(
        page.getByRole('heading', { name: pt.settings, level: 1, exact: true }),
      ).toBeVisible();
      await nav(page, pt.progress).click();
      await page
        .locator('article')
        .filter({ has: page.getByRole('heading', { name: 'Complete my walk', exact: true }) })
        .getByRole('button', { name: 'Complete my walk', exact: true })
        .click();
      await openReviewSupporting(page);
    }
    const copy = language === 'en' ? en : pt;
    await page.getByRole('button', { name: copy.editHabit, exact: true }).click();
    const input = page.getByLabel(copy.habitFieldLabel, { exact: true });
    const literal = '  Fictional draft kept through archived gap 🎵  ';
    await input.fill(literal);
    const before = await readDataset(page);
    await onDate(page, '2026-10-03');
    await expect(
      page.getByRole('heading', { name: copy.history, exact: true, level: 2 }),
    ).toBeVisible();
    await expect(page.getByText(literal, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: copy.saveChanges, exact: true })).toHaveCount(0);
    await expect(input).toHaveCount(0);
    await expect(page.locator('.completion-review input')).toHaveCount(0);
    expect(await readDataset(page)).toEqual(before);
    expect(errors).toEqual([]);
    await page.screenshot({ path: `artifacts/code-review-fixes/ui/archived-gap-${language}.png` });
    await page.getByRole('button', { name: copy.cancel, exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: copy.keepEditing, exact: true })
      .click();
    await expect(page.getByText(literal, { exact: true })).toBeVisible();
    await onDate(page, '2026-10-05');
    await expect(input).toHaveValue(literal);
    expect(await readDataset(page)).toEqual(before);
    await page.getByRole('button', { name: copy.cancel, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: copy.keepEditing, exact: true }).click();
    await expect(input).toHaveValue(literal);
  });

for (const kind of ['create-habit', 'edit-habit', 'rename-pillar'] as const)
  test(`due reconciliation retains the unrelated ${kind} form`, async ({ page }) => {
    await pendingResume(page);
    const literal = `Fictional ${kind} retained`;
    if (kind === 'create-habit') {
      await nav(page, en.today).click();
      await page.getByRole('button', { name: en.addHabit, exact: true }).click();
    } else if (kind === 'edit-habit') {
      await openHabit(page, 'Read ten pages');
      await page.getByRole('button', { name: en.editHabit, exact: true }).click();
    } else {
      await nav(page, en.pillars).click();
      await page.getByRole('button', { name: 'Actions for pillar: Mind', exact: true }).click();
      await page
        .locator('[data-action-surface]')
        .getByRole('button', { name: en.renamePillar, exact: true })
        .click();
    }
    const input = page.getByLabel(
      kind === 'rename-pillar'
        ? en.pillarName
        : kind === 'edit-habit'
          ? en.habitFieldLabel
          : en.goal,
      { exact: true },
    );
    await input.fill(literal);
    const before = await readDataset(page);
    await onDate(page, '2026-10-05');
    await expect.poll(async () => (await readDataset(page)).revision).toBe(before.revision + 1);
    await expect(input).toHaveValue(literal);
    await page
      .getByRole('button', {
        name: kind === 'create-habit' ? en.saveHabit : en.saveChanges,
        exact: true,
      })
      .click();
    await expect(input).toHaveCount(0);
    const saved = await readDataset(page);
    expect(saved.revision).toBe(before.revision + 2);
    if (kind === 'rename-pillar')
      expect(saved.pillars.find((p) => p.id === 'mind')!.nameOverride).toBe(literal);
    else
      expect(
        saved.habits.filter(
          (h: { versions: { goal: string }[] }) => h.versions.at(-1)?.goal === literal,
        ),
      ).toHaveLength(1);
  });

test('a pending move becoming due also retains an unrelated draft without a write', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await onDate(page, '2026-10-02');
  await openHabit(page);
  await page.getByRole('button', { name: en.editHabit, exact: true }).click();
  await page.getByLabel(en.pillar, { exact: true }).selectOption('mind');
  await page.getByRole('button', { name: en.saveChanges, exact: true }).click();
  await onDate(page, '2026-10-04');
  await nav(page, en.pillars).click();
  await page.getByRole('button', { name: en.newPillar, exact: true }).click();
  const input = page.getByLabel(en.pillarName, { exact: true });
  await input.fill('Fictional pending move draft');
  const before = await readDataset(page);
  expect(before.habits[1].pendingMove).toBeTruthy();
  await onDate(page, '2026-10-05');
  await expect.poll(async () => (await readDataset(page)).revision).toBe(before.revision + 1);
  await expect(input).toHaveValue('Fictional pending move draft');
  const after = await readDataset(page);
  expect(after.habits[1].pendingMove).toBeUndefined();
  expect(after.pillars).toEqual(before.pillars);
  expect(after.occurrences).toEqual(before.occurrences);
});

test('focus refresh invalidates an identical external replacement when BroadcastChannel delivery is suppressed', async ({
  page,
  context,
}) => {
  await setupScheduledHabits(page);
  await nav(page, en.pillars).click();
  await page.getByRole('button', { name: en.newPillar, exact: true }).click();
  const input = page.getByLabel(en.pillarName, { exact: true });
  const literal = 'Obsolete fictional draft must not return';
  await input.fill(literal);
  const before = await readDataset(page);
  const { revision: _revision, ...dataset } = before;
  const other = await context.newPage();
  try {
    await other.clock.install({ time: new Date('2026-09-27T12:00:00') });
    await other.addInitScript(() => {
      BroadcastChannel.prototype.postMessage = function () {};
    });
    await other.goto('./');
    await nav(other, en.settingsNav).click();
    await other.getByLabel(en.chooseBackup, { exact: true }).setInputFiles({
      name: 'identical-fictional-replacement.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'my-goat-journey-backup',
          formatVersion: 1,
          exportedAt: '2026-09-27T12:00:00.000Z',
          dataset,
        }),
      ),
    });
    await expect(other.getByRole('heading', { name: en.backupReady, exact: true })).toBeVisible();
    await other.getByRole('button', { name: en.replaceData, exact: true }).click();
    await expect(other.getByText(en.backupRestored, { exact: true })).toBeVisible();
    const replaced = await readDataset(other);
    expect(replaced).toEqual({ ...before, revision: before.revision + 1 });
    await expect(input).toHaveValue(literal);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(input).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: en.pillars, level: 1, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: en.retry, exact: true })).toHaveCount(0);
    expect(await readDataset(page)).toEqual(replaced);
    await page.getByRole('button', { name: en.newPillar, exact: true }).click();
    await expect(input).toHaveValue('');
  } finally {
    await other.close();
  }
});
