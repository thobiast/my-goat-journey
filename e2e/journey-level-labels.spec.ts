import { test, expect } from '@playwright/test';
import { seedJourney, storedJourney } from './support/journey-data';

test('three-digit signs fit without shrinking or covering the trail and position at narrow and enlarged sizes', async ({
  page,
}) => {
  // This isolated fixture intentionally renders over a thousand habits.
  test.setTimeout(90_000);
  await seedJourney(page, 12780);
  for (const language of ['en', 'pt'] as const) {
    if (language === 'pt') {
      await page
        .getByRole('navigation')
        .getByRole('button', { name: 'Settings', exact: true })
        .click();
      await page.getByLabel('Language', { exact: true }).selectOption('pt');
      await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
      await page
        .getByRole('navigation')
        .getByRole('button', { name: 'Jornada', exact: true })
        .click();
    }
    for (const size of ['100%', '200%']) {
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = size;
      }, size);
      for (const width of size === '100%' ? [320, 390, 1280] : [320, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect(page.locator('.level-sign > span')).toHaveText(
          Array.from(
            { length: 5 },
            (_, i) => `${language === 'pt' ? 'Nível' : 'Level'} ${125 + i}`,
          ),
        );
        const checks = await page.evaluate(() => {
          const map = document.querySelector('.trail-map')!.getBoundingClientRect();
          const caption = document.querySelector('.trail-continues')!.getBoundingClientRect();
          const paths = Array.from(document.querySelectorAll<SVGPathElement>('.trail-segment'));
          const points = paths.flatMap((path) => {
            const length = path.getTotalLength();
            const matrix = path.getScreenCTM()!;
            return Array.from({ length: 301 }, (_, i) => {
              const p = path.getPointAtLength((length * i) / 300);
              return new DOMPoint(p.x, p.y).matrixTransform(matrix);
            });
          });
          const rectangles = Array.from(document.querySelectorAll('.level-sign')).map((node) =>
            node.getBoundingClientRect(),
          );
          const font = parseFloat(getComputedStyle(document.documentElement).fontSize);
          return rectangles.map((r, index) => {
            const node = document.querySelectorAll('.level-sign')[index];
            const label = node.querySelector('span')!;
            const text = label.firstChild!;
            const prefix = label.textContent!.split(' ')[0];
            const range = document.createRange();
            range.setStart(text, 0);
            range.setEnd(text, prefix.length);
            const distance = Math.min(
              ...points.map((p) =>
                Math.hypot(
                  Math.max(r.left - p.x, 0, p.x - r.right),
                  Math.max(r.top - p.y, 0, p.y - r.bottom),
                ),
              ),
            );
            return {
              index,
              width: r.width,
              height: r.height,
              inside:
                r.left >= map.left + 1 &&
                r.right <= map.right - 1 &&
                r.top >= caption.bottom + 4 &&
                r.bottom <= map.bottom - 1,
              prefixLines: range.getClientRects().length,
              font: parseFloat(getComputedStyle(node).fontSize),
              expectedFont: font * 0.875,
              distance,
            };
          });
        });
        for (const item of checks) {
          expect(item.inside).toBe(true);
          expect(item.width).toBeGreaterThanOrEqual(44);
          expect(item.height).toBeGreaterThanOrEqual(44);
          expect(item.font).toBe(item.expectedFont);
          expect(item.prefixLines).toBe(1);
          // Keep every point of the actual trail clear, including a 19px position circle.
          expect(item.distance).toBeGreaterThan(21);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path: `artifacts/journey-level-labels/screenshots/level128-${language}-${size === '200%' ? 'text200' : 'normal'}-${width}.png`,
          fullPage: true,
        });
        if (width === 390 && size === '100%')
          await page.screenshot({
            path: `artifacts/journey-level-labels/screenshots/level128-${language}-viewport-390.png`,
          });
        if (size === '200%') {
          await page
            .locator('.trail-map')
            .evaluate((node) => node.scrollIntoView({ block: 'start' }));
          await page.locator('.trail-map').screenshot({
            path: `artifacts/journey-level-labels/screenshots/level128-${language}-map-text200-${width}.png`,
          });
        }
      }
    }
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '100%';
    });
  }
});

