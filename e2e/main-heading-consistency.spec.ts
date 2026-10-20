import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import en from '../src/i18n/en.json' with { type: 'json' };
import pt from '../src/i18n/pt.json' with { type: 'json' };
import { setupScheduledHabits, readDataset, nav } from './support/habit-fixtures';
import { updateCompletion } from '../src/domain/completion';
import { calculateProgress } from '../src/domain/progress';
import { localDate } from '../src/domain/calendar';

test.setTimeout(90_000);
test.use({ actionTimeout: 10_000 });
let initialFacts: Awaited<ReturnType<typeof readDataset>>;
test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(90_000);
  const page = await browser.newPage();
  try {
    await setupScheduledHabits(page);
    initialFacts = await readDataset(page);
  } finally {
    await page.close();
  }
});

async function installFacts(page: Page, facts = initialFacts) {
  await page.clock.install({ time: new Date('2026-09-30T12:00:00') });
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
    facts,
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', level: 1, exact: true })).toBeVisible();
}

const evidence = 'artifacts/visual-consistency/headings';

const firstContent = (page: Page, screen: string) =>
  page.locator(
    screen === 'today'
      ? '.summary-shell'
      : screen === 'pillars'
        ? '.management-toolbar'
        : screen === 'journey'
          ? '.journey-notes'
          : screen === 'progress'
            ? '.progress-xp'
            : '.settings-content',
  );

