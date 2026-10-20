import { backControl, expandFixturePillars, expectReview } from './support/management-fixtures';
import { test, expect, type Page, type Locator } from '@playwright/test';
import {
  setupScheduledHabits,
  scheduledHabitGoals,
  nav,
  readDataset,
} from './support/habit-fixtures';

test.setTimeout(90_000);
test.use({ actionTimeout: 10_000 });
const screenshots = 'artifacts/pillars-polish/screenshots';

const row = (page: Page, goal: string) =>
  page
    .locator('.management-habit')
    .filter({ has: page.getByRole('heading', { name: goal, exact: true }) });

const group = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

const surface = (page: Page) => page.locator('[data-action-surface]');

async function list(page: Page) {
  await setupScheduledHabits(page);
  await nav(page, 'Pillars').click();
  await expandFixturePillars(page);
}

async function rect(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

test('Desktop habit actions do not reflow the row or stretch Edit', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await list(page);
  const habit = row(page, scheduledHabitGoals[1]);
  const edit = habit.getByRole('button', { name: 'Edit', exact: true });
  const before = await rect(habit);
  const editBefore = await rect(edit);
  const nextBefore = await rect(group(page, 'Nutrition'));
  await habit.locator('[data-history-id^="more:"]').click();
  expect(await rect(habit)).toEqual(before);
  expect(await rect(edit)).toEqual(editBefore);
  expect(await rect(group(page, 'Nutrition'))).toEqual(nextBefore);
  await expect(
    page.getByRole('dialog', { name: `Actions for habit: ${scheduledHabitGoals[1]}`, exact: true }),
  ).toBeVisible();
  await expect(surface(page)).toHaveCount(1);
});

