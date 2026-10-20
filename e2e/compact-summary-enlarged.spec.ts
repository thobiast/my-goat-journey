import { expandFixturePillars } from './support/management-fixtures';
import { test, expect } from '@playwright/test';

test.use({ isMobile: true, hasTouch: true, viewport: { width: 320, height: 844 } });
test('long required pillar names and inline counts do not clip any glyph at enlarged sizes in either language', async ({
  page,
}) => {
  const name = 'Música, criatividade e momentos de imaginação sem pressa';
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
  await page.getByRole('navigation').getByRole('button', { name: 'Pillars', exact: true }).click();
  await expandFixturePillars(page);
  await page.getByRole('button', { name: 'New pillar', exact: true }).click();
  await page.getByLabel('Pillar name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Save pillar', exact: true }).click();
  await expandFixturePillars(page, [name]);
  await page
    .getByRole('region', { name, exact: true })
    .getByRole('button', { name: 'Add habit', exact: true })
    .click();
  await page.getByLabel('What do you want to do?').fill('Practice a tune at my own pace');
  await page.getByRole('button', { name: 'Save habit', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Today', exact: true }).click();
  await page.clock.setSystemTime(new Date('2026-09-29T12:00:00'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('.today-header time[datetime="2026-09-29"]')).toBeVisible();
  for (const language of ['en', 'pt'] as const) {
    if (language === 'pt') {
      await page
        .getByRole('navigation')
        .getByRole('button', { name: 'Settings', exact: true })
        .click();
      await page.getByLabel('Language', { exact: true }).selectOption('pt');
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(page.viewportSize()!.width);
      await page.getByRole('navigation').getByRole('button', { name: 'Hoje', exact: true }).click();
    }
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    for (const width of [320, 360, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const card = page
        .getByRole('list', { name: /^(Pillar summary|Resumo dos pilares)$/ })
        .getByRole('listitem')
        .filter({ has: page.getByRole('heading', { name, exact: true }) });
      const heading = card.getByRole('heading', { name, exact: true });
      const count = card.locator('.summary-count');
      await expect(count.locator('[aria-hidden=true]')).toHaveText('0/1');
      await expect(count.locator('.visually-hidden')).toHaveText(
        language === 'en' ? '0 of 1 habits completed' : '0 de 1 hábitos concluídos',
      );
      await expect(heading).toHaveText(name);
      const h = await heading.boundingBox();
      const c = await count.boundingBox();
      const tile = await card.boundingBox();
      for (const box of [h!, c!]) {
        expect(box.x).toBeGreaterThanOrEqual(tile!.x - 1);
        expect(box.x + box.width).toBeLessThanOrEqual(tile!.x + tile!.width + 1);
        expect(box.y).toBeGreaterThanOrEqual(tile!.y - 1);
        expect(box.y + box.height).toBeLessThanOrEqual(tile!.y + tile!.height + 1);
      }

      const intersects = (a: NonNullable<typeof h>, b: NonNullable<typeof h>) =>
        a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

      expect(intersects(h!, c!)).toBe(false);
      expect(
        await heading.evaluate((node) => {
          const tile = node.closest('.summary-tile')!.getBoundingClientRect();
          const count = node
            .closest('.summary-tile')!
            .querySelector('.summary-count')!
            .getBoundingClientRect();
          const text = node.firstChild!;
          for (let index = 0; index < (text.textContent?.length ?? 0); index++) {
            const range = document.createRange();
            range.setStart(text, index);
            range.setEnd(text, index + 1);
            const r = range.getBoundingClientRect();
            if (
              r.width > 0 &&
              (r.left < tile.left - 1 ||
                r.right > tile.right + 1 ||
                r.top < tile.top - 1 ||
                r.bottom > tile.bottom + 1)
            )
              return false;
            if (
              r.width > 0 &&
              r.left < count.right &&
              r.right > count.left &&
              r.top < count.bottom &&
              r.bottom > count.top
            )
              return false;
          }
          return true;
        }),
      ).toBe(true);
      expect(
        await count
          .locator('[aria-hidden=true]')
          .evaluate((n) => n.scrollWidth <= n.clientWidth + 1),
      ).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await card.evaluate((n) => n.scrollIntoView({ block: 'start' }));
      await page.screenshot({
        path: `artifacts/compact-summary-bonus/required-long-text200-${language}-${width}.png`,
      });
    }
  }
});
