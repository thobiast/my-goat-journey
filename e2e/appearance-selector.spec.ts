import { test, expect, type Locator, type Page } from '@playwright/test';
import { nav, readDataset } from './support/habit-fixtures';
import { holdNextCommit, commitHeld, releaseCommit } from './support/pwa-update';

const labels = {
  en: ['System', 'Light', 'Dark'],
  pt: ['Sistema', 'Claro', 'Escuro'],
};
const values = ['system', 'light', 'dark'] as const;

async function setupAppearanceDiary(page: Page) {
  // Selector presentation needs one real fictional habit, not four scheduled-history fixtures.
  await page.clock.install({ time: new Date('2026-09-27T12:00:00') });
  await page.goto('./');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mind', exact: true })).toBeVisible();
  await page.getByLabel('What do you want to do?').fill('Fictional appearance selector habit');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  for (const name of ['Body', 'Nutrition', 'Hygiene']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Start my journey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
}

async function renderedColors(group: Locator) {
  return group.evaluate((element) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    const rgba = (color: string, background?: string) => {
      context.clearRect(0, 0, 1, 1);
      if (background) {
        context.fillStyle = background;
        context.fillRect(0, 0, 1, 1);
      }
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    };
    const selected = getComputedStyle(element.querySelector('input:checked + span')!);
    return {
      track: rgba(getComputedStyle(element.querySelector('.appearance-options')!).backgroundColor),
      selected: rgba(selected.backgroundColor),
      // Background paints beneath the border; Chromium's system Highlight can be translucent.
      indicator: rgba(selected.borderTopColor, selected.backgroundColor),
    };
  });
}

