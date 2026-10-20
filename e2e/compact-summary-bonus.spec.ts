import { expandFixturePillars } from './support/management-fixtures';
import { test, expect, type Page } from '@playwright/test';

test.use({ isMobile: true, hasTouch: true, viewport: { width: 360, height: 844 } });
const goals = ['Read ten pages', 'Complete my walk', 'Prepare my snack', 'Complete my care'];
const longGoal =
  'Walk through my neighborhood, notice the trees and return at my own pace without comparing myself to anyone else.';

const row = (page: Page, goal: string) =>
  page.locator('article').filter({ has: page.getByRole('heading', { name: goal, exact: true }) });

const list = (page: Page) =>
  page.getByRole('list', { name: /^(Pillar summary|Resumo dos pilares)$/ });

const tile = (page: Page, name: string) =>
  list(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });

async function advance(page: Page, date: string) {
  await page.clock.setSystemTime(new Date(`${date}T12:00:00`));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator(`.today-header time[datetime="${date}"]`)).toBeVisible();
}

async function language(page: Page, value: 'en' | 'pt') {
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /^(Settings|Ajustes)$/ })
    .click();
  await page.getByLabel(/^(Language|Idioma)$/).selectOption(value);
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /^(Today|Hoje)$/ })
    .click();
}

async function capture(page: Page, name: string) {
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `artifacts/compact-summary-bonus/${name}-summary-${width}.png` });
    await page
      .getByRole('region', { name: /^(Body|Corpo)$/ })
      .evaluate((n) => n.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: `artifacts/compact-summary-bonus/${name}-habits-${width}.png` });
  }
}

test('inline required counts and one emphasized next-bonus sentence follow real progression in both languages', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-09-28T12:00:00') });
  await page.goto('./');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  for (const goal of goals) {
    await page.getByLabel('What do you want to do?').fill(goal);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Start my journey', exact: true }).click();
  await page.getByRole('button', { name: 'Add habit', exact: true }).click();
  await page.getByLabel('Pillar', { exact: true }).selectOption('body');
  await page.getByLabel('What do you want to do?').fill(longGoal);
  await page.getByRole('button', { name: 'Save habit', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Pillars', exact: true }).click();
  await expandFixturePillars(page);
  await page.getByRole('button', { name: 'New pillar', exact: true }).click();
  await page
    .getByLabel('Pillar name', { exact: true })
    .fill('Música, criatividade e momentos de imaginação sem pressa');
  await page.getByRole('button', { name: 'Save pillar', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Today', exact: true }).click();
  await expect(tile(page, 'Body').locator('.summary-count')).toHaveCount(0);
  await expect(tile(page, 'Body')).toContainText('Optional habits today');
  await expect(list(page).getByRole('progressbar')).toHaveCount(0);
  await row(page, goals[1]).getByRole('checkbox').click();
  await expect(row(page, goals[1]).getByRole('checkbox')).toBeChecked();
  await expect(row(page, goals[1]).locator('.next-bonus-message')).toHaveText(
    'Next bonus: +10 XP in 2 more consecutive completions.',
  );
  await advance(page, '2026-09-29');
  const body = tile(page, 'Body');
  await expect(body.locator('.summary-count [aria-hidden=true]')).toHaveText('0/2');
  await expect(body.locator('.summary-count .visually-hidden')).toHaveText(
    '0 of 2 habits completed',
  );
  const nameBox = await body.getByRole('heading', { name: 'Body', exact: true }).boundingBox();
  const countBox = await body.locator('.summary-count').boundingBox();
  expect(countBox!.x).toBeGreaterThanOrEqual(nameBox!.x + nameBox!.width);
  expect(countBox!.y).toBeLessThan(nameBox!.y + nameBox!.height);
  await row(page, goals[1]).getByRole('checkbox').click();
  await expect(body.locator('.summary-count [aria-hidden=true]')).toHaveText('1/2');
  const bonus = row(page, goals[1]).locator('.next-bonus-message');
  await expect(bonus).toHaveText('Next bonus: +10 XP in 1 more consecutive completion.');
  await expect(bonus.locator('strong')).toHaveText(['+10 XP', '1']);
  await expect(row(page, goals[1]).locator('.habit-metrics > p')).toHaveCount(2);
  await expect(row(page, goals[1]).locator('.habit-streak-line strong')).toHaveText(['2', '2']);
  await capture(page, 'singular-en');
  await language(page, 'pt');
  await expect(tile(page, 'Corpo').locator('.summary-count [aria-hidden=true]')).toHaveText('1/2');
  await expect(tile(page, 'Corpo').locator('.summary-count .visually-hidden')).toHaveText(
    '1 de 2 hábitos concluídos',
  );
  await expect(row(page, goals[1]).locator('.next-bonus-message')).toHaveText(
    'Próximo bônus: +10 XP em mais 1 conclusão seguida.',
  );
  await row(page, goals[1]).getByRole('checkbox').click();
  await expect(row(page, goals[1]).getByRole('checkbox')).not.toBeChecked();
  await expect(row(page, goals[1]).locator('.next-bonus-message')).toHaveText(
    'Próximo bônus: +10 XP em mais 2 conclusões seguidas.',
  );
  await capture(page, 'plural-pt');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const enlargedName = await tile(page, 'Corpo')
    .getByRole('heading', { name: 'Corpo', exact: true })
    .boundingBox();
  const enlargedCount = await tile(page, 'Corpo').locator('.summary-count').boundingBox();
  expect(enlargedCount!.x).toBeGreaterThanOrEqual(enlargedName!.x + enlargedName!.width);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'artifacts/compact-summary-bonus/enlarged-pt-320.png' });
  const action = row(page, longGoal).getByRole('checkbox');
  await action.scrollIntoViewIfNeeded();
  expect(
    await action.evaluate((n) => {
      const b = n.getBoundingClientRect();
      return n.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2));
    }),
  ).toBe(true);
  await action.click();
  await expect(action).toBeChecked();
  await page.reload();
  await expect(tile(page, 'Corpo').locator('.summary-count [aria-hidden=true]')).toHaveText('1/2');
  await language(page, 'en');
  await row(page, goals[1]).getByRole('checkbox').click();
  await expect(tile(page, 'Body').getByText('Completed today', { exact: true })).toBeVisible();
  await advance(page, '2026-09-30');
  await row(page, goals[1]).getByRole('checkbox').click();
  await expect(row(page, goals[1]).locator('.next-bonus-message')).toHaveText(
    'Next bonus: +30 XP in 4 more consecutive completions.',
  );
  await expect(
    tile(page, 'Música, criatividade e momentos de imaginação sem pressa').locator(
      '.summary-count',
    ),
  ).toHaveCount(0);
});
