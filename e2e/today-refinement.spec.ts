import { expandFixturePillars } from './support/management-fixtures';
import { test, expect, type Page } from '@playwright/test';

test.use({ isMobile: true, hasTouch: true, viewport: { width: 360, height: 800 } });
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-28T12:00:00') });
});
const goals = [
  'Read ten pages',
  'Complete my walk',
  'Prepare a fruit snack',
  'Complete my care routine',
];

const row = (page: Page, goal: string) =>
  page.locator('article').filter({ has: page.getByRole('heading', { name: goal, exact: true }) });

async function setup(page: Page, mondayOnly = false) {
  await page.goto('./');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  for (const goal of goals) {
    await page.getByLabel('What do you want to do?').fill(goal);
    if (mondayOnly)
      for (const day of ['Sunday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'])
        await page.getByRole('button', { name: day, exact: true }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Start my journey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
}

async function advance(page: Page, date: string) {
  await page.clock.setSystemTime(new Date(`${date}T12:00:00`));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator(`time[datetime="${date}"]`).first()).toBeVisible();
}

async function language(page: Page, language: 'en' | 'pt') {
  await page.getByRole('button', { name: /^(Settings|Ajustes)$/ }).click();
  await page.getByLabel(/^(Language|Idioma)$/).selectOption(language);
  await page
    .getByRole('navigation')
    .getByRole('button', { name: language === 'en' ? 'Today' : 'Hoje', exact: true })
    .click();
}

const summary = (page: Page) =>
  page.getByRole('list', { name: /^(Pillar summary|Resumo dos pilares)$/ });

const tile = (page: Page, name: string) =>
  summary(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });

async function addPillar(page: Page, name: string) {
  await page.getByRole('button', { name: 'Pillars', exact: true }).click();
  await expandFixturePillars(page);
  await page.getByRole('button', { name: 'New pillar', exact: true }).click();
  await page.getByLabel('Pillar name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Save pillar', exact: true }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
}

async function addHabit(page: Page, goal: string) {
  await page.getByRole('button', { name: 'Add habit', exact: true }).click();
  await page.getByLabel('Pillar', { exact: true }).selectOption('body');
  await page.getByLabel('What do you want to do?').fill(goal);
  await page.getByRole('button', { name: 'Save habit', exact: true }).click();
  await expect(row(page, goal)).toBeVisible();
}

async function capture(page: Page, name: string, body = false) {
  for (const width of [320, 360]) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `artifacts/today-refinement/screenshots/${name}-summary-${width}.png`,
    });
    if (body) {
      await page
        .getByRole('region', { name: /^(Body|Corpo)$/ })
        .evaluate((node) => node.scrollIntoView({ block: 'start' }));
      await page.screenshot({
        path: `artifacts/today-refinement/screenshots/${name}-body-${width}.png`,
      });
    }
  }
}

test('compact header has a localized date and bottom-navigation Settings; summaries distinguish optional and empty pillars', async ({
  page,
}) => {
  await setup(page);
  await addPillar(page, 'Music & imagination');
  const time = page.locator('time[datetime="2026-09-28"]').first();
  await expect(time).toBeVisible();
  await expect(time).not.toHaveText('2026-09-28');
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  expect(await settings.innerText()).toBe('Settings');
  await expect(
    page.locator('.today-header').getByRole('button', { name: 'Settings', exact: true }),
  ).toHaveCount(0);
  await expect(settings.locator('svg')).toBeVisible();
  await expect(tile(page, 'Mind')).toContainText('Streak 0 · Best 0');
  await expect(tile(page, 'Mind')).toContainText('Optional habits today');
  await expect(tile(page, 'Music & imagination')).toContainText('No habits scheduled today');
  await expect(summary(page).getByRole('progressbar')).toHaveCount(0);
  await expect(summary(page).locator('button,a,[tabindex]')).toHaveCount(0);
  await expect(row(page, goals[0]).getByRole('checkbox')).not.toBeChecked();
  await expect(row(page, goals[0]).getByRole('checkbox')).not.toBeChecked();
  await expect(row(page, goals[0])).toContainText('Next bonus: +10 XP');
  await expect(row(page, goals[0])).not.toContainText('Sun · Mon');
  await expect(row(page, goals[0])).not.toContainText('Each completion earns');
  await page.locator('details summary').click();
  await expect(page.locator('details')).toContainText(
    'Each completion earns 10 base XP. Bonuses are extra.',
  );
  await page.locator('details summary').click();
  await capture(page, 'optional-en');
  await language(page, 'pt');
  await expect(time).toContainText('set.');
  await expect(tile(page, 'Mente')).toContainText('Sequência 0 · Recorde 0');
  await expect(tile(page, 'Mente')).toContainText('Hábitos opcionais hoje');
  await expect(row(page, goals[0]).getByRole('checkbox')).not.toBeChecked();
  await expect(row(page, goals[0]).getByRole('checkbox')).not.toBeChecked();
  await capture(page, 'optional-pt');
});

