import { test, expect } from '@playwright/test';
import {
  setupScheduledHabits,
  nav,
  onDate,
  scheduledHabitGoals,
  readDataset,
} from './support/habit-fixtures';

test('A viewed historical day becomes Progress rather than editable Today when device date retreats', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await onDate(page, '2026-09-29');
  await nav(page, 'Progress').click();
  await page.getByRole('button', { name: '7d', exact: true }).click();
  const habit = page
    .locator('article.consistency-card')
    .filter({ has: page.getByRole('heading', { name: scheduledHabitGoals[1], exact: true }) });
  await habit.locator('[data-calendar-date="2026-09-28"]').click();
  await expect(page.locator('main.progress-day-page')).toBeVisible();
  const saved = await readDataset(page);
  await onDate(page, '2026-09-28');
  await expect(
    page.getByRole('heading', { name: 'Progress', exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.locator('main.progress-day-page')).toHaveCount(0);
  await expect(page.locator('[data-calendar-date="2026-09-28"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '7d', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await readDataset(page)).toEqual(saved);
});
test('Peer replacement invalidates a removed habit day scope without retaining its goal or correction action', async ({
  page,
  context,
}) => {
  await setupScheduledHabits(page);
  await onDate(page, '2026-09-29');
  await nav(page, 'Progress').click();
  const habit = page
    .locator('article.consistency-card')
    .filter({ has: page.getByRole('heading', { name: scheduledHabitGoals[1], exact: true }) });
  await habit.locator('[data-calendar-date="2026-09-28"]').click();
  await expect(page.locator('main.progress-day-page')).toBeVisible();
  const other = await context.newPage();
  await other.clock.install({ time: new Date('2026-09-29T12:00:00') });
  await other.goto('./');
  await nav(other, 'Settings').click();
  const { revision: _, ...facts } = await readDataset(other);
  for (const item of facts.habits) {
    item.id = `replacement-${item.id}`;
    item.versions[0].goal = `Replacement: ${item.versions[0].goal}`;
  }
  await other.getByLabel('Choose backup file', { exact: true }).setInputFiles({
    name: 'isolated-peer.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        format: 'my-goat-journey-backup',
        formatVersion: 1,
        exportedAt: '2026-09-29T12:00:00.000Z',
        dataset: facts,
      }),
    ),
  });
  await expect(other.getByText('Backup ready', { exact: true })).toBeVisible();
  await other.getByRole('button', { name: 'Replace current data', exact: true }).click();
  await expect(other.getByText('Backup restored.', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Progress', exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.locator('main.progress-day-page')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: scheduledHabitGoals[1], exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  expect(await readDataset(page)).toEqual(await readDataset(other));
});
test('A fully completed percentage remains inside the donut center at 200% text', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await onDate(page, '2026-09-28');
  const done = page.getByRole('checkbox', { name: `Done: ${scheduledHabitGoals[1]}`, exact: true });
  await done.click();
  await expect(done).toBeChecked();
  await onDate(page, '2026-09-29');
  await nav(page, 'Progress').click();
  await page.setViewportSize({ width: 320, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  const card = page
    .locator('article.consistency-card')
    .filter({ has: page.getByRole('heading', { name: scheduledHabitGoals[1], exact: true }) });
  const donut = card.locator('.period-donut');
  const percentage = card.locator('.period-percent');
  await expect(percentage).toHaveText('100%');
  await donut.scrollIntoViewIfNeeded();
  const center = await donut.evaluate((node) => {
    const inset = parseFloat(getComputedStyle(node, '::before').left);
    const box = node.getBoundingClientRect();
    return { width: box.width - 2 * inset, height: box.height - 2 * inset };
  });
  const text = await percentage.boundingBox();
  expect(text!.width).toBeLessThanOrEqual(center.width);
  expect(text!.height).toBeLessThanOrEqual(center.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: 'artifacts/progress-redesign/screenshots/complete-percent-text200-320.png',
  });
});
