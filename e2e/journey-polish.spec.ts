import { test, expect, type Page } from '@playwright/test';

const goals = ['Read my chapter', 'Complete my walk', 'Prepare my snack', 'Complete my care'];

async function setup(page: Page) {
  await page.clock.install({ time: new Date('2026-10-03T12:00:00') });
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

const nav = (page: Page, name: string) =>
  page.getByRole('navigation').getByRole('button', { name, exact: true });

async function completeDays(page: Page, count: number) {
  for (let day = 0; day < count; day++) {
    await page.clock.setSystemTime(new Date(2026, 9, 3 + day, 12));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    for (const goal of goals) {
      const check = page.getByRole('checkbox', { name: `Done: ${goal}`, exact: true });
      await check.click();
      await expect(check).toBeChecked();
    }
  }
}

test('compact live details and sign selection remain separate from the flag current level and Footprints position', async ({
  page,
}) => {
  await setup(page);
  await completeDays(page, 3);
  await nav(page, 'Journey').click();
  const current = page.getByRole('button', { name: 'Level 2 — Current', exact: true });
  await expect(current.locator('svg line[x1="4"]')).toHaveCount(1);
  await expect(page.locator('.trail-map path[d^="M4 16v"]')).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Level 1 — Reached', exact: true }).locator('svg path'),
  ).toHaveAttribute('d', 'M20 6 9 17l-5-5');
  const position = await page.locator('.position-marker').getAttribute('style');
  const paint = await current.evaluate((node) => {
    const css = getComputedStyle(node);
    return { background: css.backgroundColor, border: css.borderColor, outline: css.outlineStyle };
  });
  expect(paint.border).toBe(paint.background);
  expect(paint.outline).toBe('none');
  const details = page.getByRole('status', { name: 'Selected level', exact: true });
  expect(await details.evaluate((node) => getComputedStyle(node).borderTopWidth)).toBe('0px');
  await expect(details.locator(':scope > *')).toHaveCount(2);
  await page.getByRole('button', { name: 'Level 3 — Upcoming', exact: true }).click();
  await expect(details.locator('.selected-level-title')).toHaveText('Level 3');
  await expect(details.locator('.selected-level-facts')).toHaveText(
    'Starts at 200 total XP. · 40 XP remaining.',
  );
  await expect(details).toContainText('Upcoming');
  await expect(current).not.toHaveAttribute('aria-pressed', 'true');
  await expect(current).toHaveClass(/current/);
  expect(await current.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(
    paint.background,
  );
  expect(await page.locator('.position-marker').getAttribute('style')).toBe(position);
  await expect(page.locator('.journey-xp')).toHaveText('160 XP');
  const reached = page.getByRole('button', { name: 'Level 1 — Reached', exact: true });
  await reached.focus();
  await page.keyboard.press('Space');
  await expect(details.locator('.selected-level-facts')).toHaveText('Starts at 0 total XP.');
  await expect(reached).toBeFocused();
  expect(await reached.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe('solid');
  expect(await page.locator('.position-marker').getAttribute('style')).toBe(position);
});

for (const language of ['en', 'pt'] as const) {
  test(`daily streak uses singular plural and pending day wording in ${language} without changing calculation`, async ({
    page,
  }) => {
    await setup(page);
    if (language === 'pt') {
      await nav(page, 'Settings').click();
      await page.getByLabel('Language', { exact: true }).selectOption('pt');
      await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
    }
    const names =
      language === 'pt'
        ? { today: 'Hoje', journey: 'Jornada', done: 'Feito', help: 'Como funciona a progressão' }
        : { today: 'Today', journey: 'Journey', done: 'Done', help: 'How progression works' };
    for (let count = 0; count <= 2; count++) {
      if (count > 0) {
        await nav(page, names.today).click();
        await page.clock.setSystemTime(new Date(2026, 9, 2 + count, 12));
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        for (const goal of goals) {
          const check = page.getByRole('checkbox', { name: `${names.done}: ${goal}`, exact: true });
          await check.click();
          await expect(check).toBeChecked();
        }
      }
      await nav(page, names.journey).click();
      const unit =
        language === 'pt' ? (count === 1 ? 'dia' : 'dias') : count === 1 ? 'day' : 'days';
      const expected =
        language === 'pt'
          ? `Sequência diária · ${count} ${unit} · Recorde ${count}`
          : `Daily streak · ${count} ${unit} · Best ${count}`;
      await expect(page.locator('.journey-streak')).toHaveText(expected);
      const row = page.locator('.journey-streak');
      const heading = await row.getByRole('heading').boundingBox();
      const value = await row.locator('.journey-overall').boundingBox();
      expect(Math.abs(heading!.y - value!.y)).toBeLessThan(3);
    }
    await page.getByText(names.help, { exact: true }).click();
    await expect(page.locator('.journey-help > p').nth(0)).toHaveText(
      language === 'pt'
        ? 'Conclua todos os hábitos obrigatórios programados para o dia, de todos os pilares, para aumentar sua sequência diária. Ela aumenta no máximo uma vez por dia.'
        : 'Complete all required habits scheduled for a day, across all pillars, to increase your daily streak. It increases at most once per day.',
    );
    await expect(page.locator('.journey-help > p').nth(1)).toHaveText(
      language === 'pt'
        ? 'Dias sem hábitos obrigatórios são neutros: não aumentam nem interrompem sua sequência diária. Concluir um hábito opcional no dia em que você o cria pode fazer esse dia contar.'
        : 'Days with no required habits are neutral: they neither increase nor break your daily streak. Completing an optional habit on the day you create it can make that day count.',
    );
    await page.clock.setSystemTime(new Date('2026-10-05T23:59:30'));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.locator('.journey-overall')).toHaveText(
      language === 'pt' ? '2 dias · Recorde 2' : '2 days · Best 2',
    );
    await page.clock.runFor(60_000);
    await expect(page.locator('.journey-overall')).toHaveText(
      language === 'pt' ? '0 dias · Recorde 2' : '0 days · Best 2',
    );
    await expect(page.locator('.journey-xp')).toHaveText('80 XP');
  });
}

for (const language of ['en', 'pt'] as const) {
  test(`polished details and daily row wrap naturally at narrow widths and enlarged text in ${language}`, async ({
    page,
  }) => {
    await setup(page);
    await completeDays(page, 3);
    if (language === 'pt') {
      await nav(page, 'Settings').click();
      await page.getByLabel('Language', { exact: true }).selectOption('pt');
      await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
    }
    await nav(page, language === 'pt' ? 'Jornada' : 'Journey').click();
    const details = page.getByRole('status', {
      name: language === 'pt' ? 'Nível selecionado' : 'Selected level',
      exact: true,
    });
    const before = await page.locator('.position-marker').getAttribute('style');
    for (const size of ['100%', '200%']) {
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = size;
      }, size);
      for (const width of size === '100%' ? [320, 360, 390, 1280] : [320, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => window.scrollTo(0, 0));
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await expect(details.locator(':scope > *')).toHaveCount(2);
        for (const target of [details, page.locator('.journey-streak')]) {
          expect(await target.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(
            true,
          );
        }
        await expect(page.locator('.journey-overall')).toHaveText(
          language === 'pt' ? '3 dias · Recorde 3' : '3 days · Best 3',
        );
        if (width === 390 && size === '100%') {
          const streak = await page.locator('.journey-streak').boundingBox();
          const bar = await page.getByRole('navigation').boundingBox();
          expect(streak!.y + streak!.height).toBeLessThanOrEqual(bar!.y);
        }
        await page.screenshot({
          path: `artifacts/journey-polish/screenshots/journey-${language}-${size === '200%' ? 'text200' : 'normal'}-${width}.png`,
          fullPage: true,
        });
        if (width === 390 && size === '100%')
          await page.screenshot({
            path: `artifacts/journey-polish/screenshots/journey-${language}-viewport-390.png`,
          });
        await details.evaluate((node) => node.scrollIntoView({ block: 'start' }));
        if (width === 390 && size === '100%')
          await page.screenshot({
            path: `artifacts/journey-polish/screenshots/journey-${language}-details-390.png`,
          });
      }
    }
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '100%';
    });
    await page.setViewportSize({ width: 390, height: 900 });
    await page
      .getByRole('button', {
        name: language === 'pt' ? 'Nível 3 — Futuro' : 'Level 3 — Upcoming',
        exact: true,
      })
      .click();
    await expect(details.locator('.selected-level-facts')).toHaveText(
      language === 'pt'
        ? 'Começa em 200 XP total. · Faltam 40 XP.'
        : 'Starts at 200 total XP. · 40 XP remaining.',
    );
    expect(await page.locator('.position-marker').getAttribute('style')).toBe(before);
    await expect(page.locator('.level-sign.current')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.journey-level')).toHaveText(
      language === 'pt' ? 'Nível 2' : 'Level 2',
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `artifacts/journey-polish/screenshots/journey-${language}-selected-upcoming-390.png`,
    });
    await page.locator('.journey-help summary').click();
    await page
      .locator('.journey-reward-help')
      .evaluate((node) => node.scrollIntoView({ block: 'end' }));
    const help = await page.locator('.journey-reward-help').boundingBox();
    const bar = await page.getByRole('navigation').boundingBox();
    expect(help!.y + help!.height).toBeLessThanOrEqual(bar!.y);
  });
}

test('personalized Journey headings retain the short navigation labels and supporting sentence', async ({
  page,
}) => {
  await setup(page);
  await nav(page, 'Journey').click();
  await expect(
    page.getByRole('heading', { name: 'Your Journey', exact: true, level: 1 }),
  ).toBeFocused();
  await expect(nav(page, 'Journey')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('One step closer, every day.', { exact: true })).toBeVisible();
  await nav(page, 'Settings').click();
  await page.getByLabel('Language', { exact: true }).selectOption('pt');
  await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
  await nav(page, 'Jornada').click();
  await expect(
    page.getByRole('heading', { name: 'Sua jornada', exact: true, level: 1 }),
  ).toBeFocused();
  await expect(nav(page, 'Jornada')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Um passo mais perto, a cada dia.', { exact: true })).toBeVisible();
});
