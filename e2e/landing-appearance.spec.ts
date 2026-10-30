import { test, expect, type Locator, type Page } from '@playwright/test';
import { resolveSite } from '../config/site.mjs';
import { nav, readDataset } from './support/habit-fixtures';

const site = resolveSite();
const storageKey = `my-goat-journey:appearance:${site.appBase}`;
const languageKey = 'my-goat-journey.landing.language';
type Theme = 'light' | 'dark';

const themeButton = (page: Page, theme: Theme) =>
  page.locator(`.appearance button[data-appearance-choice="${theme}"]`);

async function expectAppearance(page: Page, theme: Theme, preference: string = theme) {
  await expect(page.locator('html')).toHaveAttribute('data-appearance', theme);
  await expect(page.locator('html')).toHaveAttribute('data-appearance-preference', preference);
  // Forced colors lets the user agent resolve its own scheme ("light dark").
  // The authored preference still follows the selected theme independently.
  await expect
    .poll(() => page.locator('html').evaluate((root) => root.style.colorScheme))
    .toBe(theme);
  if (!(await page.evaluate(() => matchMedia('(forced-colors: active)').matches))) {
    await expect(page.locator('html')).toHaveCSS('color-scheme', theme);
  }
  await expect(themeButton(page, theme)).toHaveAttribute('aria-pressed', 'true');
  await expect(themeButton(page, theme === 'light' ? 'dark' : 'light')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.locator('.appearance [aria-pressed="true"]')).toHaveCount(1);
}

async function chooseLanguage(page: Page, language: 'en' | 'pt-BR') {
  await page
    .getByRole('button', { name: language === 'en' ? 'English' : 'Português', exact: true })
    .click();
  await expect(page.locator('html')).toHaveAttribute('lang', language);
}

async function paintedContrast(
  locator: Locator,
  property: 'color' | 'stroke' | 'border-top-color',
) {
  return locator.evaluate((node, property) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    const ancestors: Element[] = [];
    for (let current: Element | null = node; current; current = current.parentElement) {
      ancestors.unshift(current);
    }
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 1, 1);
    for (const ancestor of ancestors) {
      context.fillStyle = getComputedStyle(ancestor).backgroundColor;
      context.fillRect(0, 0, 1, 1);
    }
    const background = Array.from(context.getImageData(0, 0, 1, 1).data);
    context.fillStyle = getComputedStyle(node).getPropertyValue(property);
    context.fillRect(0, 0, 1, 1);
    const foreground = Array.from(context.getImageData(0, 0, 1, 1).data);
    const luminance = (color: number[]) => {
      const channels = color.slice(0, 3).map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const a = luminance(background);
    const b = luminance(foreground);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }, property);
}

async function expectPaintedLabel(button: Locator) {
  await expect
    .poll(() =>
      button.locator('.theme-label').evaluate((node) => {
        const style = getComputedStyle(node);
        const box = node.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility === 'visible' &&
          Number(style.opacity) > 0 &&
          box.width > 0 &&
          box.height > 0
        );
      }),
    )
    .toBe(true);
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`landing resolves fresh System ${colorScheme} before demonstrations load`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.addInitScript(() => {
      const paints: {
        name: string;
        appearance: string | undefined;
        preference: string | undefined;
        colorScheme: string;
        background: string;
      }[] = [];
      (window as unknown as { landingPaints: typeof paints }).landingPaints = paints;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const root = document.documentElement;
          const style = getComputedStyle(root);
          paints.push({
            name: entry.name,
            appearance: root.dataset.appearance,
            preference: root.dataset.appearancePreference,
            colorScheme: style.colorScheme,
            background: style.backgroundColor,
          });
        }
      }).observe({ type: 'paint', buffered: true });
    });
    let release = () => {};
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    let continued: Promise<void> | undefined;
    await page.route('**/assets/landing.js', (route) => {
      continued = (async () => {
        const response = await route.fetch();
        held = true;
        await waiting;
        await route.fulfill({ response });
      })();
      return continued;
    });
    try {
      await page.goto('./', { waitUntil: 'commit' });
      await expect.poll(() => held).toBe(true);
      await expect(page.locator('html')).toHaveAttribute('data-appearance', colorScheme);
      await expect(page.locator('html')).toHaveAttribute('data-appearance-preference', 'system');
      await expect(page.locator('html')).toHaveCSS('color-scheme', colorScheme);
      await expect(page.locator('#hero-demo input')).toHaveCount(0);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const paints = (window as unknown as { landingPaints: { name: string }[] })
              .landingPaints;
            return paints.find((paint) => paint.name === 'first-paint');
          }),
        )
        .toEqual({
          name: 'first-paint',
          appearance: colorScheme,
          preference: 'system',
          colorScheme,
          background: colorScheme === 'dark' ? 'rgb(9, 11, 14)' : 'rgb(248, 246, 239)',
        });
    } finally {
      // A screenshot/load wait here would deadlock on the intentionally held module.
      release();
      await continued;
    }
    // Keep routing installed until imported modules finish: removing interception
    // during graph loading can strand requests already paused by Chromium.
    await page.waitForLoadState('load');
    await page.unrouteAll({ behavior: 'wait' });
    await expect(
      page.getByRole('button', {
        name: `${colorScheme === 'light' ? 'Light' : 'Dark'} theme`,
        exact: true,
      }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#hero-demo input')).toHaveCount(4);
  });
}

