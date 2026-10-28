import { test, expect, type Page } from '@playwright/test';
import type { Dataset, Habit, Occurrence } from '../src/domain/types';
import { nav, readDataset } from './support/habit-fixtures';

// Native file/IndexedDB/UI boundaries only: also runs against freshly compiled assets.
// Work-count regressions belong in units; no machine-specific responsiveness budget here.
test.use({ timezoneId: 'UTC' });
test.setTimeout(180_000);

const today = '2026-10-28';
const first = '0100-01-01';
const weekdays = [0, 1, 2, 3, 4, 5, 6];

function habit(id: string, createdOn: string, pillarId: string): Habit {
  return {
    id,
    createdOn,
    versions: [{ effectiveFrom: createdOn, goal: `Fictional ${id}`, weekdays }],
    memberships: [{ effectiveFrom: createdOn, pillarId }],
    periods: [{ id: `activation-${id}`, start: createdOn }],
  };
}

function completion(habit: Habit, date: string): Occurrence {
  const creation = date === habit.createdOn;
  return {
    habitId: habit.id,
    date,
    pillarId: habit.memberships[0].pillarId,
    goal: habit.versions[0].goal,
    kind: creation ? 'optional' : 'required',
    done: true,
    recordedAt: `${date}T12:00:00Z`,
    timezone: 'UTC',
    offsetMinutes: 0,
    activationId: habit.periods[0].id,
    pillarParticipation: creation ? 'on-completion' : 'required',
    completionProvenance: 'credited',
    assignmentLocked: true,
  };
}

function fixture(name: 'century' | 'sparse' | 'dormant'): Dataset {
  const defaults = ['mind', 'body', 'nutrition', 'hygiene'] as const;
  const habits = Array.from({ length: name === 'century' ? 100 : 4 }, (_, index) =>
    habit(
      `${name}-${index}`,
      name === 'century' && index === 99 ? '0200-01-01' : first,
      defaults[index % 4],
    ),
  );
  const data: Dataset = {
    schemaVersion: 2,
    revision: 0,
    onboardingComplete: true,
    draft: null,
    settings: { language: 'en', reducedMotion: false },
    pillars: defaults.map((id) => ({ id, name: id, defaultKey: id })),
    habits,
    occurrences:
      name === 'sparse'
        ? [first, today].flatMap((date) => habits.map((item) => completion(item, date)))
        : [],
    permanentUnlocks: [],
  };
  if (name === 'sparse') {
    data.pillars.push(
      { id: 'empty', name: 'Fictional empty pillar' },
      { id: 'late', name: 'Fictional late pillar' },
      { id: 'future', name: 'Fictional future pillar' },
    );
    const late = habit('late-member', '2026-10-26', 'late');
    const future = habit('future-member', '2027-01-01', 'future');
    data.habits.push(late, future);
    data.occurrences.push(completion(late, '2026-10-27'), completion(future, '2027-01-01'));
  }
  return data;
}

async function initializeControl(page: Page) {
  await page.clock.setFixedTime(new Date(`${today}T12:00:00Z`));
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  const control = fixture('dormant');
  control.revision = 7;
  control.habits = [habit('control-only', today, 'mind')];
  control.occurrences = [completion(control.habits[0], today)];
  // Only this test's fresh nonpersistent context is seeded; never the normal diary.
  await page.evaluate(
    (data) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('my-goat-journey');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('dataset', 'readwrite');
          tx.objectStore('dataset').put(data, 'current');
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
    control,
  );
  expect(await readDataset(page)).toEqual(control);
  await page.reload();
  await expectTodayXp(page, 10);
  expect(await readDataset(page)).toEqual(control);
  await nav(page, 'Settings').click();
  return control;
}

async function choose(page: Page, name: string, data: Dataset) {
  const { revision: _revision, ...portable } = data;
  await page.getByLabel('Choose backup file', { exact: true }).setInputFiles({
    name: `fictional-${name}.json`,
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        format: 'my-goat-journey-backup',
        formatVersion: 1,
        exportedAt: '2026-10-28T00:00:00Z',
        dataset: portable,
      }),
    ),
  });
  await expect(page.getByRole('heading', { name: 'Backup ready', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Replace current data', exact: true }),
  ).toBeEnabled();
}

async function expectTodayXp(page: Page, xp: number) {
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(page.locator('.today-header .header-xp .visually-hidden')).toHaveText(
    `Total XP: ${xp}.`,
  );
}

async function expectProgressXp(page: Page, xp: number) {
  await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible();
  await expect(page.locator('.progress-xp-current')).toHaveText(`Level 1${xp} / 100 XP`);
  await expect(page.locator('.progress-xp progress')).toHaveAttribute('value', String(xp));
}

const card = (page: Page, title: string) =>
  page.locator('article.consistency-card').filter({
    has: page.getByRole('heading', { name: title, exact: true }),
  });

test('Century backup selection and explicit Cancel preserve every native fact and local revision', async ({
  page,
}) => {
  const before = await initializeControl(page);
  // Preview the small 100-habit / 100-year file, but never adopt it through 2026.
  await choose(page, 'century', fixture('century'));
  expect(await readDataset(page)).toEqual(before);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Backup ready', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Choose backup file', { exact: true })).toBeEnabled();
  expect(await readDataset(page)).toEqual(before);
  await page.reload();
  await expectTodayXp(page, 10);
  expect(await readDataset(page)).toEqual(before);
});