test('two required Body habits keep counts in the colored header and explicit state separate from Complete Undo', async ({
  page,
}) => {
  await setup(page);
  await addHabit(page, 'Stretch slowly');
  await row(page, goals[1]).getByRole('checkbox').click();
  await expect(row(page, goals[1]).getByRole('checkbox')).toBeChecked();
  await advance(page, '2026-09-29');
  await addHabit(page, 'Optional rest');
  await expect(
    page.getByRole('region', { name: 'Body', exact: true }).locator('.today-pillar-status'),
  ).toHaveText('0/2 completed');
  await row(page, goals[1]).getByRole('checkbox').click();
  const body = page.getByRole('region', { name: 'Body', exact: true });
  await expect(body.locator('.pillar-header')).toContainText('1/2 completed');
  await expect(tile(page, 'Body').locator('.summary-count [aria-hidden=true]')).toHaveText('1/2');
  await expect(tile(page, 'Body').getByRole('progressbar')).toHaveCount(0);
  await expect(row(page, goals[1]).getByRole('checkbox')).toBeChecked();
  await expect(row(page, goals[1]).getByRole('checkbox')).toBeChecked();
  await expect(row(page, goals[1])).toContainText('Streak 2 · Best 2');
  await expect(body.locator('.today-pillar-metrics')).toHaveCount(0);
  await capture(page, 'partial-en', true);
  await row(page, 'Stretch slowly').getByRole('checkbox').click();
  await expect(body.locator('.pillar-header')).toContainText('2/2 completed today');
  await row(page, 'Optional rest').getByRole('checkbox').click();
  await expect(tile(page, 'Body').locator('.summary-count [aria-hidden=true]')).toHaveText('2/2');
  await row(page, goals[1]).getByRole('checkbox').click();
  await expect(body.locator('.pillar-header')).toContainText('1/2 completed');
  await page.reload();
  await expect(row(page, goals[1]).getByRole('checkbox')).not.toBeChecked();
  await language(page, 'pt');
  await expect(
    page.getByRole('region', { name: 'Corpo', exact: true }).locator('.pillar-header'),
  ).toContainText('1/2 concluídos');
  await expect(row(page, 'Stretch slowly').getByRole('checkbox')).toBeChecked();
  await expect(row(page, 'Stretch slowly').getByRole('checkbox')).toBeChecked();
  await capture(page, 'partial-pt', true);
  await row(page, goals[1]).getByRole('checkbox').click();
  const portugueseStatus = page
    .getByRole('region', { name: 'Corpo', exact: true })
    .locator('.today-pillar-status');
  await expect(portugueseStatus).toHaveText('2/2 concluídos hoje');
  await expect(portugueseStatus.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  await expect(tile(page, 'Corpo').getByText('Concluído hoje', { exact: true })).toBeVisible();
  await row(page, goals[1]).getByRole('checkbox').click();
  await expect(portugueseStatus).toHaveText('1/2 concluídos');
  await expect(portugueseStatus.locator('svg')).toHaveCount(0);
  await row(page, 'Stretch slowly').getByRole('checkbox').click();
  await expect(portugueseStatus).toHaveText('0/2 concluídos');
  await page.getByRole('button', { name: 'Pilares', exact: true }).click();
  await expandFixturePillars(page);
  await expect(
    page
      .getByRole('region', { name: 'Corpo', exact: true })
      .getByRole('button', { name: 'Corpo', exact: true }),
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(row(page, goals[1])).toContainText('Todos os dias');
});

test('no habits today retains the real compact streak and record without fractions or bars', async ({
  page,
}) => {
  await setup(page, true);
  await addPillar(page, 'Quiet creativity');
  for (const goal of goals) {
    await row(page, goal).getByRole('checkbox').click();
    await expect(row(page, goal).getByRole('checkbox')).toBeChecked();
  }
  await advance(page, '2026-09-29');
  await expect(page.locator('article')).toHaveCount(0);
  await expect(tile(page, 'Body')).toContainText('No habits scheduled today');
  await expect(tile(page, 'Body')).toContainText('Streak 1 · Best 1');
  await expect(summary(page).getByRole('progressbar')).toHaveCount(0);
  await expect(summary(page)).not.toContainText('0 of 0');
  await capture(page, 'neutral-en');
  await language(page, 'pt');
  await expect(tile(page, 'Corpo')).toContainText('Sem hábitos para hoje');
  await expect(tile(page, 'Corpo')).toContainText('Sequência 1 · Recorde 1');
  await capture(page, 'neutral-pt');
});

test('long goals and doubled text stay readable and the bottom nav cannot cover the last interaction', async ({
  page,
}) => {
  await setup(page);
  await addPillar(page, 'Música, criatividade e momentos de imaginação sem pressa');
  const long =
    'Caminhar com atenção pelo meu bairro, observar as árvores e voltar no meu próprio ritmo, sem pressa e sem comparar meu progresso com o de outras pessoas';
  await addHabit(page, long);
  await advance(page, '2026-09-29');
  await language(page, 'pt');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  for (const viewport of [
    { width: 320, height: 640 },
    { width: 360, height: 800 },
    { width: 812, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(row(page, long).getByRole('heading')).toHaveText(long);
    expect(
      await row(page, long)
        .getByRole('heading')
        .evaluate((n) => parseFloat(getComputedStyle(n).fontSize)),
    ).toBeGreaterThanOrEqual(32);
    const action = row(page, long).getByRole('checkbox');
    await action.scrollIntoViewIfNeeded();
    const box = await row(page, long).locator('.habit-check').boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(
      await action.evaluate((n) => {
        const b = n.getBoundingClientRect();
        return n.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2));
      }),
    ).toBe(true);
    await action.click();
    await expect(action).toBeChecked();
    await action.focus();
    await page.keyboard.press('Space');
    await expect(action).not.toBeChecked();
    const add = page.getByRole('button', { name: 'Adicionar hábito', exact: true });
    await add.evaluate((n) => n.scrollIntoView({ block: 'end' }));
    await expect
      .poll(async () => {
        const b = await add.boundingBox();
        const nav = await page.getByRole('navigation').boundingBox();
        return b!.y + b!.height <= nav!.y;
      })
      .toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `artifacts/today-refinement/screenshots/text200-${viewport.width}x${viewport.height}.png`,
    });
  }
  await page.getByRole('button', { name: 'Adicionar hábito', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Adicionar hábito', exact: true })).toBeVisible();
});
