import { expandFixturePillars } from './support/management-fixtures';
import { test, expect, type Page } from '@playwright/test';

const goals = [
  'Read ten pages',
  'Complete my walk',
  'Prepare a fruit snack',
  'Complete my care routine',
];

async function setup(page: Page, mondayOnly = false) {
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
    if (mondayOnly)
      for (const day of ['Sunday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'])
        await page.getByRole('button', { name: day, exact: true }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Start my journey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
}

async function addPillar(page: Page, name: string) {
  await page.getByRole('button', { name: 'Pillars', exact: true }).click();
  await expandFixturePillars(page);
  await page.getByRole('button', { name: 'New pillar', exact: true }).click();
  await page.getByLabel('Pillar name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Save pillar', exact: true }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
}

async function advance(page: Page, date: string) {
  await page.clock.setSystemTime(new Date(`${date}T12:00:00`));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator(`time[datetime="${date}"]`).first()).toBeVisible();
}

const summary = (page: Page) => page.getByRole('list', { name: 'Pillar summary', exact: true });

const tile = (page: Page, name: string) =>
  summary(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });

const row = (page: Page, goal: string) =>
  page.locator('article').filter({ has: page.getByRole('heading', { name: goal, exact: true }) });

async function addHabit(page: Page, goal: string, pillar = 'body') {
  await page.getByRole('button', { name: 'Add habit', exact: true }).click();
  await page.getByLabel('Pillar', { exact: true }).selectOption(pillar);
  await page.getByLabel('What do you want to do?').fill(goal);
  await page.getByRole('button', { name: 'Save habit', exact: true }).click();
  await expect(row(page, goal)).toBeVisible();
}

test('required summary excludes optional goals and metrics follow Done Undo and reload at a milestone', async ({
  page,
}) => {
  await setup(page);
  await addHabit(page, 'Stretch slowly');
  await row(page, goals[1]).getByRole('checkbox').click();
  await row(page, 'Stretch slowly').getByRole('checkbox').click();
  await advance(page, '2026-09-29');
  await row(page, goals[1]).getByRole('checkbox').click();
  await row(page, 'Stretch slowly').getByRole('checkbox').click();
  await advance(page, '2026-09-30');
  await addHabit(page, 'Optional breathing');
  await expect(tile(page, 'Body').locator('.summary-count [aria-hidden=true]')).toHaveText('0/2');
  await expect(tile(page, 'Body').getByRole('progressbar')).toHaveCount(0);
  await expect(tile(page, 'Body')).toContainText('Streak 2 · Best 2');
  await expect(row(page, goals[1])).toContainText('Streak 2 · Best 2');
  await expect(row(page, goals[1])).toContainText('Next bonus: +10 XP');
  await expect(row(page, goals[1])).toContainText('in 1 more consecutive completion');
  await expect(row(page, goals[1])).not.toContainText('Each completion earns');
  await expect(page.locator('details')).toContainText(
    'Each completion earns 10 base XP. Bonuses are extra.',
  );
  await language(page, 'pt');
  await expect(row(page, goals[1])).toContainText('em mais 1 conclusão seguida');
  await expect(row(page, goals[1])).toContainText('Próximo bônus: +10 XP');
  await capture(page, 'milestone-next-singular-pt', [360]);
  await language(page, 'en');
  await row(page, goals[1]).getByRole('checkbox').click();
  await expect(tile(page, 'Body').locator('.summary-count [aria-hidden=true]')).toHaveText('1/2');
  await expect(page.getByRole('region', { name: 'Body', exact: true })).toContainText(
    '1/2 completed',
  );
  await expect(row(page, goals[1])).toContainText('Streak 3 · Best 3');
  await expect(row(page, goals[1])).toContainText('Streak 3 · Best 3');
  await expect(row(page, goals[1])).toContainText('Next bonus: +30 XP');
  await expect(row(page, goals[1])).toContainText('in 4 more consecutive completions');
  await capture(page, 'milestone-partial-en');
  await row(page, 'Optional breathing').getByRole('checkbox').click();
  await expect(tile(page, 'Body').locator('.summary-count [aria-hidden=true]')).toHaveText('1/2');
  await row(page, 'Stretch slowly').getByRole('checkbox').click();
  await expect(page.getByRole('region', { name: 'Body', exact: true })).toContainText(
    '2/2 completed today',
  );
  await expect(tile(page, 'Body')).toContainText('Streak 3 · Best 3');
  await capture(page, 'milestone-complete-en');
  await page.reload();
  await expect(row(page, goals[1])).toContainText('Next bonus: +30 XP');
  await row(page, goals[1]).getByRole('checkbox').click();
  await expect(row(page, goals[1])).toContainText('Streak 2 · Best 2');
  await expect(row(page, goals[1])).toContainText('in 1 more consecutive completion');
  await expect(tile(page, 'Body')).toContainText('Streak 2 · Best 2');
  await page.reload();
  await expect(row(page, goals[1])).toContainText('Streak 2 · Best 2');
  await capture(page, 'milestone-undone-reloaded-en', [360]);
  const goalBox = await row(page, goals[1]).boundingBox();
  const statusBox = await page
    .getByRole('region', { name: 'Body', exact: true })
    .locator('.today-pillar-status')
    .boundingBox();
  expect(statusBox!.y).toBeLessThan(goalBox!.y);
});

