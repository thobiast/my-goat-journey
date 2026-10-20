import { test, expect } from '@playwright/test';
import { setupScheduledHabits, nav, readDataset } from './support/habit-fixtures';
import { readFile } from 'node:fs/promises';

test.setTimeout(60_000);

const envelope = (dataset: unknown) =>
  Buffer.from(
    JSON.stringify({
      format: 'my-goat-journey-backup',
      formatVersion: 1,
      exportedAt: '2026-09-27T12:00:00.000Z',
      dataset,
    }),
  );

test('partial step two backup resumes through actual Continue and finishes four default habits without dangling history', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await setupScheduledHabits(page);
  const original = await readDataset(page);
  const { revision: _revision, ...partial } = original;
  Object.assign(partial, {
    onboardingComplete: false,
    habits: [],
    occurrences: [],
    permanentUnlocks: [],
    draft: {
      step: 2,
      goals: [
        { pillarId: 'mind', goal: '  Imported Mind 🎵  ', weekdays: [1, 3] },
        { pillarId: 'body', goal: '  Imported Body  ', weekdays: [6, 0] },
      ],
    },
  });
  await nav(page, 'Settings').click();
  await page.getByLabel('Choose backup file', { exact: true }).setInputFiles({
    name: 'partial.json',
    mimeType: 'application/json',
    buffer: envelope(partial),
  });
  await expect(page.getByText('Backup ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Replace current data', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Body', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByLabel('What do you want to do?')).toHaveValue('  Imported Body  ');
  const resumed = await readDataset(page);
  expect(resumed.draft!.goals).toHaveLength(4);
  expect(resumed.habits).toEqual([]);
  expect(resumed.occurrences).toEqual([]);
  expect(resumed.draft!.goals.slice(0, 2)).toEqual(partial.draft!.goals);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  for (const pillar of ['Nutrition', 'Hygiene']) {
    await expect(page.getByRole('heading', { name: pillar, exact: true, level: 1 })).toBeVisible();
    await expect(page.getByLabel('What do you want to do?')).toHaveValue('');
    for (const day of [
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ])
      await expect(page.getByRole('button', { name: day, exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    await page.getByLabel('What do you want to do?').fill(`Finished ${pillar}`);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Start my journey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  const completed = await readDataset(page);
  expect(completed.onboardingComplete).toBe(true);
  expect(completed.draft).toBeNull();
  expect(completed.habits).toHaveLength(4);
  expect(completed.occurrences).toEqual([]);
  expect(completed.habits.map((h) => h.versions[0].goal)).toEqual([
    '  Imported Mind 🎵  ',
    '  Imported Body  ',
    'Finished Nutrition',
    'Finished Hygiene',
  ]);
  expect(completed.habits.slice(0, 2).map((h) => h.versions[0].weekdays)).toEqual([
    [1, 3],
    [0, 6],
  ]);
  await page.reload();
  expect(await readDataset(page)).toEqual(completed);
  await nav(page, 'Settings').click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup', exact: true }).click();
  const download = await pending;
  const exported = JSON.parse((await readFile((await download.path())!)).toString('utf8'));
  const { revision: _local, ...facts } = completed;
  expect(exported.dataset).toEqual(facts);
  expect(errors).toEqual([]);
});

test('contradictory finalized history cannot reach restore confirmation and current diary stays exact', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  const done = page.getByRole('checkbox', { name: 'Done: Read ten pages', exact: true });
  await done.click();
  await expect(done).toBeChecked();
  await nav(page, 'Settings').click();
  const before = await readDataset(page);
  const { revision: _revision, ...bad } = before;
  bad.onboardingComplete = false;
  bad.draft = {
    step: 5,
    goals: ['mind', 'body', 'nutrition', 'hygiene'].map((pillarId) => ({
      pillarId,
      goal: 'Replacement goal',
      weekdays: [1],
    })),
  };
  await page.getByLabel('Choose backup file', { exact: true }).setInputFiles({
    name: 'contradictory.json',
    mimeType: 'application/json',
    buffer: envelope(bad),
  });
  await expect(page.getByRole('alert')).toContainText('Invalid or unsupported backup');
  await expect(page.getByRole('button', { name: 'Replace current data', exact: true })).toHaveCount(
    0,
  );
  expect(await readDataset(page)).toEqual(before);
  await page.reload();
  expect(await readDataset(page)).toEqual(before);
});
