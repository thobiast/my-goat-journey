import { expandFixturePillars } from './support/management-fixtures';
import { test, expect, type Page, type Locator } from '@playwright/test';

test.use({ isMobile: true, hasTouch: true, viewport: { width: 360, height: 800 } });
const goals = ['Read ten pages', 'Complete my walk', 'Prepare my snack', 'Complete my care'];

const row = (page: Page, goal: string) =>
  page.locator('article').filter({ has: page.getByRole('heading', { name: goal, exact: true }) });

const list = (page: Page) =>
  page.getByRole('list', { name: /^(Pillar summary|Resumo dos pilares)$/ });

const tile = (page: Page, name: string) =>
  list(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });

async function geometry(card: Locator) {
  return card.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const metric = node.querySelector('.pillar-streak')!.getBoundingClientRect();
    return { height: box.height, metricOffset: metric.top - box.top };
  });
}

async function language(page: Page, value: 'en' | 'pt') {
  await page.getByRole('button', { name: /^(Settings|Ajustes)$/ }).click();
  await page.getByLabel(/^(Language|Idioma)$/).selectOption(value);
  await page
    .getByRole('navigation')
    .getByRole('button', { name: value === 'en' ? 'Today' : 'Hoje', exact: true })
    .click();
}

test('completed-day summary needs every required habit, ignores optional goals and keeps layout stable after Undo', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-09-28T12:00:00') });
  await page.goto('./');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  for (const goal of goals) {
    await page.getByLabel('What do you want to do?').fill(goal);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Start my journey', exact: true }).click();
  await page.getByRole('button', { name: 'Add habit', exact: true }).click();
  await page.getByLabel('Pillar', { exact: true }).selectOption('body');
  await page.getByLabel('What do you want to do?').fill('Stretch slowly');
  await page.getByRole('button', { name: 'Save habit', exact: true }).click();
  await row(page, goals[1]).getByRole('checkbox').click();
  await expect(row(page, goals[1]).getByRole('checkbox')).toBeChecked();
  await expect(list(page).getByText('Completed today', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Pillars', exact: true }).click();
  await expandFixturePillars(page);
  await page.getByRole('button', { name: 'New pillar', exact: true }).click();
  await page.getByLabel('Pillar name', { exact: true }).fill('Music');
  await page.getByRole('button', { name: 'Save pillar', exact: true }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.clock.setSystemTime(new Date('2026-09-29T12:00:00'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('.today-header')).toContainText('0 of 5 habits completed');
  await page.getByRole('button', { name: 'Add habit', exact: true }).click();
  await page.getByLabel('Pillar', { exact: true }).selectOption('body');
  await page.getByLabel('What do you want to do?').fill('Optional rest');
  await page.getByRole('button', { name: 'Save habit', exact: true }).click();
  await row(page, goals[1]).getByRole('checkbox').click();
  await expect(tile(page, 'Body').locator('.summary-count [aria-hidden=true]')).toHaveText('1/2');
  await expect(list(page).getByText('Completed today', { exact: true })).toHaveCount(0);
  const before = await geometry(tile(page, 'Body'));
  await row(page, 'Stretch slowly').getByRole('checkbox').click();
  const completed = tile(page, 'Body').getByText('Completed today', { exact: true });
  await expect(completed).toBeVisible();
  await expect(tile(page, 'Body').locator('.summary-count [aria-hidden=true]')).toHaveText('2/2');
  await expect(tile(page, 'Body').getByRole('progressbar')).toHaveCount(0);
  await expect(tile(page, 'Mind').getByText('Completed today', { exact: true })).toHaveCount(0);
  await expect(tile(page, 'Music').getByText('Completed today', { exact: true })).toHaveCount(0);
  expect(await geometry(tile(page, 'Body'))).toEqual(before);
  const icon = tile(page, 'Body').locator('.pillar-day-status svg');
  await expect(icon).toBeVisible();
  await expect(icon).toHaveAttribute('aria-hidden', 'true');
  const statusBox = await completed.boundingBox();
  const metricBox = await tile(page, 'Body').locator('.pillar-streak').boundingBox();
  expect(statusBox!.y).toBeGreaterThanOrEqual(metricBox!.y + metricBox!.height);
  await expect(list(page).locator('button,a,[tabindex]')).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: 'artifacts/pillar-completed-day/completed-beside-pending-en-360.png',
  });
  await language(page, 'pt');
  await expect(tile(page, 'Corpo').getByText('Concluído hoje', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 800 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: 'artifacts/pillar-completed-day/completed-beside-pending-pt-320.png',
  });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  const enlargedBefore = await geometry(tile(page, 'Corpo'));
  await row(page, goals[1]).getByRole('checkbox').click();
  await expect(tile(page, 'Corpo').locator('.summary-count [aria-hidden=true]')).toHaveText('1/2');
  await expect(list(page).getByText('Concluído hoje', { exact: true })).toHaveCount(0);
  expect(await geometry(tile(page, 'Corpo'))).toEqual(enlargedBefore);
  await row(page, goals[1]).getByRole('checkbox').click();
  await expect(tile(page, 'Corpo').getByText('Concluído hoje', { exact: true })).toBeVisible();
  expect(await geometry(tile(page, 'Corpo'))).toEqual(enlargedBefore);
  await page.reload();
  await expect(tile(page, 'Corpo').getByText('Concluído hoje', { exact: true })).toBeVisible();
});