async function capture(page: Page, name: string, widths = [320, 360, 1000]) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width === 1000 ? 900 : 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    for (const button of await page.getByRole('button').all()) {
      const box = await button.boundingBox();
      if (box) {
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    }
    await page.screenshot({
      path: `artifacts/today-update/screenshots/${name}-${width}.png`,
      fullPage: true,
    });
    if (
      width !== 1000 &&
      /^(required-partial|milestone-partial|milestone-complete|failed-undo)/.test(name)
    ) {
      const body = page.getByRole('region', { name: /^(Body|Corpo)$/ });
      await body.evaluate((node) => node.scrollIntoView({ block: 'start' }));
      await page.screenshot({
        path: `artifacts/today-update/screenshots/${name}-body-viewport-${width}.png`,
      });
    }
  }
}

async function language(page: Page, value: 'en' | 'pt') {
  await page.getByRole('button', { name: /^(Settings|Ajustes)$/ }).click();
  await page.getByLabel(/^(Language|Idioma)$/).selectOption(value);
  await page
    .getByRole('navigation')
    .getByRole('button', { name: value === 'en' ? 'Today' : 'Hoje', exact: true })
    .click();
}

test('full long goals and custom names remain operable with doubled text and keyboard on narrow screens', async ({
  page,
}) => {
  const customName = 'Música, criatividade e momentos de imaginação sem pressa';
  const longGoal =
    'Caminhar com atenção pelo meu bairro, observar as árvores e voltar no meu próprio ritmo, sem pressa e sem comparar meu progresso com o de outras pessoas';
  await setup(page);
  await addPillar(page, customName);
  await addHabit(page, longGoal);
  await advance(page, '2026-09-29');
  await row(page, goals[1]).getByRole('checkbox').click();
  await capture(page, 'required-partial-en');
  await language(page, 'pt');
  await expect(page.getByRole('list', { name: 'Resumo dos pilares' })).toContainText(customName);
  await expect(row(page, longGoal).getByRole('heading')).toHaveText(longGoal);
  await expect(row(page, goals[1])).toContainText('Sequência 1 · Recorde 1');
  await expect(row(page, goals[1])).toContainText('em mais 2 conclusões seguidas');
  await capture(page, 'required-partial-pt');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  expect(
    await row(page, longGoal)
      .getByRole('heading')
      .evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
  ).toBeGreaterThanOrEqual(32);
  expect(
    await row(page, longGoal)
      .locator('.habit-metrics p')
      .first()
      .evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
  ).toBeGreaterThanOrEqual(26);
  for (const width of [320, 360]) {
    await page.setViewportSize({ width, height: 800 });
    const headingBox = await row(page, longGoal).getByRole('heading').boundingBox();
    const action = row(page, longGoal).getByRole('checkbox');
    const actionBox = await action.boundingBox();
    expect(actionBox!.x).toBeGreaterThanOrEqual(headingBox!.x + headingBox!.width);
    expect(Math.abs(actionBox!.y - headingBox!.y)).toBeLessThanOrEqual(12);
    await action.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(action).toBeFocused();
    expect(await action.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe('none');
    await page.keyboard.press('Space');
    await expect(action).toBeChecked();
    await expect(page.getByRole('status')).toHaveText(`Conclusão salva: ${longGoal} +10 XP`);
    await capture(page, 'required-complete-pt-text200', [width]);
    await action.focus();
    await page.keyboard.press('Space');
    await expect(action).not.toBeChecked();
  }
});

test('neutral unscheduled summaries preserve real historical streaks in both languages', async ({
  page,
}) => {
  await setup(page, true);
  await addPillar(page, 'Quiet creativity');
  for (const goal of goals) await row(page, goal).getByRole('checkbox').click();
  await expect(tile(page, 'Body')).toContainText('Streak 1 · Best 1');
  await advance(page, '2026-09-29');
  await expect(page.locator('article')).toHaveCount(0);
  await expect(tile(page, 'Body')).toContainText('No habits scheduled today');
  await expect(tile(page, 'Body')).toContainText('Streak 1 · Best 1');
  await expect(tile(page, 'Body')).toContainText('Streak 1 · Best 1');
  await expect(summary(page).getByRole('progressbar')).toHaveCount(0);
  await expect(summary(page)).not.toContainText('0 of 0');
  await capture(page, 'neutral-retained-streak-en');
  await language(page, 'pt');
  const localized = page.getByRole('list', { name: 'Resumo dos pilares' });
  await expect(localized.getByText('Sem hábitos para hoje', { exact: true })).toHaveCount(5);
  await expect(localized).toContainText('Sequência 1 · Recorde 1');
  await expect(localized).toContainText('Sequência 1 · Recorde 1');
  await capture(page, 'neutral-retained-streak-pt');
  await page.reload();
  await expect(localized).toContainText('Sequência 1 · Recorde 1');
});

test('native persistence abort keeps saved metric values and completion state until retry succeeds', async ({
  page,
}) => {
  await setup(page);
  await row(page, goals[0]).getByRole('checkbox').click();
  await advance(page, '2026-09-29');
  await row(page, goals[0]).getByRole('checkbox').click();
  await advance(page, '2026-09-30');
  await row(page, goals[0]).getByRole('checkbox').click();
  await expect(row(page, goals[0]).getByRole('checkbox')).toBeChecked();
  await expect(row(page, goals[0])).toContainText('Streak 3 · Best 3');
  await expect(tile(page, 'Mind')).toContainText('Streak 3 · Best 3');
  await page.clock.runFor(701);
  const habitBefore = await row(page, goals[0]).innerText();
  const pillarBefore = await tile(page, 'Mind').innerText();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      IDBObjectStore.prototype.put = put;
      const request = put.apply(this, args);
      this.transaction.abort();
      return request;
    };
  });
  await row(page, goals[0]).getByRole('checkbox').click();
  await expect(page.getByRole('alert')).toContainText(
    'Could not save. Your last saved state is unchanged.',
  );
  expect(await row(page, goals[0]).innerText()).toBe(habitBefore);
  expect(await tile(page, 'Mind').innerText()).toBe(pillarBefore);
  await expect(row(page, goals[0]).getByRole('checkbox')).toBeChecked();
  await capture(page, 'failed-undo-saved-metrics-en');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(row(page, goals[0])).toContainText('Streak 2 · Best 2');
  await expect(row(page, goals[0])).toContainText('in 1 more consecutive completion');
  await expect(tile(page, 'Mind')).toContainText('Streak 2 · Best 2');
  await page.reload();
  await expect(row(page, goals[0]).getByRole('checkbox')).not.toBeChecked();
});