for (const name of ['dormant', 'sparse'] as const) {
  test(`${name} backup confirmation replaces exactly and reload preserves Today and Progress XP`, async ({
    page,
  }) => {
    const before = await initializeControl(page);
    const candidate = fixture(name);
    await choose(page, name, candidate);
    expect(await readDataset(page)).toEqual(before);
    await page.getByRole('button', { name: 'Replace current data', exact: true }).click();
    await expect(page.getByText('Backup restored.', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Backup ready', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Choose backup file', { exact: true })).toBeEnabled();
    const expected = { ...candidate, revision: before.revision + 1 };
    expect(await readDataset(page)).toEqual(expected);
    const xp = name === 'sparse' ? 90 : 0;
    // Eight separated old successes plus one late success; future credit earns nothing yet.
    await nav(page, 'Today').click();
    await expectTodayXp(page, xp);
    await expect(page.getByRole('checkbox')).toHaveCount(name === 'sparse' ? 5 : 4);
    await expect(page.getByText('Fictional future-member', { exact: true })).toHaveCount(0);
    await page.reload();
    await expectTodayXp(page, xp);
    expect(await readDataset(page)).toEqual(expected);
    await nav(page, 'Progress').click();
    await expectProgressXp(page, xp);
    await expect(page.locator('.consistency-card')).toHaveCount(candidate.habits.length);
    for (const item of candidate.habits.slice(0, 4)) {
      const habitCard = card(page, item.versions[0].goal);
      await expect(habitCard.locator('[data-live-streak="current"]')).toHaveText(
        name === 'sparse' ? '1 completion' : '0 completions',
      );
      await expect(habitCard.locator('[data-live-streak="best"]')).toHaveText(
        name === 'sparse' ? '1 completion' : '0 completions',
      );
    }
    if (name === 'sparse') {
      await page.locator('.progress-filters summary').click();
      await page.getByLabel('Pillar filter', { exact: true }).selectOption('future');
      await expect(page.locator('.consistency-card')).toHaveCount(1);
      const future = card(page, 'Fictional future-member');
      await expect(future).toContainText('Waiting to start');
      await expect(future.locator('[data-calendar-date]')).toHaveCount(0);
      await expect(future.locator('.period-percent')).toHaveText('—');
      await expect(future.locator('[data-live-streak="best"]')).toHaveText('0 completions');
      await expect(
        page.getByRole('button', { name: 'Previous period', exact: true }),
      ).toBeDisabled();
      await expectProgressXp(page, 90);
      await page.getByLabel('Pillar filter', { exact: true }).selectOption('late');
      await expect(page.locator('.consistency-card')).toHaveCount(1);
      await expect(
        page.getByRole('button', { name: 'Previous period', exact: true }),
      ).toBeDisabled();
      await expect(
        card(page, 'Fictional late-member').locator('[data-calendar-date="2026-10-27"]'),
      ).toHaveAttribute('data-state', 'completed');
      await page.getByRole('tab', { name: 'Pillars', exact: true }).click();
      await expect(page.locator('.consistency-card')).toHaveCount(8);
      const empty = card(page, 'Fictional empty pillar');
      await expect(empty.locator('.tracking-since')).toHaveCount(0);
      await expect(empty.locator('[data-calendar-date]')).toHaveCount(0);
      await expect(empty.locator('.period-percent')).toHaveText('—');
      await expect(empty.locator('[data-live-streak="best"]')).toHaveText('0 days');
      const late = card(page, 'Fictional late pillar');
      // Unchecked creation participates in tracking; first completion is a day later.
      await expect(late.locator('.tracking-since')).toContainText('Oct 26, 2026');
      await expect(late.locator('[data-calendar-date="2026-10-26"]')).toHaveAttribute(
        'data-state',
        'unscheduled',
      );
      await expect(late.locator('[data-calendar-date="2026-10-27"]')).toHaveAttribute(
        'data-state',
        'completed',
      );
      const futurePillar = card(page, 'Fictional future pillar');
      await expect(futurePillar.locator('.tracking-since')).toContainText('Jan 1, 2027');
      await expect(futurePillar.locator('[data-calendar-date]')).toHaveCount(0);
      await expectProgressXp(page, 90);
    }
    // Navigation/filter normalization is readonly and never manufactures facts or revisions.
    expect(await readDataset(page)).toEqual(expected);
    await nav(page, 'Today').click();
    await expectTodayXp(page, xp);
    expect(await readDataset(page)).toEqual(expected);
  });
}
