import { test, expect, type Page } from '@playwright/test';
import { seedJourney as seed, storedJourney as stored } from './support/journey-data';

async function expectPosition(page: Page, segment: number, fraction: number) {
  const geometry = await page.evaluate(
    ({ segment, fraction }) => {
      const path = document.querySelectorAll<SVGPathElement>('.trail-segment')[segment];
      const point = path.getPointAtLength(path.getTotalLength() * fraction);
      const target = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
      const marker = document.querySelector('.position-marker')!.getBoundingClientRect();
      return {
        dx: Math.abs(target.x - (marker.x + marker.width / 2)),
        dy: Math.abs(target.y - (marker.y + marker.height / 2)),
      };
    },
    { segment, fraction },
  );
  expect(geometry.dx).toBeLessThan(1);
  expect(geometry.dy).toBeLessThan(1);
}

test('Level 18 follows real 80 percent segment progress and level selection never moves its position or rewards', async ({
  page,
}) => {
  await seed(page, 1780);
  await expect(page.locator('.journey-level')).toHaveText('Level 18');
  await expect(page.locator('.journey-xp')).toHaveText('1,780 XP');
  await expect(page.locator('.trail-range')).toHaveText('Levels 17–21');
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '80');
  await expectPosition(page, 1, 0.8);
  await expect(page.locator('.traveled-segment').nth(1)).toHaveAttribute(
    'stroke-dasharray',
    '0.8 1',
  );
  const before = await stored(page);
  await page.getByRole('button', { name: 'Level 19 — Upcoming', exact: true }).click();
  const details = page.getByRole('status', { name: 'Selected level', exact: true });
  await expect(details).toContainText('Starts at 1,800 total XP.');
  await expect(details).toContainText('20 XP remaining.');
  await page.getByRole('button', { name: 'Level 17 — Reached', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(details).toContainText('Starts at 1,600 total XP.');
  await expect(details).not.toContainText('remaining');
  await expectPosition(page, 1, 0.8);
  await page.getByRole('button', { name: 'Previous stretch', exact: true }).click();
  await expect(page.locator('.trail-range')).toHaveText('Levels 13–17');
  await expect(page.getByRole('button', { name: 'My position', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'My position', exact: true }).click();
  await expect(page.locator('.selected-level-title')).toHaveText('Level 18');
  await expectPosition(page, 1, 0.8);
  expect(await stored(page)).toEqual(before);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: 'artifacts/trail-stretches/screenshots/level18-en-mobile-360.png',
  });
});

for (const sample of [
  { xp: 400, level: 5, start: 5, segment: 0, fraction: 0 },
  { xp: 1900, level: 20, start: 17, segment: 3, fraction: 0 },
  { xp: 2000, level: 21, start: 21, segment: 0, fraction: 0 },
  { xp: 12780, level: 128, start: 125, segment: 3, fraction: 0.8 },
]) {
  test(`Level ${sample.level} opens the correct stretch and position without a final cap`, async ({
    page,
  }) => {
    await seed(page, sample.xp);
    await expect(page.locator('.journey-level')).toHaveText(`Level ${sample.level}`);
    await expect(page.locator('.trail-range')).toHaveText(
      `Levels ${sample.start}–${sample.start + 4}`,
    );
    await expect(page.locator('.level-sign')).toHaveCount(5);
    await expectPosition(page, sample.segment, sample.fraction);
    const before = await stored(page);
    await page.getByRole('button', { name: 'Next stretch', exact: true }).click();
    await expect(page.locator('.trail-range')).toHaveText(
      `Levels ${sample.start + 4}–${sample.start + 8}`,
    );
    await expect(page.locator('.level-sign')).toHaveCount(5);
    await expect(page.getByRole('button', { name: 'My position', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Previous stretch', exact: true }).click();
    await expectPosition(page, sample.segment, sample.fraction);
    await expect(page.locator('.journey-xp')).toHaveText(
      `${new Intl.NumberFormat('en').format(sample.xp)} XP`,
    );
    expect(await stored(page)).toEqual(before);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `artifacts/trail-stretches/screenshots/level${sample.level}-en-mobile-360.png`,
    });
  });
}

test('Today correction and retry cross Level 21 to 20 and back with the correct map after reload', async ({
  page,
}) => {
  await seed(page, 2000);
  const before = await stored(page);
  await page.getByRole('navigation').getByRole('button', { name: 'Today', exact: true }).click();
  const check = page.getByRole('checkbox', { name: 'Done: Isolated commitment 199', exact: true });
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      IDBObjectStore.prototype.put = original;
      const request = original.apply(this, args);
      this.transaction.abort();
      return request;
    };
  });
  await check.click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(check).toBeChecked();
  expect(await stored(page)).toEqual(before);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(check).not.toBeChecked();
  await page.getByRole('navigation').getByRole('button', { name: 'Journey', exact: true }).click();
  await expect(page.locator('.journey-level')).toHaveText('Level 20');
  await expect(page.locator('.trail-range')).toHaveText('Levels 17–21');
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '90');
  await expectPosition(page, 3, 0.9);
  await page.getByRole('button', { name: 'Level 21 — Upcoming', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Selected level', exact: true })).toContainText(
    '10 XP remaining.',
  );
  await page.reload();
  await expect(check).not.toBeChecked();
  await check.click();
  await expect(check).toBeChecked();
  await page.getByRole('navigation').getByRole('button', { name: 'Journey', exact: true }).click();
  await expect(page.locator('.journey-level')).toHaveText('Level 21');
  await expect(page.locator('.trail-range')).toHaveText('Levels 21–25');
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '0');
  await expectPosition(page, 0, 0);
  await page.getByRole('button', { name: 'Previous stretch', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Level 21 — Current', exact: true })).toBeVisible();
  await expect(page.locator('.position-marker')).toHaveCount(0);
  await page.getByRole('button', { name: 'My position', exact: true }).click();
  await expectPosition(page, 0, 0);
  const corrected = await stored(page);
  expect(corrected.revision).toBe(before.revision + 2);
  expect({ ...corrected, revision: before.revision }).toEqual(before);
});

