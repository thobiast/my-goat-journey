import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import en from '../src/i18n/en.json' with { type: 'json' };
import pt from '../src/i18n/pt.json' with { type: 'json' };

const environment = (process.env.BASE_URL ?? '').includes('runtime') ? 'runtime' : 'development';
const root = `artifacts/onboarding/${environment}`;

async function checkLayout(page: Page) {
  const geometry = await page.evaluate(() => {
    const controls = Array.from(document.querySelectorAll<HTMLElement>('button,select,textarea'))
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => {
        const box = el.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(el);
        const textInside =
          el.tagName !== 'BUTTON' ||
          Array.from(range.getClientRects()).every(
            (rect) => rect.left >= box.left - 0.5 && rect.right <= box.right + 0.5,
          );
        let wholeWords = true;
        if (el.tagName === 'BUTTON') {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          while (walker.nextNode())
            for (const word of walker.currentNode.textContent!.matchAll(/\S+/g)) {
              range.setStart(walker.currentNode, word.index!);
              range.setEnd(walker.currentNode, word.index! + word[0].length);
              if (range.getClientRects().length > 1) wholeWords = false;
            }
        }
        return { width: box.width, height: box.height, textInside, wholeWords };
      });
    return { overflow: document.documentElement.scrollWidth > innerWidth, controls };
  });
  expect(geometry.overflow).toBe(false);
  for (const control of geometry.controls) {
    expect(control.width).toBeGreaterThanOrEqual(44);
    expect(control.height).toBeGreaterThanOrEqual(44);
    expect(control.textInside).toBe(true);
    expect(control.wholeWords).toBe(true);
  }
}

for (const language of ['en', 'pt'] as const)
  for (const text of [100, 200])
    for (const width of [320, 375, 390, 393, 402, 430, 440, 1280]) {
      test(`onboarding responsive ${language} ${width}px text${text}`, async ({ page }) => {
        const copy = language === 'en' ? en : pt;
        const stem = `${language}-${width}-text${text}`;
        mkdirSync(`${root}/screenshots`, { recursive: true });
        await page.setViewportSize({ width, height: 900 });
        await page.clock.install({ time: new Date('2026-10-07T12:00:00') });
        await page.goto('./');
        await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
        if (language === 'pt')
          await page.getByLabel('Language', { exact: true }).selectOption('pt');
        if (text === 200)
          await page.addStyleTag({ content: 'html { font-size: 32px !important; }' });
        await expect(page.getByRole('heading', { name: copy.welcome, exact: true })).toBeVisible();
        const logo = await page
          .getByRole('img', { name: 'My GOAT Journey', exact: true })
          .boundingBox();
        expect(logo).not.toBeNull();
        expect(logo!.width).toBeLessThanOrEqual(128);
        expect(Math.abs(logo!.width - logo!.height)).toBeLessThan(0.1);
        const field = await page.getByLabel(copy.language, { exact: true }).boundingBox();
        const start = await page
          .getByRole('button', { name: copy.start, exact: true })
          .boundingBox();
        expect(start!.y - (field!.y + field!.height)).toBeGreaterThanOrEqual(12);
        await checkLayout(page);
        await page.screenshot({ path: `${root}/screenshots/welcome-${stem}.png`, fullPage: true });
        await page.getByRole('button', { name: copy.start, exact: true }).click();
        await expect(page.getByRole('heading', { name: copy.mind, exact: true })).toBeVisible();
        const goal = page.getByLabel(copy.goal, { exact: true });
        const before = await goal.boundingBox();
        const font = await goal.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
        expect(before!.height).toBeLessThanOrEqual(font * 7);
        await page.getByRole('button', { name: copy.continue, exact: true }).click();
        await expect(goal).toBeFocused();
        await expect(page.getByRole('alert')).toHaveText(copy.onboardingGoalError);
        await checkLayout(page);
        await page.screenshot({
          path: `${root}/screenshots/validation-${stem}.png`,
          fullPage: true,
        });
        await goal.fill(
          language === 'en' ? 'Read 20 pages of my book' : 'Ler 20 páginas do meu livro',
        );
        await goal.focus();
        await page.keyboard.press('Tab');
        expect(
          await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle),
        ).not.toBe('none');
        const rows = await page.locator('.weekdays button').evaluateAll((buttons) => {
          const groups: Record<string, number> = {};
          const widths = buttons.map((button) => {
            const box = button.getBoundingClientRect();
            const y = String(Math.round(box.y));
            groups[y] = (groups[y] ?? 0) + 1;
            return box.width;
          });
          return {
            counts: Object.values(groups),
            max: Math.max(...widths),
            min: Math.min(...widths),
          };
        });
        expect(rows.counts).toEqual(rows.counts.length === 1 ? [7] : [4, 3]);
        expect(rows.max - rows.min).toBeLessThan(0.5);
        await page.getByRole('button', { name: copy.continue, exact: true }).click();
        await expect(page.getByRole('heading', { name: copy.body, exact: true })).toBeVisible();
        await page
          .getByLabel(copy.goal, { exact: true })
          .fill(
            language === 'en'
              ? 'Walk outside at my own pace, notice the trees and return without comparing my progress with anyone else.'
              : 'Caminhar ao ar livre no meu ritmo, observar as árvores e voltar sem comparar meu progresso com o de outras pessoas.',
          );
        await expect(page.getByRole('status')).toHaveText(copy.draftSaved);
        expect(
          await page
            .locator('.onboarding-pillar-icon.body')
            .evaluate((el) => getComputedStyle(el).color),
        ).toBe('rgb(138, 62, 75)');
        await checkLayout(page);
        await page.getByLabel(copy.goal, { exact: true }).evaluate((el: HTMLTextAreaElement) => {
          el.scrollTop = 0;
        });
        await page.screenshot({
          path: `${root}/screenshots/configured-step-${stem}.png`,
          fullPage: true,
        });
        await page.getByRole('button', { name: copy.continue, exact: true }).click();
        for (const pillar of [copy.nutrition, copy.hygiene]) {
          await expect(page.getByRole('heading', { name: pillar, exact: true })).toBeVisible();
          await checkLayout(page);
          await page.getByRole('button', { name: copy.onboardingSkip, exact: true }).click();
        }
        await expect(page.getByRole('heading', { name: copy.review, exact: true })).toBeVisible();
        await expect(page.getByText(copy.onboardingNoHabit, { exact: true })).toHaveCount(2);
        await expect(page.getByText(copy.everyDay, { exact: true })).toHaveCount(2);
        await expect(page.getByText(copy.onboardingFirstDay, { exact: true })).toBeVisible();
        await checkLayout(page);
        await page.screenshot({
          path: `${root}/screenshots/mixed-review-${stem}.png`,
          fullPage: true,
        });
        await page.getByRole('button', { name: `${copy.edit} ${copy.mind}`, exact: true }).focus();
        expect(
          await page.evaluate(() => getComputedStyle(document.activeElement!).backgroundColor),
        ).toBe('rgba(0, 0, 0, 0)');
        mkdirSync(`${root}/captures`, { recursive: true });
        writeFileSync(
          `${root}/captures/${stem}.json`,
          JSON.stringify(
            {
              language,
              width,
              text,
              weekdayRows: rows.counts,
              screenshots: ['welcome', 'validation', 'configured-step', 'mixed-review'].map(
                (name) => `${name}-${stem}.png`,
              ),
            },
            null,
            2,
          ),
        );
      });
    }
