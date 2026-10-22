import { test, expect, type Locator, type Page } from '@playwright/test';
import { civilDate, parseLocalDate } from '../src/domain/calendar';
import { periodWindow, type Interval } from '../src/features/progress/calendar';
import { archiveHabit, reactivateHabit } from '../src/domain/lifecycle';
import { restoreCalendarHistory } from './support/calendar-history';
import {
  nav,
  onDate,
  readDataset,
  setupScheduledHabits,
  scheduledHabitGoals,
} from './support/habit-fixtures';

// Isolated contexts, injected local dates, native day buttons and real persistence only.
// Run this suite serially with other browser gates; dense histories are memory intensive.
test.setTimeout(120_000);
const screenshots = 'artifacts/progress-monthly/screenshots';
const intervals: Interval[] = ['7d', '1m', '3m', '12m', '24m'];
const longGoal =
  'Walk calmly through my neighborhood, notice the trees and return at my own pace without rushing or comparing myself to anyone else';

const main = (page: Page) => page.locator('main.progress-page');

const card = (page: Page, title: string) =>
  main(page)
    .locator('article.consistency-card')
    .filter({ has: page.getByRole('heading', { name: title, exact: true, level: 2 }) });

const day = (scope: Locator, date: string) => scope.locator(`button[data-calendar-date="${date}"]`);

const before = (scope: Locator, date: string) =>
  scope.locator(`.calendar-before[data-context-date="${date}"]`);

const detail = (page: Page) => page.locator('main.progress-day-page');

const locale = (language: 'en' | 'pt') => (language === 'pt' ? 'pt-BR' : 'en');

const fullDate = (date: string, language: 'en' | 'pt' = 'en') =>
  new Intl.DateTimeFormat(locale(language), { timeZone: 'UTC', dateStyle: 'full' }).format(
    parseLocalDate(date),
  );

