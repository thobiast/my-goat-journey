import {
  backControl,
  expandFixturePillars,
  expectReview,
  openReviewSupporting,
} from './support/management-fixtures';
import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  nav,
  onDate,
  readDataset,
  setupScheduledHabits,
  scheduledHabitGoals,
} from './support/habit-fixtures';

// Each Playwright test receives its own context and injected local clock.
// All facts are created through the UI; this suite never seeds the normal diary.
test.setTimeout(90_000);

const intervals = ['7d', '1m', '3m', '12m', '24m'] as const;

const progress = (page: Page) => page.locator('main.progress-page');

const card = (page: Page, title: string) =>
  progress(page)
    .locator('article.consistency-card')
    .filter({ has: page.getByRole('heading', { name: title, exact: true, level: 2 }) });

const day = (scope: Locator, date: string) => scope.locator(`button[data-calendar-date="${date}"]`);

async function openProgress(page: Page) {
  await nav(page, 'Progress').click();
  await expect(
    page.getByRole('heading', { name: 'Progress', exact: true, level: 1 }),
  ).toBeVisible();
}

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await page.screenshot({
      path: `artifacts/progress-redesign/screenshots/red-${testInfo.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`,
      fullPage: true,
    });
  }
});

test('Progress defaults to a shared seven-day interval ending yesterday', async ({ page }) => {
  await setupScheduledHabits(page);
  await onDate(page, '2026-10-03');
  await openProgress(page);

  // First vertical slice: shared intervals and dated calendars inside the Progress route.
  await expect(page.getByRole('button', { name: '7d', exact: true })).toBeVisible({
    timeout: 1500,
  });
  for (const interval of intervals) {
    await expect(
      progress(page).getByRole('button', { name: interval, exact: true }),
    ).toHaveAttribute('aria-pressed', interval === '7d' ? 'true' : 'false');
  }
  await expect(progress(page).getByRole('tab', { name: 'Habits', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(progress(page).locator('article.consistency-card')).toHaveCount(4);
  for (const goal of scheduledHabitGoals) {
    const habit = card(page, goal);
    await expect(habit.getByRole('heading', { name: goal, exact: true })).toBeVisible();
    await expect(day(habit, '2026-10-02')).toHaveAttribute('data-state', 'incomplete');
    await expect(day(habit, '2026-10-03')).toHaveCount(0);
    await expect(habit.locator('.calendar-before').first()).toBeVisible();
    await expect(habit.locator('.calendar-month')).toHaveCount(0);
    await expect(habit.locator('.week-strip')).toHaveCount(1);
    await expect(habit.locator('.consistency-summary')).toContainText('Current streak');
    await expect(habit.locator('.consistency-summary')).toContainText('Best streak');
  }
  await page.screenshot({
    path: 'artifacts/progress-redesign/screenshots/default-en-360.png',
    fullPage: true,
  });
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const tab of ['Habits', 'Pillars']) {
      await progress(page).getByRole('tab', { name: tab, exact: true }).click();
      await noOverflow(page);
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        path: `artifacts/progress-redesign/screenshots/${tab.toLowerCase()}-en-normal-${width}.png`,
        fullPage: true,
      });
      await page.screenshot({
        path: `artifacts/progress-redesign/screenshots/${tab.toLowerCase()}-en-normal-${width}-viewport.png`,
      });
    }
  }
});

const secondBodyGoal = 'Stretch gently at my own pace';
const longGoal =
  'Walk calmly through my neighborhood, notice the trees and return at my own pace without rushing or comparing myself to anyone else';

const dayPage = (page: Page) => page.locator('main.progress-day-page');