test('Desktop keyboard dismissal, outside interaction and one open surface', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await list(page);
  const trigger = page.getByRole('button', {
    name: `Actions for habit: ${scheduledHabitGoals[1]}`,
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(
    surface(page).getByRole('button', { name: 'Move to another pillar', exact: true }),
  ).toBeFocused();
  await expect(surface(page).getByRole('button')).toHaveText([
    'Move to another pillar',
    'Review completions',
    'Archive habit',
    'Close',
  ]);
  await page.keyboard.press('ArrowDown');
  await expect(
    surface(page).getByRole('button', { name: 'Review completions', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(
    surface(page).getByRole('button', { name: 'Archive habit', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Home');
  await expect(
    surface(page).getByRole('button', { name: 'Move to another pillar', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('End');
  await expect(surface(page).getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(surface(page)).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole('button', { name: 'Actions for pillar: Body', exact: true }).click();
  await expect(surface(page)).toHaveCount(1);
  await expect(surface(page)).toHaveAttribute('aria-label', 'Actions for pillar: Body');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await surface(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Actions for pillar: Body', exact: true }),
  ).toBeFocused();
  await trigger.click();
  await page.mouse.click(20, 20);
  await expect(surface(page)).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await surface(page).getByRole('button', { name: 'Archive habit', exact: true }).click();
  await expect(surface(page)).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Archive this habit?', exact: true }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(trigger).toBeFocused();
});

test('Narrow sheet is modal, traps focus, locks scrolling without reflow and disposes cleanly', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await list(page);
  await page.addStyleTag({ content: 'html { font-size:200%; }' });
  const trigger = page.getByRole('button', {
    name: `Actions for habit: ${scheduledHabitGoals[3]}`,
    exact: true,
  });
  await trigger.scrollIntoViewIfNeeded();
  const before = await rect(group(page, 'Hygiene'));
  const y = await page.evaluate(() => scrollY);
  await trigger.click();
  await expect(surface(page)).toHaveAttribute('aria-modal', 'true');
  expect(await rect(group(page, 'Hygiene'))).toEqual(before);
  await expect(
    surface(page).getByRole('button', { name: 'Move to another pillar', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(surface(page).getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    surface(page).getByRole('button', { name: 'Move to another pillar', exact: true }),
  ).toBeFocused();
  await page.mouse.wheel(0, 500);
  expect(await page.evaluate(() => scrollY)).toBe(y);
  const box = await rect(surface(page));
  const bottomNav = await rect(page.getByRole('navigation'));
  expect(box.y).toBeGreaterThanOrEqual(8);
  expect(box.y + box.height).toBeLessThanOrEqual(bottomNav.y);
  await page.mouse.click(8, 8);
  await expect(surface(page)).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => scrollY)).toBe(y);
  await trigger.click();
  await surface(page).getByRole('button', { name: 'Move to another pillar', exact: true }).click();
  await expect(page.getByLabel('Pillar', { exact: true })).toBeFocused();
  await expect(surface(page)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await trigger.click();
  await surface(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(trigger).toBeFocused();
  await trigger.click();
  // Test-only programmatic route disposal bypasses native modal inertness.
  await nav(page, 'Today').evaluate((node) => (node as HTMLButtonElement).click());
  await expect(surface(page)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
  await expect(page.getByRole('heading', { name: 'Today', exact: true, level: 1 })).toBeFocused();
});

test('Compact icon controls keep expansion separate and ordered destructive actions restrained', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await list(page);
  const body = group(page, 'Body');
  const expand = body.getByRole('button', { name: 'Body', exact: true });
  const trigger = page.getByRole('button', { name: 'Actions for pillar: Body', exact: true });
  await expect(trigger.locator('svg')).toHaveCount(1);
  expect((await trigger.innerText()).trim()).toBe('');
  await expect(expand.locator('[data-chevron="up"]')).toHaveCount(1);
  const before = await rect(body);
  const next = await rect(group(page, 'Nutrition'));
  await trigger.click();
  expect(await rect(body)).toEqual(before);
  expect(await rect(group(page, 'Nutrition'))).toEqual(next);
  await expect(expand).toHaveAttribute('aria-expanded', 'true');
  await expect(surface(page).getByRole('button')).toHaveText([
    'Rename pillar',
    'View pillar streaks',
    'Remove from active pillars',
    'Close',
  ]);
  await expect(surface(page).getByRole('button', { name: 'Add habit', exact: true })).toHaveCount(
    0,
  );
  await expect(
    surface(page).getByRole('button', { name: 'Remove from active pillars', exact: true }),
  ).toHaveClass(/actions-danger/);
  await surface(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expand.click();
  await expect(expand.locator('[data-chevron="down"]')).toHaveCount(1);
  await trigger.click();
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Escape');
  await expand.click();
  const footer = body.getByRole('button', { name: 'Add habit', exact: true });
  await expect(footer).toHaveText('+ Add habit');
  expect(await footer.evaluate((node) => getComputedStyle(node).borderTopWidth)).toBe('0px');
  expect((await rect(footer)).height).toBeGreaterThanOrEqual(44);
  const edit = row(page, scheduledHabitGoals[1]).getByRole('button', { name: 'Edit', exact: true });
  expect((await rect(edit)).height).toBe(44);
  await expect(page.getByRole('button', { name: 'New pillar', exact: true })).not.toHaveClass(
    /secondary/,
  );
  await expect(page.getByRole('button', { name: 'Archived', exact: true })).toHaveClass(
    /secondary/,
  );
});

const longGoal =
  'Walk calmly through my neighborhood, notice the trees and return at my own pace without rushing or comparing myself to anyone else';
const longPillar = 'Creative practice, music and quiet time to reflect on my day';
const nextGoal = 'Pause and breathe';
const labels = {
  en: {
    pillars: 'Pillars',
    body: 'Body',
    nutrition: 'Nutrition',
    edit: 'Edit',
    add: 'Add habit',
    close: 'Close',
    habit: (goal: string) => `Actions for habit: ${goal}`,
    pillar: (name: string) => `Actions for pillar: ${name}`,
    habitEntries: ['Move to another pillar', 'Review completions', 'Archive habit', 'Close'],
    pillarEntries: ['Rename pillar', 'View pillar streaks', 'Remove from active pillars', 'Close'],
  },
  pt: {
    pillars: 'Pilares',
    body: 'Corpo',
    nutrition: 'Alimentação',
    edit: 'Editar',
    add: 'Adicionar hábito',
    close: 'Fechar',
    habit: (goal: string) => `Ações do hábito: ${goal}`,
    pillar: (name: string) => `Ações do pilar: ${name}`,
    habitEntries: ['Mover para outro pilar', 'Revisar conclusões', 'Arquivar hábito', 'Fechar'],
    pillarEntries: [
      'Renomear pilar',
      'Ver sequências do pilar',
      'Remover dos pilares ativos',
      'Fechar',
    ],
  },
};

async function populated(page: Page, language: 'en' | 'pt') {
  await list(page);
  await page.getByRole('button', { name: 'New pillar', exact: true }).click();
  await page.getByLabel('Pillar name').fill(longPillar);
  await page.getByRole('button', { name: 'Save pillar', exact: true }).click();
  await expect(group(page, longPillar).locator('.pillar-disclosure')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expandFixturePillars(page, [longPillar]);
  for (const goal of [longGoal, nextGoal]) {
    await group(page, 'Body').getByRole('button', { name: 'Add habit', exact: true }).click();
    await page.getByLabel('What do you want to do?').fill(goal);
    await page.getByRole('button', { name: 'Save habit', exact: true }).click();
  }
  if (language === 'pt') {
    await nav(page, 'Settings').click();
    await page.getByLabel('Language', { exact: true }).selectOption('pt');
    await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
    await nav(page, 'Pilares').click();
    await expandFixturePillars(page);
  }
}

async function contained(page: Page) {
  // Resize/visual-viewport events are delivered on the next browser frame.
  await expect
    .poll(async () => {
      const box = await surface(page).boundingBox();
      const viewport = page.viewportSize();
      const navBox = await page.getByRole('navigation').boundingBox();
      return (
        !!box &&
        !!viewport &&
        !!navBox &&
        box.x >= 8 &&
        box.x + box.width <= viewport.width - 8 &&
        box.y >= 8 &&
        box.y + box.height <= navBox.y
      );
    })
    .toBe(true);
  const box = await rect(surface(page));
  const viewport = page.viewportSize()!;
  const bottomNav = await rect(page.getByRole('navigation'));
  expect(box.x).toBeGreaterThanOrEqual(8);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 8);
  expect(box.y).toBeGreaterThanOrEqual(8);
  expect(box.y + box.height).toBeLessThanOrEqual(bottomNav.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const button of await surface(page).getByRole('button').all()) {
    const target = await rect(button);
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
  }
}

test.describe('Responsive touch matrix', () => {
  test.use({ hasTouch: true });
  for (const language of ['en', 'pt'] as const)
    for (const width of [320, 375, 390, 393, 402, 430, 440, 1280])
      for (const text of [100, 200]) {
        test(`${language} ${width}px text${text}: full goals, unchanged geometry and reachable actions`, async ({
          page,
        }) => {
          await page.setViewportSize({ width, height: 900 });
          await populated(page, language);
          const copy = labels[language];
          const stem = `${language}-${width}-text${text}`;
          await page.addStyleTag({ content: `html {font-size:${text}%;}` });
          await page.evaluate(() => scrollTo(0, 0));
          const beforeData = await readDataset(page);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
          await page.screenshot({ path: `${screenshots}/grouped-list-${stem}.png` });
          const habit = row(page, longGoal);
          const trigger = page.getByRole('button', { name: copy.habit(longGoal), exact: true });
          await trigger.evaluate((node) => node.scrollIntoView({ block: 'center' }));
          const edit = habit.getByRole('button', { name: copy.edit, exact: true });
          const before = {
            card: await rect(group(page, copy.body)),
            row: await rect(habit),
            next: await rect(row(page, nextGoal)),
            edit: await rect(edit),
            nextCard: await rect(group(page, copy.nutrition)),
          };
          await trigger.tap();
          await expect(surface(page)).toHaveCount(1);
          await expect(surface(page)).toHaveAttribute('aria-label', copy.habit(longGoal));
          await expect(surface(page)).toHaveAttribute('aria-modal', String(width < 640));
          expect(await rect(group(page, copy.body))).toEqual(before.card);
          expect(await rect(habit)).toEqual(before.row);
          expect(await rect(row(page, nextGoal))).toEqual(before.next);
          expect(await rect(edit)).toEqual(before.edit);
          expect(await rect(group(page, copy.nutrition))).toEqual(before.nextCard);
          await expect(habit.getByRole('heading', { name: longGoal, exact: true })).toHaveText(
            longGoal,
          );
          await expect(surface(page).getByRole('button')).toHaveText(copy.habitEntries);
          await contained(page);
          await expect(surface(page).getByRole('button').first()).toBeFocused();
          await page.screenshot({ path: `${screenshots}/habit-actions-${stem}.png` });
          await surface(page).getByRole('button', { name: copy.close, exact: true }).tap();
          await expect(trigger).toBeFocused();
          const pillarTrigger = page.getByRole('button', {
            name: copy.pillar(longPillar),
            exact: true,
          });
          await pillarTrigger.evaluate((node) => node.scrollIntoView({ block: 'center' }));
          const pillarBefore = await rect(group(page, longPillar));
          await pillarTrigger.tap();
          expect(await rect(group(page, longPillar))).toEqual(pillarBefore);
          await expect(surface(page)).toHaveAttribute('aria-label', copy.pillar(longPillar));
          await expect(surface(page).getByRole('button')).toHaveText(copy.pillarEntries);
          await expect(
            surface(page).getByRole('button', { name: copy.add, exact: true }),
          ).toHaveCount(0);
          await contained(page);
          await page.screenshot({ path: `${screenshots}/pillar-actions-${stem}.png` });
          await page.keyboard.press('Escape');
          await expect(surface(page)).toHaveCount(0);
          await expect(pillarTrigger).toBeFocused();
          await expect(
            group(page, longPillar).getByRole('button', { name: copy.add, exact: true }),
          ).toHaveText(`+ ${copy.add}`);
          expect(await readDataset(page)).toEqual(beforeData);
        });
      }
});

test('Desktop surfaces clamp at right and bottom edges and follow scrolling and resizing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await list(page);
  const trigger = page.getByRole('button', { name: 'Actions for pillar: Hygiene', exact: true });
  // Position a real trigger at exact viewport edges in this isolated browser-only stress fixture.
  await trigger.evaluate((node) => {
    node.style.position = 'fixed';
    node.style.right = '12px';
    node.style.bottom = 'calc(var(--bottom-nav-height) + 16px)';
  });
  await trigger.click();
  await contained(page);
  const before = await rect(surface(page));
  expect(before.y + before.height).toBeLessThan((await rect(trigger)).y);
  await page.evaluate(() => scrollTo(0, 150));
  await contained(page);
  await page.setViewportSize({ width: 800, height: 640 });
  await contained(page);
  await page.setViewportSize({ width: 390, height: 640 });
  await expect(surface(page)).toHaveAttribute('aria-modal', 'true');
  await contained(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(surface(page)).toHaveAttribute('aria-modal', 'false');
  await contained(page);
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('Phone Edit and dots stay top aligned beside a full long goal when text fits comfortably', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await populated(page, 'en');
  const habit = row(page, longGoal);
  const heading = habit.getByRole('heading', { name: longGoal, exact: true });
  const edit = habit.getByRole('button', { name: 'Edit', exact: true });
  const trigger = habit.locator('[data-action-trigger]');
  expect(Math.abs((await rect(edit)).y - (await rect(heading)).y)).toBeLessThanOrEqual(1);
  expect((await rect(edit)).height).toBe(44);
  expect((await rect(trigger)).y).toBe((await rect(edit)).y);
  await heading.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: `${screenshots}/long-goal-top-actions-en-390.png` });
});

test('Enlarged sheet in a short viewport keeps focused entries visible above measured safe-area navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 440 });
  await list(page);
  await page.addStyleTag({
    content: 'html {font-size:200%;} nav {padding-bottom:32px !important;}',
  });
  const trigger = page.getByRole('button', { name: 'Actions for pillar: Hygiene', exact: true });
  await trigger.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  await trigger.click();
  expect(await surface(page).evaluate((node) => node.matches(':modal'))).toBe(true);
  await contained(page);
  await nav(page, 'Today').evaluate((node) => node.focus());
  await expect(surface(page).getByRole('button').first()).toBeFocused();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    const panel = await rect(surface(page));
    const focused = await page.locator('[data-action-surface] button:focus').boundingBox();
    expect(focused).not.toBeNull();
    expect(focused!.y).toBeGreaterThanOrEqual(panel.y);
    expect(focused!.y + focused!.height).toBeLessThanOrEqual(panel.y + panel.height);
  }
  await page.screenshot({ path: `${screenshots}/short-safearea-sheet-en-320-text200.png` });
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

for (const width of [390, 1280])
  test(`Management selections preserve existing commands and destination focus at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await list(page);

    const habitTrigger = () =>
      page.getByRole('button', {
        name: `Actions for habit: ${scheduledHabitGoals[1]}`,
        exact: true,
      });

    const pillarTrigger = () =>
      page.getByRole('button', { name: 'Actions for pillar: Body', exact: true });

    await row(page, scheduledHabitGoals[1])
      .getByRole('button', { name: 'Edit', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Edit habit', exact: true, level: 1 }),
    ).toBeFocused();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await habitTrigger().click();
    await surface(page)
      .getByRole('button', { name: 'Move to another pillar', exact: true })
      .click();
    await expect(page.getByLabel('Pillar', { exact: true })).toBeFocused();
    await page.getByLabel('Pillar', { exact: true }).selectOption('mind');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(
      group(page, 'Mind').getByRole('heading', { name: scheduledHabitGoals[1], exact: true }),
    ).toBeVisible();
    const moved = await readDataset(page);
    expect(moved.habits[1].memberships.at(-1)!.pillarId).toBe('mind');
    await habitTrigger().click();
    await surface(page).getByRole('button', { name: 'Review completions', exact: true }).click();
    await expectReview(page, scheduledHabitGoals[1], true);
    await expect(backControl(page)).toHaveText('← Pillars');
    await backControl(page).click();
    await expect(habitTrigger()).toBeFocused();
    await habitTrigger().click();
    await surface(page).getByRole('button', { name: 'Archive habit', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Archive this habit?', exact: true }),
    ).toBeFocused();
    await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
    await expect(row(page, scheduledHabitGoals[1])).toHaveCount(0);
    const archived = await readDataset(page);
    expect(archived.habits[1].periods.at(-1)!.archivedOn).toBeDefined();
    await pillarTrigger().click();
    await surface(page).getByRole('button', { name: 'View pillar streaks', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Body', exact: true, level: 1 })).toBeFocused();
    await backControl(page).click();
    await expect(pillarTrigger()).toBeFocused();
    await pillarTrigger().click();
    await surface(page).getByRole('button', { name: 'Rename pillar', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Rename pillar', exact: true, level: 1 }),
    ).toBeFocused();
    await page.getByLabel('Pillar name').fill('My movement');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    expect((await readDataset(page)).pillars.find((p) => p.id === 'body')!.nameOverride).toBe(
      'My movement',
    );
    await page
      .getByRole('button', { name: 'Actions for pillar: My movement', exact: true })
      .click();
    await surface(page)
      .getByRole('button', { name: 'Remove from active pillars', exact: true })
      .click();
    await expect(page.getByRole('button', { name: 'Confirm removal', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm removal', exact: true }).click();
    await expect(group(page, 'My movement')).toHaveCount(0);
    const removed = await readDataset(page);
    expect(removed.pillars.find((p) => p.id === 'body')!.removedOn).toBeDefined();
    expect(removed.habits).toHaveLength(4);
    expect(removed.occurrences).toEqual(archived.occurrences);
  });