for (const xp of [1780, 12780]) {
  test(`trail labels, locale and touch controls remain usable for ${xp} XP on narrow and enlarged layouts`, async ({
    page,
  }) => {
    await seed(page, xp);
    const initial = await stored(page);
    for (const language of ['en', 'pt'] as const) {
      if (language === 'pt') {
        await page
          .getByRole('navigation')
          .getByRole('button', { name: 'Settings', exact: true })
          .click();
        await page.getByLabel('Language', { exact: true }).selectOption('pt');
        await expect(
          page.getByRole('heading', { name: 'Configurações', exact: true }),
        ).toBeVisible();
        await page
          .getByRole('navigation')
          .getByRole('button', { name: 'Jornada', exact: true })
          .click();
      }
      const locale = language === 'pt' ? 'pt-BR' : 'en';
      const level = xp === 1780 ? 18 : 128;
      await expect(page.locator('.journey-xp')).toHaveText(
        `${new Intl.NumberFormat(locale).format(xp)} XP`,
      );
      await expect(
        page.getByRole('group', {
          name: language === 'pt' ? 'Trilha na montanha' : 'Mountain trail',
          exact: true,
        }),
      ).toBeVisible();
      for (const size of ['100%', '200%']) {
        await page.evaluate((size) => {
          document.documentElement.style.fontSize = size;
        }, size);
        for (const width of size === '100%' ? [320, 390, 1280] : [320]) {
          await page.setViewportSize({ width, height: 900 });
          await page.evaluate(() => window.scrollTo(0, 0));
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
          const map = await page.locator('.trail-map').boundingBox();
          if (size === '100%') expect(map!.height).toBeGreaterThanOrEqual(400);
          if (size === '100%') expect(map!.height).toBeLessThanOrEqual(430);
          for (const button of await page.locator('.trail-arrow,.level-sign').all()) {
            const box = await button.boundingBox();
            expect(box!.height).toBeGreaterThanOrEqual(44);
            expect(box!.width).toBeGreaterThanOrEqual(44);
            if (await button.locator('span').count()) {
              const fits = await button.locator('span').evaluate((node) => {
                const range = document.createRange();
                range.selectNodeContents(node);
                const sign = node.parentElement!.getBoundingClientRect();
                return Array.from(range.getClientRects()).every(
                  (rect) =>
                    rect.left >= sign.left &&
                    rect.right <= sign.right &&
                    rect.top >= sign.top &&
                    rect.bottom <= sign.bottom,
                );
              });
              expect(fits).toBe(true);
            }
            if (await button.isEnabled()) {
              await button.scrollIntoViewIfNeeded();
              expect(
                await button.evaluate((node) => {
                  const r = node.getBoundingClientRect();
                  return node.contains(
                    document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
                  );
                }),
              ).toBe(true);
            }
          }
          const labels = await page.locator('.level-sign').evaluateAll((nodes) =>
            nodes.map((node) => {
              const r = node.getBoundingClientRect();
              return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
            }),
          );
          const caption = await page.locator('.trail-continues').boundingBox();
          const marker = await page.locator('.position-marker').boundingBox();
          for (const [index, label] of labels.entries()) {
            expect(label.left).toBeGreaterThanOrEqual(map!.x);
            expect(label.right).toBeLessThanOrEqual(map!.x + map!.width);
            expect(label.top).toBeGreaterThanOrEqual(caption!.y + caption!.height + 4);

            const overlaps = (a: typeof label, b: typeof label) =>
              a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

            for (const other of labels.slice(index + 1)) expect(overlaps(label, other)).toBe(false);
            expect(
              overlaps(label, {
                left: marker!.x,
                right: marker!.x + marker!.width,
                top: marker!.y,
                bottom: marker!.y + marker!.height,
              }),
            ).toBe(false);
          }
          await expectPosition(page, level === 18 ? 1 : 3, 0.8);
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({
            path: `artifacts/trail-stretches/screenshots/level${level}-${language}-${size === '200%' ? 'text200' : 'normal'}-${width}.png`,
            fullPage: true,
          });
          if (width === 390 && size === '100%')
            await page.screenshot({
              path: `artifacts/trail-stretches/screenshots/level${level}-${language}-viewport-390.png`,
            });
          if (size === '200%') {
            await page
              .locator('.trail-map')
              .evaluate((node) => node.scrollIntoView({ block: 'start' }));
            await page.locator('.trail-map').screenshot({
              path: `artifacts/trail-stretches/screenshots/level${level}-${language}-map-text200-320.png`,
            });
          }
        }
      }
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '100%';
      });
      const next = level + 1;
      await page
        .getByRole('button', {
          name: language === 'pt' ? `Nível ${next} — Futuro` : `Level ${next} — Upcoming`,
          exact: true,
        })
        .focus();
      await page.keyboard.press('Space');
      const details = page.getByRole('status', {
        name: language === 'pt' ? 'Nível selecionado' : 'Selected level',
        exact: true,
      });
      await expect(details).toContainText(language === 'pt' ? 'Faltam 20 XP.' : '20 XP remaining.');
      await expect(page.locator('.level-sign[aria-pressed=true]')).toHaveCount(1);
      await expectPosition(page, level === 18 ? 1 : 3, 0.8);
      await page.locator('.journey-help summary').click();
      await page
        .locator('.journey-reward-help')
        .evaluate((node) => node.scrollIntoView({ block: 'end' }));
      const help = await page.locator('.journey-reward-help').boundingBox();
      const navigation = await page.getByRole('navigation').boundingBox();
      expect(help!.y + help!.height).toBeLessThanOrEqual(navigation!.y);
    }
    const after = await stored(page);
    expect(after.revision).toBe(initial.revision + 1);
    expect({ ...after, revision: initial.revision, settings: initial.settings }).toEqual(initial);
  });
}