async function addBodyHabit(page: Page, goal = secondBodyGoal) {
  await nav(page, 'Today').click();
  await page.getByRole('button', { name: 'Add habit', exact: true }).click();
  await page.getByLabel('Pillar', { exact: true }).selectOption('body');
  await page.getByLabel('What do you want to do?').fill(goal);
  // The initial default is daily; match the existing four M/W/F habits.
  for (const weekday of ['Sunday', 'Tuesday', 'Thursday', 'Saturday']) {
    await page.getByRole('button', { name: weekday, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Save habit', exact: true }).click();
  await expect(page.getByRole('heading', { name: goal, exact: true })).toBeVisible();
}

async function complete(page: Page, goal: string) {
  const done = page.getByRole('checkbox', { name: `Done: ${goal}`, exact: true });
  await done.click();
  await expect(done).toBeChecked();
  await expect(done).toBeEnabled();
}

async function fullDate(page: Page, date: string, language = 'en') {
  return page.evaluate(
    ({ date, language }) =>
      new Intl.DateTimeFormat(language === 'pt' ? 'pt-BR' : 'en', { dateStyle: 'full' }).format(
        new Date(`${date}T12:00:00`),
      ),
    { date, language },
  );
}

async function openDay(page: Page, scope: Locator, date: string) {
  await day(scope, date).click();
  await expect(
    dayPage(page).getByRole('heading', { name: await fullDate(page, date), exact: true, level: 1 }),
  ).toBeVisible();
}

async function returnToProgress(page: Page) {
  await page.getByRole('button', { name: 'Back to Progress', exact: true }).click();
  await expect(progress(page)).toBeVisible();
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('Pillar calendars distinguish partial required agendas from individual binary completion and gray off-days', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await addBodyHabit(page);
  for (const date of ['2026-09-28', '2026-09-30']) {
    await onDate(page, date);
    for (const goal of [...scheduledHabitGoals, secondBodyGoal]) await complete(page, goal);
  }
  await onDate(page, '2026-10-02');
  await complete(page, scheduledHabitGoals[1]);
  await onDate(page, '2026-10-03');
  await openProgress(page);
  await expect(day(card(page, scheduledHabitGoals[1]), '2026-10-02')).toHaveAttribute(
    'data-state',
    'completed',
  );
  await expect(day(card(page, secondBodyGoal), '2026-10-02')).toHaveAttribute(
    'data-state',
    'incomplete',
  );
  await progress(page).getByRole('tab', { name: 'Pillars', exact: true }).click();
  await expect(progress(page).locator('article.consistency-card')).toHaveCount(5);
  const body = card(page, 'Body');
  const all = card(page, 'All pillars together');
  for (const scope of [body, all]) {
    await expect(day(scope, '2026-09-28')).toHaveAttribute('data-state', 'completed');
    await expect(day(scope, '2026-09-29')).toHaveAttribute('data-state', 'unscheduled');
    await expect(day(scope, '2026-10-02')).toHaveAttribute('data-state', 'partial');
    await expect(scope.locator('.period-percent')).toHaveText('67%');
    await expect(scope).toContainText('2/3 days completed');
  }
  await expect(day(card(page, 'Mind'), '2026-10-02')).toHaveAttribute('data-state', 'incomplete');
  await expect(day(body, '2026-10-02')).toHaveAttribute(
    'aria-label',
    `${await fullDate(page, '2026-10-02')} · Partially completed`,
  );
  await openDay(page, body, '2026-10-02');
  await expect(dayPage(page)).toContainText('Partially completed');
  await expect(dayPage(page)).toContainText('1/2 habits completed');
  await expect(dayPage(page)).toContainText(scheduledHabitGoals[1]);
  await expect(dayPage(page)).toContainText(secondBodyGoal);
  await expect(
    dayPage(page).getByRole('button', { name: 'Manage habit', exact: true }),
  ).toHaveCount(2);
  await page.screenshot({
    path: 'artifacts/progress-redesign/screenshots/partial-body-en-360.png',
    fullPage: true,
  });
});

test('Gray day details explain neutrality and cannot navigate outside the closed period', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await onDate(page, '2026-10-03');
  await openProgress(page);
  await progress(page).getByRole('button', { name: '1m', exact: true }).click();
  const habit = card(page, scheduledHabitGoals[1]);
  await expect(day(habit, '2026-10-01')).toHaveAttribute('data-state', 'unscheduled');
  await openDay(page, habit, '2026-10-01');
  await expect(dayPage(page)).toContainText('Not scheduled');
  await expect(dayPage(page)).toContainText('This habit was not scheduled on this day.');
  await expect(dayPage(page).getByRole('checkbox')).toHaveCount(0);
  await expect(
    dayPage(page).getByRole('button', { name: 'Previous day', exact: true }),
  ).toBeDisabled();
  await dayPage(page).getByRole('button', { name: 'Next day', exact: true }).click();
  await expect(
    dayPage(page).getByRole('heading', {
      name: await fullDate(page, '2026-10-02'),
      exact: true,
      level: 1,
    }),
  ).toBeVisible();
  await expect(dayPage(page).getByRole('button', { name: 'Next day', exact: true })).toBeDisabled();
  await returnToProgress(page);
  await progress(page).getByRole('tab', { name: 'Pillars', exact: true }).click();
  await openDay(page, card(page, 'All pillars together'), '2026-10-01');
  await expect(dayPage(page)).toContainText('No habits were scheduled on this day.');
  await expect(dayPage(page).getByRole('checkbox')).toHaveCount(0);
  await page.screenshot({
    path: 'artifacts/progress-redesign/screenshots/neutral-all-en-360.png',
    fullPage: true,
  });
});

test('Shared interval and month navigation respect creation boundaries with honest zero eligibility', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await nav(page, 'Pillars').click();
  await expandFixturePillars(page);
  await page.getByRole('button', { name: 'New pillar', exact: true }).click();
  await page.getByLabel('Pillar name', { exact: true }).fill('Music & imagination');
  await page.getByRole('button', { name: 'Save pillar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pillars', exact: true, level: 1 })).toBeVisible();
  await expandFixturePillars(page, ['Music & imagination']);
  await expect(
    page.getByRole('region', { name: 'Music & imagination', exact: true }),
  ).toContainText('No habits yet.');
  await onDate(page, '2026-10-03');
  await openProgress(page);
  await progress(page).getByRole('button', { name: '1m', exact: true }).click();
  const previous = progress(page).getByRole('button', { name: 'Previous period', exact: true });
  const next = progress(page).getByRole('button', { name: 'Next period', exact: true });
  await expect(previous).toBeEnabled();
  await expect(next).toBeDisabled();
  await previous.click();
  for (const goal of scheduledHabitGoals) {
    await expect(day(card(page, goal), '2026-09-26')).toHaveCount(0);
    await expect(day(card(page, goal), '2026-09-27')).toHaveAttribute('data-state', 'unscheduled');
    await expect(day(card(page, goal), '2026-09-30')).toBeVisible();
    await expect(day(card(page, goal), '2026-10-01')).toHaveCount(0);
  }
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();
  await progress(page).getByRole('tab', { name: 'Pillars', exact: true }).click();
  await expect(progress(page).getByRole('button', { name: '1m', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(day(card(page, 'Body'), '2026-09-30')).toBeVisible();
  const empty = card(page, 'Music & imagination');
  await expect(empty.locator('.period-percent')).toHaveText('—');
  await expect(empty).toContainText('No scheduled days in this period.');
  await expect(empty.locator('[data-calendar-date]')).toHaveCount(0);
  await next.click();
  await expect(day(card(page, 'Body'), '2026-10-02')).toBeVisible();
  await expect(next).toBeDisabled();
  await page.screenshot({
    path: 'artifacts/progress-redesign/screenshots/empty-pillar-en-360.png',
    fullPage: true,
  });
});

test('Live current and best streaks include today without adding today to history percentages', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  for (const date of ['2026-09-28', '2026-09-30', '2026-10-02']) {
    await onDate(page, date);
    for (const goal of scheduledHabitGoals) await complete(page, goal);
  }
  await openProgress(page);
  const habit = card(page, scheduledHabitGoals[1]);
  await expect(day(habit, '2026-10-02')).toHaveCount(0);
  await expect(day(habit, '2026-10-01')).toHaveAttribute('data-state', 'unscheduled');
  await expect(habit.locator('.period-percent')).toHaveText('100%');
  await expect(habit).toContainText('2/2 days completed');
  for (const metric of ['current', 'best']) {
    await expect(habit.locator(`[data-live-streak="${metric}"]`)).toHaveText(/3\s+completions/);
  }
  await expect(
    progress(page).getByText('History through yesterday. Streaks include today.', { exact: true }),
  ).toHaveCount(1);
  await progress(page).getByRole('tab', { name: 'Pillars', exact: true }).click();
  for (const title of ['All pillars together', 'Mind', 'Body', 'Nutrition', 'Hygiene']) {
    const scope = card(page, title);
    await expect(scope.locator('.period-percent')).toHaveText('100%');
    await expect(scope).toContainText('2/2 days completed');
    await expect(scope.locator('[data-live-streak="current"]')).toHaveText(/3\s+days/);
    await expect(day(scope, '2026-10-02')).toHaveCount(0);
  }
});

test('Returning from day and nested habit management restores filters interval scroll and exact origin focus', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await addBodyHabit(page);
  await onDate(page, '2026-10-03');
  await openProgress(page);
  const filters = progress(page)
    .locator('details')
    .filter({ has: page.locator('summary').filter({ hasText: /^Filters$/ }) });
  await expect(filters).not.toHaveAttribute('open');
  await filters.locator('summary').click();
  await progress(page).getByLabel('Pillar filter', { exact: true }).selectOption('body');
  await progress(page).getByRole('button', { name: '7d', exact: true }).click();
  await expect(progress(page).locator('article.consistency-card')).toHaveCount(2);
  const origin = day(card(page, secondBodyGoal), '2026-10-02');
  await origin.scrollIntoViewIfNeeded();
  await origin.focus();
  const y = await page.evaluate(() => scrollY);
  await page.keyboard.press('Enter');
  await expect(dayPage(page)).toBeVisible();
  const manage = dayPage(page).getByRole('button', { name: 'Manage habit', exact: true });
  await manage.scrollIntoViewIfNeeded();
  await manage.focus();
  const detailY = await page.evaluate(() => scrollY);
  await manage.click();
  await expectReview(page, secondBodyGoal);
  await backControl(page).click();
  await expect(manage).toBeFocused();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(detailY);
  await returnToProgress(page);
  await expect(filters).toHaveAttribute('open');
  await expect(progress(page).getByLabel('Pillar filter', { exact: true })).toHaveValue('body');
  await expect(progress(page).getByRole('button', { name: '7d', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(origin).toBeFocused();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(y);
  await expect(nav(page, 'Progress')).toHaveAttribute('aria-current', 'page');
});

test('Allowed corrections recalculate calendar and live metrics while older historical days remain read-only', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  for (const date of ['2026-09-28', '2026-09-30', '2026-10-02']) {
    await onDate(page, date);
    await complete(page, scheduledHabitGoals[1]);
  }
  await onDate(page, '2026-10-03');
  await openProgress(page);
  await openDay(page, card(page, scheduledHabitGoals[1]), '2026-10-02');
  await dayPage(page).getByRole('button', { name: 'Manage habit', exact: true }).click();
  await openReviewSupporting(page);
  const correction = page.getByRole('checkbox', { name: /Done: Complete my walk.*Oct 2/ });
  await expect(correction).toBeChecked();
  await expect(page.getByRole('checkbox')).toHaveCount(1);
  await correction.click();
  await expect(correction).not.toBeChecked();
  await expect(page.getByText('20 XP', { exact: true })).toBeVisible();
  await backControl(page).click();
  await expect(dayPage(page)).toContainText('Not completed');
  await returnToProgress(page);
  const habit = card(page, scheduledHabitGoals[1]);
  await expect(day(habit, '2026-10-02')).toHaveAttribute('data-state', 'incomplete');
  await expect(habit.locator('.period-percent')).toHaveText('67%');
  await expect(habit).toContainText('2/3 days completed');
  await expect(habit.locator('[data-live-streak="current"]')).toHaveText(/0\s+completions/);
  await expect(habit.locator('[data-live-streak="best"]')).toHaveText(/2\s+completions/);
  const saved = await readDataset(page);
  await openDay(page, habit, '2026-09-28');
  await expect(dayPage(page)).toContainText('Completed');
  await expect(dayPage(page).getByRole('checkbox')).toHaveCount(0);
  await expect(dayPage(page)).not.toContainText('Done:');
  expect(await readDataset(page)).toEqual(saved);
  await page.screenshot({
    path: 'artifacts/progress-redesign/screenshots/old-readonly-en-360.png',
    fullPage: true,
  });
});

test('Keyboard calendar navigation opens a fully dated day and returns focus without a pointer', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await onDate(page, '2026-10-03');
  await openProgress(page);
  await progress(page).getByRole('button', { name: '1m', exact: true }).click();
  const habit = card(page, scheduledHabitGoals[1]);
  const first = day(habit, '2026-10-01');
  const last = day(habit, '2026-10-02');
  await first.focus();
  await page.keyboard.press('ArrowRight');
  await expect(last).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    dayPage(page).getByRole('heading', {
      name: await fullDate(page, '2026-10-02'),
      exact: true,
      level: 1,
    }),
  ).toBeVisible();
  const back = page.getByRole('button', { name: 'Back to Progress', exact: true });
  await back.focus();
  await page.keyboard.press('Enter');
  await expect(last).toBeFocused();
  await page.keyboard.press('Home');
  await expect(first).toBeFocused();
  await page.keyboard.press('End');
  await expect(last).toBeFocused();
});

test('Direct Enter and Space day selection and arrow-key tabs provide accessible navigation without date entry', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await onDate(page, '2026-10-03');
  await openProgress(page);
  const habits = progress(page).getByRole('tab', { name: 'Habits', exact: true });
  const pillars = progress(page).getByRole('tab', { name: 'Pillars', exact: true });
  await habits.focus();
  await page.keyboard.press('ArrowRight');
  await expect(pillars).toBeFocused();
  await expect(pillars).toHaveAttribute('aria-selected', 'true');
  await expect(habits).toHaveAttribute('aria-selected', 'false');
  await expect(progress(page).getByLabel('Pillar filter', { exact: true })).toHaveCount(0);
  await page.keyboard.press('ArrowLeft');
  await expect(habits).toBeFocused();
  await expect(habits).toHaveAttribute('aria-selected', 'true');
  await progress(page).getByRole('button', { name: '1m', exact: true }).click();
  await expect(progress(page).locator('input[type="date"]')).toHaveCount(0);
  await expect(progress(page).getByLabel('Calendar date', { exact: true })).toHaveCount(0);
  const selected = day(card(page, scheduledHabitGoals[1]), '2026-10-02');
  await selected.focus();
  await page.keyboard.press('Enter');
  await expect(
    dayPage(page).getByRole('heading', {
      name: await fullDate(page, '2026-10-02'),
      exact: true,
      level: 1,
    }),
  ).toBeVisible();
  await expect(dayPage(page)).toContainText(scheduledHabitGoals[1]);
  await expect(dayPage(page)).toContainText('Not completed');
  await returnToProgress(page);
  await expect(progress(page).getByRole('button', { name: '1m', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(selected).toBeFocused();
  await page.keyboard.press('Space');
  await expect(
    dayPage(page).getByRole('heading', {
      name: await fullDate(page, '2026-10-02'),
      exact: true,
      level: 1,
    }),
  ).toBeVisible();
  await expect(dayPage(page)).toContainText('Not completed');
});

test('Native day-detail correction saves the same occurrence and recalculates on return', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  for (const date of ['2026-09-28', '2026-09-30', '2026-10-02']) {
    await onDate(page, date);
    await complete(page, scheduledHabitGoals[1]);
  }
  await onDate(page, '2026-10-03');
  await openProgress(page);
  const original = await readDataset(page);
  await openDay(page, card(page, scheduledHabitGoals[1]), '2026-10-02');
  const correction = dayPage(page).getByRole('checkbox', { name: /Done: Complete my walk.*Oct 2/ });
  await expect(correction).toBeChecked();
  await correction.focus();
  await page.keyboard.press('Space');
  await expect(correction).not.toBeChecked();
  await expect(correction).toBeEnabled();
  await expect(correction).toBeFocused();
  await expect(dayPage(page).locator('.day-state')).toContainText('Not completed');
  await returnToProgress(page);
  await expect(card(page, scheduledHabitGoals[1]).locator('.period-percent')).toHaveText('67%');
  await openDay(page, card(page, scheduledHabitGoals[1]), '2026-10-02');
  await correction.focus();
  await page.keyboard.press('Space');
  await expect(correction).toBeChecked();
  await expect(correction).toBeEnabled();
  await expect(correction).toBeFocused();
  await expect(dayPage(page).locator('.day-state')).toContainText('Completed');
  const restored = await readDataset(page);
  expect(restored.occurrences).toEqual(original.occurrences);
  expect(restored.permanentUnlocks).toEqual(original.permanentUnlocks);
  await returnToProgress(page);
  await expect(card(page, scheduledHabitGoals[1]).locator('.period-percent')).toHaveText('100%');
  await expect(card(page, scheduledHabitGoals[1])).toContainText('3/3 days completed');
});

for (const language of ['en', 'pt'] as const) {
  test(`Long full goals and 12/24 separate months fit 320px at 200% text in ${language}`, async ({
    page,
  }) => {
    await setupScheduledHabits(page);
    await addBodyHabit(page, longGoal);
    await onDate(page, '2026-10-03');
    if (language === 'pt') {
      await nav(page, 'Settings').click();
      await page.getByLabel('Language', { exact: true }).selectOption('pt');
      await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
    }
    await nav(page, language === 'en' ? 'Progress' : 'Progresso').click();
    await page.setViewportSize({ width: 320, height: 900 });
    await noOverflow(page);
    await page.screenshot({
      path: `artifacts/progress-redesign/screenshots/long-${language}-normal-320.png`,
      fullPage: true,
    });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    const habit = card(page, longGoal);
    const title = habit.getByRole('heading', { name: longGoal, exact: true, level: 2 });
    await expect(title).toHaveText(longGoal);
    await expect(title).toHaveCSS('white-space', 'pre-wrap');
    for (const interval of ['12m', '24m'] as const) {
      await progress(page).getByRole('button', { name: interval, exact: true }).click();
      for (const scope of await progress(page).locator('article.consistency-card').all()) {
        await expect(scope.locator('.calendar-month')).toHaveCount(interval === '12m' ? 12 : 24);
        await expect(scope.locator('.day-number')).toHaveCount(0);
        for (const month of await scope.locator('.calendar-month').all()) {
          const dimensions = await month.evaluate((node) => {
            const grid = node.querySelector('.monthly-grid') as HTMLElement;
            return {
              columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
              width: node.clientWidth,
              scrollWidth: node.scrollWidth,
            };
          });
          expect(dimensions.columns).toBe(7);
          expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
        }
      }
      await noOverflow(page);
      await title.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `artifacts/progress-redesign/screenshots/long-${interval}-${language}-text200-320.png`,
      });
    }
    const origin = day(habit, '2026-10-02');
    await expect(origin).toHaveAttribute(
      'aria-label',
      `${await fullDate(page, '2026-10-02', language)} · ${language === 'en' ? 'Not completed' : 'Não concluído'}`,
    );
    await origin.click();
    await expect(
      dayPage(page).getByRole('heading', {
        name: await fullDate(page, '2026-10-02', language),
        exact: true,
        level: 1,
      }),
    ).toBeVisible();
    await expect(dayPage(page)).toContainText(longGoal);
    await expect(
      dayPage(page).getByRole('button', {
        name: language === 'en' ? 'Back to Progress' : 'Voltar ao Progresso',
        exact: true,
      }),
    ).toBeVisible();
    await noOverflow(page);
    await page.screenshot({
      path: `artifacts/progress-redesign/screenshots/day-${language}-text200-320.png`,
      fullPage: true,
    });
  });
}