test('landing follows live OS appearance until an explicit native button choice', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await expectAppearance(page, 'light', 'system');
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBeNull();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectAppearance(page, 'dark', 'system');
  await page.emulateMedia({ colorScheme: 'light' });
  await expectAppearance(page, 'light', 'system');
  await themeButton(page, 'dark').click();
  await expectAppearance(page, 'dark');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.emulateMedia({ colorScheme: 'light' });
  await expectAppearance(page, 'dark');
});

for (const theme of ['light', 'dark'] as const) {
  test(`explicit already-System ${theme} stores only the shared appearance key and survives reload`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('./');
    await expectAppearance(page, theme, 'system');
    await themeButton(page, theme).click();
    await expectAppearance(page, theme);
    expect(await page.evaluate(() => Object.entries(localStorage))).toEqual([[storageKey, theme]]);
    await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
    await expectAppearance(page, theme);
    await page.reload();
    await expectAppearance(page, theme);
    expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(theme);
  });
}

for (const failure of ['invalid', 'blocked-read', 'blocked-write'] as const) {
  test(`landing ${failure} storage keeps System fallback and in-session theme switching`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(
      ({ failure, storageKey, landingPath }) => {
        if (location.pathname !== landingPath) return;
        if (failure === 'invalid') localStorage.setItem(storageKey, 'Graphite');
        if (failure === 'blocked-read') {
          Object.defineProperty(window, 'localStorage', {
            get() {
              throw new DOMException('Storage denied', 'SecurityError');
            },
          });
        }
        if (failure === 'blocked-write') {
          Storage.prototype.setItem = () => {
            throw new DOMException('Storage full', 'QuotaExceededError');
          };
        }
      },
      { failure, storageKey, landingPath: site.prefix },
    );
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('./');
    await expectAppearance(page, 'dark', 'system');
    await page.emulateMedia({ colorScheme: 'light' });
    await expectAppearance(page, 'light', 'system');
    for (const theme of ['light', 'dark', 'light'] as const) {
      await themeButton(page, theme).click();
      await expectAppearance(page, theme);
    }
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectAppearance(page, 'light');
    await chooseLanguage(page, 'pt-BR');
    await expect(themeButton(page, 'light')).toHaveAccessibleName('Tema claro');
    await page.reload();
    await expectAppearance(page, 'dark', 'system');
    expect(errors).toEqual([]);
  });
}

