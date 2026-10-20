import { expandFixturePillars } from './support/management-fixtures';
import { test, expect, type Page } from '@playwright/test';
import type { Dataset } from '../src/domain/types';

const goals = ['Read ten pages', 'Complete my walk', 'Prepare my snack', 'Complete my care'];

async function setup(page: Page) {
  await page.clock.install({ time: new Date('2026-09-28T12:00:00') });
  await page.goto('./');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  for (const [index, goal] of goals.entries()) {
    await expect(
      page.getByRole('heading', {
        name: ['Mind', 'Body', 'Nutrition', 'Hygiene'][index],
        exact: true,
      }),
    ).toBeVisible();
    await page.getByLabel('What do you want to do?').fill(goal);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Start my journey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
}

async function stored(page: Page): Promise<Dataset> {
  return page.evaluate(
    () =>
      new Promise<Dataset>((resolve, reject) => {
        const open = indexedDB.open('my-goat-journey');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const get = db.transaction('dataset').objectStore('dataset').get('current');
          get.onerror = () => {
            db.close();
            reject(get.error);
          };
          get.onsuccess = () => {
            db.close();
            // Setup has committed the current schema-2 fixture before this read.
            resolve(get.result as Dataset);
          };
        };
      }),
  );
}

const nav = (page: Page, name: string) =>
  page.getByRole('navigation').getByRole('button', { name, exact: true });

test('persisted multi-habit progression stays consistent in Today, Pillars, details and Journey after correction', async ({
  page,
}) => {
  await setup(page);
  await nav(page, 'Pillars').click();
  await expandFixturePillars(page);
  await page
    .getByRole('region', { name: 'Body', exact: true })
    .getByRole('button', { name: 'Add habit', exact: true })
    .click();
  const extra =
    'Walk calmly through my neighborhood, notice the trees and return at my own pace without rushing or comparing myself to anyone else';
  await page.getByLabel('What do you want to do?').fill(extra);
  await page.getByRole('button', { name: 'Save habit', exact: true }).click();
  await nav(page, 'Today').click();
  for (let day = 0; day < 3; day++) {
    await page.clock.setSystemTime(new Date(2026, 8, 28 + day, 12));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    for (const goal of [...goals, extra]) {
      const check = page.getByRole('checkbox', { name: `Done: ${goal}`, exact: true });
      await expect(check).not.toBeChecked();
      await check.click();
      await expect(check).toBeChecked();
    }
  }
  await expect(page.locator('.header-xp > span[aria-hidden=true]')).toHaveText('200 XP');
  const history = await stored(page);
  expect(history.occurrences).toHaveLength(15);
  const bodySummary = page.locator('.summary-tile.body');
  await expect(bodySummary.getByText('Streak 3 · Best 3', { exact: true })).toBeVisible();
  await nav(page, 'Pillars').click();
  await expandFixturePillars(page);
  const managementBody = page.getByRole('region', { name: 'Body', exact: true });
  await expect(managementBody.locator('article')).toHaveCount(2);
  await expect(managementBody.locator('.habit-metrics, .pillar-streak')).toHaveCount(0);
  await nav(page, 'Progress').click();
  await page.getByRole('tab', { name: 'Pillars', exact: true }).click();
  const pillarProgress = page
    .locator('article.consistency-card')
    .filter({ has: page.getByRole('heading', { name: 'Body', exact: true, level: 2 }) });
  for (const metric of ['current', 'best']) {
    await expect(pillarProgress.locator(`[data-live-streak="${metric}"]`)).toHaveText(/3\s+days/);
  }
  await nav(page, 'Today').click();
  for (const goal of [goals[1], extra]) {
    const row = page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: goal, exact: true }) });
    await expect(row.locator('.habit-streak-line')).toHaveText('Streak 3 · Best 3');
    await expect(row.locator('.next-bonus-message')).toHaveText(
      'Next bonus: +30 XP in 4 more consecutive completions.',
    );
  }
  await nav(page, 'Journey').click();
  await expect(page.locator('.journey-level')).toHaveText('Level 3');
  await expect(page.locator('.journey-xp')).toHaveText('200 XP');
  await expect(page.locator('.journey-overall')).toHaveText('3 days · Best 3');
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '0');
  await nav(page, 'Today').click();
  await page.getByRole('checkbox', { name: `Done: ${extra}`, exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: `Done: ${extra}`, exact: true }),
  ).not.toBeChecked();
  await expect(page.locator('.header-xp > span[aria-hidden=true]')).toHaveText('180 XP');
  await expect(bodySummary.getByText('Streak 2 · Best 2', { exact: true })).toBeVisible();
  await nav(page, 'Journey').click();
  await expect(page.locator('.journey-level')).toHaveText('Level 2');
  await expect(page.locator('.journey-overall')).toHaveText('2 days · Best 2');
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '80');
  await page.reload();
  await expect(page.locator('.header-xp > span[aria-hidden=true]')).toHaveText('180 XP');
  await page.getByRole('checkbox', { name: `Done: ${extra}`, exact: true }).click();
  await expect(page.getByRole('checkbox', { name: `Done: ${extra}`, exact: true })).toBeChecked();
  await expect(page.locator('.header-xp > span[aria-hidden=true]')).toHaveText('200 XP');
  const corrected = await stored(page);
  expect(corrected.revision).toBe(history.revision + 2);
  expect({ ...corrected, revision: history.revision }).toEqual(history);
});