test('base completions continue beyond 365 without displaying an invented next bonus', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await setup(page);
  const start = new Date('2026-09-28T12:00:00');
  for (let index = 0; index < 366; index++) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    await page.clock.setSystemTime(date);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(row(page, goals[0]).getByRole('checkbox')).not.toBeChecked();
    await row(page, goals[0]).getByRole('checkbox').click();
    await expect(row(page, goals[0]).getByRole('checkbox')).toBeChecked();
  }
  await expect(row(page, goals[0])).toContainText('Streak 366 · Best 366');
  await expect(row(page, goals[0])).toContainText('Streak 366 · Best 366');
  await expect(row(page, goals[0])).not.toContainText('Next bonus');
  await expect(row(page, goals[0])).not.toContainText('remaining');
  await expect(row(page, goals[0])).not.toContainText('Each completion earns');
  await expect(page.locator('details')).toContainText(
    'Each completion earns 10 base XP. Bonuses are extra.',
  );
  await page.reload();
  await expect(row(page, goals[0])).toContainText('Streak 366 · Best 366');
  await capture(page, 'beyond-final-milestone-en', [360]);
});

test('native checkbox communicates completion while optional Today distinction stays visible', async ({
  page,
}) => {
  await setup(page);
  await advance(page, '2026-09-29');
  await addHabit(page, 'Optional rest');
  await expect(row(page, goals[1]).locator('.habit-today-status')).toHaveCount(0);
  await expect(row(page, goals[1]).getByRole('checkbox')).not.toBeChecked();
  await expect(
    row(page, 'Optional rest').getByText('Optional today', { exact: true }),
  ).toBeVisible();
  for (const goal of [goals[1], 'Optional rest']) {
    const main = await row(page, goal).locator('.goal-row').boundingBox();
    const metrics = await row(page, goal).locator('.habit-metrics').boundingBox();
    expect(metrics!.y).toBeGreaterThanOrEqual(main!.y + main!.height);
  }
  await language(page, 'pt');
  await expect(row(page, goals[1]).locator('.habit-today-status')).toHaveCount(0);
  await expect(
    row(page, 'Optional rest').getByText('Opcional hoje', { exact: true }),
  ).toBeVisible();
});

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-28T12:00:00') });
});
test('all pillars have informational summaries and optional-only is not an empty agenda', async ({
  page,
}) => {
  await setup(page);
  await addPillar(page, 'Music & imagination');
  await expect(summary(page).getByRole('listitem')).toHaveCount(5);
  await expect(tile(page, 'Music & imagination')).toContainText('No habits scheduled today');
  await expect(tile(page, 'Mind')).toContainText('Optional habits today');
  await expect(summary(page).getByRole('progressbar')).toHaveCount(0);
  await expect(summary(page).locator('button, a, [tabindex], [role=button]')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Music & imagination', exact: true })).toHaveCount(
    0,
  );
  const before = await page.locator('main').innerText();
  await tile(page, 'Music & imagination').click();
  expect(await page.locator('main').innerText()).toBe(before);
  for (const width of [320, 360]) {
    await page.setViewportSize({ width, height: 800 });
    const first = await tile(page, 'Mind').boundingBox();
    const second = await tile(page, 'Body').boundingBox();
    expect(first!.y).toBe(second!.y);
    expect(second!.x).toBeGreaterThan(first!.x);
  }
  await capture(page, 'optional-only-en');
  await row(page, goals[1]).getByRole('checkbox').click();
  await expect(tile(page, 'Body')).toContainText('Streak 1 · Best 1');
  await expect(summary(page).getByRole('progressbar')).toHaveCount(0);
  await language(page, 'pt');
  const localized = page.getByRole('list', { name: 'Resumo dos pilares' });
  await expect(localized).toContainText('Hábitos opcionais hoje');
  await expect(row(page, goals[1])).toContainText('Sequência 1 · Recorde 1');
  await capture(page, 'optional-only-completed-pt');
});