test('real same-origin peer storage synchronizes relevant choices, removal and System only', async ({
  page,
  context,
  baseURL,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => {
    const events: { key: string | null; value: string | null; trusted: boolean }[] = [];
    (window as unknown as { appearanceEvents: typeof events }).appearanceEvents = events;
    addEventListener('storage', (event) => {
      events.push({ key: event.key, value: event.newValue, trusted: event.isTrusted });
    });
  });
  await page.goto('./');
  const peer = await context.newPage();
  try {
    await peer.goto(baseURL!);
    const writeFromPeer = async (key: string, value: string | null) => {
      const count = await page.evaluate(
        () => (window as unknown as { appearanceEvents: unknown[] }).appearanceEvents.length,
      );
      await peer.evaluate(
        ({ key, value }) => {
          if (value === null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        },
        { key, value },
      );
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as unknown as { appearanceEvents: unknown[] }).appearanceEvents.length,
          ),
        )
        .toBe(count + 1);
      expect(
        await page.evaluate(() =>
          (
            window as unknown as {
              appearanceEvents: { key: string | null; value: string | null; trusted: boolean }[];
            }
          ).appearanceEvents.at(-1),
        ),
      ).toEqual({ key, value, trusted: true });
    };
    await writeFromPeer(storageKey, 'dark');
    await expectAppearance(page, 'dark');
    await writeFromPeer(`${storageKey}other-app/`, 'light');
    await expectAppearance(page, 'dark');
    await writeFromPeer(languageKey, 'pt-BR');
    await expectAppearance(page, 'dark');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await writeFromPeer(storageKey, null);
    await expectAppearance(page, 'light', 'system');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectAppearance(page, 'dark', 'system');
    await writeFromPeer(storageKey, 'light');
    await expectAppearance(page, 'light');
    await writeFromPeer(storageKey, 'system');
    await expectAppearance(page, 'dark', 'system');
    await page.emulateMedia({ colorScheme: 'light' });
    await expectAppearance(page, 'light', 'system');
    await writeFromPeer(storageKey, 'dark');
    await expectAppearance(page, 'dark');
    await writeFromPeer(storageKey, 'invalid-theme');
    await expectAppearance(page, 'light', 'system');
  } finally {
    await peer.close();
  }
});

test('app and landing share appearance in both directions without mutating a UI-created diary', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(60_000);
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00'));
  const appURL = new URL('app/', baseURL).href;
  await page.goto(appURL);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mind', exact: true })).toBeVisible();
  await page.getByLabel('What do you want to do?').fill('Fictional landing appearance continuity');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  for (const name of ['Body', 'Nutrition', 'Hygiene']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Start my journey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await nav(page, 'Settings').click();
  const before = await readDataset(page);
  const dark = page.getByRole('radio', { name: 'Dark', exact: true });
  await dark.locator('..').click();
  await expect(dark).toBeChecked();
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe('dark');
  await page.goto(baseURL!);
  await expectAppearance(page, 'dark');
  await themeButton(page, 'light').click();
  await expectAppearance(page, 'light');
  await page.locator('header a[href="app/"]').click();
  await expect(page).toHaveURL(appURL);
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await nav(page, 'Settings').click();
  await expect(page.getByRole('radio', { name: 'Light', exact: true })).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
  expect(await readDataset(page)).toEqual(before);
  await page.getByRole('radio', { name: 'System', exact: true }).locator('..').click();
  await expect(page.getByRole('radio', { name: 'System', exact: true })).toBeChecked();
  await page.goto(baseURL!);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectAppearance(page, 'dark', 'system');
  await page.locator('header a[href="app/"]').click();
  await nav(page, 'Settings').click();
  await expect(page.getByRole('radio', { name: 'System', exact: true })).toBeChecked();
  expect(await readDataset(page)).toEqual(before);
});

