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
  openHabit,
  readDataset,
  abortNextWrite,
} from './support/habit-fixtures';
import en from '../src/i18n/en.json' with { type: 'json' };
import pt from '../src/i18n/pt.json' with { type: 'json' };

type BackupReadProbeWindow = Window & { releaseBackupRead?: () => Promise<void> };

test.setTimeout(90_000);

async function language(page: Page, lang: 'en' | 'pt') {
  const copy = lang === 'pt' ? pt : en;
  if (lang === 'pt') {
    await nav(page, en.settingsNav).click();
    await page.getByLabel(en.language, { exact: true }).selectOption('pt');
    await expect(page.getByRole('heading', { name: copy.settings, exact: true })).toBeVisible();
  }
  return copy;
}

async function bodyHistory(page: Page, copy = en) {
  // These regressions exercise the retained historical list, including Today
  // and its Show more pagination, rather than Progress's yesterday-ended calendar.
  await nav(page, copy.pillars).click();
  await expandFixturePillars(page);
  const body = page.getByRole('region', { name: copy.body, exact: true });
  const origin = body.getByRole('button', {
    name: copy.pillarActions.replace('{pillar}', copy.body),
    exact: true,
  });
  await origin.click();
  await page
    .locator('[data-action-surface]')
    .getByRole('button', { name: copy.viewPillarStreaks, exact: true })
    .click();
  return origin;
}

function historyRow(page: Page, date: string) {
  return page
    .locator('.pillar-history-day')
    .filter({ has: page.locator(`time[datetime="${date}"]`) })
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: scheduledHabitGoals[1], exact: true }) });
}

async function confirm(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click();
  await page
    .locator('.habit-management .confirmation')
    .getByRole('button', { name, exact: true })
    .click();
}

for (const lang of ['en', 'pt'] as const) {
  test(`${lang}: today's unchecked optional first opportunity is not Pending in pillar history`, async ({
    page,
  }) => {
    await setupScheduledHabits(page);
    const copy = await language(page, lang);
    await bodyHistory(page, copy);
    const row = historyRow(page, '2026-09-27');
    await expect(row.getByText(copy.optionalUncompleted, { exact: true })).toBeVisible({
      timeout: 1500,
    });
    await expect(row.getByText(copy.pending, { exact: true })).toHaveCount(0);
    await expect(row.getByText(copy.exemptHelp, { exact: true })).toHaveCount(0);
  });

  test(`${lang}: retained completed archive supports Undo/Redo without contradictory help`, async ({
    page,
  }) => {
    await setupScheduledHabits(page);
    await onDate(page, '2026-10-02');
    const todayDone = page.getByRole('checkbox', {
      name: `Done: ${scheduledHabitGoals[1]}`,
      exact: true,
    });
    await todayDone.click();
    await expect(todayDone).toBeChecked();
    await openHabit(page);
    await confirm(page, en.archiveHabit);
    const copy = await language(page, lang);
    await bodyHistory(page, copy);
    await historyRow(page, '2026-10-02')
      .getByRole('button', { name: copy.viewHistory, exact: true })
      .click();
    const done = page
      .locator('.correction-row')
      .filter({ has: page.locator('time[datetime="2026-10-02"]') })
      .getByRole('checkbox');
    await expect(done).toBeChecked();
    await done.click();
    await expect(done).not.toBeChecked();
    await expect(page.getByRole('status')).toHaveText(copy.recordUpdated);
    await backControl(page).click();
    await expect(
      historyRow(page, '2026-10-02').getByText(copy.exempt, { exact: true }),
    ).toBeVisible();
    await expect(
      historyRow(page, '2026-10-02').getByText(copy.exemptHelp, { exact: true }),
    ).toBeVisible();
    await historyRow(page, '2026-10-02')
      .getByRole('button', { name: copy.viewHistory, exact: true })
      .click();
    await done.click();
    await expect(done).toBeChecked();
    await expect(page.getByRole('status')).toHaveText(copy.recordUpdated);
    await backControl(page).click();
    await expect(
      historyRow(page, '2026-10-02').getByText(copy.completionDone, { exact: true }),
    ).toBeVisible();
    await expect(
      historyRow(page, '2026-10-02').getByText(copy.exemptHelp, { exact: true }),
    ).toHaveCount(0);
    const saved = await readDataset(page);
    expect(
      saved.occurrences.find((o) => o.habitId === saved.habits[1].id && o.date === '2026-10-02'),
    ).toMatchObject({ done: true, exempt: true, completionProvenance: 'credited' });
  });
}

for (const action of ['archive', 'reactivate', 'cancel-resumption'] as const) {
  test(`Failed ${action} then Cancel removes obsolete Retry and preserves saved facts`, async ({
    page,
  }) => {
    await setupScheduledHabits(page);
    await onDate(page, '2026-10-02');
    await openHabit(page);
    if (action !== 'archive') await confirm(page, en.archiveHabit);
    if (action === 'cancel-resumption') await confirm(page, en.reactivateHabit);
    const name = action === 'reactivate' ? en.reactivateHabit : en.archiveHabit;
    const before = await readDataset(page);
    await page.getByRole('button', { name, exact: true }).click();
    await abortNextWrite(page);
    await page
      .locator('.habit-management .confirmation')
      .getByRole('button', { name, exact: true })
      .click();
    await expect(page.getByRole('alert')).toContainText(en.saveError);
    await expect(page.getByRole('button', { name: en.retry, exact: true })).toBeVisible();
    expect(await readDataset(page)).toEqual(before);
    await page
      .getByRole('button', {
        name: action === 'cancel-resumption' ? en.keepResumption : en.cancel,
        exact: true,
      })
      .click();
    await expect(page.locator('.habit-management .confirmation')).toHaveCount(0);
    await expect(page.getByRole('button', { name: en.retry, exact: true })).toHaveCount(0, {
      timeout: 1500,
    });
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button', { name, exact: true })).toBeFocused();
    expect(await readDataset(page)).toEqual(before);
  });
}

