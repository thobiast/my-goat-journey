import { test, expect, type Page } from '@playwright/test';
import en from '../src/i18n/en.json' with { type: 'json' };
import pt from '../src/i18n/pt.json' with { type: 'json' };
import {
  setupScheduledHabits,
  scheduledHabitGoals,
  nav,
  onDate,
  readDataset,
  abortNextWrite,
} from './support/habit-fixtures';
import { updateCompletion } from '../src/domain/completion';
import { calculateProgress } from '../src/domain/progress';
import { archiveHabit } from '../src/domain/lifecycle';
import type { Dataset } from '../src/domain/types';

test.setTimeout(90_000);
test.use({ actionTimeout: 10_000 });
let base: Dataset;
test.beforeAll(async ({ browser }, info) => {
  info.setTimeout(90_000);
  const page = await browser.newPage();
  try {
    await setupScheduledHabits(page);
    base = await readDataset(page);
  } finally {
    await page.close();
  }
});

async function install(page: Page, data: Dataset, date: string) {
  await page.clock.install({ time: new Date(`${date}T12:00:00`) });
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

async function language(page: Page, lang: 'en' | 'pt') {
  if (lang === 'pt') {
    await nav(page, 'Settings').click();
    await page.getByLabel('Language', { exact: true }).selectOption('pt');
    await nav(page, 'Hoje').click();
  }
  return lang === 'en' ? en : pt;
}

const banner = (page: Page) => page.locator('.today-complete');

const count = (page: Page) => page.locator('.today-header .today-count');

const check = (page: Page, copy: typeof en, goal: string) =>
  page.getByRole('checkbox', { name: `${copy.done}: ${goal}`, exact: true });

for (const lang of ['en', 'pt'] as const)
  test(`Daily recognition follows committed eligibility, correction, reload and midnight ${lang}`, async ({
    page,
  }) => {
    await install(page, base, '2026-09-27');
    const copy = await language(page, lang);
    await expect(banner(page)).toHaveCount(0);
    await expect(count(page)).toHaveText(copy.noRequired);
    await check(page, copy, scheduledHabitGoals[0]).click();
    await expect(check(page, copy, scheduledHabitGoals[0])).toBeChecked();
    await expect(banner(page)).toContainText(copy.todayAllCompleted);
    await expect(count(page)).toHaveText(copy.noRequired);
    await check(page, copy, scheduledHabitGoals[0]).click();
    await expect(check(page, copy, scheduledHabitGoals[0])).not.toBeChecked();
    await expect(banner(page)).toHaveCount(0);
    await onDate(page, '2026-10-02');
    await expect(count(page)).toHaveText(
      copy.todayCompletionCount.replace('{done}', '0').replace('{total}', '4'),
    );
    for (const goal of scheduledHabitGoals.slice(0, 3)) {
      await check(page, copy, goal).click();
      await expect(check(page, copy, goal)).toBeChecked();
    }
    await expect(banner(page)).toHaveCount(0);
    const before = await readDataset(page);
    await abortNextWrite(page);
    await check(page, copy, scheduledHabitGoals[3]).click();
    await expect(page.getByRole('alert')).toContainText(copy.saveError);
    await expect(banner(page)).toHaveCount(0);
    expect(await readDataset(page)).toEqual(before);
    await page.getByRole('button', { name: copy.retry, exact: true }).click();
    await expect(check(page, copy, scheduledHabitGoals[3])).toBeChecked();
    await expect(banner(page)).toContainText(copy.todayAllCompleted);
    await expect(count(page)).toHaveText(
      copy.todayCompletionCount.replace('{done}', '4').replace('{total}', '4'),
    );
    const complete: Dataset = await readDataset(page);
    expect(calculateProgress(complete, '2026-10-02').totalXp).toBe(40);
    expect(complete.permanentUnlocks).toEqual(base.permanentUnlocks);
    await page.reload();
    await expect(banner(page)).toContainText(copy.todayAllCompleted);
    expect(await readDataset(page)).toEqual(complete);
    await check(page, copy, scheduledHabitGoals[3]).click();
    await expect(check(page, copy, scheduledHabitGoals[3])).not.toBeChecked();
    await expect(banner(page)).toHaveCount(0);
    await expect(count(page)).toHaveText(
      copy.todayCompletionCount.replace('{done}', '3').replace('{total}', '4'),
    );
    await check(page, copy, scheduledHabitGoals[3]).click();
    await expect(check(page, copy, scheduledHabitGoals[3])).toBeChecked();
    await expect(banner(page)).toContainText(copy.todayAllCompleted);
    const prior = await readDataset(page);
    await page.clock.setSystemTime(new Date('2026-10-02T23:59:30'));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.clock.runFor(31_000);
    await expect(page.locator('.today-header time')).toHaveAttribute('datetime', '2026-10-03');
    await expect(banner(page)).toHaveCount(0);
    await expect(count(page)).toHaveText(copy.noRequired);
    expect(await readDataset(page)).toEqual(prior);
    await onDate(page, '2026-10-05');
    await expect(banner(page)).toHaveCount(0);
    await expect(count(page)).toHaveText(
      copy.todayCompletionCount.replace('{done}', '0').replace('{total}', '4'),
    );
  });

for (const lang of ['en', 'pt'] as const)
  test(`Optional additions and unfinished exemptions do not block eligible completion ${lang}`, async ({
    page,
  }) => {
    const data = structuredClone(base);
    const now = new Date('2026-10-02T12:00:00');
    for (const habit of data.habits.slice(0, 3))
      updateCompletion(data, habit.id, '2026-10-02', true, now);
    archiveHabit(data, data.habits[3].id, now);
    const optional = structuredClone(base.habits[0]);
    optional.id = 'new-optional';
    optional.createdOn = '2026-10-02';
    optional.versions[0].effectiveFrom = '2026-10-02';
    optional.memberships[0].effectiveFrom = '2026-10-02';
    optional.periods[0].start = '2026-10-02';
    data.habits.push(optional);
    const notDue = structuredClone(base.habits[0]);
    notDue.id = 'not-due';
    notDue.versions[0].weekdays = [4];
    data.habits.push(notDue);
    await install(page, data, '2026-10-02');
    const copy = await language(page, lang);
    await expect(banner(page)).toContainText(copy.todayAllCompleted);
    await expect(count(page)).toHaveText(
      copy.todayCompletionCount.replace('{done}', '3').replace('{total}', '3'),
    );
    await expect(
      page
        .locator('article')
        .filter({ has: page.getByRole('heading', { name: scheduledHabitGoals[0], exact: true }) })
        .last()
        .getByRole('checkbox'),
    ).not.toBeChecked();
    const stable = await readDataset(page);
    await page.reload();
    await expect(banner(page)).toContainText(copy.todayAllCompleted);
    expect(await readDataset(page)).toEqual(stable);
  });

test('A truly empty day keeps the neutral header with no stored recognition', async ({ page }) => {
  const data = structuredClone(base);
  data.habits = [];
  await install(page, data, '2026-10-02');
  await expect(banner(page)).toHaveCount(0);
  await expect(count(page)).toHaveText(en.noRequired);
  expect(await readDataset(page)).toEqual(data);
});

for (const lang of ['en', 'pt'] as const)
  for (const width of [320, 375, 390, 393, 402, 430, 440, 1280])
    for (const text of [100, 200])
      test(`Completed header ${lang} ${width}px text${text}`, async ({ page }) => {
        const data = structuredClone(base);
        const now = new Date('2026-10-02T12:00:00');
        for (const habit of data.habits) updateCompletion(data, habit.id, '2026-10-02', true, now);
        await page.setViewportSize({ width, height: 900 });
        await install(page, data, '2026-10-02');
        const copy = await language(page, lang);
        await page.addStyleTag({ content: `html {font-size:${text}%}` });
        await page.evaluate(() => scrollTo(0, 0));
        await expect(banner(page)).toContainText(copy.todayAllCompleted);
        await expect(count(page)).toHaveText(
          copy.todayCompletionCount.replace('{done}', '4').replace('{total}', '4'),
        );
        await expect(banner(page)).not.toHaveAttribute('aria-live');
        await expect(banner(page).locator('svg')).toHaveAttribute('aria-hidden', 'true');
        await expect(banner(page).locator('svg')).toHaveAttribute('focusable', 'false');
        await expect(banner(page).getByRole('img')).toHaveCount(0);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        const geometry = await page.locator('.today-header').evaluate((header) => {
          const rect = (selector: string) => {
            const r = header.querySelector(selector)!.getBoundingClientRect();
            return {
              x: r.x,
              y: r.y,
              right: r.right,
              bottom: r.bottom,
              width: r.width,
              height: r.height,
            };
          };

          const node = header.querySelector<HTMLElement>('.today-complete')!;
          const message = node.querySelector<HTMLElement>('.today-complete-message')!;
          const count = node.querySelector<HTMLElement>('.today-count')!;
          return {
            line: rect('.today-header-line'),
            title: rect('h1'),
            date: rect('time'),
            xp: rect('.header-xp'),
            motto: rect('.today-motto'),
            banner: rect('.today-complete'),
            message: rect('.today-complete-message'),
            count: rect('.today-count'),
            messageSize: getComputedStyle(message).fontSize,
            countSize: getComputedStyle(count).fontSize,
            titleSize: getComputedStyle(header.querySelector('h1')!).fontSize,
            background: getComputedStyle(node).backgroundColor,
            color: getComputedStyle(message).color,
            medalColor: getComputedStyle(node.querySelector('.today-complete-icon')!).color,
            overflow: node.scrollWidth - node.clientWidth,
            animations: node.getAnimations({ subtree: true }).length,
          };
        });
        expect(geometry.titleSize).toBe(`${(32 * text) / 100}px`);
        expect(geometry.messageSize).toBe(`${(16 * text) / 100}px`);
        expect(geometry.countSize).toBe(`${(14 * text) / 100}px`);
        expect(geometry.count.y).toBeGreaterThanOrEqual(geometry.message.bottom);
        expect(geometry.banner.y).toBeGreaterThanOrEqual(geometry.motto.bottom);
        expect(geometry.background).toBe('rgb(240, 245, 239)');
        expect(geometry.color).toBe('rgb(41, 47, 42)');
        expect(geometry.medalColor).toBe('rgb(145, 107, 36)');
        expect(geometry.overflow).toBeLessThanOrEqual(0);
        expect(geometry.animations).toBe(0);
        expect(geometry.xp.right).toBeCloseTo(geometry.line.right, 0);
        expect(geometry.motto.y).toBeGreaterThanOrEqual(
          Math.max(geometry.title.bottom, geometry.date.bottom, geometry.xp.bottom),
        );
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path: `artifacts/today-celebration/screenshots/completed-${lang}-${width}-text${text}.png`,
        });
        const stable = await readDataset(page);
        await nav(page, copy.pillars).click();
        await nav(page, copy.today).click();
        await expect(banner(page)).toContainText(copy.todayAllCompleted);
        expect(await readDataset(page)).toEqual(stable);
      });