for (const language of ['en', 'pt-BR'] as const) {
  test(`landing ${language} sun/moon buttons have localized hover labels and native Tab focus`, async ({
    page,
  }, testInfo) => {
    await page.goto('./');
    const originalLight = await themeButton(page, 'light').elementHandle();
    await chooseLanguage(page, language);
    expect(
      await originalLight!.evaluate(
        (node) => node === document.querySelector('[data-appearance-choice="light"]'),
      ),
    ).toBe(true);
    const labels =
      language === 'en' ? ['Light theme', 'Dark theme'] : ['Tema claro', 'Tema escuro'];
    await expect(page.locator('.appearance')).toHaveAccessibleName(
      language === 'en' ? 'Appearance' : 'Aparência',
    );
    await expect(page.locator('.appearance button')).toHaveCount(2);
    for (const [index, theme] of (['light', 'dark'] as const).entries()) {
      const button = themeButton(page, theme);
      await expect(page.getByRole('button', { name: labels[index], exact: true })).toHaveCount(1);
      await expect(button).toHaveAttribute('type', 'button');
      await expect(button).not.toHaveAttribute('tabindex', '-1');
      await expect(button.locator('svg')).toHaveAttribute('aria-hidden', 'true');
      await expect(button.locator('svg')).toHaveAttribute('focusable', 'false');
      await expect(button.locator('.theme-label')).toHaveText(labels[index]);
      await expect(button.locator('.theme-label')).toHaveAttribute('aria-hidden', 'true');
      await button.hover();
      await expectPaintedLabel(button);
      const target = (await button.boundingBox())!;
      const label = (await button.locator('.theme-label').boundingBox())!;
      // Cross the visual gap, then hover the label itself without focusing it.
      await page.mouse.move(target.x + target.width / 2, label.y - 2, { steps: 8 });
      await expectPaintedLabel(button);
      await page.mouse.move(label.x + label.width / 2, label.y + label.height / 2, { steps: 8 });
      await expectPaintedLabel(button);
    }
    await expect(themeButton(page, 'light').locator('svg circle')).toHaveCount(1);
    await expect(themeButton(page, 'dark').locator('svg circle')).toHaveCount(0);
    await expect(themeButton(page, 'dark').locator('svg path')).toHaveCount(1);
    await page.mouse.move(0, 0);
    // Start before the header, then reach the control through native sequential navigation.
    await page.locator('.skip-link').focus();
    for (let step = 0; step < 20; step++) {
      await page.keyboard.press('Tab');
      if (await themeButton(page, 'light').evaluate((node) => node === document.activeElement))
        break;
    }
    const light = themeButton(page, 'light');
    await expect(light).toBeFocused();
    await expectPaintedLabel(light);
    expect(await light.evaluate((node) => node.matches(':focus-visible'))).toBe(true);
    await expect(light).not.toHaveCSS('outline-style', 'none');
    await page.keyboard.press('Space');
    await expectAppearance(page, 'light');
    await page.keyboard.press('Tab');
    const dark = themeButton(page, 'dark');
    await expect(dark).toBeFocused();
    await expectPaintedLabel(dark);
    await page.keyboard.press('Enter');
    await expectAppearance(page, 'dark');
    await expect(dark).toBeFocused();
    await page.locator('.masthead').screenshot({
      path: testInfo.outputPath(`${language}-native-keyboard-dark.png`),
    });
    await page.keyboard.press('Shift+Tab');
    await expect(light).toBeFocused();
    await expect(dark).toHaveAttribute('aria-pressed', 'true');
  });
}

for (const language of ['en', 'pt-BR'] as const) {
  test(`touch theme taps keep labels hidden but native keyboard labels available ${language}`, async ({
    browser,
    baseURL,
  }, testInfo) => {
    const context = await browser.newContext({
      hasTouch: true,
      isMobile: true,
      viewport: { width: 390, height: 844 },
    });
    try {
      const page = await context.newPage();
      await page.goto(baseURL!);
      await page.locator(`[data-language="${language}"]`).tap();
      expect(await page.evaluate(() => matchMedia('(hover: hover)').matches)).toBe(false);
      for (const theme of ['dark', 'light'] as const) {
        const button = themeButton(page, theme);
        await button.tap();
        await expectAppearance(page, theme);
        await expect(button.locator('.theme-label')).toHaveCSS('visibility', 'hidden');
        // Touch must not be "fixed" by blurring the native button.
        await expect(button).toBeFocused();
      }
      await page.locator('.skip-link').focus();
      for (let step = 0; step < 20; step++) {
        await page.keyboard.press('Tab');
        if (await themeButton(page, 'light').evaluate((node) => node === document.activeElement))
          break;
      }
      await expect(themeButton(page, 'light')).toBeFocused();
      await expectPaintedLabel(themeButton(page, 'light'));
      await expect(themeButton(page, 'light')).toHaveAccessibleName(
        language === 'en' ? 'Light theme' : 'Tema claro',
      );
      await expect(themeButton(page, 'light')).toHaveCSS('outline-style', 'solid');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      await expectAppearance(page, 'dark');
      await expectPaintedLabel(themeButton(page, 'dark'));
      await page.screenshot({ path: testInfo.outputPath(`${language}-touch-keyboard.png`) });
    } finally {
      await context.close();
    }
  });
}