function contrast(first: number[], second: number[]) {
  const luminance = (color: number[]) => {
    const channels = color.slice(0, 3).map((value) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test.setTimeout(90_000);

async function positions(group: Locator) {
  return group.locator('.appearance-label, .appearance-icon').evaluateAll((elements) => {
    const origin = elements[0].closest('fieldset')!.getBoundingClientRect();
    return elements.map((element) => {
      const box = element.getBoundingClientRect();
      return [box.x - origin.x, box.y - origin.y, box.width, box.height];
    });
  });
}

for (const theme of ['light', 'dark'] as const) {
  for (const language of ['en', 'pt'] as const) {
    test(`compact selector ${theme} ${language}: stable icons, geometry, pointer and keyboard states`, async ({
      page,
    }, testInfo) => {
      await page.emulateMedia({ colorScheme: theme });
      await setupAppearanceDiary(page);
      await nav(page, 'Settings').click();
      if (language === 'pt') {
        await page.getByLabel('Language', { exact: true }).selectOption('pt');
        await expect(page.getByLabel('Idioma', { exact: true })).toHaveValue('pt');
      }
      const group = page.locator('.appearance-preference');
      await expect(group).toHaveAccessibleName(language === 'en' ? 'Appearance' : 'Aparência');
      await expect(group.locator('.appearance-icon')).toHaveCount(3);
      const before = await readDataset(page);
      const widths = [390, 1280, 320];
      const viewports = widths.map((width) => ({ width, enlarged: false }));
      if (language === 'pt') viewports.push({ width: 320, enlarged: true });
      for (const { width, enlarged } of viewports) {
        await page.setViewportSize({ width, height: enlarged ? 900 : 844 });
        await page.evaluate((enlarged) => {
          document.documentElement.style.fontSize = enlarged ? '200%' : '';
        }, enlarged);
        await group.scrollIntoViewIfNeeded();
        const geometry = await positions(group);
        for (const [index, value] of values.entries()) {
          const radio = group.getByRole('radio', { name: labels[language][index], exact: true });
          await radio.locator('..').click();
          await expect(radio).toBeChecked();
          await expect(radio).toBeFocused();
          await expect(group.locator('input:checked')).toHaveCount(1);
          for (const unselected of await group.locator('input:not(:checked) + span').all())
            await expect(unselected).toHaveCSS('border-top-width', '0px');
          const option = radio.locator('+ span');
          await expect(option.locator('svg')).toHaveCount(1);
          await expect(option).toHaveCSS('text-decoration-line', 'none');
          await expect(option).toHaveCSS('box-shadow', 'none');
          await expect(option).toHaveCSS('border-top-width', '2px');
          await expect(option).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
          expect(
            Number(await option.evaluate((element) => getComputedStyle(element).fontWeight)),
          ).toBeLessThanOrEqual(600);
          await expect(option.locator('.appearance-icon')).toHaveAttribute('aria-hidden', 'true');
          await expect(option.locator('.appearance-icon')).toHaveAttribute('focusable', 'false');

          await expect(option.locator('.appearance-icon')).toHaveAttribute(
            'data-appearance-icon',
            value,
          );
          const iconGaps = await group
            .locator('.appearance-options > label')
            .evaluateAll((options) =>
              options.map((option) => {
                const icon = option.querySelector('.appearance-icon')!.getBoundingClientRect();
                const range = document.createRange();
                range.selectNodeContents(option.querySelector('.appearance-label')!);
                return range.getBoundingClientRect().left - icon.right;
              }),
            );
          expect(iconGaps.every((gap) => gap >= 0 && gap <= 6)).toBe(true);
          expect(await positions(group)).toEqual(geometry);
          const boxes = await group.locator('.appearance-options > label').evaluateAll((elements) =>
            elements.map((element) => {
              const box = element.getBoundingClientRect();
              return { width: box.width, height: box.height, y: box.y };
            }),
          );
          expect(
            Math.max(...boxes.map((box) => box.width)) - Math.min(...boxes.map((box) => box.width)),
          ).toBeLessThan(1);
          expect(boxes.every((box) => box.width >= 44 && box.height >= 44)).toBe(true);
          const control = (await group.locator('.appearance-options').boundingBox())!;
          const field = (await page.locator('#language').boundingBox())!;
          const groupBox = (await group.boundingBox())!;
          expect(Math.abs(groupBox.x - field.x)).toBeLessThan(1);
          const rem = await page.evaluate(() =>
            parseFloat(getComputedStyle(document.documentElement).fontSize),
          );
          expect(groupBox.width).toBeLessThanOrEqual(24 * rem);
          if (width === 1280) expect(groupBox.width).toBeCloseTo(24 * rem, 0);
          if (!enlarged && new Set(boxes.map((box) => box.y)).size === 1) {
            expect(control.height).toBeGreaterThanOrEqual(44);
            expect(control.height).toBeLessThanOrEqual(48);
          }
          const centers = await group.locator('.appearance-option').evaluateAll((options) =>
            options.map((element) => {
              const optionBox = element.getBoundingClientRect();
              const pairBox = element.querySelector('.appearance-choice')!.getBoundingClientRect();
              return Math.abs(pairBox.x + pairBox.width / 2 - optionBox.x - optionBox.width / 2);
            }),
          );
          expect(centers.every((distance) => distance < 1)).toBe(true);
          const lines = await group.locator('.appearance-label').evaluateAll((elements) =>
            elements.map((element) => {
              const range = document.createRange();
              range.selectNodeContents(element);
              return range.getClientRects().length;
            }),
          );
          expect(lines).toEqual([1, 1, 1]);
          const resolved = value === 'system' ? theme : value;
          await expect(page.locator('html')).toHaveAttribute('data-appearance', resolved);
          // Surface palette is an aesthetic guard; selection contrast is tested separately below.
          expect(await renderedColors(group)).toMatchObject(
            resolved === 'light'
              ? { track: [240, 240, 233, 255], selected: [255, 253, 247, 255] }
              : { track: [20, 24, 29, 255], selected: [40, 45, 50, 255] },
          );
          await expect
            .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
            .toBe(true);
          if (!enlarged || value === 'dark') {
            await (width === 1280 ? group.locator('..') : group).screenshot({
              path: testInfo.outputPath(
                `${theme}-${language}-${width}-${enlarged ? 'large-' : ''}${value}.png`,
              ),
            });
          }
        }
      }
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '';
      });
      await page.setViewportSize({ width: 1280, height: 844 });
      const system = group.getByRole('radio', { name: labels[language][0], exact: true });
      await system.focus();
      await system.press('Space');
      await expect(system).toBeChecked();
      await expect(system.locator('+ span')).toHaveCSS('outline-width', '3px');
      await group.locator('..').screenshot({
        path: testInfo.outputPath(`${theme}-${language}-desktop-focus.png`),
      });
      await system.press('ArrowRight');
      await expect(
        group.getByRole('radio', { name: labels[language][1], exact: true }),
      ).toBeChecked();
      await page.keyboard.press('ArrowRight');
      const dark = group.getByRole('radio', { name: labels[language][2], exact: true });
      await expect(dark).toBeFocused();
      await expect(dark).toBeChecked();
      await expect(dark.locator('+ span')).toHaveCSS('outline-style', 'solid');
      await expect(dark.locator('+ span')).toHaveCSS('outline-width', '3px');

      expect(await readDataset(page)).toEqual(before);
      await page.reload();
      await nav(page, language === 'en' ? 'Settings' : 'Ajustes').click();
      await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
      await expect(dark).toBeChecked();
      expect(await readDataset(page)).toEqual(before);
      await group
        .getByRole('radio', { name: labels[language][theme === 'light' ? 1 : 2], exact: true })
        .locator('..')
        .click();
      await holdNextCommit(page);
      await page
        .getByLabel(language === 'en' ? 'Language' : 'Idioma', { exact: true })
        .selectOption(language === 'en' ? 'pt' : 'en');
      await expect.poll(() => commitHeld(page)).toBe(true);
      for (const radio of await group.getByRole('radio').all()) await expect(radio).toBeDisabled();
      await expect(group.locator('input:checked')).toHaveValue(theme);
      const disabledBox = (await group.locator('label').first().boundingBox())!;
      // Real pointer input still reaches the page; native disabled radios must ignore it.
      await page.mouse.click(
        disabledBox.x + disabledBox.width / 2,
        disabledBox.y + disabledBox.height / 2,
      );
      await expect(group.locator('input:checked')).toHaveValue(theme);
      await expect(group.locator('input:disabled + span').first()).toHaveCSS('opacity', '0.65');
      await group.screenshot({ path: testInfo.outputPath(`${theme}-${language}-disabled.png`) });
      await releaseCommit(page);
      await expect(group.getByRole('radio').first()).toBeEnabled();
    });
  }
}

test('touch-emulated native labels select each option without losing radio focus', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  try {
    const page = await context.newPage();
    await setupAppearanceDiary(page);
    await nav(page, 'Settings').tap();
    for (const label of ['Dark', 'Light', 'System']) {
      const radio = page.getByRole('radio', { name: label, exact: true });
      await radio.locator('..').tap();
      await expect(radio).toBeChecked();
      await expect(radio).toBeFocused();
      await expect(radio.locator('+ span')).toHaveCSS('border-top-width', '2px');
      await expect(page.locator('.appearance-options input:checked')).toHaveCount(1);
    }
  } finally {
    await context.close();
  }
});

