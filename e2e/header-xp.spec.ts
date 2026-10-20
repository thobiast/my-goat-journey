import { test, expect, type Page } from '@playwright/test';
import { calculateProgress } from '../src/domain/progress';
import type { Dataset } from '../src/domain/types';

test.use({ isMobile: true, hasTouch: true, viewport: { width: 360, height: 844 } });

async function stored(page: Page): Promise<Dataset> {
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

test('Today header total XP follows real completion bonus correction and locale-aware layout', async ({
  page,
}) => {
  test.setTimeout(120_000);
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
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Start my journey', exact: true }).click();
  const xp = page.locator('.today-header .header-xp');
  const visible = xp.locator(':scope > span[aria-hidden=true]');
  const description = xp.locator('.visually-hidden');
  const icon = visible.locator('svg');
  await expect(icon).toHaveAttribute('aria-hidden', 'true');
  await expect(icon).toHaveAttribute('focusable', 'false');
  await expect(xp.getByRole('img')).toHaveCount(0);
  await expect(xp).toMatchAriaSnapshot('- text: "Total XP: 0."');
  await expect(visible).toHaveText('0 XP');
  await expect(description).toHaveText('Total XP: 0.');
  const check = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Complete my walk', exact: true }) })
    .getByRole('checkbox');
  const start = new Date('2026-09-28T12:00:00');
  for (let index = 0; index < 3; index++) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    await page.clock.setSystemTime(date);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(check).not.toBeChecked();
    await check.click();
    await expect(check).toBeChecked();
    await expect(visible).toHaveText(`${[10, 20, 40][index]} XP`);
  }
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      IDBObjectStore.prototype.put = put;
      const request = put.apply(this, args);
      this.transaction.abort();
      return request;
    };
  });
  await check.click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(check).toBeChecked();
  await expect(visible).toHaveText('40 XP');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(check).not.toBeChecked();
  await expect(visible).toHaveText('20 XP');
  await page.reload();
  await expect(visible).toHaveText('20 XP');
  await check.click();
  await expect(check).toBeChecked();
  await expect(visible).toHaveText('40 XP');
  for (let index = 3; index < 64; index++) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    await page.clock.setSystemTime(date);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(check).not.toBeChecked();
    await check.click();
    await expect(check).toBeChecked();
  }
  const date = await page.locator('.today-header time').getAttribute('datetime');
  const expected = calculateProgress(await stored(page), date!).totalXp;
  expect(expected).toBeGreaterThan(1000);
  await expect(visible).toHaveText(`${new Intl.NumberFormat('en').format(expected)} XP`);
  for (const language of ['en', 'pt'] as const) {
    if (language === 'pt') {
      await page
        .getByRole('navigation')
        .getByRole('button', { name: 'Settings', exact: true })
        .click();
      await page.getByLabel('Language', { exact: true }).selectOption('pt');
      await page.getByRole('navigation').getByRole('button', { name: 'Hoje', exact: true }).click();
    }
    const formatted = new Intl.NumberFormat(language === 'pt' ? 'pt-BR' : 'en').format(expected);
    await expect(visible).toHaveText(`${formatted} XP`);
    await expect(description).toHaveText(
      language === 'pt' ? `XP total: ${formatted}.` : `Total XP: ${formatted}.`,
    );
    for (const size of ['100%', '200%']) {
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = size;
      }, size);
      for (const width of [320, 360, 390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => window.scrollTo(0, 0));
        const titleNode = page.locator('.today-header h1');
        const title = await titleNode.boundingBox();
        const dateBox = await page.locator('.today-header time').boundingBox();
        const amount = await xp.boundingBox();
        const motto = await page.locator('.today-motto').boundingBox();
        const left = await page.locator('.today-title-date').boundingBox();
        const line = await page.locator('.today-header-line').boundingBox();
        // Date/XP may wrap; neither may overlap or shrink the shared title.
        expect(await titleNode.evaluate((n) => getComputedStyle(n).fontSize)).toBe(
          size === '200%' ? '64px' : '32px',
        );
        expect(amount!.x + amount!.width).toBeCloseTo(line!.x + line!.width, 0);

        const overlaps = (a: NonNullable<typeof title>, b: NonNullable<typeof title>) =>
          a.x < b.x + b.width &&
          a.x + a.width > b.x &&
          a.y < b.y + b.height &&
          a.y + a.height > b.y;

        expect(overlaps(title!, amount!)).toBe(false);
        expect(overlaps(dateBox!, amount!)).toBe(false);
        expect(overlaps(title!, dateBox!)).toBe(false);
        expect(motto!.y).toBeGreaterThanOrEqual(
          Math.max(
            left!.y + left!.height,
            title!.y + title!.height,
            dateBox!.y + dateBox!.height,
            amount!.y + amount!.height,
          ),
        );
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width,
        );
        expect(await visible.evaluate((n) => n.scrollWidth <= n.clientWidth + 1)).toBe(true);
        const decoration = await visible.evaluate((node) => {
          const svg = node.querySelector('svg')!;
          const value = node.querySelector('span')!;
          const i = svg.getBoundingClientRect();
          const v = value.getBoundingClientRect();
          const text = document.createRange();
          text.selectNodeContents(value);
          return {
            width: i.width,
            height: i.height,
            gap: v.left - i.right,
            centerOffset: Math.abs((i.top + i.bottom - v.top - v.bottom) / 2),
            color: getComputedStyle(svg).stroke,
            textColor: getComputedStyle(value).color,
            font: getComputedStyle(value).fontSize,
            animations: node.getAnimations({ subtree: true }).length,
            first: node.firstElementChild === svg,
            valueFits: text.getBoundingClientRect().width <= v.width + 1,
          };
        });
        expect(decoration.width).toBe(16);
        expect(decoration.height).toBe(16);
        expect(decoration.gap).toBeGreaterThanOrEqual(5);
        expect(decoration.gap).toBeLessThanOrEqual(6);
        expect(decoration.centerOffset).toBeLessThanOrEqual(1);
        expect(decoration.color).toBe(decoration.textColor);
        expect(decoration.font).toBe(size === '200%' ? '26px' : '13px');
        expect(decoration.animations).toBe(0);
        expect(decoration.first).toBe(true);
        expect(decoration.valueFits).toBe(true);
        await expect(xp).toMatchAriaSnapshot(
          `- text: "${language === 'pt' ? `XP total: ${formatted}.` : `Total XP: ${formatted}.`}"`,
        );
        await page.screenshot({
          path: `artifacts/today-header-sparkles/screenshots/${language}-${width}-text${size.replace('%', '')}.png`,
        });
      }
    }
  }
});