for (const theme of ['light', 'dark'] as const) {
  for (const language of ['en', 'pt-BR'] as const) {
    test(`landing appearance layout ${theme} ${language} at mobile/desktop and 100/200% text`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(90_000);
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.goto('./');
      await chooseLanguage(page, language);
      await themeButton(page, theme).click();
      for (const width of [320, 375, 390, 430, 1440]) {
        for (const scale of [1, 2]) {
          await page.setViewportSize({ width, height: 1050 });
          await page.evaluate((scale) => {
            document.documentElement.style.fontSize = `${scale * 100}%`;
          }, scale);
          await expectAppearance(page, theme);
          await expect
            .poll(() =>
              page.evaluate(() => {
                const controls = [
                  ...document.querySelectorAll<HTMLElement>('.masthead button, .masthead a'),
                ];
                return {
                  overflow: document.documentElement.scrollWidth > innerWidth,
                  boxes: controls.map((node) => {
                    const box = node.getBoundingClientRect();
                    return {
                      adequate: box.width >= 44 && box.height >= 44,
                      contained: box.left >= 0 && box.right <= innerWidth,
                    };
                  }),
                };
              }),
            )
            .toEqual({
              overflow: false,
              boxes: Array.from({ length: 10 }, () => ({ adequate: true, contained: true })),
            });
          const rem = await page.evaluate(() =>
            parseFloat(getComputedStyle(document.documentElement).fontSize),
          );
          expect(rem).toBe(16 * scale);
          const clipping = await page.locator('.masthead').evaluate((header) => {
            const walker = document.createTreeWalker(header, NodeFilter.SHOW_TEXT);
            const outside: string[] = [];
            while (walker.nextNode()) {
              const text = walker.currentNode;
              const parent = text.parentElement!;
              if (
                !text.textContent?.trim() ||
                parent.closest('.theme-label') ||
                !parent.getClientRects().length ||
                getComputedStyle(parent).display === 'none'
              )
                continue;
              const target = parent.closest('a, button')!.getBoundingClientRect();
              const range = document.createRange();
              range.selectNodeContents(text);
              for (const r of range.getClientRects()) {
                if (
                  r.left < target.left - 1 ||
                  r.right > target.right + 1 ||
                  r.top < target.top - 1 ||
                  r.bottom > target.bottom + 1
                )
                  outside.push(text.textContent!);
              }
            }
            return outside;
          });
          expect(clipping).toEqual([]);
          const collisions = await page.locator('.masthead').evaluate((header) => {
            const controls = [...header.querySelectorAll<HTMLElement>('a, button')];
            return controls.flatMap((node, index) => {
              const a = node.getBoundingClientRect();
              return controls
                .slice(index + 1)
                .filter((other) => {
                  const b = other.getBoundingClientRect();
                  return (
                    Math.min(a.right, b.right) > Math.max(a.left, b.left) &&
                    Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top)
                  );
                })
                .map((other) => [node.textContent, other.textContent]);
            });
          });
          expect(collisions).toEqual([]);
          if (width <= 760) {
            await expect(themeButton(page, theme).locator('svg')).toHaveCSS('width', '16px');
            await expect(page.locator('.github-link svg')).toHaveCSS('width', '18px');
            for (const group of ['.language', '.appearance']) {
              await expect(page.locator(group)).toHaveCSS('padding', '1px');
            }
            await expect(page.locator('.hero')).toHaveCSS('padding-top', '24px');
            await expect(page.locator('.masthead')).toHaveCSS('row-gap', '4px');
            await expect(page.locator('.masthead nav')).toHaveCSS('row-gap', '0px');
            await expect(page.locator('.language button').first()).toHaveCSS(
              'font-size',
              `${12 * scale}px`,
            );
            await page.locator('.wordmark').focus();
            await page.mouse.move(0, 0);
            const selected = themeButton(page, theme);
            const unselected = themeButton(page, theme === 'light' ? 'dark' : 'light');
            await expect(selected).not.toBeFocused();
            await expect(selected).toHaveCSS('border-top-width', '2px');
            expect(await paintedContrast(selected, 'border-top-color')).toBeGreaterThanOrEqual(3);
            expect(await selected.evaluate((n) => getComputedStyle(n).backgroundColor)).not.toBe(
              await unselected.evaluate((n) => getComputedStyle(n).backgroundColor),
            );
          }
          if (scale === 1 && width <= 760) {
            const brand = (await page.locator('.wordmark').boundingBox())!;
            const primary = (await page.locator('.header-actions > .button').boundingBox())!;
            expect(
              Math.abs(brand.y + brand.height / 2 - primary.y - primary.height / 2),
            ).toBeLessThanOrEqual(1);
            const entry = await page.locator('.header-actions > .button').boundingBox();
            const preferences = await page.locator('.header-preferences').boundingBox();
            expect(
              entry!.y + entry!.height,
              'App entry stays ahead of secondary preferences',
            ).toBeLessThanOrEqual(preferences!.y);
          }
          if (scale === 1 && width !== 320) {
            await page.mouse.move(0, 0);
            await page.evaluate(() => scrollTo(0, 0));
            await page.screenshot({
              path: testInfo.outputPath(`${theme}-${language}-${width}-hero.png`),
            });
          }
        }
      }
    });
  }
}

