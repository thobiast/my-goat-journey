import { test, expect, type Page, type Locator } from '@playwright/test';
import { setupScheduledHabits, nav, readDataset } from './support/habit-fixtures';
import { expandFixturePillars } from './support/management-fixtures';

test.setTimeout(90_000);
const evidence = 'artifacts/pillars-ux-final/panels';
const copy = {
  en: {
    body: 'Body',
    nutrition: 'Nutrition',
    pillars: 'Pillars',
    edit: 'Edit',
    close: 'Close',
    goal: 'Walk calmly through my neighborhood, notice the trees and return at my own pace without rushing or comparing myself to anyone else',
    pillar: 'Creative practice, music and quiet time to reflect on my day',
    habitLabel: 'Actions for habit: ',
    pillarLabel: 'Actions for pillar: ',
    habitEntries: ['Move to another pillar', 'Review completions', 'Archive habit', 'Close'],
    pillarEntries: ['Rename pillar', 'View pillar streaks', 'Remove from active pillars', 'Close'],
  },
  pt: {
    body: 'Corpo',
    nutrition: 'Alimentação',
    pillars: 'Pilares',
    edit: 'Editar',
    close: 'Fechar',
    goal: 'Caminhar tranquilamente pelo meu bairro, observar as árvores e voltar no meu ritmo sem pressa nem comparação com outras pessoas',
    pillar: 'Prática criativa, música e um tempo tranquilo para refletir sobre meu dia',
    habitLabel: 'Ações do hábito: ',
    pillarLabel: 'Ações do pilar: ',
    habitEntries: ['Mover para outro pilar', 'Revisar conclusões', 'Arquivar hábito', 'Fechar'],
    pillarEntries: [
      'Renomear pilar',
      'Ver sequências do pilar',
      'Remover dos pilares ativos',
      'Fechar',
    ],
  },
};

const surface = (page: Page) => page.locator('[data-action-surface]');

const group = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

const row = (page: Page, goal: string) =>
  page
    .locator('.management-habit')
    .filter({ has: page.getByRole('heading', { name: goal, exact: true }) });

async function rect(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function revealTrigger(page: Page, trigger: Locator) {
  // Native scrollIntoView includes the global bottom scroll-margin, which can
  // place a trigger partly above a very short enlarged viewport. Measure the
  // actual usable area before taking exact before/after geometry snapshots.
  await trigger.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const bottom = document.querySelector('nav')!.getBoundingClientRect().top;
    scrollTo({ top: scrollY + box.top - (bottom - box.height) / 2, behavior: 'instant' });
  });
  const box = await rect(trigger);
  const bottom = await rect(page.getByRole('navigation'));
  expect(box.y).toBeGreaterThanOrEqual(16);
  expect(box.y + box.height).toBeLessThanOrEqual(bottom.y);
}