const expectedHelp = {
  en: [
    'Complete all required habits scheduled for a day, across all pillars, to increase your daily streak. It increases at most once per day.',
    'Days with no required habits are neutral: they neither increase nor break your daily streak. Completing an optional habit on the day you create it can make that day count.',
    'Today stays pending while required habits remain incomplete. If any are still incomplete when your local day ends, your daily streak breaks.',
    'Habit completions earn XP, with bonus XP at habit streak milestones. Every 100 XP advances your level. Pillar and daily streaks do not award extra XP.',
    'Checking or unchecking a completion recalculates XP, your level, and current and best streaks.',
  ],
  pt: [
    'Conclua todos os hábitos obrigatórios programados para o dia, de todos os pilares, para aumentar sua sequência diária. Ela aumenta no máximo uma vez por dia.',
    'Dias sem hábitos obrigatórios são neutros: não aumentam nem interrompem sua sequência diária. Concluir um hábito opcional no dia em que você o cria pode fazer esse dia contar.',
    'Hoje continua pendente enquanto houver hábitos obrigatórios não concluídos. Se algum permanecer incompleto quando o dia terminar no horário local do dispositivo, sua sequência diária será interrompida.',
    'Concluir hábitos gera XP, com bônus nos marcos da sequência de cada hábito. A cada 100 XP, você avança um nível. As sequências dos pilares e a sequência diária não concedem XP adicional.',
    'Marcar ou desmarcar uma conclusão recalcula o XP, seu nível, as sequências atuais e os recordes.',
  ],
};

test('progression help preserves the exact localized five-paragraph explanation', async ({
  page,
}) => {
  await seedJourney(page, 1780);
  const before = await storedJourney(page);
  for (const language of ['en', 'pt'] as const) {
    if (language === 'pt') {
      await page
        .getByRole('navigation')
        .getByRole('button', { name: 'Settings', exact: true })
        .click();
      await page.getByLabel('Language', { exact: true }).selectOption('pt');
      await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
      await page
        .getByRole('navigation')
        .getByRole('button', { name: 'Jornada', exact: true })
        .click();
    }
    const help = page.locator('.journey-help');
    await expect(help.locator('summary')).toHaveText(
      language === 'pt' ? 'Como funciona a progressão' : 'How progression works',
    );
    await help.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(help).toHaveAttribute('open', '');
    await expect(help.locator(':scope > p')).toHaveCount(5);
    await expect(help.locator(':scope > p')).toHaveText(expectedHelp[language]);
    await page.setViewportSize({ width: 320, height: 900 });
    await help.evaluate((node) => node.scrollIntoView({ block: 'start' }));
    await page.screenshot({
      path: `artifacts/journey-level-labels/screenshots/help-${language}-320.png`,
      fullPage: true,
    });
    await help.locator('summary').click();
    await expect(help).not.toHaveAttribute('open', '');
  }
  const after = await storedJourney(page);
  expect(after.revision).toBe(before.revision + 1);
  expect({ ...after, revision: before.revision, settings: before.settings }).toEqual(before);
});

test('map signs show localized Level labels while selection stays informational', async ({
  page,
}) => {
  await seedJourney(page, 0);
  const before = await storedJourney(page);
  for (const language of ['en', 'pt'] as const) {
    if (language === 'pt') {
      await page
        .getByRole('navigation')
        .getByRole('button', { name: 'Settings', exact: true })
        .click();
      await page.getByLabel('Language', { exact: true }).selectOption('pt');
      await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
      await page
        .getByRole('navigation')
        .getByRole('button', { name: 'Jornada', exact: true })
        .click();
    }
    await expect(page.locator('.level-sign > span')).toHaveText(
      Array.from({ length: 5 }, (_, i) => `${language === 'pt' ? 'Nível' : 'Level'} ${i + 1}`),
    );
    const position = await page.locator('.position-marker').getAttribute('style');
    await page
      .getByRole('button', {
        name: language === 'pt' ? 'Nível 3 — Futuro' : 'Level 3 — Upcoming',
        exact: true,
      })
      .click();
    await expect(page.locator('.level-sign.current')).toHaveAttribute('aria-pressed', 'false');
    expect(await page.locator('.position-marker').getAttribute('style')).toBe(position);
    await expect(page.locator('.journey-xp')).toHaveText('0 XP');
  }
  const after = await storedJourney(page);
  expect(after.revision).toBe(before.revision + 1);
  expect({ ...after, revision: before.revision, settings: before.settings }).toEqual(before);
});
