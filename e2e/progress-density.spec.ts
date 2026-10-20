import { test, expect, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  nav,
  onDate,
  readDataset,
  setupScheduledHabits,
  scheduledHabitGoals,
} from './support/habit-fixtures';

// Real UI-created facts, isolated contexts; no normal-diary writes.
// A temporary capture-baseline marker records RED before spacing changes.
const root = 'artifacts/visual-consistency/progress';
const phase = existsSync(`${root}/capture-baseline`) ? 'baseline' : 'after';
test.setTimeout(120_000);

async function openProgress(page: Page) {
  await setupScheduledHabits(page);
  await onDate(page, '2026-09-28');
  const done = page.getByRole('checkbox', { name: `Done: ${scheduledHabitGoals[0]}`, exact: true });
  await done.click();
  await expect(done).toBeChecked();
  await expect(done).toBeEnabled();
  await onDate(page, '2026-10-03');
  await nav(page, 'Progress').click();
  await expect(page.locator('.progress-page')).toBeVisible();
  // This suite measures monthly geometry, not the first-visit interval preference.
  await page.getByRole('button', { name: '3m', exact: true }).click();
  await expect(page.getByRole('button', { name: '3m', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
}

async function measure(page: Page) {
  return page.locator('.progress-page').evaluate((main) => {
    const card = main.querySelector('.consistency-card')!;

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

    const tabs = main.querySelector('.progress-tabs')!;
    const heading = card.querySelector('.consistency-heading')!;
    const calendar = card.querySelector('.daily-calendar')!;
    const grid = card.querySelector('.monthly-grid')!;
    const rows = [
      'header',
      '.progress-xp',
      '.progress-tabs',
      '.interval-selector',
      '.period-navigation',
      '.progress-filter-row',
      '.calendar-legend',
      '.streak-scope-note',
    ].map((selector) => ({ selector, ...rect(main.querySelector(selector)!) }));
    const filterRow = rect(main.querySelector('.progress-filter-row')!);
    const filterChildren = ['.progress-filters', '.filter-summary'].map((selector) => ({
      selector,
      ...rect(main.querySelector(selector)!),
    }));

    const style = (node: Element) => {
      const s = getComputedStyle(node);
      return {
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        color: s.color,
        background: s.backgroundColor,
        image: s.backgroundImage,
      };
    };

    return {
      firstGridY: rect(grid).y,
      firstMonthY: rect(card.querySelector('.calendar-month')!).y,
      controlsToGrid: rect(grid).y - rect(tabs).y,
      identityToCalendar: rect(calendar).y - rect(heading).bottom,
      tabsGap: parseFloat(getComputedStyle(tabs).marginBottom),
      cardGap: rect(card).y - rect(main.querySelector('.streak-scope-note')!).bottom,
      headingBottomGap: parseFloat(getComputedStyle(heading).marginBottom),
      calendarTopGap: parseFloat(getComputedStyle(calendar).marginTop),
      rows,
      filterRow,
      filterChildren,
      card: rect(card),
      controls: Array.from(
        main.querySelectorAll(
          '.progress-tabs button, .interval-selector button, .period-navigation button, .progress-filters summary',
        ),
      ).map((node) => ({ ...rect(node), text: node.textContent })),
      overflow: document.documentElement.scrollWidth - innerWidth,
      monthOverflow: Array.from(
        card.querySelectorAll('.daily-calendar, .calendar-month, .monthly-grid'),
      ).map((node) => ({
        width: (node as HTMLElement).clientWidth,
        scrollWidth: (node as HTMLElement).scrollWidth,
        overflowX: getComputedStyle(node).overflowX,
      })),
      preserved: {
        labels: Array.from(
          card.querySelectorAll(
            '.calendar-month-label, .month-weekdays, .month-context, .calendar-context',
          ),
        ).map((node) => ({ text: node.textContent, style: style(node) })),
        cells: Array.from(
          card.querySelectorAll('.calendar-day, .calendar-before, .calendar-blank'),
        ).map((node) => ({
          date: node.getAttribute('data-calendar-date') ?? node.getAttribute('data-context-date'),
          state: node.getAttribute('data-state'),
          context: node.getAttribute('data-context'),
          tag: node.tagName,
          width: rect(node).width,
          height: rect(node).height,
          style: style(node),
        })),
        summary: card.querySelector('.consistency-summary')!.textContent,
        fonts: Array.from(
          card.querySelectorAll('.consistency-heading h2, .consistency-heading p, .day-number'),
        ).map((node) => style(node)),
        legend: Array.from(main.querySelectorAll('.calendar-legend li, .legend-swatch')).map(
          (node) => ({ text: node.textContent, style: style(node) }),
        ),
      },
    };
  });
}

for (const language of ['en', 'pt'] as const) {
  test(`Progress density ${language} retains month geometry at mobile desktop ordinary and 200% text`, async ({
    page,
  }) => {
    mkdirSync(`${root}/${phase}`, { recursive: true });
    await openProgress(page);
    if (language === 'pt') {
      await nav(page, 'Settings').click();
      await page.getByLabel('Language', { exact: true }).selectOption('pt');
      await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
      await nav(page, 'Progresso').click();
    }
    const saved = await readDataset(page);
    for (const width of [390, 1280])
      for (const text of [100, 200]) {
        const key = `${language}-${width}-text${text}`;
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate((text) => {
          document.documentElement.style.fontSize = `${text}%`;
          window.scrollTo(0, 0);
        }, text);
        const measured = await measure(page);
        writeFileSync(`${root}/${phase}/${key}.json`, JSON.stringify(measured, null, 2));
        await page.screenshot({ path: `${root}/${phase}/${key}-top.png` });
        await page
          .locator('.consistency-card .calendar-month')
          .first()
          .evaluate((node) => node.scrollIntoView({ block: 'center' }));
        await page.screenshot({ path: `${root}/${phase}/${key}-calendar.png` });
        console.log(
          `${phase} ${key}: firstGridY=${measured.firstGridY}, controlsToGrid=${measured.controlsToGrid}, identityToCalendar=${measured.identityToCalendar}`,
        );
        expect
          .soft(measured.tabsGap, `${key}: compact tab-to-interval spacing`)
          .toBeLessThanOrEqual(12);
        expect.soft(measured.cardGap, `${key}: scope-to-card spacing`).toBeLessThanOrEqual(12);
        expect
          .soft(measured.headingBottomGap, `${key}: identity-to-calendar spacing`)
          .toBeLessThanOrEqual(8);
        expect
          .soft(measured.calendarTopGap, `${key}: calendar outer spacing`)
          .toBeLessThanOrEqual(8);
        expect(measured.overflow).toBeLessThanOrEqual(0);
        for (const size of measured.controls) {
          expect(size.width).toBeGreaterThanOrEqual(44);
          expect(size.height).toBeGreaterThanOrEqual(44);
        }
        for (const size of measured.monthOverflow) {
          expect(size.scrollWidth).toBeLessThanOrEqual(size.width);
          expect(['auto', 'scroll']).not.toContain(size.overflowX);
        }
        for (let index = 1; index < measured.rows.length; index++) {
          expect(
            measured.rows[index].y,
            `${key}: ${measured.rows[index].selector} overlaps prior row`,
          ).toBeGreaterThanOrEqual(measured.rows[index - 1].bottom - 0.5);
        }
        // The filter controls and summary may share a line or wrap, but neither
        // may escape their common row or collide in both dimensions.
        for (const child of measured.filterChildren) {
          expect(child.x, `${key}: ${child.selector} left containment`).toBeGreaterThanOrEqual(
            measured.filterRow.x - 0.5,
          );
          expect(
            child.x + child.width,
            `${key}: ${child.selector} right containment`,
          ).toBeLessThanOrEqual(measured.filterRow.x + measured.filterRow.width + 0.5);
          expect(child.y, `${key}: ${child.selector} top containment`).toBeGreaterThanOrEqual(
            measured.filterRow.y - 0.5,
          );
          expect(child.bottom, `${key}: ${child.selector} bottom containment`).toBeLessThanOrEqual(
            measured.filterRow.bottom + 0.5,
          );
        }
        const [filters, summary] = measured.filterChildren;
        const intersects =
          filters.x < summary.x + summary.width &&
          filters.x + filters.width > summary.x &&
          filters.y < summary.bottom &&
          filters.bottom > summary.y;
        expect(intersects, `${key}: filter controls and summary collide`).toBe(false);
        expect(measured.card.y).toBeGreaterThanOrEqual(measured.rows.at(-1)!.bottom);
        if (phase === 'after' && existsSync(`${root}/baseline/${key}.json`)) {
          // Optional preserved-start comparison enriches local evidence, never a
          // prerequisite for running this spec in a fresh checkout.
          const baseline = JSON.parse(readFileSync(`${root}/baseline/${key}.json`, 'utf8'));
          expect(measured.preserved).toEqual(baseline.preserved);
          expect(measured.card.width).toBe(baseline.card.width);
          expect(
            measured.controlsToGrid,
            `${key}: real first calendar at least 32px sooner below controls`,
          ).toBeLessThanOrEqual(baseline.controlsToGrid - 32);
          expect
            .soft(measured.firstGridY, `${key}: real first calendar higher on page`)
            .toBeLessThan(baseline.firstGridY);
        }
      }
    expect(await readDataset(page)).toEqual(saved);
  });
}

test('Progress density preserves intervals filters tabs date navigation and dated details', async ({
  page,
}) => {
  await openProgress(page);
  const main = page.locator('.progress-page');
  const saved = await readDataset(page);
  const first = main.locator('.consistency-card').first();
  await expect(main.getByRole('button', { name: '3m', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(first.locator('.calendar-month')).toHaveCount(3);
  await expect(first.locator('.calendar-before[data-context-date="2026-09-26"]')).toHaveAttribute(
    'data-context',
    'before-tracking',
  );
  await expect(first.locator('button[data-calendar-date="2026-09-28"]')).toHaveAttribute(
    'data-state',
    'completed',
  );
  await expect(first.locator('button[data-calendar-date="2026-09-30"]')).toHaveAttribute(
    'data-state',
    'incomplete',
  );
  await expect(first.locator('button[data-calendar-date="2026-10-01"]')).toHaveAttribute(
    'data-state',
    'unscheduled',
  );
  await expect(first.locator('.period-fraction')).toHaveText('1/3 days completed');
  for (const [interval, count] of [
    ['7d', 0],
    ['1m', 1],
    ['3m', 3],
    ['12m', 12],
    ['24m', 24],
  ] as const) {
    await main.getByRole('button', { name: interval, exact: true }).click();
    await expect(main.getByRole('button', { name: interval, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(first.locator('.calendar-month')).toHaveCount(count);
    await expect(main.getByRole('button', { name: 'Next period', exact: true })).toBeDisabled();
  }
  await main.getByRole('button', { name: '1m', exact: true }).click();
  await main.getByRole('button', { name: 'Previous period', exact: true }).click();
  await expect(first.locator('.calendar-month')).toHaveAttribute('data-month', '2026-09');
  await expect(main.getByRole('button', { name: 'Next period', exact: true })).toBeEnabled();
  await main.getByRole('button', { name: 'Next period', exact: true }).click();
  await expect(first.locator('.calendar-month')).toHaveAttribute('data-month', '2026-10');
  await main.locator('.progress-filters summary').click();
  await main.getByLabel('Pillar filter', { exact: true }).selectOption('mind');
  await expect(main.locator('.consistency-card')).toHaveCount(1);
  await main.getByRole('button', { name: 'Archived', exact: true }).click();
  await expect(main.locator('.consistency-card')).toHaveCount(0);
  await main
    .locator('.progress-filters')
    .getByRole('button', { name: 'Reset filters', exact: true })
    .click();
  await expect(main.locator('.consistency-card')).toHaveCount(4);
  await main.getByRole('tab', { name: 'Pillars', exact: true }).click();
  await expect(main.locator('.aggregate-card')).toHaveCount(1);
  await expect(main.locator('.calendar-legend')).toContainText('Partially completed');
  await main.getByRole('tab', { name: 'Habits', exact: true }).click();
  await first.locator('button[data-calendar-date="2026-10-01"]').click();
  await expect(page.locator('.progress-day-page')).toContainText(
    'This habit was not scheduled on this day.',
  );
  await page.getByRole('button', { name: 'Back to Progress', exact: true }).click();
  await expect(first.locator('button[data-calendar-date="2026-10-01"]')).toBeFocused();
  await expect(main.getByRole('button', { name: '1m', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const after = await readDataset(page);
  expect(after.settings).toEqual({ ...saved.settings, progressInterval: '1m' });
  expect(after.revision).toBeGreaterThan(saved.revision);
  expect({ ...after, settings: saved.settings, revision: saved.revision }).toEqual(saved);
});