test('Journey localizes real optional participation and pending-to-missed day boundaries at mobile sizes', async ({
  page,
}) => {
  await setup(page);
  for (const goal of goals) {
    const check = page.getByRole('checkbox', { name: `Done: ${goal}`, exact: true });
    await check.click();
    await expect(check).toBeChecked();
  }
  const history = await stored(page);
  for (const language of ['en', 'pt'] as const) {
    if (language === 'pt') {
      await nav(page, 'Settings').click();
      await page.getByLabel('Language', { exact: true }).selectOption('pt');
      await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
    }
    const names =
      language === 'en'
        ? ['Today', 'Pillars', 'Journey', 'Progress', 'Settings']
        : ['Hoje', 'Pilares', 'Jornada', 'Progresso', 'Ajustes'];
    await nav(page, names[2]).click();
    await expect(page.locator('.journey-level')).toHaveText(
      language === 'en' ? 'Level 1' : 'Nível 1',
    );
    await expect(page.locator('.journey-xp')).toHaveText('40 XP');
    await expect(page.locator('.journey-overall')).toHaveText(
      language === 'en' ? '1 day · Best 1' : '1 dia · Recorde 1',
    );
    await expect(
      page.getByRole('progressbar', {
        name:
          language === 'en' ? 'Progress toward the next level' : 'Progresso para o próximo nível',
      }),
    ).toHaveAttribute('value', '40');
    await expect(
      page.getByText(language === 'en' ? '60 XP to level 2.' : '60 XP para o nível 2.', {
        exact: true,
      }),
    ).toBeVisible();
    await page.locator('.journey-help summary').click();
    for (const size of ['100%', '200%']) {
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = size;
      }, size);
      for (const width of [320, 360, 390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => window.scrollTo(0, 0));
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        const navigation = page.getByRole('navigation');
        await expect(navigation.locator('[aria-current=page]')).toHaveCount(1);
        for (const name of names) {
          const button = nav(page, name);
          const box = await button.boundingBox();
          expect(box!.width).toBeGreaterThanOrEqual(44);
          expect(box!.height).toBeGreaterThanOrEqual(44);
          expect(
            await button.evaluate((node) => {
              const rect = node.getBoundingClientRect();
              return node.contains(
                document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
              );
            }),
          ).toBe(true);
        }
        await page.screenshot({
          path: `artifacts/journey-progression/screenshots/journey-${language}-${size === '200%' ? 'text200' : 'normal'}-${width}.png`,
          fullPage: true,
        });
        if (width === 360 && size === '100%')
          await page.screenshot({
            path: `artifacts/journey-progression/screenshots/journey-${language}-viewport-360.png`,
          });
        const explanation = page.locator('.journey-reward-help');
        await explanation.evaluate((node) => node.scrollIntoView({ block: 'end' }));
        await expect
          .poll(async () => {
            const content = await explanation.boundingBox();
            const bar = await navigation.boundingBox();
            return content!.y + content!.height <= bar!.y;
          })
          .toBe(true);
        if (width === 360 && size === '100%')
          await page.screenshot({
            path: `artifacts/journey-progression/screenshots/journey-${language}-bottom-360.png`,
          });
      }
    }
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '100%';
    });
    await page.setViewportSize({ width: 360, height: 800 });
    for (const destination of [names[0], names[1]]) {
      await nav(page, destination).click();
      await page.screenshot({
        path: `artifacts/journey-progression/screenshots/${destination}-${language}-360.png`,
        fullPage: true,
      });
    }
    await nav(page, names[0]).click();
    await expect(page.locator('.summary-tile.body .pillar-streak')).toHaveText(
      language === 'en' ? 'Streak 1 · Best 1' : 'Sequência 1 · Recorde 1',
    );
    const habit = page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: goals[1], exact: true }) });
    await expect(habit.locator('.habit-streak-line')).toHaveText(
      language === 'en' ? 'Streak 1 · Best 1' : 'Sequência 1 · Recorde 1',
    );
    await expect(habit.locator('.next-bonus-message')).toHaveText(
      language === 'en'
        ? 'Next bonus: +10 XP in 2 more consecutive completions.'
        : 'Próximo bônus: +10 XP em mais 2 conclusões seguidas.',
    );
    await page.screenshot({
      path: `artifacts/journey-progression/screenshots/detail-${language}-360.png`,
      fullPage: true,
    });
  }
  const localized = await stored(page);
  expect(localized.revision).toBe(history.revision + 1);
  expect({ ...localized, revision: history.revision, settings: history.settings }).toEqual(history);
  await nav(page, 'Jornada').click();
  await page.clock.setSystemTime(new Date('2026-09-29T23:59:30'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('.journey-overall')).toHaveText('1 dia · Recorde 1');
  await page.clock.runFor(60_000);
  await expect(page.locator('.journey-overall')).toHaveText('0 dias · Recorde 1');
  await expect(page.locator('.journey-xp')).toHaveText('40 XP');
  expect(await stored(page)).toEqual(localized);
});

test('Journey is a working labeled destination with real initial progression and explicit primary navigation from Settings', async ({
  page,
}) => {
  await setup(page);
  await expect(page.getByRole('navigation').getByRole('button')).toHaveCount(5);
  await nav(page, 'Journey').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Your Journey', exact: true })).toBeFocused();
  await expect(nav(page, 'Journey')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.journey-level')).toHaveText('Level 1');
  await expect(page.locator('.journey-xp')).toHaveText('0 XP');
  await expect(
    page.getByRole('progressbar', { name: 'Progress toward the next level' }),
  ).toHaveAttribute('value', '0');
  await expect(page.locator('.journey-overall')).toHaveText('0 days · Best 0');
  await expect(page.getByText('100 XP to level 2.', { exact: true })).toBeVisible();
  await nav(page, 'Settings').click();
  await nav(page, 'Journey').click();
  await expect(page.getByRole('heading', { name: 'Your Journey', exact: true })).toBeFocused();
});
