import { test, expect, type Locator, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import en from '../src/i18n/en.json' with { type: 'json' };
import pt from '../src/i18n/pt.json' with { type: 'json' };
import { setupScheduledHabits, readDataset, nav } from './support/habit-fixtures';
import { makeHabit } from '../src/domain/creation';
import { updateCompletion } from '../src/domain/completion';
import type { Dataset } from '../src/domain/types';

const customName = 'Music, creativity and unhurried moments of imagination';
const emptyName = 'Quiet reflection';
const palette = {
  mind: ['rgb(232, 222, 243)', 'rgb(98, 81, 125)'],
  body: ['rgb(239, 217, 222)', 'rgb(139, 70, 81)'],
  nutrition: ['rgb(239, 224, 203)', 'rgb(129, 89, 50)'],
  hygiene: ['rgb(217, 233, 241)', 'rgb(56, 107, 133)'],
};
let fixture: Dataset;
test.setTimeout(90_000);
test.beforeAll(async ({ browser }, info) => {
  info.setTimeout(90_000);
  const page = await browser.newPage();
  try {
    await setupScheduledHabits(page);
    fixture = await readDataset(page);
    fixture.pillars.push({ id: 'creative', name: customName }, { id: 'quiet', name: emptyName });
    fixture.habits.push(
      makeHabit(
        { pillarId: 'creative', goal: 'Play a favorite melody', weekdays: [1, 3, 5] },
        '2026-09-27',
        fixture,
      ),
    );
    updateCompletion(
      fixture,
      fixture.habits[0].id,
      '2026-09-28',
      true,
      new Date('2026-09-28T12:00:00'),
    );
  } finally {
    await page.close();
  }
});

async function install(page: Page, language: 'en' | 'pt') {
  const data = structuredClone(fixture);
  data.settings.language = language;
  await page.clock.install({ time: new Date('2026-09-28T12:00:00') });
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  await page.evaluate(
    (data) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('my-goat-journey');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
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

async function iconFacts(icon: Locator) {
  return icon.evaluate((node) => {
    const svg = node.querySelector('svg')!;
    const box = node.getBoundingClientRect();
    const glyph = svg.getBoundingClientRect();
    const style = getComputedStyle(node);
    const parent = getComputedStyle(node.closest('.pillar-header') ?? node.parentElement!);
    const ctx = document.createElement('canvas').getContext('2d')!;

    function rgba(color: string) {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    }

    const foreground = rgba(style.color);
    const tint = rgba(style.backgroundColor);
    const base = rgba(parent.backgroundColor);
    const background = tint
      .slice(0, 3)
      .map((c, i) => (c * tint[3]) / 255 + base[i] * (1 - tint[3] / 255));

    function luminance(rgb: number[]) {
      return rgb
        .slice(0, 3)
        .map((c) => c / 255)
        .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
        .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    }

    function contrast(a: number[], b: number[]) {
      const x = luminance(a);
      const y = luminance(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    }

    return {
      background: style.backgroundColor,
      color: style.color,
      radius: style.borderRadius,
      width: box.width,
      height: box.height,
      glyphWidth: glyph.width,
      glyphHeight: glyph.height,
      centered:
        Math.abs(glyph.x + glyph.width / 2 - box.x - box.width / 2) < 0.1 &&
        Math.abs(glyph.y + glyph.height / 2 - box.y - box.height / 2) < 0.1,
      contrast: contrast(foreground, background),
      headerContrast: contrast(rgba(parent.color), base),
      alpha: tint[3] / 255,
    };
  });
}

async function verifyIcons(scope: Locator, size: number, glyph: number, colored = false) {
  const icons = scope.locator('.pillar-icon');
  expect(await icons.count()).toBeGreaterThan(0);
  for (const icon of await icons.all()) {
    const facts = await iconFacts(icon);
    expect(facts.width).toBe(size);
    expect(facts.height).toBe(size);
    expect(facts.glyphWidth).toBe(glyph);
    expect(facts.glyphHeight).toBe(glyph);
    expect(facts.radius).toBe('11px');
    expect(facts.centered).toBe(true);
    expect(facts.contrast).toBeGreaterThanOrEqual(3);
    if (colored) {
      expect(facts.alpha).toBeGreaterThan(0);
      expect(facts.alpha).toBeLessThan(0.3);
      expect(facts.headerContrast).toBeGreaterThanOrEqual(4.5);
    }
    await expect(icon.locator('svg')).toHaveAttribute('aria-hidden', 'true');
    await expect(icon.locator('svg')).toHaveAttribute('focusable', 'false');
    await expect(icon.locator('svg')).toHaveAttribute('stroke-width', '1.8');
    await expect(icon).not.toHaveAttribute('role', 'button');
  }
  if (!colored)
    for (const [key, [background, color]] of Object.entries(palette)) {
      const matching = scope.locator(`.${key} .pillar-icon`);
      expect(await matching.count()).toBeGreaterThan(0);
      for (const icon of await matching.all()) {
        await expect(icon).toHaveCSS('background-color', background);
        await expect(icon).toHaveCSS('color', color);
      }
    }
}

async function contained(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const escaped = await page
    .locator(
      '.pillar-icon, .summary-count, .pillar-title h2, .today-pillar-status, .management-pillar-header button',
    )
    .evaluateAll((nodes) =>
      nodes
        .filter((n) => {
          const box = n.getBoundingClientRect();
          return box.left < 0 || box.right > innerWidth + 1 || n.scrollWidth > n.clientWidth + 1;
        })
        .map((n) => n.className),
    );
  expect(escaped).toEqual([]);
}

for (const language of ['en', 'pt'] as const)
  for (const width of [320, 390, 1280])
    for (const text of [100, 200]) {
      test(`pillar icon surfaces ${language} ${width}px text${text}`, async ({ page }) => {
        const copy = language === 'en' ? en : pt;
        const prefix = `artifacts/pillar-icon-surfaces/screenshots/${language}-${width}-text${text}`;
        await page.setViewportSize({ width, height: 900 });
        await install(page, language);
        await page.addStyleTag({ content: `html { font-size: ${text}% }` });
        const today = page.locator('.today-page');
        await expect(today.locator('.summary-tile')).toHaveCount(6);
        await verifyIcons(today.locator('.summary-shell'), 36, 21);
        await verifyIcons(today.locator('.today-pillar'), 36, 21, true);
        await expect(
          today.locator('.summary-tile.custom').filter({ hasText: emptyName }),
        ).toContainText(copy.noHabitsToday);
        await expect(today.locator('.today-pillar.mind .today-pillar-status')).toHaveText(
          copy.todayGroupCompletedCountOne.replace('{done}', '1').replace('{total}', '1'),
        );
        await expect(today.locator('.today-pillar.mind .today-pillar-status svg')).toHaveCount(1);
        await contained(page);
        const custom = await iconFacts(today.locator('.summary-tile.custom .pillar-icon').first());
        const before = await today
          .locator('.pillar-icon')
          .evaluateAll((nodes) =>
            nodes.map((n) => [getComputedStyle(n).backgroundColor, getComputedStyle(n).color]),
          );
        const group = today.locator('.today-pillar.body');
        const row = group.locator('.today-goal');
        const checkbox = row.getByRole('checkbox');
        const surface = await row.evaluate((n) => getComputedStyle(n).backgroundColor);
        await checkbox.focus();
        await page.keyboard.press('Space');
        await expect(checkbox).toBeChecked();
        await expect(checkbox).toBeEnabled();
        await expect(checkbox).toBeFocused();
        await expect(group.locator('.today-pillar-status svg')).toHaveCount(1);
        expect(await row.evaluate((n) => getComputedStyle(n).backgroundColor)).toBe(surface);
        expect(
          await today
            .locator('.pillar-icon')
            .evaluateAll((nodes) =>
              nodes.map((n) => [getComputedStyle(n).backgroundColor, getComputedStyle(n).color]),
            ),
        ).toEqual(before);
        await page.keyboard.press('Space');
        await expect(checkbox).not.toBeChecked();
        await expect(checkbox).toBeEnabled();
        expect(
          await today
            .locator('.pillar-icon')
            .evaluateAll((nodes) =>
              nodes.map((n) => [getComputedStyle(n).backgroundColor, getComputedStyle(n).color]),
            ),
        ).toEqual(before);
        await page.screenshot({ path: `${prefix}-today.png`, fullPage: true });
        writeFileSync(
          `${prefix}-contrast.json`,
          JSON.stringify(
            {
              neutral: await Promise.all(
                (await today.locator('.summary-tile .pillar-icon').all()).map(iconFacts),
              ),
              colored: await Promise.all(
                (await today.locator('.today-pillar .pillar-icon').all()).map(iconFacts),
              ),
            },
            null,
            2,
          ),
        );
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({ path: `${prefix}-today-summary-viewport.png` });
        await today
          .locator('.today-pillar.mind')
          .evaluate((n) => n.scrollIntoView({ block: 'start' }));
        await page.screenshot({ path: `${prefix}-today-groups-viewport.png` });
        const saved = await readDataset(page);
        expect(saved.pillars).toEqual(fixture.pillars);
        await nav(page, copy.progress).click();
        await expect(page.locator('.consistency-card')).toHaveCount(5);
        await verifyIcons(page.locator('#progress-cards'), 40, 22);
        await contained(page);
        // Habit icons continue to identify their parent pillar, including custom identities.
        expect(
          (await iconFacts(page.locator('.consistency-card.custom .pillar-icon'))).background,
        ).toBe(custom.background);
        expect((await iconFacts(page.locator('.consistency-card.custom .pillar-icon'))).color).toBe(
          custom.color,
        );
        await page.screenshot({ path: `${prefix}-progress-habits.png`, fullPage: true });
        await page
          .locator('.consistency-card.custom')
          .evaluate((n) => n.scrollIntoView({ block: 'start' }));
        await page.screenshot({ path: `${prefix}-progress-custom-viewport.png` });
        await page.getByRole('tab', { name: copy.pillars, exact: true }).click();
        await expect(page.locator('.consistency-card')).toHaveCount(7);
        await verifyIcons(page.locator('#progress-cards'), 40, 22);
        await contained(page);
        await page.screenshot({ path: `${prefix}-progress-pillars.png`, fullPage: true });
        await nav(page, copy.pillars).click();
        await verifyIcons(page.locator('.pillars-management-page'), 36, 21);
        await contained(page);
        // Enlarged names must retain complete words, not merely avoid page overflow.
        const splitWords = await page
          .locator('.pillar-disclosure > span:nth-child(2)')
          .evaluateAll((names) =>
            names.flatMap((name) => {
              const text = name.firstChild!;
              return [...text.textContent!.matchAll(/\S+/g)]
                .filter((match) => {
                  const range = document.createRange();
                  range.setStart(text, match.index!);
                  range.setEnd(text, match.index! + match[0].length);
                  return range.getClientRects().length !== 1;
                })
                .map((match) => match[0]);
            }),
          );
        expect(splitWords).toEqual([]);
        const empty = page.getByRole('region', { name: emptyName, exact: true });
        await empty.getByRole('button', { name: emptyName, exact: true }).click();
        await expect(empty).toContainText(copy.noHabitsYet);
        for (const control of await page.locator('.pillar-disclosure, .action-trigger').all()) {
          const box = await control.boundingBox();
          expect(box!.width).toBeGreaterThanOrEqual(44);
          expect(box!.height).toBeGreaterThanOrEqual(44);
        }
        expect(
          (await iconFacts(page.locator('.management-pillar.custom .pillar-icon').first()))
            .background,
        ).toBe(custom.background);
        expect(
          (await iconFacts(page.locator('.management-pillar.custom .pillar-icon').first())).color,
        ).toBe(custom.color);
        await page.screenshot({ path: `${prefix}-pillars.png`, fullPage: true });
        await page
          .getByRole('region', { name: customName, exact: true })
          .evaluate((n) => n.scrollIntoView({ block: 'start' }));
        await page.screenshot({ path: `${prefix}-pillars-custom-viewport.png` });
        expect(await readDataset(page)).toEqual(saved);
      });
    }
