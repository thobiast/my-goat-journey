import { test, expect, type Page } from '@playwright/test';
import { calculateProgress } from '../src/domain/progress';
import type { Dataset } from '../src/domain/types';

test.use({ isMobile: true, hasTouch: true, viewport: { width: 360, height: 800 } });
const longGoal =
  'Walk through my neighborhood, notice the trees and return at my own pace without comparing myself to anyone else.';

const row = (page: Page, goal: string) =>
  page.locator('article').filter({ has: page.getByRole('heading', { name: goal, exact: true }) });

async function setup(page: Page, mondayOnly = false) {
  await page.clock.install({ time: new Date('2026-09-28T12:00:00') });
  await page.goto('./');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  for (const goal of [
    'Read ten pages',
    'Complete my walk',
    'Prepare my snack',
    'Complete my care',
  ]) {
    await page.getByLabel('What do you want to do?').fill(goal);
    if (mondayOnly)
      for (const day of ['Sunday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'])
        await page.getByRole('button', { name: day, exact: true }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Start my journey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
}

async function advance(page: Page, date: string) {
  await page.clock.setSystemTime(new Date(`${date}T12:00:00`));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator(`.today-header time[datetime="${date}"]`)).toBeVisible();
}

async function addHabit(page: Page, goal: string) {
  await page.getByRole('button', { name: 'Add habit', exact: true }).click();
  await page.getByLabel('Pillar', { exact: true }).selectOption('body');
  await page.getByLabel('What do you want to do?').fill(goal);
  await page.getByRole('button', { name: 'Save habit', exact: true }).click();
  await expect(row(page, goal)).toBeVisible();
}

async function done(page: Page, goal: string) {
  await row(page, goal).getByRole('checkbox').click();
  await expect(row(page, goal).getByRole('checkbox')).toBeChecked();
}

async function facts(page: Page): Promise<Dataset> {
  return page.evaluate(
    () =>
      new Promise<Dataset>((resolve, reject) => {
        const open = indexedDB.open('my-goat-journey');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const get = db.transaction('dataset').objectStore('dataset').get('current');
          get.onerror = () => reject(get.error);
          get.onsuccess = () => {
            db.close();
            // Setup has committed the current schema-2 fixture before this read.
            resolve(get.result as Dataset);
          };
        };
      }),
  );
}

async function snapshot(page: Page) {
  const date = await page.locator('.today-header time').getAttribute('datetime');
  return calculateProgress(await facts(page), date!);
}

async function captureBody(page: Page, name: string) {
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page
      .getByRole('region', { name: /^(Body|Corpo)$/ })
      .evaluate((n) => n.scrollIntoView({ block: 'start' }));
    await page.screenshot({
      path: `artifacts/mobile-completion-progression/screenshots/${name}-${width}.png`,
    });
  }
}

async function normalLayout(page: Page, goal: string) {
  const card = row(page, goal);
  const title = card.getByRole('heading');
  const action = card.locator('.habit-check');
  const t = await title.boundingBox();
  const a = await action.boundingBox();
  const status = await card.locator('.habit-metrics').boundingBox();
  expect(a!.x).toBeGreaterThanOrEqual(t!.x + t!.width);
  expect(Math.abs(a!.y - t!.y)).toBeLessThanOrEqual(4);
  expect(a!.height).toBeGreaterThanOrEqual(44);
  expect(status!.y).toBeGreaterThanOrEqual(t!.y + t!.height);
  expect(await action.evaluate((n) => n.scrollWidth <= n.clientWidth)).toBe(true);
  expect(await title.evaluate((n) => parseFloat(getComputedStyle(n).fontSize))).toBe(16);
  expect(
    await card.locator('.habit-metrics').evaluate((n) => parseFloat(getComputedStyle(n).fontSize)),
  ).toBe(13);
}

