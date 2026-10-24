import { test, expect, type Page } from '@playwright/test';
import {
  nav,
  readDataset,
  scheduledHabitGoals,
  setupScheduledHabits,
} from './support/habit-fixtures';

test.setTimeout(90_000);
test.use({ actionTimeout: 10_000 });

const dialog = (page: Page) =>
  page.getByRole('dialog', { name: 'Leave without saving?', exact: true });
const disclosure = (page: Page, name: string) =>
  page.getByRole('region', { name, exact: true }).getByRole('button', { name, exact: true });
const edit = (page: Page) =>
  page
    .locator('.management-habit')
    .filter({ has: page.getByRole('heading', { name: scheduledHabitGoals[3], exact: true }) })
    .getByRole('button', { name: 'Edit', exact: true });
const heading = (page: Page, name: string) =>
  page.getByRole('heading', { name, level: 1, exact: true });

async function dirtyDirectEditor(page: Page) {
  await page.setViewportSize({ width: 390, height: 740 });
  await setupScheduledHabits(page);
  await nav(page, 'Pillars').click();
  for (const name of ['Mind', 'Body', 'Nutrition', 'Hygiene']) await disclosure(page, name).click();
  await edit(page).scrollIntoViewIfNeeded();
  const y = await page.evaluate(() => scrollY);
  expect(y).toBeGreaterThan(0);
  await edit(page).click();
  const goal = page.getByLabel('Habit', { exact: true });
  await goal.fill('  Café ☕ — an unsaved walk  ');
  await goal.focus();
  await goal.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(2, 7));
  await expect(goal).toHaveValue('  Café ☕ — an unsaved walk  ');
  return { y, facts: await readDataset(page) };
}

async function competingClicks(page: Page, first: 'back' | 'primary') {
  const back = page.locator('main > header .quiet-back');
  const primary = nav(page, 'Pillars');
  await expect(back).toBeVisible();
  await expect(primary).toBeVisible();
  // Both are real rendered controls, invoked before the browser leaves this task.
  await page.evaluate((first) => {
    const back = document.querySelector<HTMLButtonElement>('main > header .quiet-back')!;
    const primary = Array.from(document.querySelectorAll<HTMLButtonElement>('nav button')).find(
      (button) => button.textContent?.trim() === 'Pillars',
    )!;
    const firstControl = first === 'back' ? back : primary;
    const secondControl = first === 'back' ? primary : back;
    firstControl.click();
    secondControl.click();
  }, first);
  await expect(dialog(page)).toBeVisible();
}

test('First request Back retains contextual expansion, scroll, control focus and saved facts', async ({
  page,
}) => {
  const before = await dirtyDirectEditor(page);
  await competingClicks(page, 'back');
  await dialog(page).getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(disclosure(page, 'Mind')).toHaveAttribute('aria-expanded', 'true');
  await expect(disclosure(page, 'Body')).toHaveAttribute('aria-expanded', 'true');
  await expect(disclosure(page, 'Nutrition')).toHaveAttribute('aria-expanded', 'true');
  await expect(disclosure(page, 'Hygiene')).toHaveAttribute('aria-expanded', 'true');
  await expect(edit(page)).toBeFocused();
  expect(await page.evaluate(() => scrollY)).toBe(before.y);
  expect(await readDataset(page)).toEqual(before.facts);
});

test('First request primary Pillars retains fresh collapse and accepts discard only once', async ({
  page,
}) => {
  const before = await dirtyDirectEditor(page);
  await competingClicks(page, 'primary');
  await page.evaluate(() => {
    (window as unknown as Window & { departureFocusEvents: string[] }).departureFocusEvents = [];
    document.addEventListener('focusin', (event) => {
      if (event.target instanceof HTMLElement && event.target.textContent === 'Pillars')
        (
          window as unknown as Window & { departureFocusEvents: string[] }
        ).departureFocusEvents.push(event.target.tagName);
    });
  });
  // A duplicate activation and queued native close must not replay the departure.
  await dialog(page).evaluate((node: HTMLDialogElement) => {
    const discard = Array.from(node.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Discard changes',
    )!;
    discard.click();
    discard.click();
    node.close();
  });
  await expect(dialog(page)).toHaveCount(0);
  await expect(heading(page, 'Pillars')).toBeFocused();
  for (const name of ['Mind', 'Body', 'Nutrition', 'Hygiene'])
    await expect(disclosure(page, name)).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => scrollY)).toBe(0);
  expect(await readDataset(page)).toEqual(before.facts);
  expect(
    await page.evaluate(
      () => (window as unknown as Window & { departureFocusEvents: string[] }).departureFocusEvents,
    ),
  ).toEqual(['H1']);

  await disclosure(page, 'Hygiene').click();
  await edit(page).click();
  const goal = page.getByLabel('Habit', { exact: true });
  await goal.fill('Second session — literal  ');
  await nav(page, 'Today').click();
  await dialog(page).getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(goal).toHaveValue('Second session — literal  ');
  await expect(goal).toBeFocused();
});

