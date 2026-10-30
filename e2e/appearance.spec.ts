import { test, expect } from '@playwright/test';
import {
  setupScheduledHabits,
  nav,
  readDataset,
  openHabit,
  onDate,
} from './support/habit-fixtures';
import { holdNextCommit, commitHeld, releaseCommit } from './support/pwa-update';
import { readFile } from 'node:fs/promises';
import { resolveSite } from '../config/site.mjs';

const storageKey = `my-goat-journey:appearance:${resolveSite().appBase}`;

test.setTimeout(90_000);

for (const colorScheme of ['light', 'dark'] as const) {
  test(`fresh System appearance follows ${colorScheme} before app initialization`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme });
    let initializedBeforeModule: string | null = null;
    await page.route(/\/src\/main\.tsx(?:\?.*)?$/, async (route) => {
      initializedBeforeModule = await page.locator('html').getAttribute('data-appearance');
      await route.continue();
    });
    await page.goto('./');
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
    expect(initializedBeforeModule).toBe(colorScheme);
    await expect(page.locator('html')).toHaveAttribute('data-appearance', colorScheme);
    await expect(page.locator('html')).toHaveCSS('color-scheme', colorScheme);
    await expect(page.locator('html')).toHaveCSS(
      'background-color',
      colorScheme === 'dark' ? 'rgb(9, 11, 14)' : 'rgb(255, 250, 240)',
    );
    await expect(page.locator('.onboarding-logo')).toBeVisible();
    expect(
      await page
        .locator('.onboarding-logo')
        .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`onboarding-${colorScheme}.png`) });
  });
}

