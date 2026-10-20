import { test, expect, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { seedJourney, storedJourney } from './support/journey-data';
import { nav, onDate } from './support/habit-fixtures';
import { backControl } from './support/management-fixtures';
import en from '../src/i18n/en.json' with { type: 'json' };
import pt from '../src/i18n/pt.json' with { type: 'json' };

const root = 'artifacts/progress-spacing';
const baseline = existsSync(`${root}/capture-baseline`);
const phase = baseline ? 'before' : 'after';
const goal =
  'Read a chapter of my chosen book and write a thoughtful note about something I want to remember';
const pillar = 'Creative practice and everyday discoveries with a deliberately long pillar name';
test.setTimeout(90_000);

async function fixture(page: Page, language: 'en' | 'pt') {
  await seedJourney(page, 40);
  const data = await storedJourney(page);
  data.settings.language = language;
  data.habits[0].versions[0].goal = goal;
  data.occurrences[0].goal = goal;
  data.pillars[0].nameOverride = pillar;
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
  await onDate(page, '2026-10-11');
  await nav(page, language === 'en' ? 'Progress' : 'Progresso').click();
}

async function measure(page: Page) {
  return page.locator('.progress-page').evaluate((main) => {
    const first = main.querySelector('.consistency-card')!;

    const rect = (node: Element) => {
      const b = node.getBoundingClientRect();
      return {
        x: b.x,
        y: b.y + scrollY,
        width: b.width,
        height: b.height,
        bottom: b.bottom + scrollY,
      };
    };

    const style = (node: Element) => {
      const s = getComputedStyle(node);
      return {
        font: s.font,
        color: s.color,
        background: s.backgroundColor,
        border: s.border,
        radius: s.borderRadius,
        padding: s.padding,
      };
    };

    return {
      firstCardY: rect(first).y,
      firstCalendarY: rect(first.querySelector('.daily-calendar')!).y,
      controlStack: [
        '.period-navigation',
        '.progress-filter-row',
        '.calendar-legend',
        '.streak-scope-note',
        '.consistency-card',
      ].map((selector) => ({ selector, ...rect(main.querySelector(selector)!) })),
      targets: Array.from(
        main.querySelectorAll(
          '.interval-selector button, .period-navigation button, .progress-filters summary',
        ),
      ).map((node) => ({ ...rect(node), text: node.textContent })),
      protected: {
        xp: main.querySelector('.progress-xp')!.outerHTML,
        xpBox: rect(main.querySelector('.progress-xp')!),
        intervals: Array.from(main.querySelectorAll('.interval-selector button')).map((node) => ({
          text: node.textContent,
          style: style(node),
          box: rect(node),
        })),
        legend: Array.from(main.querySelectorAll('.calendar-legend li')).map((node) => ({
          text: node.textContent,
          font: getComputedStyle(node).font,
          color: getComputedStyle(node).color,
        })),
        calendar: Array.from(
          first.querySelectorAll('[data-calendar-date], [data-context-date]'),
        ).map((node) => ({
          date: node.getAttribute('data-calendar-date') ?? node.getAttribute('data-context-date'),
          state: node.getAttribute('data-state'),
          context: node.getAttribute('data-context'),
          text: node.textContent,
          style: style(node),
        })),
        metrics: first.querySelector('.consistency-summary')!.textContent,
        icon: style(first.querySelector('.pillar-icon')!),
      },
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
}

for (const language of ['en', 'pt'] as const) {
  test(`Compact Progress ${language} preserves XP and controls while raising calendars at mobile wide and enlarged text`, async ({
    page,
    context,
  }) => {
    mkdirSync(`${root}/${phase}/screenshots`, { recursive: true });
    await fixture(page, language);
    const saved = await storedJourney(page);
    const cdp = await context.newCDPSession(page);
    // Native browser safe-area emulation; production env() rules are not replaced.
    await cdp.send('Emulation.setSafeAreaInsetsOverride', {
      insets: { top: 0, left: 0, right: 0, bottom: 34 },
    });
    await expect
      .poll(() =>
        page.locator('.bottom-nav').evaluate((node) => getComputedStyle(node).paddingBottom),
      )
      .toBe('34px');
    for (const width of [320, 390, 1280])
      for (const text of [100, 200]) {
        const key = `${language}-${width}-text${text}`;
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate((text) => {
          document.documentElement.style.fontSize = `${text}%`;
          scrollTo(0, 0);
        }, text);
        await expect
          .poll(() =>
            page
              .locator('.bottom-nav')
              .evaluate((node) =>
                Math.abs(
                  node.getBoundingClientRect().height -
                    parseFloat(
                      getComputedStyle(document.documentElement).getPropertyValue(
                        '--bottom-nav-height',
                      ),
                    ),
                ),
              ),
          )
          .toBeLessThan(1);
        const measured = await measure(page);
        writeFileSync(`${root}/${phase}/${key}.json`, JSON.stringify(measured, null, 2));
        expect(measured.overflow).toBeLessThanOrEqual(0);
        for (const target of measured.targets) {
          expect(target.width).toBeGreaterThanOrEqual(44);
          expect(target.height).toBeGreaterThanOrEqual(44);
        }
        for (let index = 1; index < measured.controlStack.length; index++) {
          expect(measured.controlStack[index].y).toBeGreaterThanOrEqual(
            measured.controlStack[index - 1].bottom - 0.5,
          );
        }
        await expect(page.locator('.progress-filters')).not.toHaveAttribute('open');
        await expect(page.locator('.calendar-legend')).toHaveCount(1);
        if (!baseline) {
          await expect(
            page.locator('.consistency-card').first().locator('.tracking-since'),
          ).toHaveCount(0);
          if (existsSync(`${root}/before/${key}.json`)) {
            const before = JSON.parse(readFileSync(`${root}/before/${key}.json`, 'utf8'));
            expect(measured.protected).toEqual(before.protected);
            expect(
              measured.firstCardY,
              `${key}: compact controls alone raise the card`,
            ).toBeLessThanOrEqual(before.firstCardY - 8);
            expect(
              measured.firstCalendarY,
              `${key}: simplified header brings the calendar sooner`,
            ).toBeLessThanOrEqual(before.firstCalendarY - 24);
          }
        }
        await page.screenshot({ path: `${root}/${phase}/screenshots/${key}-header.png` });
        const first = page.locator('.consistency-card').first();
        await first
          .locator('.daily-calendar')
          .evaluate((node) => node.scrollIntoView({ block: 'center' }));
        await page.screenshot({ path: `${root}/${phase}/screenshots/${key}-calendar.png` });
        await first
          .locator('.consistency-summary dl')
          .evaluate((node) => node.scrollIntoView({ block: 'center' }));
        await page.screenshot({ path: `${root}/${phase}/screenshots/${key}-metrics.png` });
        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        const final = await page
          .locator('.consistency-card')
          .last()
          .evaluate((node) => {
            const last = node.getBoundingClientRect();
            const metrics = node.querySelector('.consistency-summary')!.getBoundingClientRect();
            const nav = document.querySelector('.bottom-nav')!.getBoundingClientRect();
            return { bottom: last.bottom, metricsBottom: metrics.bottom, navigationTop: nav.top };
          });
        expect(final.bottom).toBeLessThanOrEqual(final.navigationTop - 16);
        expect(final.metricsBottom).toBeLessThan(final.navigationTop);
        await page.screenshot({ path: `${root}/${phase}/screenshots/${key}-last-card.png` });
      }
    expect(await storedJourney(page)).toEqual(saved);
  });
}

for (const language of ['en', 'pt'] as const) {
  test(`Tracking start remains read-only in the existing habit detail and returns to Progress ${language}`, async ({
    page,
  }) => {
    test.skip(baseline, 'Baseline captures measure the preserved layout, before moving the date.');
    await fixture(page, language);
    const copy = language === 'pt' ? pt : en;
    const saved = await storedJourney(page);
    await page.locator('.progress-filters > summary').click();
    await page.getByLabel(copy.pillarFilter, { exact: true }).selectOption('mind');
    await page.locator('.progress-filters > summary').click();
    await page.setViewportSize({ width: 320, height: 900 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await expect(page.locator('.filter-summary')).toContainText(pillar);
    await page
      .locator('.filter-summary')
      .evaluate((node) => node.scrollIntoView({ block: 'center' }));
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
    const splitWords = await page
      .locator('.progress-filter-row, .calendar-legend')
      .evaluateAll((nodes) => {
        const split: string[] = [];
        for (const element of nodes) {
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const node = walker.currentNode;
            if (!node.parentElement?.closest('.filter-summary, .calendar-legend')) continue;
            for (const match of node.textContent!.matchAll(/\p{L}+/gu)) {
              const range = document.createRange();
              range.setStart(node, match.index!);
              range.setEnd(node, match.index! + match[0].length);
              if (range.getClientRects().length > 1) split.push(match[0]);
            }
          }
        }
        return split;
      });
    expect(splitWords).toEqual([]);
    await page.screenshot({ path: `${root}/after/screenshots/${language}-filtered-text200.png` });
    const first = page.locator('.consistency-card').first();
    const name = first.getByRole('button', { name: goal, exact: true });
    await expect(first.locator('.consistency-heading')).not.toContainText(
      language === 'pt' ? 'Acompanhamento desde' : 'Tracking since',
    );
    await name.click();
    await expect(page.locator('.completion-review')).toBeVisible();
    await page.locator('.review-supporting > summary').click();
    const date = page.locator('.habit-tracking-start');
    await expect(date).toHaveText(
      copy.trackingStartDate.replace(
        '{date}',
        new Intl.DateTimeFormat(language === 'pt' ? 'pt-BR' : 'en', { dateStyle: 'medium' }).format(
          new Date('2026-10-03T12:00:00'),
        ),
      ),
    );
    await expect(date.locator('input, button, select')).toHaveCount(0);
    await date.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${root}/after/screenshots/${language}-tracking-detail.png` });
    await backControl(page).click();
    await expect(name).toBeFocused();
    await expect(page.locator('.progress-filters')).not.toHaveAttribute('open');
    await expect(page.locator('.filter-summary')).toContainText(pillar);
    await expect(page.getByRole('button', { name: '7d', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await storedJourney(page)).toEqual(saved);
  });
}