async function populated(page: Page, language: keyof typeof copy) {
  const labels = copy[language];
  // Source owners may be editing in parallel; this suite tests the loaded UI,
  // not Vite HMR. A dev-server refresh must not replace its isolated diary flow.
  await page.routeWebSocket('**', (socket) => socket.onMessage(() => {}));
  await setupScheduledHabits(page);
  await nav(page, 'Pillars').click();
  await page.getByRole('button', { name: 'New pillar', exact: true }).click();
  await page.getByLabel('Pillar name', { exact: true }).fill(labels.pillar);
  await page.getByRole('button', { name: 'Save pillar', exact: true }).click();
  await expandFixturePillars(page, ['Body']);
  for (const goal of [labels.goal, 'Pause and breathe']) {
    await group(page, 'Body').getByRole('button', { name: 'Add habit', exact: true }).click();
    await page.getByLabel('What do you want to do?', { exact: true }).fill(goal);
    await page.getByRole('button', { name: 'Save habit', exact: true }).click();
    await expect(row(page, goal)).toBeVisible();
  }
  if (language === 'pt') {
    await nav(page, 'Settings').click();
    await page.getByLabel('Language', { exact: true }).selectOption('pt');
    await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
    await nav(page, labels.pillars).click();
    await expandFixturePillars(page, [labels.body]);
  }
  await expect(group(page, labels.pillar).locator('.pillar-disclosure')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
}

async function contained(page: Page) {
  await expect
    .poll(async () => {
      const box = await surface(page).boundingBox();
      const navBox = await page.getByRole('navigation').boundingBox();
      const viewport = page.viewportSize()!;
      return (
        !!box &&
        !!navBox &&
        box.x >= 8 &&
        box.x + box.width <= viewport.width - 8 &&
        box.y >= 8 &&
        box.y + box.height <= navBox.y
      );
    })
    .toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await surface(page).evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
}

async function contextHeading(page: Page, target: string, text: number) {
  const heading = surface(page).getByRole('heading', { name: target, exact: true, level: 2 });
  await expect(heading).toHaveText(target);
  const style = await heading.evaluate((node) => {
    const css = getComputedStyle(node);
    return {
      size: parseFloat(css.fontSize),
      line: parseFloat(css.lineHeight),
      margin: css.marginTop,
      background: css.backgroundColor,
      overflow: css.textOverflow,
      clamp: css.webkitLineClamp,
      shrink: css.flexShrink,
      height: node.getBoundingClientRect().height,
    };
  });
  expect(style.size).toBe((16 * text) / 100);
  expect(style.height).toBeGreaterThan(style.line);
  expect(style.margin).toBe('0px');
  expect(style.background).toBe('rgba(0, 0, 0, 0)');
  expect(style.overflow).not.toBe('ellipsis');
  expect(style.clamp).toBe('none');
  expect(style.shrink).toBe('0');
  await heading.evaluate((node) => node.scrollIntoView({ block: 'nearest' }));
  await expect(heading).toBeVisible();
}

for (const language of ['en', 'pt'] as const)
  for (const layout of [
    { width: 320, height: 900, text: 100 },
    { width: 390, height: 900, text: 100 },
    { width: 390, height: 900, text: 200 },
    { width: 320, height: 440, text: 200 },
  ]) {
    test(`${language} ${layout.width}x${layout.height} text${layout.text}: mobile panels identify full targets without list reflow`, async ({
      page,
    }) => {
      const { width, height, text } = layout;
      const labels = copy[language];
      const stem = `${language}-${width}x${height}-text${text}`;
      await page.setViewportSize({ width, height });
      await populated(page, language);
      await page.addStyleTag({
        content: `html { font-size:${text}%; }${height === 440 ? ' nav { padding-bottom:32px !important; }' : ''}`,
      });
      const beforeData = await readDataset(page);
      const trigger = page.getByRole('button', {
        name: labels.habitLabel + labels.goal,
        exact: true,
      });
      await revealTrigger(page, trigger);
      const unchanged = [
        group(page, labels.body),
        row(page, labels.goal),
        row(page, 'Pause and breathe'),
        row(page, labels.goal).getByRole('button', { name: labels.edit, exact: true }),
        group(page, labels.nutrition),
      ];
      const before = await Promise.all(unchanged.map(rect));
      const y = await page.evaluate(() => scrollY);
      await trigger.click();
      await expect(surface(page)).toHaveAttribute('aria-label', labels.habitLabel + labels.goal);
      await expect(surface(page)).toHaveAttribute('aria-modal', 'true');
      expect(await surface(page).evaluate((node) => node.matches(':modal'))).toBe(true);
      expect(await Promise.all(unchanged.map(rect))).toEqual(before);
      await contextHeading(page, labels.goal, text);
      await contained(page);
      await expect(surface(page).getByRole('button')).toHaveText(labels.habitEntries);
      await page.screenshot({ path: `${evidence}/habit-${stem}.png` });
      for (const key of ['Home', 'Shift+Tab', 'Tab', 'End', 'ArrowUp', 'ArrowDown']) {
        await page.keyboard.press(key);
        const focused = surface(page).locator('button:focus');
        await expect(focused).toHaveCount(1);
        const box = await rect(surface(page));
        const entry = await rect(focused);
        expect(entry.y).toBeGreaterThanOrEqual(box.y);
        expect(entry.y + entry.height).toBeLessThanOrEqual(box.y + box.height);
        expect(entry.width).toBeGreaterThanOrEqual(44);
        expect(entry.height).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({ path: `${evidence}/focused-close-${stem}.png` });
      expect(await page.evaluate(() => scrollY)).toBe(y);
      const danger = surface(page).getByRole('button', {
        name: labels.habitEntries[2],
        exact: true,
      });
      await expect(danger).toHaveClass(/actions-danger/);
      expect(await danger.evaluate((node) => getComputedStyle(node).borderTopWidth)).toBe('1px');
      await page.keyboard.press('Escape');
      await expect(surface(page)).toHaveCount(0);
      await expect(trigger).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
      await trigger.click();
      await page.mouse.click(4, 4);
      await expect(surface(page)).toHaveCount(0);
      await expect(trigger).toBeFocused();
      const pillarTrigger = page.getByRole('button', {
        name: labels.pillarLabel + labels.pillar,
        exact: true,
      });
      await revealTrigger(page, pillarTrigger);
      const pillarBefore = await rect(group(page, labels.pillar));
      await pillarTrigger.click();
      expect(await rect(group(page, labels.pillar))).toEqual(pillarBefore);
      await contextHeading(page, labels.pillar, text);
      await contained(page);
      await expect(surface(page)).toHaveAttribute('aria-label', labels.pillarLabel + labels.pillar);
      await expect(surface(page).getByRole('button')).toHaveText(labels.pillarEntries);
      await expect(group(page, labels.pillar).locator('.pillar-disclosure')).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      await page.screenshot({ path: `${evidence}/pillar-${stem}.png` });
      await surface(page).getByRole('button', { name: labels.close, exact: true }).click();
      await expect(surface(page)).toHaveCount(0);
      await expect(pillarTrigger).toBeFocused();
      expect(await readDataset(page)).toEqual(beforeData);
    });
  }

test('desktop popovers retain button-only content and geometry', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await populated(page, 'en');
  for (const [target, label, entries] of [
    [copy.en.goal, copy.en.habitLabel, copy.en.habitEntries],
    [copy.en.pillar, copy.en.pillarLabel, copy.en.pillarEntries],
  ] as const) {
    const trigger = page.getByRole('button', { name: label + target, exact: true });
    await revealTrigger(page, trigger);
    const cards = page.locator('.management-pillar');
    const before = await Promise.all((await cards.all()).map(rect));
    await trigger.click();
    await expect(surface(page)).toHaveAttribute('aria-modal', 'false');
    expect(await surface(page).evaluate((node) => node.matches(':popover-open'))).toBe(true);
    await expect(surface(page).getByRole('heading')).toHaveCount(0);
    await expect(surface(page).getByRole('button')).toHaveText(entries);
    expect(await surface(page).evaluate((node) => node.children.length)).toBe(4);
    expect(await Promise.all((await cards.all()).map(rect))).toEqual(before);
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  }
});