test('initial Journey shows five selectable trail signs and informational thresholds without changing records', async ({
  page,
}) => {
  await seed(page, 0);
  await expect(page.getByText('One step closer, every day.', { exact: true })).toBeVisible();
  await expect(page.locator('.trail-range')).toHaveText('Levels 1–5');
  await expect(page.locator('.trail-map .level-sign')).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Previous stretch', exact: true })).toBeDisabled();
  await expect(page.locator('.position-marker')).toBeVisible();
  await expect(page.getByText('The trail continues', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Level 3 — Upcoming', exact: true }).click();
  await expect(page.locator('.selected-level-title')).toHaveText('Level 3');
  await expect(page.locator('.selected-level-facts')).toHaveText(
    'Starts at 200 total XP. · 200 XP remaining.',
  );
  await expect(page.locator('.journey-xp')).toHaveText('0 XP');
  await page.getByRole('button', { name: 'Next stretch', exact: true }).click();
  await expect(page.locator('.trail-range')).toHaveText('Levels 5–9');
  await expect(page.locator('.position-marker')).toHaveCount(0);
  await page.getByRole('button', { name: 'My position', exact: true }).click();
  await expect(page.locator('.trail-range')).toHaveText('Levels 1–5');
  await expect(page.locator('.selected-level-title')).toHaveText('Level 1');
  await expect(page.locator('.journey-xp')).toHaveText('0 XP');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'artifacts/trail-stretches/screenshots/level1-en-mobile-360.png' });
});