test('dark Graphite roles reach hero, tour, calendar, trail and closing without changing light', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('./');
  const lightSelectors = ['html', '#hero-demo', 'h1', 'h1 em', '.hero .lead', '.closing'];
  const colors = async () => {
    const result: Record<string, string[]> = {};
    for (const selector of lightSelectors) {
      result[selector] = await page.locator(selector).evaluate((node) => {
        const style = getComputedStyle(node);
        return [style.color, style.backgroundColor, style.borderTopColor];
      });
    }
    return result;
  };
  const before = await colors();
  await themeButton(page, 'dark').click();
  await expectAppearance(page, 'dark');
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(9, 11, 14)');
  await expect(page.locator('html')).toHaveCSS('color', 'rgb(240, 242, 244)');
  for (const preview of await page.locator('.app-preview').all()) {
    await expect(preview).toHaveCSS('background-color', 'rgb(27, 32, 38)');
    await expect(preview).toHaveCSS('border-top-color', 'rgb(54, 62, 71)');
    await expect(preview).toHaveCSS('color', 'rgb(240, 242, 244)');
  }
  await expect(page.locator('h1')).toHaveCSS('color', 'rgb(240, 242, 244)');
  await expect(page.locator('h1 em')).toHaveCSS('color', 'rgb(181, 221, 189)');
  for (const selector of ['.hero .lead', '#tour-description', '.demo-date', '.habit-detail']) {
    for (const element of await page.locator(selector).all()) {
      await expect(element).toHaveCSS('color', 'rgb(176, 183, 192)');
    }
  }
  await expect(page.locator('.masthead')).toHaveCSS('border-bottom-color', 'rgb(54, 62, 71)');
  await expect(page.locator('.github-link')).toHaveCSS('border-top-color', 'rgb(54, 62, 71)');
  const primaryAction = page.locator('.hero .actions .button');
  await expect(primaryAction).toHaveCSS('background-color', 'rgb(181, 221, 189)');
  await expect(primaryAction).toHaveCSS('color', 'rgb(16, 37, 24)');
  await expect(page.locator('[data-view="progress"]')).toHaveCSS(
    'background-color',
    'rgb(181, 221, 189)',
  );
  await expect(page.locator('[data-view="progress"]')).toHaveCSS('color', 'rgb(16, 37, 24)');
  const readable = [
    'h1',
    'h1 em',
    '.hero .lead',
    '#hero-demo .habit-name',
    '#hero-demo .habit-detail',
    '#tour-description',
    '.calendar-cell.complete',
    '.calendar-cell.missed',
    '#calendar-detail',
    '.calendar-legend',
    '.closing h2',
    '.closing .button',
    '.install-panel:not([hidden]) strong',
  ];
  for (const selector of readable) {
    const elements = await page.locator(selector).all();
    expect(elements.length, selector).toBeGreaterThan(0);
    for (const element of elements) {
      expect(await paintedContrast(element, 'color'), selector).toBeGreaterThanOrEqual(4.5);
    }
  }
  await page.locator('[data-view="journey"]').click();
  for (const selector of ['.journey-xp', '#level-detail', '.level-name', '.level-state']) {
    for (const element of await page.locator(selector).all()) {
      expect(await paintedContrast(element, 'color'), selector).toBeGreaterThanOrEqual(4.5);
    }
  }
  expect(await paintedContrast(page.locator('.trail-traveled'), 'stroke')).toBeGreaterThanOrEqual(
    3,
  );
  await page.locator('#journey-view').screenshot({ path: testInfo.outputPath('dark-trail.png') });
  await page.locator('[data-view="progress"]').click();
  await page
    .locator('#progress-view')
    .screenshot({ path: testInfo.outputPath('dark-calendar.png') });
  await page.locator('.closing').screenshot({ path: testInfo.outputPath('dark-closing.png') });
  await themeButton(page, 'light').click();
  await expectAppearance(page, 'light');
  expect(await colors()).toEqual(before);
});

