import { test, expect, type Page } from '@playwright/test';
import en from '../src/i18n/en.json' with { type: 'json' };
import pt from '../src/i18n/pt.json' with { type: 'json' };
import { setupScheduledHabits, readDataset, nav } from './support/habit-fixtures';
import { makeHabit } from '../src/domain/creation';
import { updateCompletion } from '../src/domain/completion';
import type { Dataset } from '../src/domain/types';

test.setTimeout(60_000);
let base: Dataset;
const longGoal =
  'Walk around the neighborhood, notice the trees and return at my own comfortable pace, without comparing my progress with anyone else';
const customName = 'Música, criatividade e momentos de imaginação sem pressa';
test.beforeAll(async ({ browser }, info) => {
  info.setTimeout(90_000);
  const page = await browser.newPage();
  try {
    await setupScheduledHabits(page);
    base = await readDataset(page);
    base.pillars.push(
      { id: 'creative', name: customName },
      { id: 'quiet', name: 'Quiet reflection' },
    );
    base.habits.push(
      makeHabit({ pillarId: 'body', goal: longGoal, weekdays: [1, 3, 5] }, '2026-09-27', base),
    );
    base.habits.push(
      makeHabit(
        {
          pillarId: 'creative',
          goal: 'Play a favorite melody slowly and enjoy the practice',
          weekdays: [1, 3, 5],
        },
        '2026-09-27',
        base,
      ),
    );
    updateCompletion(base, base.habits[0].id, '2026-09-28', true, new Date('2026-09-28T12:00:00'));
  } finally {
    await page.close();
  }
});

async function install(page: Page, language: 'en' | 'pt') {
  const data = structuredClone(base);
  data.settings.language = language;
  await page.clock.install({ time: new Date('2026-09-28T12:00:00') });
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  await page.evaluate(
    (data) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('my-goat-journey');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('dataset', 'readwrite');
          tx.objectStore('dataset').put(data, 'current');
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
    data,
  );
  await page.reload();
  await expect(page.locator('.today-header')).toBeVisible();
}