async function noManualEntry(page: Page, language: 'en' | 'pt' = 'en') {
  await expect(main(page).locator('input[type="date"], input[type="datetime-local"]')).toHaveCount(
    0,
  );
  await expect(main(page)).not.toContainText(
    language === 'en' ? 'Calendar date' : 'Data do calendário',
  );
  await expect(main(page)).not.toContainText('Select a day, or enter its date');
  await expect(
    main(page).getByRole('button', { name: /choose (a )?date|date picker|escolher (uma )?data/i }),
  ).toHaveCount(0);
  await expect(
    main(page)
      .locator('summary')
      .filter({ hasText: /choose (a )?date|date picker|escolher (uma )?data/i }),
  ).toHaveCount(0);
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function languageAndProgress(page: Page, language: 'en' | 'pt') {
  if (language === 'pt') {
    await nav(page, 'Settings').click();
    await page.getByLabel('Language', { exact: true }).selectOption('pt');
    await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
  }
  await nav(page, language === 'en' ? 'Progress' : 'Progresso').click();
  await expect(main(page)).toBeVisible();
  // Monthly fixtures choose their interval explicitly now that first visits default to 7d.
  await main(page).getByRole('button', { name: '3m', exact: true }).click();
  await expect(main(page).getByRole('button', { name: '3m', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
}

async function complete(page: Page, goal: string) {
  const checkbox = page.getByRole('checkbox', { name: `Done: ${goal}`, exact: true });
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await expect(checkbox).toBeEnabled();
}

async function addBodyHabit(page: Page) {
  await nav(page, 'Today').click();
  await page.getByRole('button', { name: 'Add habit', exact: true }).click();
  await page.getByLabel('Pillar', { exact: true }).selectOption('body');
  await page.getByLabel('What do you want to do?').fill(longGoal);
  for (const weekday of ['Sunday', 'Tuesday', 'Thursday', 'Saturday'])
    await page.getByRole('button', { name: weekday, exact: true }).click();
  await page.getByRole('button', { name: 'Save habit', exact: true }).click();
  await expect(page.getByRole('heading', { name: longGoal, exact: true })).toBeVisible();
}

/** Independent DOM/geometry oracle: Monday-first, seven horizontal columns, actual month-only dates. */
async function assertMonths(
  scope: Locator,
  expectedMonths: string[],
  language: 'en' | 'pt',
  historyEnd: string,
  numbered: boolean,
) {
  const months = scope.locator('.calendar-month');
  await expect(months).toHaveCount(expectedMonths.length);
  expect(
    await months.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-month'))),
  ).toEqual(expectedMonths);
  const observed = await months.evaluateAll(
    (nodes, args) =>
      nodes.map((node) => {
        const grid = node.querySelector('.monthly-grid')!;
        const boxes = Array.from(grid.children).map((child) => {
          const box = child.getBoundingClientRect();
          return {
            date:
              child.getAttribute('data-calendar-date') ?? child.getAttribute('data-context-date'),
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            padding: child.classList.contains('calendar-padding'),
            state: child.getAttribute('data-state'),
            tag: child.tagName,
            tabIndex: child.getAttribute('tabindex'),
            context: child.getAttribute('data-context'),
          };
        });
        const headings = Array.from(node.querySelectorAll('h3')).map(
          (heading) => heading.textContent,
        );
        const weekdayNodes = Array.from(node.querySelector('.month-weekdays')!.children);
        const weekdayLabels = weekdayNodes.map(
          (day) =>
            day.getAttribute('aria-label') ??
            day.querySelector('abbr')?.getAttribute('title') ??
            day.getAttribute('title') ??
            '',
        );
        const month = node.getAttribute('data-month')!;
        const date = new Date(`${month}-01T12:00:00`);
        const length = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
        const lead = (date.getDay() + 6) % 7;
        const weekdayFormat = new Intl.DateTimeFormat(args.locale, { weekday: 'long' });
        const expectedWeekdays = Array.from({ length: 7 }, (_, index) =>
          weekdayFormat.format(new Date(2026, 8, 28 + index, 12)),
        );
        return {
          month,
          length,
          lead,
          boxes,
          headings,
          weekdayLabels,
          expectedWeekdays,
          title: new Intl.DateTimeFormat(args.locale, { month: 'long', year: 'numeric' }).format(
            date,
          ),
          columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
          width: (node as HTMLElement).clientWidth,
          scrollWidth: (node as HTMLElement).scrollWidth,
          numbers: Array.from(node.querySelectorAll('.day-number')).map(
            (number) => number.textContent,
          ),
          numberFits: Array.from(node.querySelectorAll('.day-number')).map((number) => {
            const glyph = number.getBoundingClientRect();
            const cell = number.closest('.calendar-day, .calendar-before')!.getBoundingClientRect();
            return (
              glyph.left >= cell.left - 1 &&
              glyph.right <= cell.right + 1 &&
              glyph.top >= cell.top - 1 &&
              glyph.bottom <= cell.bottom + 1
            );
          }),
          borderWidths: Array.from(node.querySelectorAll('.calendar-day, .calendar-before')).map(
            (cell) => getComputedStyle(cell).borderTopWidth,
          ),
        };
      }),
    { locale: locale(language) },
  );
  const allDates: string[] = [];
  for (const month of observed) {
    expect(month.headings).toContain(month.title);
    expect(month.weekdayLabels.map((label) => label.toLocaleLowerCase(locale(language)))).toEqual(
      month.expectedWeekdays.map((label) => label.toLocaleLowerCase(locale(language))),
    );
    expect(month.columns).toBe(7);
    expect(month.scrollWidth).toBeLessThanOrEqual(month.width);
    expect(month.numberFits.every(Boolean)).toBe(true);
    expect(month.borderWidths.every((width) => width === '0px')).toBe(true);
    expect(month.boxes).toHaveLength(Math.ceil((month.lead + month.length) / 7) * 7);
    for (const [index, cell] of month.boxes.entries()) {
      if (cell.padding) {
        expect(cell.date).toBeNull();
        expect(cell.state).toBeNull();
        expect(cell.context).toBeNull();
        expect(cell.tag).not.toBe('BUTTON');
        expect(cell.tabIndex).toBeNull();
      }
      if (!cell.date) continue;
      expect(cell.date.slice(0, 7)).toBe(month.month);
      expect(cell.date <= historyEnd).toBe(true);
      const expectedIndex = month.lead + Number(cell.date.slice(8)) - 1;
      expect(index).toBe(expectedIndex);
      // Center on the Monday-first column; weeks must advance downward, not sideways.
      expect(Math.abs(cell.x - month.boxes[expectedIndex % 7].x)).toBeLessThanOrEqual(1);
      expect(
        Math.abs(cell.y - month.boxes[Math.floor(expectedIndex / 7) * 7].y),
      ).toBeLessThanOrEqual(1);
      allDates.push(cell.date);
    }
    const dates = month.boxes.filter((cell) => cell.date).map((cell) => cell.date!);
    const expectedDates = Array.from(
      { length: month.length },
      (_, index) => `${month.month}-${String(index + 1).padStart(2, '0')}`,
    ).filter((date) => date <= historyEnd);
    expect(dates).toEqual(expectedDates);
    expect(month.numbers).toEqual(
      numbered ? expectedDates.map((date) => String(Number(date.slice(8)))) : [],
    );
    const firstRow = month.boxes.slice(0, 7);
    expect(new Set(firstRow.map((cell) => Math.round(cell.y))).size).toBe(1);
    for (let index = 1; index < firstRow.length; index++)
      expect(firstRow[index].x).toBeGreaterThan(firstRow[index - 1].x);
    if (month.boxes.length > 7) expect(month.boxes[7].y).toBeGreaterThan(firstRow[0].y);
  }
  expect(new Set(allDates).size).toBe(allDates.length);
  await expect(scope.locator('[data-calendar-date][data-context-date]')).toHaveCount(0);
  await expect(
    scope.locator(
      '.calendar-padding[data-calendar-date], .calendar-padding[data-state], .calendar-padding[data-context-date]',
    ),
  ).toHaveCount(0);
}

function monthsInWindow(today: string, interval: Interval, offset = 0) {
  const window = periodWindow(today, interval, offset);
  const cursor = parseLocalDate(window.start);
  const months: string[] = [];
  while (civilDate(cursor) <= window.end) {
    const month = civilDate(cursor).slice(0, 7);
    if (!months.includes(month)) months.push(month);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return { months, window };
}

test('Recently created habits show inert dated hatch context distinct from selectable gray days', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await onDate(page, '2026-09-28');
  await complete(page, scheduledHabitGoals[1]);
  await onDate(page, '2026-10-03');
  await languageAndProgress(page, 'en');
  const habit = card(page, scheduledHabitGoals[1]);
  await assertMonths(habit, ['2026-08', '2026-09', '2026-10'], 'en', '2026-10-02', true);
  await expect(habit.locator('.tracking-since')).toHaveCount(0);
  await expect(habit.locator('.calendar-before')).toHaveCount(57);
  const inactive = before(habit, '2026-09-26');
  await expect(inactive).toHaveAttribute(
    'aria-label',
    `${fullDate('2026-09-26')} · Before tracking`,
  );
  await expect(inactive).toHaveAttribute('data-context', 'before-tracking');
  await expect(inactive).not.toHaveAttribute('data-state');
  await expect(inactive).not.toHaveAttribute('tabindex');
  expect(await inactive.evaluate((node) => node.tagName)).toBe('SPAN');
  await expect(habit.locator('.calendar-month[data-month="2026-08"]')).toContainText(
    'Before tracking',
  );
  await expect(habit.locator('.calendar-month[data-month="2026-08"] button')).toHaveCount(0);
  await expect(day(habit, '2026-09-26')).toHaveCount(0);
  const offday = day(habit, '2026-09-29');
  await expect(offday).toHaveAttribute('data-state', 'unscheduled');
  const paint = await inactive.evaluate((node) => ({
    image: getComputedStyle(node).backgroundImage,
    color: getComputedStyle(node).backgroundColor,
  }));
  const grayPaint = await offday.evaluate((node) => ({
    image: getComputedStyle(node).backgroundImage,
    color: getComputedStyle(node).backgroundColor,
  }));
  expect(paint.image).toContain('gradient');
  expect(grayPaint.image).toBe('none');
  expect(paint).not.toEqual(grayPaint);
  await expect(habit.locator('.period-fraction')).toHaveText('1/3 days completed');
  await expect(habit.locator('.period-percent')).toHaveText('33%');
  await expect(habit.locator('[data-live-streak="best"]')).toHaveText(/1\s+completion$/);
  const saved = await readDataset(page);
  const firstApplicable = day(habit, '2026-09-27');
  await firstApplicable.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(firstApplicable).toBeFocused();
  await inactive.click();
  await expect(main(page)).toBeVisible();
  await expect(detail(page)).toHaveCount(0);
  expect(await readDataset(page)).toEqual(saved);
  for (const tab of ['Habits', 'Pillars']) {
    await main(page).getByRole('tab', { name: tab, exact: true }).click();
    await noManualEntry(page);
    await expect(
      main(page).getByText('History through yesterday. Streaks include today.', { exact: true }),
    ).toHaveCount(1);
    await expect(
      main(page).locator('[data-calendar-date="2026-10-03"], [data-context-date="2026-10-03"]'),
    ).toHaveCount(0);
  }
});

test('All intervals align separate months and expose gray dated details with no manual picker', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await addBodyHabit(page);
  await onDate(page, '2026-10-02');
  await complete(page, scheduledHabitGoals[1]);
  await onDate(page, '2026-10-03');
  await languageAndProgress(page, 'en');
  for (const interval of intervals) {
    await main(page).getByRole('button', { name: interval, exact: true }).click();
    for (const tab of ['Habits', 'Pillars']) {
      await main(page).getByRole('tab', { name: tab, exact: true }).click();
      const scope = card(page, tab === 'Habits' ? scheduledHabitGoals[1] : 'Body');
      await noManualEntry(page);
      if (interval === '7d') {
        await expect(scope.locator('.day-number')).toHaveCount(7);
        await expect(scope.locator('[data-calendar-date], [data-context-date]')).toHaveCount(7);
      } else {
        const { months, window } = monthsInWindow('2026-10-03', interval);
        await assertMonths(
          scope,
          months,
          'en',
          window.historyEnd,
          interval === '1m' || interval === '3m',
        );
      }
      if (interval === '3m') {
        const septemberEnd = day(scope, '2026-09-30');
        await septemberEnd.focus();
        await page.keyboard.press('ArrowRight');
        await expect(day(scope, '2026-10-01')).toBeFocused();
        await page.keyboard.press('ArrowLeft');
        await expect(septemberEnd).toBeFocused();
      }
      const date = '2026-10-01';
      await expect(day(scope, date)).toHaveAttribute('data-state', 'unscheduled');
      await day(scope, date).click();
      await expect(
        detail(page).getByRole('heading', { name: fullDate(date), level: 1, exact: true }),
      ).toBeVisible();
      await expect(detail(page)).toContainText(
        tab === 'Habits'
          ? 'This habit was not scheduled on this day.'
          : 'No habits were scheduled for this pillar on this day.',
      );
      await expect(detail(page).getByRole('checkbox')).toHaveCount(0);
      await page.getByRole('button', { name: 'Back to Progress', exact: true }).click();
      await expect(day(scope, date)).toBeFocused();
      await expect(main(page).getByRole('button', { name: interval, exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    }
    const body = card(page, 'Body');
    await expect(day(body, '2026-10-02')).toHaveAttribute('data-state', 'partial');
    await day(body, '2026-10-02').click();
    await expect(detail(page)).toContainText('1/2 habits completed');
    await expect(detail(page)).toContainText('Partially completed');
    await page.getByRole('button', { name: 'Back to Progress', exact: true }).click();
  }
});

test('Dense leap-year history has exact month lengths and no cross-month duplicate dates', async ({
  page,
}) => {
  await restoreCalendarHistory(page);
  await languageAndProgress(page, 'en');
  const habit = card(page, scheduledHabitGoals[1]);
  for (const interval of ['1m', '3m', '12m', '24m'] as Interval[]) {
    await main(page).getByRole('button', { name: interval, exact: true }).click();
    for (const offset of [0, 1]) {
      if (offset)
        await main(page).getByRole('button', { name: 'Previous period', exact: true }).click();
      const { months, window } = monthsInWindow('2026-03-01', interval, offset);
      await assertMonths(
        habit,
        months,
        'en',
        window.historyEnd,
        interval === '1m' || interval === '3m',
      );
    }
  }
  await expect(
    habit.locator('.calendar-month[data-month="2024-02"] [data-calendar-date]'),
  ).toHaveCount(29);
  await expect(
    habit.locator('.calendar-month[data-month="2024-01"] [data-calendar-date]'),
  ).toHaveCount(31);
  await expect(day(habit, '2024-02-29')).toHaveAttribute('data-state', 'unscheduled');
  await day(habit, '2024-02-29').click();
  await expect(
    detail(page).getByRole('heading', { name: fullDate('2024-02-29'), level: 1, exact: true }),
  ).toBeVisible();
  await expect(detail(page).getByRole('checkbox')).toHaveCount(0);
});

test('Direct keyboard and pointer selection restore the previous month filter scroll and exact focus', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await addBodyHabit(page);
  await onDate(page, '2026-10-03');
  await languageAndProgress(page, 'en');
  await page.setViewportSize({ width: 390, height: 844 });
  const filters = main(page).locator('details.progress-filters');
  await filters.locator('summary').click();
  await main(page).getByLabel('Pillar filter', { exact: true }).selectOption('body');
  await main(page).getByRole('button', { name: '1m', exact: true }).click();
  await main(page).getByRole('button', { name: 'Previous period', exact: true }).click();
  const scope = card(page, longGoal);
  const origin = day(scope, '2026-09-28');
  const gray = day(scope, '2026-09-29');
  await origin.scrollIntoViewIfNeeded();
  await origin.focus();
  await page.keyboard.press('ArrowRight');
  await expect(gray).toBeFocused();
  await expect(scope.locator('[role="status"]')).toContainText(
    `${fullDate('2026-09-29')} · Not scheduled`,
  );
  expect(await gray.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe('none');
  const y = await page.evaluate(() => scrollY);
  const range = await main(page).locator('.period-navigation time').textContent();
  await page.keyboard.press('Space');
  await expect(
    detail(page).getByRole('heading', { name: fullDate('2026-09-29'), level: 1, exact: true }),
  ).toBeVisible();
  await expect(detail(page)).toContainText('This habit was not scheduled on this day.');
  await page.getByRole('button', { name: 'Back to Progress', exact: true }).click();
  await expect(gray).toBeFocused();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(y);
  await expect(filters).toHaveAttribute('open');
  await expect(main(page).getByLabel('Pillar filter', { exact: true })).toHaveValue('body');
  await expect(main(page).getByRole('tab', { name: 'Habits', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(main(page).getByRole('button', { name: '1m', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(main(page).locator('.period-navigation time')).toHaveText(range!);
  await expect(main(page).getByRole('button', { name: 'Next period', exact: true })).toBeEnabled();
  await page.keyboard.press('ArrowRight');
  const pointer = day(scope, '2026-09-30');
  await expect(pointer).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    detail(page).getByRole('heading', { name: fullDate('2026-09-30'), level: 1, exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back to Progress', exact: true }).click();
  await expect(pointer).toBeFocused();
  await pointer.click();
  await expect(detail(page)).toBeVisible();
  await page.getByRole('button', { name: 'Back to Progress', exact: true }).click();
  await expect(pointer).toBeFocused();
  await noManualEntry(page);
});

test('A new habit cannot hide older pillar and aggregate participation history', async ({
  page,
}) => {
  await restoreCalendarHistory(page);
  await addBodyHabit(page);
  await onDate(page, '2026-03-02');
  await languageAndProgress(page, 'en');
  const recent = card(page, longGoal);
  const old = card(page, scheduledHabitGoals[1]);
  await expect(recent.locator('.tracking-since')).toHaveCount(0);
  await expect(before(recent, '2026-02-27')).toHaveAttribute('data-context', 'before-tracking');
  await expect(day(recent, '2026-02-27')).toHaveCount(0);
  await expect(old.locator('.tracking-since')).toHaveCount(0);
  await expect(day(old, '2026-02-27')).toBeVisible();
  await main(page).getByRole('tab', { name: 'Pillars', exact: true }).click();
  for (const title of ['Body', 'All pillars together']) {
    const scope = card(page, title);
    await expect(scope.locator('.tracking-since')).toContainText('Tracking since Jan 1, 2024');
    await expect(before(scope, '2026-02-27')).toHaveCount(0);
    await expect(day(scope, '2026-02-27')).toBeVisible();
    await day(scope, '2026-02-27').click();
    await expect(detail(page)).toContainText(scheduledHabitGoals[1]);
    await expect(detail(page)).not.toContainText(longGoal);
    await page.getByRole('button', { name: 'Back to Progress', exact: true }).click();
  }
});

test('Arrow keys reach historical pillar days across inactive archival gaps without a date picker', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  const data = await readDataset(page);
  const habit = data.habits[0];
  archiveHabit(data, habit.id, new Date('2026-09-30T12:00:00'));
  reactivateHabit(data, habit.id, new Date('2026-10-17T12:00:00'));
  archiveHabit(data, habit.id, new Date('2026-10-21T12:00:00'));
  reactivateHabit(data, habit.id, new Date('2026-11-07T12:00:00'));
  await onDate(page, '2026-12-01');
  await nav(page, 'Settings').click();
  const { revision: _, ...portable } = data;
  await page.getByLabel('Choose backup file', { exact: true }).setInputFiles({
    name: 'isolated-gaps.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        format: 'my-goat-journey-backup',
        formatVersion: 1,
        exportedAt: '2026-12-01T12:00:00.000Z',
        dataset: portable,
      }),
    ),
  });
  await expect(page.getByText('Backup ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Replace current data', exact: true }).click();
  await expect(page.getByText('Backup restored.', { exact: true })).toBeVisible();
  await languageAndProgress(page, 'en');
  await main(page).getByRole('tab', { name: 'Pillars', exact: true }).click();
  const scope = card(page, 'Mind');
  await expect(day(scope, '2026-10-01')).toHaveCount(0);
  await expect(before(scope, '2026-10-01')).toHaveCount(0);
  await day(scope, '2026-09-30').focus();
  await page.keyboard.press('ArrowRight');
  await expect(day(scope, '2026-10-19')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(day(scope, '2026-09-30')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(day(scope, '2026-10-19')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    detail(page).getByRole('heading', { name: fullDate('2026-10-19'), exact: true, level: 1 }),
  ).toBeVisible();
  await expect(detail(page).getByRole('checkbox')).toHaveCount(0);
});

test('Changing periods clears the announcement for a focused date no longer in the displayed window', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await onDate(page, '2026-10-03');
  await languageAndProgress(page, 'en');
  await main(page).getByRole('button', { name: '1m', exact: true }).click();
  const scope = card(page, scheduledHabitGoals[1]);
  await day(scope, '2026-10-01').focus();
  await expect(scope.locator('[role="status"]')).toContainText(fullDate('2026-10-01'));
  await main(page).getByRole('button', { name: 'Previous period', exact: true }).click();
  await expect(scope.locator('[role="status"]')).toHaveText('');
  await expect(scope.locator('[data-calendar-date="2026-10-01"]')).toHaveCount(0);
});

for (const language of ['en', 'pt'] as const) {
  for (const density of ['recent', 'dense'] as const) {
    test(`Monthly ${density} history screenshots preserve ${language} desktop mobile enlarged text and long goals`, async ({
      page,
    }) => {
      if (density === 'dense') await restoreCalendarHistory(page);
      else {
        await setupScheduledHabits(page);
        await addBodyHabit(page);
        await onDate(page, '2026-10-02');
        await complete(page, scheduledHabitGoals[1]);
        await onDate(page, '2026-10-03');
      }
      await languageAndProgress(page, language);
      const scope = card(page, density === 'recent' ? longGoal : scheduledHabitGoals[1]);
      await noManualEntry(page, language);
      await expect(
        main(page).getByText(
          language === 'en'
            ? 'History through yesterday. Streaks include today.'
            : 'Histórico até ontem. As sequências incluem hoje.',
          { exact: true },
        ),
      ).toHaveCount(1);
      if (density === 'recent') {
        await expect(scope.locator('.tracking-since')).toHaveCount(0);
        await expect(before(scope, '2026-09-26')).toHaveAttribute(
          'aria-label',
          `${fullDate('2026-09-26', language)} · ${language === 'en' ? 'Before tracking' : 'Antes do início'}`,
        );
        await expect(scope.getByRole('heading', { name: longGoal, exact: true })).toHaveCSS(
          'white-space',
          'pre-wrap',
        );
      }
      for (const view of [
        { width: 1280, text: 100 },
        { width: 320, text: 100 },
        { width: 390, text: 100 },
        { width: 320, text: 200 },
      ]) {
        await page.setViewportSize({ width: view.width, height: 900 });
        await page.evaluate((text) => {
          document.documentElement.style.fontSize = `${text}%`;
        }, view.text);
        await scope.getByRole('heading', { level: 2 }).scrollIntoViewIfNeeded();
        await noOverflow(page);
        const { months, window } = monthsInWindow(
          density === 'recent' ? '2026-10-03' : '2026-03-01',
          '3m',
        );
        await assertMonths(scope, months, language, window.historyEnd, true);
        await page.screenshot({
          path: `${screenshots}/${density}-habits-${language}-text${view.text}-${view.width}.png`,
        });
        await scope
          .locator('.calendar-month')
          .first()
          .evaluate((node) => node.scrollIntoView({ block: 'center' }));
        await page.screenshot({
          path: `${screenshots}/${density}-calendar-${language}-text${view.text}-${view.width}.png`,
        });
        if (view.width === 1280)
          await scope.screenshot({ path: `${screenshots}/${density}-card-${language}-1280.png` });
        // Numbered month blocks must stack on a phone rather than squeeze seven dates.
        if (view.width <= 390) {
          const boxes = await scope.locator('.calendar-month').evaluateAll((nodes) =>
            nodes.map((node) => ({
              x: node.getBoundingClientRect().x,
              y: node.getBoundingClientRect().y,
            })),
          );
          expect(new Set(boxes.map((box) => Math.round(box.x))).size).toBe(1);
          expect(boxes[1].y).toBeGreaterThan(boxes[0].y);
        }
      }
      for (const interval of ['12m', '24m'] as const) {
        await main(page).getByRole('button', { name: interval, exact: true }).click();
        const { months, window } = monthsInWindow(
          density === 'recent' ? '2026-10-03' : '2026-03-01',
          interval,
        );
        await assertMonths(scope, months, language, window.historyEnd, false);
        await noOverflow(page);
        await scope.locator('.calendar-month').first().scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `${screenshots}/${density}-${interval}-${language}-text200-320.png`,
        });
      }
    });
  }
}