test('Appearance is an immediate native radio preference, not a diary mutation', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await nav(page, 'Settings').click();
  const before = await readDataset(page);
  const appearance = page.getByRole('group', { name: 'Appearance', exact: true });
  await expect(appearance.getByRole('radio', { name: 'System', exact: true })).toBeChecked();
  const dark = appearance.getByRole('radio', { name: 'Dark', exact: true });
  await dark.focus();
  await dark.press('Space');
  await expect(dark).toBeChecked();
  await expect(dark).toBeFocused();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
  const controlContrast = await page.locator('#language').evaluate((element) => {
    const luminance = (color: string) => {
      const channels = color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
        .map((value) => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const style = getComputedStyle(element);
    const foreground = luminance(style.borderTopColor);
    const background = luminance(style.backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  expect(controlContrast).toBeGreaterThanOrEqual(3);
  expect(await readDataset(page)).toEqual(before);
});

for (const choice of ['Light', 'Dark'] as const) {
  test(`explicit ${choice} survives reload and ignores live System changes`, async ({ page }) => {
    await setupScheduledHabits(page);
    await nav(page, 'Settings').click();
    const before = await readDataset(page);
    await page.getByRole('radio', { name: choice, exact: true }).locator('..').click();
    const resolved = choice.toLowerCase();
    await page.emulateMedia({ colorScheme: choice === 'Light' ? 'dark' : 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-appearance', resolved);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-appearance', resolved);
    await nav(page, 'Settings').click();
    await expect(page.getByRole('radio', { name: choice, exact: true })).toBeChecked();
    expect(await readDataset(page)).toEqual(before);
  });
}

test('System changes live; native keyboard choices and EN/PT retain nodes and focus', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await setupScheduledHabits(page);
  await nav(page, 'Settings').click();
  const before = await readDataset(page);
  const system = page.getByRole('radio', { name: 'System', exact: true });
  await system.focus();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
  await expect(system).toBeFocused();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
  await system.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Light', exact: true })).toBeChecked();
  await page.keyboard.press('ArrowRight');
  const dark = page.getByRole('radio', { name: 'Dark', exact: true });
  await expect(dark).toBeFocused();
  await expect(dark).toBeChecked();
  await expect(dark.locator('+ span')).toHaveCSS('outline-style', 'solid');
  expect(await readDataset(page)).toEqual(before);
  const node = await dark.elementHandle();
  await page.getByLabel('Language', { exact: true }).selectOption('pt');
  const group = page.getByRole('group', { name: 'Aparência', exact: true });
  await expect(group.getByRole('radio', { name: 'Sistema', exact: true })).toBeVisible();
  await expect(group.getByRole('radio', { name: 'Claro', exact: true })).toBeVisible();
  await expect(group.getByRole('radio', { name: 'Escuro', exact: true })).toBeChecked();
  expect(
    await node!.evaluate((element) => element === document.querySelector('input[value="dark"]')),
  ).toBe(true);
  await group.getByRole('radio', { name: 'Escuro', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(group.getByRole('radio', { name: 'Claro', exact: true })).toBeFocused();
  await expect(group.getByRole('radio', { name: 'Claro', exact: true })).toBeChecked();
  await page.keyboard.press('ArrowLeft');
  await expect(group.getByRole('radio', { name: 'Sistema', exact: true })).toBeChecked();
});

for (const failure of ['invalid', 'read', 'write'] as const) {
  test(`${failure} local storage falls back safely and keeps session switching`, async ({
    page,
  }) => {
    await page.addInitScript(
      ({ failure, storageKey }) => {
        if (failure === 'invalid') localStorage.setItem(storageKey, 'Graphite');
        if (failure === 'read')
          Object.defineProperty(window, 'localStorage', {
            get() {
              throw new DOMException('Blocked', 'SecurityError');
            },
          });
        if (failure === 'write')
          Storage.prototype.setItem = () => {
            throw new DOMException('Full', 'QuotaExceededError');
          };
      },
      { failure, storageKey },
    );
    await page.emulateMedia({ colorScheme: 'dark' });
    await setupScheduledHabits(page);
    await nav(page, 'Settings').click();
    const before = await readDataset(page);
    await expect(page.getByRole('radio', { name: 'System', exact: true })).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
    await page.getByRole('radio', { name: 'Light', exact: true }).locator('..').click();
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
    await expect(page.getByRole('radio', { name: 'Light', exact: true })).toBeChecked();
    await page.getByRole('radio', { name: 'Dark', exact: true }).locator('..').click();
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
    expect(await readDataset(page)).toEqual(before);
  });
}

test('device appearance changes preserve a literal dirty draft and its navigation guards', async ({
  page,
  context,
}) => {
  await setupScheduledHabits(page);
  const peer = await context.newPage();
  await peer.clock.install({ time: new Date('2026-09-27T12:00:00') });
  await peer.goto('./');
  await nav(peer, 'Settings').click();
  await openHabit(page);
  await page.getByRole('button', { name: 'Edit habit', exact: true }).click();
  const literal = '  Keep my literal $& draft\nwith accents: café  ';
  const input = page.getByLabel('Habit', { exact: true });
  await input.fill(literal);
  await input.focus();
  const before = await readDataset(page);
  await peer.getByRole('radio', { name: 'Dark', exact: true }).locator('..').click();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
  await expect(input).toHaveValue(literal);
  await expect(input).toBeFocused();
  expect(await readDataset(page)).toEqual(before);
  await nav(page, 'Today').click();
  const dialog = page.getByRole('dialog', { name: 'Leave without saving?', exact: true });
  await expect(dialog).toBeVisible();
  await peer.getByRole('radio', { name: 'Light', exact: true }).locator('..').click();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(input).toHaveValue(literal);
  expect(await readDataset(page)).toEqual(before);
  await peer.close();
});

test('backup replacement and full diary reset retain device appearance', async ({ page }) => {
  await setupScheduledHabits(page);
  await nav(page, 'Settings').click();
  await page.getByRole('radio', { name: 'Dark', exact: true }).locator('..').click();
  const before = await readDataset(page);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup', exact: true }).click();
  const download = await pending;
  const bytes = await readFile((await download.path())!);
  const { revision: _revision, ...portable } = before;
  expect(JSON.parse(bytes.toString('utf8')).dataset).toEqual(portable);
  await page.getByRole('checkbox', { name: 'Reduce motion', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Reduce motion', exact: true })).toBeChecked();
  await page
    .getByLabel('Choose backup file', { exact: true })
    .setInputFiles({ name: 'fictional.json', mimeType: 'application/json', buffer: bytes });
  await expect(page.getByRole('heading', { name: 'Backup ready', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Replace current data', exact: true }).click();
  await expect(page.getByText('Backup restored.', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
  await page.getByRole('button', { name: 'Delete all data…', exact: true }).click();
  await page.getByRole('button', { name: 'Delete all data', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe('dark');
});

for (const theme of ['light', 'dark'] as const) {
  test(`representative ${theme} mobile/desktop surfaces and isolated captures`, async ({
    page,
  }, testInfo) => {
    await setupScheduledHabits(page);
    // Real dated facts give calendars completed, missed, unscheduled and pre-tracking cells.
    await onDate(page, '2026-09-28');
    for (const goal of ['Read ten pages', 'Complete my walk']) {
      const checkbox = page.getByRole('checkbox', { name: `Done: ${goal}`, exact: true });
      await checkbox.click();
      await expect(checkbox).toBeChecked();
    }
    await onDate(page, '2026-10-02');
    await nav(page, 'Settings').click();
    await page
      .getByRole('radio', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true })
      .locator('..')
      .click();
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const screen of ['Today', 'Progress', 'Journey', 'Pillars', 'Settings']) {
        await nav(page, screen).click();
        if (screen === 'Progress')
          await page.getByRole('button', { name: '7d', exact: true }).click();
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
          .toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(`${theme}-${screen.toLowerCase()}-${width}.png`),
          fullPage: true,
        });
      }
      await openHabit(page);
      await page.getByRole('button', { name: 'Edit habit', exact: true }).click();
      await page
        .getByLabel('Habit', { exact: true })
        .fill('  Fictional retained draft\nwith literal whitespace  ');
      await page.screenshot({
        path: testInfo.outputPath(`${theme}-editing-${width}.png`),
        fullPage: true,
      });
      await nav(page, 'Today').click();
      const dialog = page.getByRole('dialog', { name: 'Leave without saving?', exact: true });
      await expect(dialog).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`${theme}-modal-${width}.png`) });
      await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click();
    }
  });
}

test('Appearance radios respect protected Settings commits and fit enlarged Portuguese', async ({
  page,
}, testInfo) => {
  await setupScheduledHabits(page);
  await nav(page, 'Settings').click();
  const radios = page.getByRole('radio');
  await holdNextCommit(page);
  await page.getByLabel('Language', { exact: true }).selectOption('pt');
  await expect.poll(() => commitHeld(page)).toBe(true);
  for (let index = 0; index < 3; index++) await expect(radios.nth(index)).toBeDisabled();
  await releaseCommit(page);
  const group = page.getByRole('group', { name: 'Aparência', exact: true });
  await expect(group).toBeVisible();
  await expect(radios.nth(0)).toBeEnabled();
  await page.setViewportSize({ width: 320, height: 720 });
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  const dark = group.getByRole('radio', { name: 'Escuro', exact: true });
  await dark.focus();
  await dark.press('Space');
  await expect(dark).toBeFocused();
  await expect(dark).toBeChecked();
  const optionLines = await group
    .locator('.appearance-options .appearance-label')
    .evaluateAll((options) =>
      options.map((option) => {
        const range = document.createRange();
        range.selectNodeContents(option);
        return range.getClientRects().length;
      }),
    );
  expect(optionLines).toEqual([1, 1, 1]);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await dark.locator('+ span').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('pt-enlarged-dark-focus.png') });
});

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} aggregate partial state and dated day details keep meaningful indicators`, async ({
    page,
  }, testInfo) => {
    await setupScheduledHabits(page);
    await nav(page, 'Settings').click();
    await page
      .getByRole('radio', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true })
      .locator('..')
      .click();
    await nav(page, 'Today').click();
    await onDate(page, '2026-09-28');
    const completed = page.getByRole('checkbox', { name: 'Done: Read ten pages', exact: true });
    const row = page.locator('article.today-goal').filter({ has: completed });
    const neutral = await row.evaluate((element) => getComputedStyle(element).backgroundColor);
    await completed.click();
    await expect(completed).toBeChecked();
    await expect(row).toHaveCSS('background-color', neutral);
    await expect(row.getByRole('heading')).toHaveCSS('text-decoration-line', 'none');
    await page.screenshot({ path: testInfo.outputPath(`${theme}-completed-neutral.png`) });
    await onDate(page, '2026-10-02');
    const before = await readDataset(page);
    await nav(page, 'Progress').click();
    await page.getByRole('tab', { name: 'Pillars', exact: true }).click();
    const aggregate = page
      .locator('article.consistency-card')
      .filter({ has: page.getByRole('heading', { name: 'All pillars together', exact: true }) });
    const day = aggregate.locator('button[data-calendar-date="2026-09-28"]');
    await expect(day).toHaveClass(/state-partial/);
    await expect(day).toHaveAttribute('aria-label', /Partially completed/);
    await day.focus();
    await page.screenshot({ path: testInfo.outputPath(`${theme}-partial-calendar.png`) });
    await day.press('Enter');
    const detail = page.locator('main.progress-day-page');
    await expect(detail.locator('.day-state.state-partial')).toContainText('Partially completed');
    await expect(detail.locator('.day-state svg')).toBeVisible();
    await expect(detail.locator('.historical-state')).toContainText([
      'Completed',
      'Not completed',
      'Not completed',
      'Not completed',
    ]);
    await page.screenshot({
      path: testInfo.outputPath(`${theme}-day-details.png`),
      fullPage: true,
    });
    expect(await readDataset(page)).toEqual(before);
    await page.getByRole('button', { name: 'Back to Progress', exact: true }).click();
    await expect(day).toBeFocused();
  });
}

test('startup preference changes from a peer survive a delayed module handoff', async ({
  page,
  context,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await setupScheduledHabits(page);
  await nav(page, 'Settings').click();
  const before = await readDataset(page);
  const entering = await context.newPage();
  await entering.emulateMedia({ colorScheme: 'light' });
  await entering.clock.setFixedTime(new Date('2026-09-27T12:00:00'));
  await entering.addInitScript(() => {
    const state = window as typeof window & {
      startupAppearanceEvents: { key: string | null; value: string | null; trusted: boolean }[];
    };
    state.startupAppearanceEvents = [];
    window.addEventListener('storage', (event) => {
      state.startupAppearanceEvents.push({
        key: event.key,
        value: event.newValue,
        trusted: event.isTrusted,
      });
    });
  });
  let release = () => {};
  let continued: Promise<void> | undefined;
  let held = false;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await entering.route(/\/src\/main\.tsx(?:\?.*)?$/, async (route) => {
    held = true;
    continued = waiting.then(() => route.continue());
    await continued;
  });
  try {
    await entering.goto('./', { waitUntil: 'commit' });
    await expect.poll(() => held).toBe(true);
    await expect(entering.locator('html')).toHaveAttribute('data-appearance-preference', 'system');
    await page.getByRole('radio', { name: 'Dark', exact: true }).locator('..').click();
    await expect(page.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
    await expect
      .poll(() =>
        entering.evaluate((key) => {
          const state = window as typeof window & {
            startupAppearanceEvents: {
              key: string | null;
              value: string | null;
              trusted: boolean;
            }[];
          };
          return state.startupAppearanceEvents.some(
            (event) => event.key === key && event.value === 'dark' && event.trusted,
          );
        }, storageKey),
      )
      .toBe(true);
    // The real storage event has already dispatched while React's entry is still held.
    await expect(entering.locator('html')).toHaveAttribute('data-appearance-preference', 'dark');
    await expect(entering.locator('html')).toHaveAttribute('data-appearance', 'dark');
  } finally {
    release();
    await continued;
    await entering.unrouteAll({ behavior: 'wait' });
  }
  await expect(entering.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await nav(entering, 'Settings').click();
  await expect(entering.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
  await expect(entering.locator('html')).toHaveAttribute('data-appearance', 'dark');
  expect(await readDataset(entering)).toEqual(before);
  await entering.screenshot({ path: testInfo.outputPath('peer-dark-after-delayed-entry.png') });
  await entering.close();
});
