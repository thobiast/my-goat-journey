import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { seedJourney } from './support/journey-data';

for (const xp of [0, 12780]) {
  test(`Journey sign order and short connectors stay associated with all five waypoints at ${xp} XP`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await seedJourney(page, xp);
    const samples: unknown[] = [];
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
      for (const size of ['100%', '150%', '200%']) {
        await page.evaluate((size) => {
          document.documentElement.style.fontSize = size;
        }, size);
        for (const width of [320, 390, 1280]) {
          await page.setViewportSize({ width, height: 900 });
          const metrics = await page.evaluate(() => {
            const map = document.querySelector<HTMLElement>('.trail-map')!;
            const frame = map.getBoundingClientRect();
            const caption = document.querySelector('.trail-continues')!.getBoundingClientRect();
            const paths = Array.from(document.querySelectorAll<SVGPathElement>('.trail-segment'));

            const pixel = (path: SVGPathElement, p: DOMPoint) =>
              new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM()!);

            const points = paths.flatMap((path) => {
              const length = path.getTotalLength();
              return Array.from({ length: 301 }, (_, i) => {
                const p = pixel(path, path.getPointAtLength((length * i) / 300));
                return { x: p.x - frame.left, y: p.y - frame.top };
              });
            });
            const waypoints = [
              ...paths.map((path) => pixel(path, path.getPointAtLength(0))),
              pixel(paths[3], paths[3].getPointAtLength(paths[3].getTotalLength())),
            ].map((p) => ({ x: p.x - frame.left, y: p.y - frame.top }));
            const signs = Array.from(document.querySelectorAll<HTMLElement>('.level-sign')).map(
              (node) => {
                const r = node.getBoundingClientRect();
                return {
                  x: (r.left + r.right) / 2 - frame.left,
                  y: (r.top + r.bottom) / 2 - frame.top,
                  width: r.width,
                  height: r.height,
                  column: getComputedStyle(node).flexDirection === 'column',
                };
              },
            );
            return {
              width: frame.width,
              height: frame.height,
              captionBottom: caption.bottom - frame.top,
              points,
              waypoints,
              signs,
            };
          });
          samples.push({ language, size, viewport: width, ...metrics });
        }
      }
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '100%';
      });
    }
    mkdirSync('artifacts/journey-waypoint-layout', { recursive: true });
    writeFileSync(
      `artifacts/journey-waypoint-layout/layout-metrics-${xp}.json`,
      JSON.stringify(samples),
    );
    for (const sample of samples as {
      language: string;
      size: string;
      viewport: number;
      width: number;
      height: number;
      signs: {
        x: number;
        y: number;
        width: number;
        height: number;
        column: boolean;
      }[];
      waypoints: { x: number; y: number }[];
      points: { x: number; y: number }[];
    }[]) {
      const previous = sample.signs[0].column
        ? [
            { x: 18, y: 72 },
            { x: 82, y: 54 },
            { x: 18, y: 36 },
            { x: 82, y: 16 },
            { x: 23, y: 17 },
          ]
        : [
            { x: 20, y: 72 },
            { x: 80, y: 54 },
            { x: 20, y: 36 },
            { x: 80, y: 14 },
            { x: 23, y: 14 },
          ];

      const gap = (
        sign: {
          x: number;
          y: number;
          width: number;
          height: number;
        },
        point: { x: number; y: number },
      ) =>
        Math.hypot(
          Math.max(sign.x - sign.width / 2 - point.x, 0, point.x - sign.x - sign.width / 2),
          Math.max(sign.y - sign.height / 2 - point.y, 0, point.y - sign.y - sign.height / 2),
        );

      // Relative layout rule, never a special case tied to level numbers 4 or 5.
      expect(sample.signs[4].y + 10).toBeLessThan(sample.signs[3].y);
      for (const [index, sign] of sample.signs.entries()) {
        expect(sign.width).toBeGreaterThanOrEqual(44);
        expect(sign.height).toBeGreaterThanOrEqual(44);
        const former = {
          ...sign,
          x: 1 + ((sample.width - 2) * previous[index].x) / 100,
          y: 1 + ((sample.height - 2) * previous[index].y) / 100,
        };
        expect(gap(sign, sample.waypoints[index]) + 3).toBeLessThan(
          gap(former, sample.waypoints[index]),
        );
        expect(Math.min(...sample.points.map((point) => gap(sign, point)))).toBeGreaterThan(21);
      }
    }
    for (const language of ['en', 'pt'] as const) {
      await page
        .getByRole('navigation')
        .getByRole('button', { name: language === 'en' ? 'Ajustes' : 'Settings', exact: true })
        .click();
      await page
        .getByLabel(language === 'en' ? 'Idioma' : 'Language', { exact: true })
        .selectOption(language);
      await expect(
        page.getByRole('heading', {
          name: language === 'en' ? 'Settings' : 'Configurações',
          exact: true,
        }),
      ).toBeVisible();
      await page
        .getByRole('navigation')
        .getByRole('button', { name: language === 'en' ? 'Journey' : 'Jornada', exact: true })
        .click();
      await page.setViewportSize({ width: 390, height: 900 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `artifacts/journey-waypoint-layout/screenshots/journey-${xp}-${language}-viewport-390.png`,
      });
      await page.locator('.trail-map').screenshot({
        path: `artifacts/journey-waypoint-layout/screenshots/map-${xp}-${language}-390.png`,
      });
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      await page.setViewportSize({ width: 320, height: 900 });
      await page.locator('.trail-map').evaluate((node) => node.scrollIntoView({ block: 'start' }));
      await page.locator('.trail-map').screenshot({
        path: `artifacts/journey-waypoint-layout/screenshots/map-${xp}-${language}-text200-320.png`,
      });
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '100%';
      });
    }
  });
}