for (const language of ['en', 'pt'] as const)
  for (const width of [320, 375, 390, 393, 402, 430, 440, 1280])
    for (const text of [100, 200])
      test(`Shared headings ${language} ${width}px text${text}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await installFacts(page);
        if (language === 'pt') {
          await nav(page, 'Settings').click();
          await page.getByLabel('Language', { exact: true }).selectOption('pt');
          await expect(page.getByRole('heading', { name: pt.settings, exact: true })).toBeVisible();
        }
        const copy = language === 'en' ? en : pt;
        await nav(page, copy.settingsNav).click();
        await page.addStyleTag({ content: `html {font-size:${text}%;}` });
        const rows = [];
        for (const [screen, destination, title] of [
          ['today', copy.today, copy.today],
          ['pillars', copy.pillars, copy.pillars],
          ['journey', language === 'en' ? 'Journey' : 'Jornada', copy.journeyTitle],
          ['progress', copy.progress, copy.progress],
          ['settings', copy.settingsNav, copy.settings],
        ]) {
          await nav(page, destination).click();
          const heading = page.getByRole('heading', { name: title, level: 1, exact: true });
          await expect(heading).toBeFocused();
          await page.evaluate(() => scrollTo(0, 0));
          const metrics = await heading.evaluate((node) => {
            const css = getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            const header = node.closest('header')!;
            const intro = header.querySelector('.page-intro');
            const body = getComputedStyle(document.querySelector('main')!);
            const introStyle = intro ? getComputedStyle(intro) : undefined;
            return {
              style: {
                font: css.fontFamily,
                size: css.fontSize,
                weight: css.fontWeight,
                line: css.lineHeight,
                color: css.color,
              },
              top: rect.top,
              left: rect.left,
              right: rect.right,
              width: rect.width,
              height: rect.height,
              mainTop: parseFloat(body.paddingTop),
              headerGap: getComputedStyle(header).marginBottom,
              headerBackground: getComputedStyle(header).backgroundColor,
              intro: introStyle
                ? {
                    font: introStyle.fontFamily,
                    size: introStyle.fontSize,
                    weight: introStyle.fontWeight,
                    line: introStyle.lineHeight,
                    color: introStyle.color,
                    margin: introStyle.marginTop,
                  }
                : null,
            };
          });
          rows.push({ screen, ...metrics });
          await page.screenshot({
            path: `${evidence}/captures/${screen}-${language}-${width}-text${text}.png`,
          });
        }
        mkdirSync(`${evidence}/metrics`, { recursive: true });
        writeFileSync(
          `${evidence}/metrics/${language}-${width}-text${text}.json`,
          JSON.stringify(rows, null, 2),
        );
        const reference = rows.find((row) => row.screen === 'pillars')!;
        for (const row of rows) {
          // Today retains Field Notes colors; all typography remains shared.
          expect(row.style).toEqual({
            ...reference.style,
            color: row.screen === 'today' ? 'rgb(41, 47, 42)' : 'rgb(21, 46, 36)',
          });
          expect(parseFloat(row.style.size)).toBe((32 * text) / 100);
          expect(row.style.weight).toBe('700');
          expect(row.top).toBe(row.mainTop);
          expect(row.headerGap).toBe('16px');
          expect(row.intro).not.toBeNull();
          expect(row.intro).toEqual({
            ...reference.intro,
            color: row.screen === 'today' ? 'rgb(100, 108, 99)' : 'rgb(88, 103, 93)',
          });
          expect(row.headerBackground).toBe('rgba(0, 0, 0, 0)');
        }
        await expect(page.locator('main > header .brand')).toHaveCount(0);
        await expect(page.locator('main > button')).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        // Settings is a primary destination, not a nested screen with a Back action.
        await expect(page.getByRole('button', { name: /^(Back|Voltar)$/ })).toHaveCount(0);
        const before = await readDataset(page);
        expect(before.habits).toEqual(initialFacts.habits);
        expect(before.occurrences).toEqual(initialFacts.occurrences);
        const sections = page.locator('.settings-section');
        for (const section of await sections.all()) {
          expect(await section.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(
            true,
          );
        }
        // Exercise real keyboard traversal in a software-keyboard-sized viewport at
        // every requested width/text/locale, without activating restore or reset.
        await page.setViewportSize({ width, height: 430 });
        const languageField = page.getByLabel(copy.language, { exact: true });
        await languageField.focus();
        const controls = [
          languageField,
          page.getByRole('checkbox', { name: copy.reducedMotion, exact: true }),
          page.getByRole('button', { name: copy.exportBackup, exact: true }),
          page.getByLabel(copy.chooseBackup, { exact: true }),
          page.getByRole('button', { name: copy.deleteOpen, exact: true }),
        ];
        for (const [index, control] of controls.entries()) {
          if (index) await page.keyboard.press('Tab');
          await expect(control).toBeFocused();
          await control.scrollIntoViewIfNeeded();
          await expect
            .poll(() =>
              control.evaluate((node) => {
                const r = node.getBoundingClientRect();
                const nav = document.querySelector('nav')!.getBoundingClientRect();
                return r.top >= 0 && r.bottom <= nav.top + 0.5;
              }),
            )
            .toBe(true);
          expect(
            await control.evaluate((node) => {
              const r = node.getBoundingClientRect();
              return node.contains(
                document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2),
              );
            }),
          ).toBe(true);
        }
        await page.screenshot({
          path: `${evidence}/captures/settings-keyboard-${language}-${width}-text${text}.png`,
        });
        await controls.at(-1)!.press('Enter');
        const cancel = page.getByRole('button', { name: copy.cancel, exact: true });
        await expect(cancel).toBeFocused();
        await cancel.press('Enter');
        await expect(controls.at(-1)!).toBeFocused();
        expect(await readDataset(page)).toEqual(before);
        await page.setViewportSize({ width, height: 900 });
        // Each page's first useful content follows the shared header clearance.
        for (const [screen, destination] of [
          ['today', copy.today],
          ['pillars', copy.pillars],
          ['journey', language === 'en' ? 'Journey' : 'Jornada'],
          ['progress', copy.progress],
          ['settings', copy.settingsNav],
        ]) {
          await nav(page, destination).click();
          const content = firstContent(page, screen);
          await expect(content).toBeVisible();
          expect(
            await content.evaluate(
              (node) =>
                node.getBoundingClientRect().top -
                document.querySelector('main > header')!.getBoundingClientRect().bottom,
            ),
          ).toBeCloseTo(16, 0);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
          if (screen === 'progress') {
            await page.getByRole('tab', { name: copy.pillars, exact: true }).click();
            await expect(page.locator('.aggregate-card')).toBeVisible();
            await page.evaluate(() => scrollTo(0, 0));
            await page.screenshot({
              path: `${evidence}/captures/progress-pillars-${language}-${width}-text${text}.png`,
            });
            expect(
              await page
                .locator('.consistency-card')
                .first()
                .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
            ).toBe(true);
          }
        }
      });

for (const language of ['en', 'pt'] as const)
  test(`Today long earned XP and date wrap without shrinking title ${language}`, async ({
    page,
  }) => {
    const facts = structuredClone(initialFacts);
    for (const habit of facts.habits) {
      habit.createdOn = '2025-01-01';
      habit.versions[0].effectiveFrom = '2025-01-01';
      habit.memberships[0].effectiveFrom = '2025-01-01';
      habit.periods[0].start = '2025-01-01';
    }
    facts.habits[0].versions[0].weekdays = [0, 1, 2, 3, 4, 5, 6];
    const date = new Date('2025-01-01T12:00:00');
    for (let index = 0; index < 365; index++, date.setDate(date.getDate() + 1))
      updateCompletion(facts, facts.habits[0].id, localDate(date), true, date);
    const xp = calculateProgress(facts, '2026-09-30').totalXp;
    expect(xp).toBeGreaterThan(10_000);
    await installFacts(page, facts);
    if (language === 'pt') {
      await nav(page, 'Settings').click();
      await page.getByLabel('Language', { exact: true }).selectOption('pt');
      await nav(page, 'Hoje').click();
    }
    for (const width of [320, 375, 390, 393, 402, 430, 440, 1280])
      for (const text of [100, 200]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(
          (value) => (document.documentElement.style.fontSize = `${value}%`),
          text,
        );
        await page.evaluate(() => scrollTo(0, 0));
        const header = page.locator('.today-header');
        await expect(header.locator('.header-xp > span[aria-hidden=true]')).toHaveText(
          `${new Intl.NumberFormat(language === 'pt' ? 'pt-BR' : 'en').format(xp)} XP`,
        );
        const boxes = await header.evaluate((node) => {
          const rect = (selector: string) => {
            const r = node.querySelector(selector)!.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
          };

          return {
            title: rect('h1'),
            date: rect('time'),
            xp: rect('.header-xp'),
            line: rect('.today-header-line'),
            motto: rect('.today-motto'),
            font: getComputedStyle(node.querySelector('h1')!).fontSize,
          };
        });
        expect(boxes.font).toBe(`${(32 * text) / 100}px`);
        expect(boxes.xp.right).toBeCloseTo(boxes.line.right, 0);
        expect(boxes.motto.top).toBeGreaterThanOrEqual(
          Math.max(boxes.title.bottom, boxes.date.bottom, boxes.xp.bottom),
        );

        const intersects = (a: typeof boxes.title, b: typeof boxes.title) =>
          a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

        expect(intersects(boxes.title, boxes.xp)).toBe(false);
        expect(intersects(boxes.date, boxes.xp)).toBe(false);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path: `${evidence}/captures/today-earned-xp-${language}-${width}-text${text}.png`,
        });
      }
  });
