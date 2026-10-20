import { test, expect, type Page } from '@playwright/test';
import { developmentModuleUrl } from './support/development-module';

test.use({ isMobile: true, hasTouch: true, viewport: { width: 360, height: 844 } });
const goals = ['Read ten pages', 'Complete my walk', 'Prepare my snack', 'Complete my care'];
const long =
  'Walk through my neighborhood, notice the trees and return at my own pace without comparing myself to anyone else.';

const row = (page: Page, goal: string) =>
  page.locator('article').filter({ has: page.getByRole('heading', { name: goal, exact: true }) });

async function setup(page: Page) {
  await page.clock.install({ time: new Date('2026-09-28T12:00:00') });
  await page.goto('./');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  for (const goal of goals) {
    await page.getByLabel('What do you want to do?').fill(goal);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Start my journey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
}

test('native checklist checks required and optional goals, unchecks with consistent metrics, and restores saved state on failure', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: 'Add habit', exact: true }).click();
  await page.getByLabel('Pillar', { exact: true }).selectOption('body');
  await page.getByLabel('What do you want to do?').fill(long);
  await page.getByRole('button', { name: 'Save habit', exact: true }).click();
  const walking = row(page, goals[1]);
  const check = walking.getByRole('checkbox', { name: `Done: ${goals[1]}`, exact: true });
  await expect(check).not.toBeChecked();
  await expect(walking.getByRole('button')).toHaveCount(0);
  await expect(walking).toContainText('Optional today');
  await check.focus();
  await page.keyboard.press('Space');
  await expect(check).toBeChecked();
  await expect(walking).toContainText('Streak 1 · Best 1');
  await check.focus();
  await page.keyboard.press('Space');
  await expect(check).not.toBeChecked();
  await expect(walking).toContainText('Streak 0 · Best 0');
  await page.clock.setSystemTime(new Date('2026-09-29T12:00:00'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('.today-header')).toContainText('0 of 5 habits completed');
  const body = page.getByRole('region', { name: 'Body', exact: true });
  await expect(body.locator('.today-pillar-status')).toHaveText('0/2 completed');
  await expect(walking).not.toContainText('Required');
  await check.click();
  await expect(check).toBeChecked();
  await expect(body.locator('.today-pillar-status')).toHaveText('1/2 completed');
  await row(page, long).getByRole('checkbox').click();
  await expect(row(page, long).getByRole('checkbox')).toBeChecked();
  await expect(body.locator('.today-pillar-status')).toHaveText('2/2 completed today');
  await expect(body.locator('.today-pillar-status svg')).toBeVisible();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      IDBObjectStore.prototype.put = put;
      const result = put.apply(this, args);
      this.transaction.abort();
      return result;
    };
  });
  await check.click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(check).toBeChecked();
  await expect(body.locator('.today-pillar-status')).toHaveText('2/2 completed today');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(check).not.toBeChecked();
  await expect(body.locator('.today-pillar-status')).toHaveText('1/2 completed');
  await page.reload();
  await expect(check).not.toBeChecked();
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Language', { exact: true }).selectOption('pt');
  await page.getByRole('navigation').getByRole('button', { name: 'Hoje', exact: true }).click();
  await expect(
    walking.getByRole('checkbox', { name: `Feito: ${goals[1]}`, exact: true }),
  ).not.toBeChecked();
  await expect(walking.locator('.habit-check span')).toHaveText('Feito');
  await expect(
    page.getByRole('region', { name: 'Corpo', exact: true }).locator('.today-pillar-status'),
  ).toHaveText('1/2 concluídos');
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const card = row(page, long);
    const name = await card.getByRole('heading').boundingBox();
    const target = await card.locator('.habit-check').boundingBox();
    expect(target!.x).toBeGreaterThanOrEqual(name!.x + name!.width);
    expect(Math.abs(target!.y - name!.y)).toBeLessThanOrEqual(4);
    expect(target!.height).toBeGreaterThanOrEqual(44);
    expect(target!.width).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page
      .getByRole('region', { name: 'Corpo', exact: true })
      .evaluate((n) => n.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: `artifacts/checklist/checklist-pt-${width}.png` });
  }
  await walking.getByRole('checkbox').focus();
  await page.keyboard.press('Space');
  await expect(walking.getByRole('checkbox')).toBeChecked();
  await expect(
    page.getByRole('region', { name: 'Corpo', exact: true }).locator('.today-pillar-status'),
  ).toHaveText('2/2 concluídos hoje');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await page.setViewportSize({ width: 320, height: 844 });
  const target = row(page, long).locator('.habit-check');
  await target.scrollIntoViewIfNeeded();
  expect(
    await target.evaluate((n) => {
      const b = n.getBoundingClientRect();
      return n.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2));
    }),
  ).toBe(true);
  await row(page, long).getByRole('checkbox').focus();
  expect(
    await row(page, long)
      .getByRole('checkbox')
      .evaluate((n) => getComputedStyle(n).outlineStyle),
  ).not.toBe('none');
  await page.keyboard.press('Space');
  await expect(row(page, long).getByRole('checkbox')).not.toBeChecked();
});

test('disabled native checklist prevents another write during saving', async ({ page }) => {
  test.skip(
    (process.env.BASE_URL ?? '').includes('runtime'),
    'Controlled repository promise seam uses development modules',
  );
  await setup(page);
  const modulePath = await developmentModuleUrl(page, '/src/data/database.ts');
  await page.evaluate(async (modulePath) => {
    const { Repository } = await import(modulePath);
    const original = Repository.prototype.setDone;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const state = window as unknown as { releaseChecklist: () => void; checklistWrites: number };
    state.releaseChecklist = release;
    state.checklistWrites = 0;
    Repository.prototype.setDone = async function (...args: unknown[]) {
      state.checklistWrites++;
      await gate;
      return original.apply(this, args);
    };
  }, modulePath);
  const card = row(page, goals[0]);
  await card.getByRole('checkbox').click();
  await expect(card.getByRole('checkbox')).toBeDisabled();
  await card.locator('.habit-check').evaluate((n) => {
    (n as HTMLLabelElement).click();
    (n as HTMLLabelElement).click();
  });
  expect(
    await page.evaluate(() => (window as unknown as { checklistWrites: number }).checklistWrites),
  ).toBe(1);
  await page.evaluate(() =>
    (window as unknown as { releaseChecklist: () => void }).releaseChecklist(),
  );
  await expect(card.getByRole('checkbox')).toBeChecked();
});