for (const width of [390, 1440]) {
  for (const forcedColors of ['none', 'active'] as const) {
    test(`landing ${forcedColors} selection border survives focus outside in both themes at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1050 });
      await page.emulateMedia({ forcedColors });
      await page.goto('./');
      for (const theme of ['light', 'dark'] as const) {
        const selected = themeButton(page, theme);
        const unselected = themeButton(page, theme === 'light' ? 'dark' : 'light');
        await selected.click();
        await page.getByRole('button', { name: 'English', exact: true }).focus();
        await expectAppearance(page, theme);
        await expect(selected).not.toBeFocused();
        if (forcedColors === 'active') await unselected.hover();
        const borders = await page.locator('.appearance').evaluate((group) => {
          const style = (pressed: string) =>
            getComputedStyle(group.querySelector(`[aria-pressed="${pressed}"]`)!);
          const selected = style('true');
          const other = style('false');
          return {
            selected: [selected.borderTopStyle, selected.borderTopWidth, selected.borderTopColor],
            other: [other.borderTopStyle, other.borderTopWidth, other.borderTopColor],
            background: selected.backgroundColor,
          };
        });
        expect(borders.selected[0]).toBe('solid');
        expect(parseFloat(borders.selected[1])).toBeGreaterThanOrEqual(2);
        expect(borders.selected[2]).not.toBe('rgba(0, 0, 0, 0)');
        expect(borders.selected[2]).not.toBe(borders.background);
        expect(borders.selected).not.toEqual(borders.other);
        expect(await paintedContrast(selected, 'border-top-color')).toBeGreaterThanOrEqual(3);
        await expect(page.locator('html')).toHaveCSS('forced-color-adjust', 'auto');
        // Focus an unchecked button without changing the independently pressed choice.
        await page.keyboard.press('Tab');
        await unselected.focus();
        await expect(unselected).toBeFocused();
        await expect(unselected).not.toHaveCSS('outline-style', 'none');
        await expect(selected).toHaveAttribute('aria-pressed', 'true');
        await page.locator('.masthead').screenshot({
          path: testInfo.outputPath(`${forcedColors}-${theme}-separate-selection-focus.png`),
        });
      }
    });
  }
}

test('dark/light switching preserves demo choice, completions, Undo XP, tour and language state', async ({
  page,
}) => {
  await page.goto('./');
  await page.locator('[data-idea="walk"]').click();
  await page.locator('[data-day="8"]').click();
  await page.locator('[data-view="journey"]').click();
  await page.locator('[data-level="3"]').click();
  await page.locator('[data-view="today"]').click();
  const heroCheck = page.locator('#hero-demo [data-habit="walk"] input');
  const tourCheck = page.locator('#tour-today [data-habit="walk"] input');
  await heroCheck.check();
  await expect(tourCheck).toBeChecked();
  for (const theme of ['dark', 'light'] as const) {
    await themeButton(page, theme).click();
    await chooseLanguage(page, 'pt-BR');
    await expectAppearance(page, theme);
    await expect(page.locator('[data-idea="walk"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-view="today"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(heroCheck).toBeChecked();
    await expect(tourCheck).toBeChecked();
    await expect(page.locator('#hero-demo .xp-badge strong')).toHaveText('70');
    await expect(page.locator('#tour-today .xp-badge strong')).toHaveText('70');
    await expect(page.locator('#journey-strip progress')).toHaveAttribute('value', '70');
    await tourCheck.uncheck();
    await expect(heroCheck).not.toBeChecked();
    await expect(page.locator('#hero-demo .xp-badge strong')).toHaveText('60');
    await expect(page.locator('#journey-strip progress')).toHaveAttribute('value', '60');
    await heroCheck.check();
    await expect(page.locator('#hero-demo .xp-badge strong')).toHaveText('70');
    await page.locator('[data-view="progress"]').click();
    await expect(page.locator('[data-day="8"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#calendar-detail')).toHaveText(
      '8 de outubro de 2026 · Não concluído',
    );
    await page.locator('[data-view="journey"]').click();
    await expect(page.locator('[data-level="3"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#level-detail')).toHaveText('Nível 3 · À frente · 200 XP');
    await expect(page.locator('#journey-view progress')).toHaveAttribute('value', '70');
    await page.locator('[data-view="today"]').click();
  }
  await chooseLanguage(page, 'en');
  await expect(page.locator('#hero-demo [data-habit="walk"] .habit-name')).toHaveText('Walk');
  await expect(tourCheck).toBeChecked();
  await expect(page.locator('#hero-demo .xp-badge strong')).toHaveText('70');
});

test('landing loads exactly eight reviewed script URLs and only presentation storage', async ({
  page,
  baseURL,
}) => {
  await page.addInitScript((landingPath) => {
    // App navigation in this same context must still run the real diary and PWA code.
    if (location.pathname !== landingPath) return;
    const calls: string[] = [];
    (window as unknown as { landingPrivacyCalls: string[] }).landingPrivacyCalls = calls;
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      calls.push(`read:${key}`);
      return getItem.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      calls.push(`write:${key}:${value}`);
      return setItem.call(this, key, value);
    };
    indexedDB.open = () => {
      calls.push('database');
      throw new Error('Landing must not open a diary');
    };
    indexedDB.deleteDatabase = () => {
      calls.push('delete-database');
      throw new Error('Landing must not delete a diary');
    };
    indexedDB.databases = async () => {
      calls.push('list-databases');
      throw new Error('Landing must not inspect diary databases');
    };
    Storage.prototype.removeItem = () => {
      calls.push('remove-storage');
      throw new Error('Landing must not remove stored records');
    };
    Storage.prototype.clear = () => {
      calls.push('clear-storage');
      throw new Error('Landing must not clear stored records');
    };
    window.BroadcastChannel = class {
      constructor() {
        calls.push('channel');
        throw new Error('Landing must not join a channel');
      }
    } as unknown as typeof BroadcastChannel;
    window.Worker = class {
      constructor() {
        calls.push('worker');
        throw new Error('Landing must not start a worker');
      }
    } as unknown as typeof Worker;
    window.SharedWorker = class {
      constructor() {
        calls.push('shared-worker');
        throw new Error('Landing must not start a shared worker');
      }
    } as unknown as typeof SharedWorker;
    if (navigator.serviceWorker) {
      navigator.serviceWorker.register = async () => {
        calls.push('service-worker');
        throw new Error('Landing must not register a service worker');
      };
    }
  }, site.prefix);
  const scripts = new Set<string>();
  const externalRequests: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const recordRequest = (request: import('@playwright/test').Request) => {
    const url = new URL(request.url());
    if (url.origin !== new URL(baseURL!).origin) externalRequests.push(request.url());
    if (request.resourceType() === 'script') scripts.add(request.url());
  };
  page.on('request', recordRequest);
  await page.goto('./');
  await expect(page.locator('.idea')).toHaveCount(16);
  expect(
    await page.evaluate(() => {
      const appearance = document.querySelector<HTMLScriptElement>(
        'head script[src="assets/appearance.js"]',
      )!;
      const stylesheet = document.querySelector('head link[rel="stylesheet"]')!;
      return {
        type: appearance.type,
        async: appearance.async,
        defer: appearance.defer,
        beforeStylesheet: Boolean(
          appearance.compareDocumentPosition(stylesheet) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
        entryScripts: [...document.scripts].map((script) => script.getAttribute('src')),
      };
    }),
  ).toEqual({
    type: '',
    async: false,
    defer: false,
    beforeStylesheet: true,
    entryScripts: ['assets/appearance.js', 'assets/landing.js'],
  });
  await themeButton(page, 'dark').click();
  await themeButton(page, 'light').click();
  await chooseLanguage(page, 'pt-BR');
  await page.locator('[data-idea="walk"]').click();
  await page.locator('#hero-demo input').first().check();
  for (const view of ['today', 'journey', 'progress']) {
    await page.locator(`[data-view="${view}"]`).click();
  }
  for (const image of await page.locator('img').all()) await image.scrollIntoViewIfNeeded();
  await page.locator('#install-tab-android').click();
  await page.locator('#install-tab-computer').click();
  expect([...scripts].sort()).toEqual(
    [
      'appearance.js',
      'landing.js',
      'language.js',
      'translations.js',
      'demonstrations.js',
      'habit-catalog.js',
      'tour.js',
      'installation.js',
    ]
      .map((name) => new URL(`assets/${name}`, baseURL).href)
      .sort(),
  );
  expect(externalRequests).toEqual([]);
  expect(errors).toEqual([]);
  const calls = await page.evaluate(
    () => (window as unknown as { landingPrivacyCalls: string[] }).landingPrivacyCalls,
  );
  expect(calls.filter((call) => call.startsWith('read:')).sort()).toEqual(
    [`read:${storageKey}`, `read:${languageKey}`].sort(),
  );
  expect(calls.filter((call) => call.startsWith('write:'))).toEqual([
    `write:${storageKey}:dark`,
    `write:${storageKey}:light`,
    `write:${languageKey}:pt-BR`,
  ]);
  expect(calls.filter((call) => !/^(read|write):/.test(call))).toEqual([]);
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
  // Stop the landing-only request inventory before exercising the actual app link.
  page.off('request', recordRequest);
  await page.locator('header a[href="app/"]').click();
  await expect(page).toHaveURL(new URL('app/', baseURL).href);
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
});