for (const language of ['en', 'pt'] as const)
  for (const width of [320, 390, 430, 1280])
    for (const text of [100, 200]) {
      test(`Field Notes Today ${language} ${width}px text${text}`, async ({ page }) => {
        const copy = language === 'en' ? en : pt;
        await page.setViewportSize({ width, height: 900 });
        await install(page, language);
        await page.addStyleTag({ content: `html {font-size:${text}%}` });
        await expect(page.locator('.today-progress')).toContainText(copy.todayProgressTitle);
        await expect(page.locator('.today-count')).toContainText(
          copy.todayCompletionCount.replace('{done}', '1').replace('{total}', '6'),
        );
        await expect(page.locator('.today-progress-circle')).toHaveText('17%');
        const summary = page.getByRole('list', { name: copy.pillarSummary });
        await expect(summary.getByRole('listitem')).toHaveCount(6);
        const quiet = summary
          .getByRole('listitem')
          .filter({ has: page.getByRole('heading', { name: 'Quiet reflection', exact: true }) });
        await expect(quiet).toContainText(copy.noHabitsToday);
        await expect(quiet).not.toContainText('0/0');
        await expect(quiet.locator('.pillar-day-status')).toHaveCount(0);
        await expect(summary.locator('a,button,[tabindex]')).toHaveCount(0);
        expect(
          await page.locator('body').evaluate((n) => getComputedStyle(n).backgroundColor),
        ).toBe('rgb(248, 246, 241)');
        expect(
          await summary.locator('.body .pillar-icon').evaluate((n) => getComputedStyle(n).color),
        ).toBe('rgb(139, 70, 81)');
        if (text === 100)
          expect(
            await summary.evaluate(
              (n) => getComputedStyle(n).gridTemplateColumns.split(' ').length,
            ),
          ).toBe(2);
        const row = page
          .locator('.today-goal')
          .filter({ has: page.getByRole('heading', { name: longGoal, exact: true }) });
        const goal = row.getByRole('heading');
        expect(await goal.evaluate((n) => parseFloat(getComputedStyle(n).fontSize))).toBe(
          (16 * text) / 100,
        );
        const title = await goal.boundingBox();
        const control = await row.locator('.habit-check').boundingBox();
        expect(control!.x).toBeGreaterThanOrEqual(title!.x + title!.width);
        expect(Math.abs(control!.y - title!.y)).toBeLessThanOrEqual(8);
        expect(control!.width).toBeGreaterThanOrEqual(44);
        expect(control!.height).toBeGreaterThanOrEqual(44);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({
          path: `artifacts/today-colored-groups/screenshots/${language}-${width}-text${text}-summary.png`,
        });
        await row.locator('..').evaluate((n) => n.scrollIntoView({ block: 'start' }));
        await page.screenshot({
          path: `artifacts/today-colored-groups/screenshots/${language}-${width}-text${text}-habits.png`,
        });
        const headerLayout = await page
          .locator('.today-pillar .pillar-header')
          .evaluateAll((headers) =>
            headers.map((header) => {
              const box = header.getBoundingClientRect();
              const name = header.querySelector('h2')!.getBoundingClientRect();
              const status = header.querySelector('.today-pillar-status')!.getBoundingClientRect();
              const style = getComputedStyle(header);

              const color = (value: string) =>
                value
                  .match(/[\d.]+/g)!
                  .slice(0, 3)
                  .map(Number);

              const luminance = (rgb: number[]) =>
                rgb
                  .map((c) => c / 255)
                  .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
                  .reduce((sum, c, index) => sum + c * [0.2126, 0.7152, 0.0722][index], 0);

              const a = luminance(color(style.backgroundColor));
              const b = luminance(color(style.color));
              return {
                contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
                contained: status.right <= box.right && name.right <= box.right,
                body: header.closest('.body') !== null,
                sameRow: Math.abs(name.y - status.y) < 8,
              };
            }),
          );
        for (const header of headerLayout) {
          expect(header.contrast).toBeGreaterThanOrEqual(4.5);
          expect(header.contained).toBe(true);
          if (text === 100 && header.body) expect(header.sameRow).toBe(true);
        }
        const neutralSurface = await row.evaluate((n) => getComputedStyle(n).backgroundColor);
        const checkbox = row.getByRole('checkbox');
        await checkbox.focus();
        await page.keyboard.press('Space');
        await expect(checkbox).toBeChecked();
        await expect(checkbox).toBeEnabled();
        await expect(checkbox).toBeFocused();
        expect(await checkbox.evaluate((n) => getComputedStyle(n).outlineStyle)).toBe('solid');
        expect(await row.evaluate((n) => getComputedStyle(n).backgroundColor)).toBe(neutralSurface);
        await row.locator('..').evaluate((n) => n.scrollIntoView({ block: 'start' }));
        await page.screenshot({
          path: `artifacts/today-colored-groups/screenshots/${language}-${width}-text${text}-checked.png`,
        });
        await page.keyboard.press('Space');
        await expect(checkbox).not.toBeChecked();
        await page
          .getByRole('region', { name: customName, exact: true })
          .evaluate((n) => n.scrollIntoView({ block: 'start' }));
        await page.screenshot({
          path: `artifacts/today-colored-groups/screenshots/${language}-${width}-text${text}-custom.png`,
        });
        const add = page.getByRole('button', { name: copy.addHabit, exact: true });
        await add.evaluate((n) => n.scrollIntoView({ block: 'end' }));
        await expect
          .poll(async () => {
            const b = await add.boundingBox();
            const nav = await page.getByRole('navigation').boundingBox();
            return b!.y + b!.height <= nav!.y;
          })
          .toBe(true);
        expect(await page.getByRole('navigation').getByRole('button').allTextContents()).toEqual([
          copy.today,
          copy.pillars,
          copy.journey,
          copy.progress,
          copy.settingsNav,
        ]);
        const before = await readDataset(page);
        await nav(page, copy.pillars).click();
        await nav(page, copy.journey).click();
        await nav(page, copy.progress).click();
        await nav(page, copy.settingsNav).click();
        expect(
          await page.locator('body').evaluate((n) => getComputedStyle(n).backgroundColor),
        ).not.toBe('rgb(248, 246, 241)');
        expect(await readDataset(page)).toEqual(before);
      });
    }