test('Body completion progression preserves XP through partial full Undo redo and reload while mobile actions stay beside long goals', async ({
  page,
}) => {
  await setup(page);
  await addHabit(page, longGoal);
  for (const goal of ['Complete my walk', longGoal]) await done(page, goal);
  await advance(page, '2026-09-29');
  for (const goal of ['Complete my walk', longGoal]) await done(page, goal);
  await advance(page, '2026-09-30');
  await done(page, 'Complete my walk');
  const body = page.getByRole('region', { name: 'Body', exact: true });
  const summary = page.getByRole('list', { name: 'Pillar summary' });
  const bodyTile = summary
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Body', exact: true }) });
  await expect(body.locator('.pillar-header')).toContainText('1/2 completed');
  await expect(bodyTile.getByText('Completed today', { exact: true })).toHaveCount(0);
  expect((await snapshot(page)).totalXp).toBe(60);
  expect((await snapshot(page)).pillars.body).toEqual({ current: 2, best: 2 });
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await normalLayout(page, longGoal);
    await normalLayout(page, 'Complete my walk');
  }
  await expect(body.locator('.pillar-header')).toHaveCSS('background-color', 'rgb(138, 62, 75)');
  await expect(bodyTile.locator('.pillar-icon')).toHaveCSS('color', 'rgb(139, 70, 81)');
  await expect(row(page, longGoal).getByRole('checkbox')).toHaveCSS(
    'accent-color',
    'rgb(52, 99, 78)',
  );
  await expect(
    page.getByRole('navigation').getByRole('button', { name: 'Today', exact: true }),
  ).toHaveCSS('background-color', 'rgb(52, 99, 78)');
  await captureBody(page, 'long-complete-en');
  await done(page, longGoal);
  await expect(bodyTile.getByText('Completed today', { exact: true })).toBeVisible();
  expect((await snapshot(page)).totalXp).toBe(80);
  expect((await snapshot(page)).pillars.body).toEqual({ current: 3, best: 3 });
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await normalLayout(page, longGoal);
  }
  await captureBody(page, 'long-undo-en');
  await addHabit(page, 'Optional new goal');
  await expect(body.locator('.pillar-header')).toContainText('2/2 completed today');
  expect((await snapshot(page)).pillars.body.current).toBe(3);
  for (let repeat = 0; repeat < 3; repeat++) {
    await row(page, longGoal).getByRole('checkbox').click();
    await expect(row(page, longGoal).getByRole('checkbox')).not.toBeChecked();
    expect((await snapshot(page)).totalXp).toBe(60);
    expect((await snapshot(page)).pillars.body).toEqual({ current: 2, best: 2 });
    await expect(bodyTile.getByText('Completed today', { exact: true })).toHaveCount(0);
    await page.reload();
    expect((await snapshot(page)).totalXp).toBe(60);
    await done(page, longGoal);
    expect((await snapshot(page)).totalXp).toBe(80);
    expect((await snapshot(page)).pillars.body.current).toBe(3);
  }
  await page.reload();
  expect((await snapshot(page)).totalXp).toBe(80);
  const stored = await facts(page);
  expect(stored.occurrences).toHaveLength(6);
  expect(new Set(stored.occurrences.map((o) => `${o.habitId}:${o.date}`)).size).toBe(6);
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Language', { exact: true }).selectOption('pt');
  await page.getByRole('navigation').getByRole('button', { name: 'Hoje', exact: true }).click();
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await normalLayout(page, longGoal);
    await expect(row(page, longGoal).getByRole('checkbox')).toBeChecked();
  }
  await captureBody(page, 'long-undo-pt');
  await row(page, longGoal).getByRole('checkbox').click();
  await expect(row(page, longGoal).getByRole('checkbox')).not.toBeChecked();
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await normalLayout(page, longGoal);
  }
  await captureBody(page, 'long-complete-pt');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await page.setViewportSize({ width: 320, height: 800 });
  const titleBox = await row(page, longGoal).getByRole('heading').boundingBox();
  const action = row(page, longGoal).getByRole('checkbox');
  const actionBox = await action.boundingBox();
  expect(actionBox!.x).toBeGreaterThanOrEqual(titleBox!.x + titleBox!.width);
  await action.scrollIntoViewIfNeeded();
  expect(
    await action.evaluate((n) => {
      const b = n.getBoundingClientRect();
      return n.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2));
    }),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await action.click();
  await expect(action).toBeChecked();
});

test('empty and optional-only days remain neutral without invented pillar credit', async ({
  page,
}) => {
  await setup(page, true);
  await expect(
    page
      .getByRole('list', { name: 'Pillar summary' })
      .getByText('Completed today', { exact: true }),
  ).toHaveCount(0);
  expect((await snapshot(page)).pillars.body).toEqual({ current: 0, best: 0 });
  await done(page, 'Complete my walk');
  expect((await snapshot(page)).pillars.body).toEqual({ current: 1, best: 1 });
  await advance(page, '2026-09-29');
  await expect(page.locator('article')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Pillar summary' })).toContainText(
    'No habits scheduled today',
  );
  expect((await snapshot(page)).pillars.body).toEqual({ current: 1, best: 1 });
  expect((await snapshot(page)).totalXp).toBe(10);
  await page.reload();
  expect((await snapshot(page)).pillars.body).toEqual({ current: 1, best: 1 });
});
