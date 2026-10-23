import { test, expect, type Page } from '@playwright/test';
import en from '../src/i18n/en.json' with { type: 'json' };
import pt from '../src/i18n/pt.json' with { type: 'json' };
import {
  setupScheduledHabits,
  onDate,
  nav,
  readDataset,
  abortNextWrite,
  scheduledHabitGoals,
} from './support/habit-fixtures';

test.setTimeout(180_000);
test.use({ timezoneId: 'UTC' });
// Build the reusable facts through the real onboarding flow, then copy those
// exact facts only into each isolated test context (never the normal diary).
let initialFacts: Awaited<ReturnType<typeof readDataset>>;
test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(180_000);
  const page = await browser.newPage();
  try {
    await setupScheduledHabits(page);
    initialFacts = await readDataset(page);
  } finally {
    await page.close();
  }
});
const evidence = 'artifacts/pillars-ux-final/forms/captures';

const form = (page: Page) => page.locator('form.habit-form');

const row = (page: Page) =>
  page
    .locator('.management-habit')
    .filter({ has: page.getByRole('heading', { name: scheduledHabitGoals[1], exact: true }) });

async function setup(page: Page, language: 'en' | 'pt') {
  await page.clock.install({ time: new Date('2026-09-27T12:00:00') });
  await page.goto('./');
  await page.evaluate(
    (facts) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('my-goat-journey');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('dataset', 'readwrite');
          tx.objectStore('dataset').put(facts, 'current');
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
    initialFacts,
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: en.today, exact: true })).toBeVisible();
  await onDate(page, '2026-09-30');
  if (language === 'pt') {
    await nav(page, en.settingsNav).click();
    await page.getByLabel(en.language, { exact: true }).selectOption('pt');
    await expect(page.getByRole('heading', { name: pt.settings, exact: true })).toBeVisible();
  }
  const copy = language === 'en' ? en : pt;
  await nav(page, copy.pillars).click();
  await page
    .getByRole('region', { name: copy.body, exact: true })
    .getByRole('button', { name: copy.body, exact: true })
    .click();
  return copy;
}

async function edit(page: Page, copy: typeof en) {
  await row(page).getByRole('button', { name: copy.edit, exact: true }).click();
  await expect(page.getByLabel(copy.habitFieldLabel, { exact: true })).toBeVisible();
}

async function cleanCancel(page: Page, copy: typeof en) {
  await form(page).getByRole('button', { name: copy.cancel, exact: true }).click();
  await expect(form(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: copy.discardChanges, exact: true })).toHaveCount(0);
}