async function pendingEditor(page: Page) {
  await setupScheduledHabits(page);
  await nav(page, 'Pillars').click();
  await disclosure(page, 'Body').click();
  await page
    .locator('.management-habit')
    .filter({ has: page.getByRole('heading', { name: scheduledHabitGoals[1], exact: true }) })
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await page.getByLabel('Habit', { exact: true }).fill('Old unsaved goal ☕');
  await page.locator('main > header .quiet-back').click();
  await expect(dialog(page)).toBeVisible();
}

async function peer(page: Page) {
  await page.clock.install({ time: new Date('2026-09-27T12:00:00') });
  await page.goto('./');
  await nav(page, 'Settings').click();
}

async function assertOldSessionGone(page: Page) {
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByLabel('Habit', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Old unsaved goal ☕', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
}

test('External replacement closes open departure without replay and permits a new focused session', async ({
  page,
  context,
}) => {
  await pendingEditor(page);
  const oldDialog = await dialog(page).elementHandle();
  const other = await context.newPage();
  await peer(other);
  const { revision: _revision, ...facts } = await readDataset(other);
  for (const habit of facts.habits) {
    habit.id = `peer-${habit.id}`;
    for (const version of habit.versions) version.goal = `Peer ${version.goal}`;
  }
  for (const occurrence of facts.occurrences) {
    occurrence.habitId = `peer-${occurrence.habitId}`;
    occurrence.goal = `Peer ${occurrence.goal}`;
  }
  const envelope = {
    format: 'my-goat-journey-backup',
    formatVersion: 1,
    exportedAt: '2026-09-27T12:00:00.000Z',
    dataset: facts,
  };
  await other.getByLabel('Choose backup file', { exact: true }).setInputFiles({
    name: 'fictional-peer.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(envelope)),
  });
  await expect(other.getByText('Backup ready', { exact: true })).toBeVisible();
  await other.getByRole('button', { name: 'Replace current data', exact: true }).click();
  await expect(other.getByText('Backup restored.', { exact: true })).toBeVisible();
  const committed = await readDataset(other);
  await expect(heading(page, 'Progress')).toBeVisible();
  await assertOldSessionGone(page);
  await expect(page.getByText(scheduledHabitGoals[1], { exact: true })).toHaveCount(0);
  await oldDialog!.evaluate((node) => node.dispatchEvent(new Event('close')));
  await expect(heading(page, 'Progress')).toBeVisible();
  expect(await readDataset(page)).toEqual(committed);
  await nav(page, 'Pillars').click();
  await disclosure(page, 'Body').click();
  const newEdit = page
    .locator('.management-habit')
    .filter({
      has: page.getByRole('heading', { name: `Peer ${scheduledHabitGoals[1]}`, exact: true }),
    })
    .getByRole('button', { name: 'Edit', exact: true });
  await newEdit.click();
  const goal = page.getByLabel('Habit', { exact: true });
  await goal.fill('New session — literal  ');
  await nav(page, 'Today').click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(goal).toHaveValue('New session — literal  ');
  await expect(goal).toBeFocused();
  expect(await readDataset(page)).toEqual(committed);
});

test('External reset closes open departure without replay or old draft resurrection', async ({
  page,
  context,
}) => {
  await pendingEditor(page);
  const oldDialog = await dialog(page).elementHandle();
  const other = await context.newPage();
  await peer(other);
  await other.getByRole('button', { name: 'Delete all data…', exact: true }).click();
  await other.getByRole('button', { name: 'Delete all data', exact: true }).click();
  await expect(other.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  const committed = await readDataset(other);
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  await assertOldSessionGone(page);
  await oldDialog!.evaluate((node) => node.dispatchEvent(new Event('close')));
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  expect(await readDataset(page)).toEqual(committed);
  expect(committed.habits).toEqual([]);
  expect(committed.draft).toBeNull();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByLabel('What do you want to do?')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  const onboarding = await readDataset(page);
  expect(onboarding.habits).toEqual([]);
  expect(onboarding.draft?.goals.every((goal) => goal.goal === '')).toBe(true);
});
