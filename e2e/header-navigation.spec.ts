import { expandFixturePillars } from './support/management-fixtures';
import { test, expect, type Page } from '@playwright/test';

test.use({ isMobile: true, hasTouch: true, viewport: { width: 360, height: 800 } });
const goals = ['Read ten pages', 'Complete my walk', 'Prepare my snack', 'Complete my care'];

async function setup(page: Page) {
  await page.clock.install({ time: new Date('2026-09-28T12:00:00') });
  await page.goto('./');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  for (const goal of goals) {
    await page.getByLabel('What do you want to do?').fill(goal);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Start my journey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
}

async function assertNavigation(page: Page, names: string[], active: string) {
  const nav = page.getByRole('navigation');
  await expect(nav.getByRole('button')).toHaveCount(5);
  for (const name of names) {
    const button = nav.getByRole('button', { name, exact: true });
    await expect(button).toBeVisible();
    await expect(button.locator('svg')).toBeVisible();
    await expect(button.locator('.nav-label')).toHaveText(name);
    const box = await button.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(
      await button.locator('.nav-label').evaluate((n) => n.scrollWidth <= n.clientWidth + 1),
    ).toBe(true);
    if (name === active) await expect(button).toHaveAttribute('aria-current', 'page');
    else await expect(button).not.toHaveAttribute('aria-current', 'page');
  }
}

test('five icon and label destinations select the actual page in both languages while Today title and date share a row', async ({
  page,
}) => {
  await setup(page);
  await assertNavigation(page, ['Today', 'Pillars', 'Journey', 'Progress', 'Settings'], 'Today');
  const header = page.locator('.today-header');
  await expect(header.getByRole('button')).toHaveCount(0);
  const title = header.getByRole('heading', { name: 'Today', exact: true });
  const date = header.locator('time');
  const titleBox = await title.boundingBox();
  const dateBox = await date.boundingBox();
  expect(dateBox!.x).toBeGreaterThan(titleBox!.x + titleBox!.width);
  expect(dateBox!.y).toBeLessThan(titleBox!.y + titleBox!.height);
  const sentence = header.getByText('Your day, one step at a time.', { exact: true });
  await expect(sentence).toBeVisible();
  const sentenceBox = await sentence.boundingBox();
  expect(sentenceBox!.y).toBeGreaterThanOrEqual(
    Math.max(titleBox!.y + titleBox!.height, dateBox!.y + dateBox!.height),
  );
  await page.getByRole('navigation').getByRole('button', { name: 'Pillars', exact: true }).click();
  await expandFixturePillars(page);
  await expect(page.getByRole('heading', { name: 'Pillars', exact: true })).toBeVisible();
  await assertNavigation(page, ['Today', 'Pillars', 'Journey', 'Progress', 'Settings'], 'Pillars');
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await assertNavigation(page, ['Today', 'Pillars', 'Journey', 'Progress', 'Settings'], 'Settings');
  await page.getByLabel('Language', { exact: true }).selectOption('pt');
  await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
  await assertNavigation(page, ['Hoje', 'Pilares', 'Jornada', 'Progresso', 'Ajustes'], 'Ajustes');
  await page.getByRole('navigation').getByRole('button', { name: 'Hoje', exact: true }).click();
  await expect(header.getByText('Seu dia, um passo de cada vez.', { exact: true })).toBeVisible();
  await assertNavigation(page, ['Hoje', 'Pilares', 'Jornada', 'Progresso', 'Ajustes'], 'Hoje');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'artifacts/header-navigation/header-nav-pt-360.png' });
  await page.getByRole('navigation').getByRole('button', { name: 'Pilares', exact: true }).click();
  await expandFixturePillars(page);
  await expect(page.getByRole('heading', { name: 'Pilares', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Corpo', exact: true })).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Pilares', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pilares', exact: true, level: 1 })).toBeFocused();
  await expandFixturePillars(page);
  await expect(page.getByRole('region', { name: 'Corpo', exact: true })).toBeVisible();
  await assertNavigation(page, ['Hoje', 'Pilares', 'Jornada', 'Progresso', 'Ajustes'], 'Pilares');
});

test('title date wrapping, visible navigation labels and scrolling remain usable at 320px and doubled text', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Language', { exact: true }).selectOption('pt');
  await page.getByRole('navigation').getByRole('button', { name: 'Hoje', exact: true }).click();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  for (const viewport of [
    { width: 320, height: 640 },
    { width: 360, height: 800 },
    { width: 812, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await assertNavigation(page, ['Hoje', 'Pilares', 'Jornada', 'Progresso', 'Ajustes'], 'Hoje');
    const header = page.locator('.today-header');
    const title = header.getByRole('heading', { name: 'Hoje', level: 1, exact: true });
    const titleBox = await title.boundingBox();
    const dateBox = await header.locator('time').boundingBox();
    const xpBox = await header.locator('.header-xp').boundingBox();
    const lineBox = await header.locator('.today-header-line').boundingBox();
    const sentenceBox = await header
      .getByText('Seu dia, um passo de cada vez.', { exact: true })
      .boundingBox();
    expect(await title.evaluate((n) => getComputedStyle(n).fontSize)).toBe('64px');
    expect(xpBox!.x + xpBox!.width).toBeCloseTo(lineBox!.x + lineBox!.width, 0);

    const overlaps = (a: NonNullable<typeof titleBox>, b: NonNullable<typeof titleBox>) =>
      a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

    expect(overlaps(titleBox!, xpBox!)).toBe(false);
    expect(overlaps(dateBox!, xpBox!)).toBe(false);
    expect(overlaps(titleBox!, dateBox!)).toBe(false);
    expect(sentenceBox!.y).toBeGreaterThanOrEqual(
      Math.max(
        titleBox!.y + titleBox!.height,
        dateBox!.y + dateBox!.height,
        xpBox!.y + xpBox!.height,
      ),
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const add = page.getByRole('button', { name: 'Adicionar hábito', exact: true });
    await add.evaluate((n) => n.scrollIntoView({ block: 'end' }));
    await expect
      .poll(async () => {
        const a = await add.boundingBox();
        const b = await page.getByRole('navigation').boundingBox();
        return a!.y + a!.height <= b!.y;
      })
      .toBe(true);
    expect(
      await add.evaluate((n) => {
        const b = n.getBoundingClientRect();
        return n.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2));
      }),
    ).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `artifacts/header-navigation/text200-${viewport.width}x${viewport.height}.png`,
    });
  }
  const settings = page
    .getByRole('navigation')
    .getByRole('button', { name: 'Ajustes', exact: true });
  await settings.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeFocused();
});