for (const [theme, forcedColors] of [
  ['light', 'none'],
  ['dark', 'none'],
  ['light', 'active'],
  ['dark', 'active'],
] as const) {
  for (const language of ['en', 'pt'] as const) {
    test(`selection indicator ${forcedColors} ${theme} ${language}: selection survives external focus and differs from keyboard focus`, async ({
      page,
    }, testInfo) => {
      await page.emulateMedia({ colorScheme: theme, forcedColors });
      await setupAppearanceDiary(page);
      await nav(page, 'Settings').click();
      if (language === 'pt') {
        await page.getByLabel('Language', { exact: true }).selectOption('pt');
        await expect(page.getByLabel('Idioma', { exact: true })).toHaveValue('pt');
      }
      const group = page.locator('.appearance-preference');
      const languageField = page.locator('#language');
      const before = await readDataset(page);
      const viewports = [
        { width: 1280, enlarged: false },
        { width: 320, enlarged: false },
      ];
      if (language === 'pt') viewports.push({ width: 320, enlarged: true });
      for (const { width, enlarged } of viewports) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate((enlarged) => {
          document.documentElement.style.fontSize = enlarged ? '200%' : '';
        }, enlarged);
        await group.scrollIntoViewIfNeeded();
        await page.emulateMedia({ forcedColors: 'none' });
        const geometry = await positions(group);
        await page.emulateMedia({ forcedColors });
        expect(await positions(group)).toEqual(geometry);
        for (const [index, value] of values.entries()) {
          const radio = group.getByRole('radio', { name: labels[language][index], exact: true });
          await radio.locator('..').click();
          await expect(radio).toBeChecked();
          await expect(radio).toBeFocused();
          await languageField.focus();
          await expect(languageField).toBeFocused();
          await expect(group.locator('input:checked')).toHaveCount(1);
          const option = radio.locator('+ span');
          await (width === 1280 ? group.locator('..') : group).screenshot({
            path: testInfo.outputPath(
              `${forcedColors}-${theme}-${language}-${width}-${enlarged ? 'large-' : ''}${value}-outside-focus.png`,
            ),
          });
          // The persistent checked-state border remains after focus leaves the group.
          await expect(option).toHaveCSS('border-top-style', 'solid');
          await expect(option).toHaveCSS('border-top-width', '2px');
          await expect(option).toHaveCSS('outline-width', '0px');
          await expect(option).toHaveCSS('opacity', '1');
          await expect(option).toHaveCSS('background-clip', 'border-box');
          // The checked border touches the selected surface inside and the track outside.
          // Resolve alpha over the painted background, not against transparent canvas black.
          const colors = await renderedColors(group);
          for (const color of Object.values(colors)) expect(color[3]).toBe(255);
          const ratios = {
            againstSelected: contrast(colors.indicator, colors.selected),
            againstTrack: contrast(colors.indicator, colors.track),
          };
          await testInfo.attach(`${width}-${enlarged}-${value}-selection-contrast`, {
            body: JSON.stringify({ colors, ratios }),
            contentType: 'application/json',
          });
          expect(ratios.againstSelected).toBeGreaterThanOrEqual(3);
          expect(ratios.againstTrack).toBeGreaterThanOrEqual(3);
          for (const unselected of await group.locator('input:not(:checked) + span').all())
            await expect(unselected).toHaveCSS('border-top-width', '0px');
          await expect(page.locator('html')).toHaveCSS('forced-color-adjust', 'auto');
          await expect(group).toHaveAccessibleName(language === 'en' ? 'Appearance' : 'Aparência');
          await expect(radio).toHaveAccessibleName(labels[language][index]);
          await expect(option.locator('.appearance-icon')).toHaveAttribute('aria-hidden', 'true');
          expect(await positions(group)).toEqual(geometry);
          await expect
            .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
            .toBe(true);
        }
        // Focus an unchecked radio: focus and the existing selection must both remain visible.
        const system = group.getByRole('radio', { name: labels[language][0], exact: true });
        const selected = group.getByRole('radio', {
          name: labels[language][theme === 'light' ? 1 : 2],
          exact: true,
        });
        await selected.locator('..').click();
        await expect(selected).toBeChecked();
        await expect(page.locator('html')).toHaveAttribute('data-appearance', theme);
        await languageField.focus();
        await languageField.press('Tab');
        await expect(selected).toBeFocused();
        const focusStyle = forcedColors === 'active' ? 'dashed' : 'solid';
        await expect(selected.locator('+ span')).toHaveCSS('outline-style', focusStyle);
        await system.focus();
        await expect(selected).toBeChecked();
        await expect(selected.locator('+ span')).toHaveCSS('border-top-width', '2px');
        await expect(selected.locator('+ span')).toHaveCSS('outline-width', '0px');
        await expect(system.locator('+ span')).toHaveCSS('border-top-width', '0px');
        await expect(system.locator('+ span')).toHaveCSS('outline-style', focusStyle);
        await expect(system.locator('+ span')).toHaveCSS('outline-width', '3px');
        expect(await positions(group)).toEqual(geometry);
        await group.locator('..').screenshot({
          path: testInfo.outputPath(
            `${forcedColors}-${theme}-${language}-${width}-${enlarged ? 'large-' : ''}separate-focus.png`,
          ),
        });
        await system.press('Space');
        await expect(system).toBeChecked();
        await system.press('ArrowRight');
        const light = group.getByRole('radio', { name: labels[language][1], exact: true });
        await expect(light).toBeChecked();
        await expect(light).toBeFocused();
        expect(await positions(group)).toEqual(geometry);
      }
      expect(await readDataset(page)).toEqual(before);
    });
  }
}