for (const language of ['en', 'pt'] as const) {
  test(`${language}: restored semantic edit and creation drafts leave quietly`, async ({
    page,
  }) => {
    const copy = await setup(page, language);
    const before = await readDataset(page);
    await edit(page, copy);
    await expect(form(page).locator('.habit-edit-note')).toHaveCount(0);
    await expect(form(page)).not.toContainText(`${copy.today}:`);
    const goal = page.getByLabel(copy.habitFieldLabel, { exact: true });
    await goal.fill(`${scheduledHabitGoals[1]} `);
    await goal.fill(scheduledHabitGoals[1]);
    await page.getByLabel(copy.pillar, { exact: true }).selectOption('mind');
    await expect(form(page).locator('.habit-edit-note')).toHaveCount(0);
    await page.getByLabel(copy.pillar, { exact: true }).selectOption('body');
    // Remove/reselect in a different order: selected weekdays are a set.
    for (const day of [1, 3, 5, 5, 3, 1])
      await form(page).getByRole('button', { name: copy.weekdays[day], exact: true }).click();
    await cleanCancel(page, copy);
    expect(await readDataset(page)).toEqual(before);
    await page
      .getByRole('region', { name: copy.body, exact: true })
      .getByRole('button', { name: copy.addHabit, exact: true })
      .click();
    // Opening a blank form is clean; literal whitespace is still an unsaved edit.
    await cleanCancel(page, copy);
    await page
      .getByRole('region', { name: copy.body, exact: true })
      .getByRole('button', { name: copy.addHabit, exact: true })
      .click();
    await page.getByLabel(copy.goal).fill(' ');
    await form(page).getByRole('button', { name: copy.cancel, exact: true }).click();
    await expect(page.getByRole('button', { name: copy.keepEditing, exact: true })).toBeVisible();
    await page.getByRole('button', { name: copy.keepEditing, exact: true }).click();
    await expect(page.getByLabel(copy.goal)).toHaveValue(' ');
    expect(await readDataset(page)).toEqual(before);
    await page.getByLabel(copy.goal).fill('New draft');
    expect(await readDataset(page)).toEqual(before);
    await page.getByLabel(copy.goal).fill('');
    await page.getByLabel(copy.pillar, { exact: true }).selectOption('mind');
    await page.getByLabel(copy.pillar, { exact: true }).selectOption('body');
    await form(page).getByRole('button', { name: copy.weekdays[1], exact: true }).click();
    await form(page).getByRole('button', { name: copy.everyDay, exact: true }).click();
    await cleanCancel(page, copy);
    expect(await readDataset(page)).toEqual(before);
  });
  test(`${language}: compact notes distinguish drafts and saved pending edits and retain failed values`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 850 });
    const copy = await setup(page, language);
    const before = await readDataset(page);
    await edit(page, copy);
    const goal = page.getByLabel(copy.habitFieldLabel, { exact: true });
    const note = form(page).locator('.habit-edit-note');
    const date = new Intl.DateTimeFormat(language === 'pt' ? 'pt-BR' : 'en', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date('2026-10-01T12:00:00'));
    const currentSchedule = [1, 3, 5].map((day) => copy.shortWeekdays[day]).join(' · ');
    for (const kind of ['goal', 'schedule', 'both'] as const) {
      await test.step(`${kind}-only affected saved values`, async () => {
        await goal.fill(kind === 'schedule' ? scheduledHabitGoals[1] : 'A draft walk');
        if (kind !== 'goal')
          for (const day of [3, 5])
            await form(page).getByRole('button', { name: copy.weekdays[day], exact: true }).click();
        const values = [
          kind !== 'schedule' ? scheduledHabitGoals[1] : undefined,
          kind !== 'goal' ? currentSchedule : undefined,
        ]
          .filter((value) => value !== undefined)
          .join(' · ');
        await expect(note).toHaveText(
          `${copy.habitEditIfSaved.replace('{date}', date)} ${copy.habitEditUntil.replace('{values}', values)}`,
        );
        await expect(form(page)).not.toContainText(`${copy.today}:`);
        expect(await readDataset(page)).toEqual(before);
        await goal.fill(scheduledHabitGoals[1]);
        if (kind !== 'goal')
          for (const day of [5, 3])
            await form(page).getByRole('button', { name: copy.weekdays[day], exact: true }).click();
        await expect(note).toHaveCount(0);
      });
    }
    await cleanCancel(page, copy);
    expect(await readDataset(page)).toEqual(before);
    await edit(page, copy);
    await goal.fill('  A future walk  ');
    await expect(note).toHaveText(
      `${copy.habitEditIfSaved.replace('{date}', date)} ${copy.habitEditUntil.replace('{values}', scheduledHabitGoals[1])}`,
    );
    await page.screenshot({ path: `${evidence}/editor-effective-draft-${language}-390.png` });
    expect(await readDataset(page)).toEqual(before);
    await abortNextWrite(page);
    await form(page).getByRole('button', { name: copy.saveChanges, exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(copy.saveError);
    await expect(goal).toHaveValue('  A future walk  ');
    await expect(note).toContainText(copy.habitEditIfSaved.replace('{date}', date));
    expect(await readDataset(page)).toEqual(before);
    await page.getByRole('button', { name: copy.retry, exact: true }).click();
    await expect(row(page)).toBeVisible();
    const saved = await readDataset(page);
    expect(saved.habits[1].versions.at(-1)).toMatchObject({
      goal: '  A future walk  ',
      effectiveFrom: '2026-10-01',
    });
    await edit(page, copy);
    await expect(goal).toHaveValue('  A future walk  ');
    await expect(note).toHaveText(
      `${copy.habitEditScheduled.replace('{date}', date)} ${copy.habitEditUntil.replace('{values}', scheduledHabitGoals[1])}`,
    );
    await page.screenshot({ path: `${evidence}/editor-effective-scheduled-${language}-390.png` });
    await goal.fill('Another draft');
    await goal.fill('  A future walk  ');
    await cleanCancel(page, copy);
    expect(await readDataset(page)).toEqual(saved);
    await edit(page, copy);
    await goal.fill(scheduledHabitGoals[1]);
    await expect(note).toHaveCount(0);
    await form(page).getByRole('button', { name: copy.cancel, exact: true }).click();
    await expect(
      page.getByRole('button', { name: copy.discardChanges, exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: copy.keepEditing, exact: true }).click();
    await expect(goal).toHaveValue(scheduledHabitGoals[1]);
    expect(await readDataset(page)).toEqual(saved);
  });
}
for (const language of ['en', 'pt'] as const)
  for (const revisit of [false, true])
    test(`${language}: ${revisit ? 'revisited' : 'same-date'} pending date and pillar draft note agree with committed Save`, async ({
      page,
    }) => {
      const copy = await setup(page, language);
      await onDate(page, revisit ? '2026-10-02' : '2026-09-30');
      const originalDate = revisit ? '2026-10-03' : '2026-10-01';
      await edit(page, copy);
      await page.getByLabel(copy.habitFieldLabel, { exact: true }).fill('A saved future walk');
      await form(page).getByRole('button', { name: copy.saveChanges, exact: true }).click();
      await expect(row(page)).toBeVisible();
      const pending = await readDataset(page);
      expect(pending.habits[1].versions.at(-1)).toMatchObject({
        effectiveFrom: originalDate,
        goal: 'A saved future walk',
      });
      await onDate(page, '2026-09-30');
      await edit(page, copy);

      const date = (value: string) =>
        new Intl.DateTimeFormat(language === 'pt' ? 'pt-BR' : 'en', {
          weekday: 'short',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        }).format(new Date(`${value}T12:00:00`));

      const note = form(page).locator('.habit-edit-note');
      await expect(note).toHaveText(
        `${copy.habitEditScheduled.replace('{date}', date(originalDate))} ${copy.habitEditUntil.replace('{values}', scheduledHabitGoals[1])}`,
      );
      // A clean Save is a no-write departure, not a request to rebase future facts.
      await form(page).getByRole('button', { name: copy.saveChanges, exact: true }).click();
      await expect(row(page)).toBeVisible();
      expect(await readDataset(page)).toEqual(pending);
      await edit(page, copy);
      await page.getByLabel(copy.pillar, { exact: true }).selectOption('mind');
      await expect(note).toHaveText(
        `${(revisit ? copy.habitEditIfSaved : copy.habitEditScheduled).replace('{date}', date('2026-10-01'))} ${copy.habitEditUntil.replace('{values}', scheduledHabitGoals[1])}`,
      );
      await expect(form(page)).toContainText(
        copy.moveBeforeHelp.replace('{target}', copy.mind).split('{date}')[0],
      );
      expect(await readDataset(page)).toEqual(pending);
      await page.clock.setFixedTime(new Date('2026-09-30T12:00:00.000Z'));
      await form(page).getByRole('button', { name: copy.saveChanges, exact: true }).click();
      await expect(form(page)).toHaveCount(0);
      const saved = await readDataset(page);
      expect(saved.habits[1].versions.find((v) => v.effectiveFrom === '2026-10-01')).toMatchObject({
        goal: 'A saved future walk',
        weekdays: [1, 3, 5],
      });
      expect(saved.habits[1].versions.find((v) => v.effectiveFrom === originalDate)).toMatchObject({
        goal: 'A saved future walk',
      });
      // Moving an uncredited required habit records today's conditional assignment.
      expect(saved.occurrences).toEqual([
        ...pending.occurrences,
        {
          habitId: pending.habits[1].id,
          activationId: pending.habits[1].periods[0].id,
          date: '2026-09-30',
          goal: scheduledHabitGoals[1],
          pillarId: 'mind',
          kind: 'required',
          done: false,
          pillarParticipation: 'on-completion',
          completionProvenance: 'never-credited',
          assignmentLocked: false,
          recordedAt: '2026-09-30T12:00:00.000Z',
          timezone: 'UTC',
          offsetMinutes: 0,
        },
      ]);
      expect(saved.habits[1].pendingMove).toEqual({ requestedOn: '2026-09-30', pillarId: 'mind' });
      await nav(page, copy.pillars).click();
      await page
        .getByRole('region', { name: copy.mind, exact: true })
        .getByRole('button', { name: copy.mind, exact: true })
        .click();
      await edit(page, copy);
      const loadedGoal = page.getByLabel(copy.habitFieldLabel, { exact: true });
      await expect(loadedGoal).toHaveValue('A saved future walk');
      await expect(page.getByLabel(copy.pillar, { exact: true })).toHaveValue('mind');
      await loadedGoal.fill('A saved future walk ');
      await form(page).getByRole('button', { name: copy.cancel, exact: true }).click();
      await expect(page.getByRole('button', { name: copy.keepEditing, exact: true })).toBeVisible();
      await page.getByRole('button', { name: copy.keepEditing, exact: true }).click();
      await loadedGoal.fill('A saved future walk');
      await page.getByLabel(copy.pillar, { exact: true }).selectOption('body');
      await page.getByLabel(copy.pillar, { exact: true }).selectOption('mind');
      for (const day of [1, 3, 5, 5, 3, 1])
        await form(page).getByRole('button', { name: copy.weekdays[day], exact: true }).click();
      await cleanCancel(page, copy);
      expect(await readDataset(page)).toEqual(saved);
      await nav(page, copy.today).click();
      await expect(
        page.getByRole('heading', { name: scheduledHabitGoals[1], exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { name: 'A saved future walk', exact: true }),
      ).toHaveCount(0);
    });

async function weekdayGeometry(page: Page, copy: typeof en, width: number, text: number) {
  const days = form(page).locator('.weekdays button');
  await expect(days).toHaveCount(7);
  const metrics = await days.evaluateAll((nodes) =>
    nodes.map((node) => {
      const r = node.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(node);
      const label = range.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        text: node.textContent,
        name: node.getAttribute('aria-label'),
        label: { left: label.left, right: label.right, top: label.top, bottom: label.bottom },
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
      };
    }),
  );
  for (const [index, m] of metrics.entries()) {
    expect(m.name).toBe(copy.weekdays[index]);
    expect(m.text).toBe(copy.shortWeekdays[index]);
    expect(m.w).toBeGreaterThanOrEqual(44);
    expect(m.h).toBeGreaterThanOrEqual(44);
    expect(Math.abs(m.w - metrics[0].w)).toBeLessThan(0.1);
    expect(Math.abs(m.h - metrics[0].h)).toBeLessThan(0.1);
    expect(m.label.left).toBeGreaterThanOrEqual(m.left + 0.5);
    expect(m.label.right).toBeLessThanOrEqual(m.right - 0.5);
    expect(m.label.top).toBeGreaterThanOrEqual(m.top);
    expect(m.label.bottom).toBeLessThanOrEqual(m.bottom);
    expect(m.left).toBeGreaterThanOrEqual(0);
    expect(m.right).toBeLessThanOrEqual(width);
  }
  const rows = [...new Set(metrics.map((m) => Math.round(m.y)))].map((y) =>
    metrics.filter((m) => Math.round(m.y) === y),
  );
  expect(rows.map((r) => r.length)).toEqual(
    width === 1280 || (width >= 375 && text === 100) ? [7] : [4, 3],
  );
  if (rows.length === 2)
    expect(
      Math.abs(
        (rows[0][0].left + rows[0].at(-1)!.right) / 2 -
          (rows[1][0].left + rows[1].at(-1)!.right) / 2,
      ),
    ).toBeLessThan(0.1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test.describe('Equal responsive weekday controls', () => {
  test.use({ hasTouch: true });
  for (const language of ['en', 'pt'] as const)
    for (const width of [320, 375, 390, 393, 402, 430, 440, 1280])
      for (const text of [100, 200]) {
        test(`${language} ${width}px text${text}: creation and edit equal targets`, async ({
          page,
        }) => {
          await page.setViewportSize({ width, height: 900 });
          const copy = await setup(page, language);
          await page.addStyleTag({ content: `html {font-size:${text}%;}` });
          await page
            .getByRole('region', { name: copy.body, exact: true })
            .getByRole('button', { name: copy.addHabit, exact: true })
            .click();
          await weekdayGeometry(page, copy, width, text);
          const buttons = form(page).locator('.weekdays button');
          await buttons.first().focus();
          await page.keyboard.press('Space');
          await expect(buttons.first()).toHaveAttribute('aria-pressed', 'false');
          await buttons.first().tap();
          await expect(buttons.first()).toHaveAttribute('aria-pressed', 'true');
          await buttons.first().evaluate((node) => node.scrollIntoView({ block: 'center' }));
          await page.screenshot({
            path: `${evidence}/creation-${language}-${width}-text${text}.png`,
          });
          await cleanCancel(page, copy);
          await edit(page, copy);
          expect(
            await page
              .getByLabel(copy.habitFieldLabel, { exact: true })
              .evaluate((node) =>
                Boolean(
                  node.compareDocumentPosition(document.getElementById('pillar')!) &
                  Node.DOCUMENT_POSITION_FOLLOWING,
                ),
              ),
          ).toBe(true);
          await weekdayGeometry(page, copy, width, text);
          await form(page)
            .locator('.weekdays button')
            .first()
            .evaluate((node) => node.scrollIntoView({ block: 'center' }));
          await page.screenshot({
            path: `${evidence}/editing-${language}-${width}-text${text}.png`,
          });
          await cleanCancel(page, copy);
        });
      }
});