for (const expanded of [false, true]) {
  test(`Pillar history Back preserves ${expanded ? 'Show more older' : 'later duplicate'} dated origin and exact scroll`, async ({
    page,
  }) => {
    await setupScheduledHabits(page);
    await onDate(page, expanded ? '2027-01-04' : '2026-10-09');
    const pillarOrigin = await bodyHistory(page);
    const initial = await page.locator('.pillar-history-day').count();
    if (expanded) {
      expect(initial).toBe(30);
      await page.getByRole('button', { name: en.showMore, exact: true }).click();
      await expect(page.locator('.pillar-history-day')).toHaveCount(44);
    }
    const days = page.locator('.pillar-history-day');
    const day = days.nth(expanded ? 35 : 3);
    const date = await day.locator('time').getAttribute('datetime');
    const target = historyRow(page, date!).getByRole('button', {
      name: en.viewHistory,
      exact: true,
    });
    await target.scrollIntoViewIfNeeded();
    const y = await page.evaluate(() => scrollY);
    await target.click();
    await expectReview(page, scheduledHabitGoals[1]);
    await backControl(page).click();
    await expect(
      historyRow(page, date!).getByRole('button', { name: en.viewHistory, exact: true }),
    ).toBeFocused({ timeout: 1500 });
    await expect(page.locator('.pillar-history-day')).toHaveCount(expanded ? 44 : initial);
    expect(await page.evaluate(() => scrollY)).toBe(y);
    await expect(nav(page, en.pillars)).toHaveAttribute('aria-current', 'page');
    await backControl(page).click();
    await expect(pillarOrigin).toBeFocused();
  });
}

test('Cancelling a pending backup read through deletion re-enables selection without writes', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await nav(page, en.settingsNav).click();
  const before = await readDataset(page);
  const backup = Buffer.from(
    JSON.stringify({
      format: 'my-goat-journey-backup',
      formatVersion: 1,
      exportedAt: '2026-09-27T12:00:00.000Z',
      dataset: before,
    }),
  );
  await page.evaluate(() => {
    const text = Blob.prototype.text;
    Blob.prototype.text = function () {
      Blob.prototype.text = text;
      return new Promise<string>((resolve) => {
        (window as BackupReadProbeWindow).releaseBackupRead = async () =>
          resolve(await text.call(this));
      });
    };
  });
  const input = page.getByLabel(en.chooseBackup, { exact: true });
  await input.setInputFiles({ name: 'delayed.json', mimeType: 'application/json', buffer: backup });
  await expect(page.getByText(en.checkingBackup, { exact: true })).toBeVisible();
  await expect(input).toBeDisabled();
  await page.getByRole('button', { name: en.deleteOpen, exact: true }).click();
  await page.getByRole('button', { name: en.cancel, exact: true }).click();
  await expect(input).toBeEnabled({ timeout: 1500 });
  await page.evaluate(() => (window as BackupReadProbeWindow).releaseBackupRead!());
  await expect(page.getByRole('heading', { name: en.backupReady, exact: true })).toHaveCount(0);
  await input.setInputFiles({ name: 'second.json', mimeType: 'application/json', buffer: backup });
  await expect(page.getByRole('heading', { name: en.backupReady, exact: true })).toBeVisible();
  await page.getByRole('button', { name: en.cancel, exact: true }).click();
  expect(await readDataset(page)).toEqual(before);
});

for (const lang of ['en', 'pt'] as const) {
  test(`${lang}: editing a local-date revisit cannot overwrite recorded future commitments or offer blind Retry`, async ({
    page,
  }) => {
    await setupScheduledHabits(page);
    await onDate(page, '2026-10-04');
    await openHabit(page);
    await page.getByRole('button', { name: en.editHabit, exact: true }).click();
    await page.getByLabel(en.habitFieldLabel, { exact: true }).fill('Walk with my family');
    await page.getByRole('button', { name: en.saveChanges, exact: true }).click();
    await openReviewSupporting(page);
    await expect(page.getByRole('heading', { name: /Pending changes/ })).toBeVisible();
    await onDate(page, '2026-10-05');
    await nav(page, en.today).click();
    const done = page.getByRole('checkbox', { name: 'Done: Walk with my family', exact: true });
    await done.click();
    await expect(done).toBeChecked();
    const copy = await language(page, lang);
    await onDate(page, '2026-10-04');
    await nav(page, copy.progress).click();
    await page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: scheduledHabitGoals[1], exact: true }) })
      .getByRole('button', { name: scheduledHabitGoals[1], exact: true })
      .click();
    await openReviewSupporting(page);
    await page.getByRole('button', { name: copy.editHabit, exact: true }).click();
    await page
      .getByLabel(copy.habitFieldLabel, { exact: true })
      .fill('A conflicting historical edit');
    const before = await readDataset(page);
    await page.getByRole('button', { name: copy.saveChanges, exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(
      lang === 'pt'
        ? 'Estas datas já têm histórico salvo.'
        : 'These dates already have saved history.',
      { timeout: 1500 },
    );
    await expect(page.getByRole('alert')).toContainText(
      lang === 'pt'
        ? 'Volte à data atual do dispositivo e revise'
        : 'Return to the current device date and review',
    );
    await expect(page.getByRole('button', { name: copy.retry, exact: true })).toHaveCount(0);
    expect(await readDataset(page)).toEqual(before);
  });
}
