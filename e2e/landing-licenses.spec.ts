import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function textContrast(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((node) => {
      const rgb = (color: string) => color.match(/[\d.]+/g)!.map(Number);

      let ancestor: Element | null = node;
      let background = 'rgba(0, 0, 0, 0)';
      while (ancestor) {
        background = getComputedStyle(ancestor).backgroundColor;
        if (rgb(background)[3] !== 0) break;
        ancestor = ancestor.parentElement;
      }

      const luminance = (color: string) =>
        rgb(color)
          .slice(0, 3)
          .map((value) => {
            value /= 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          })
          .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);

      const a = luminance(getComputedStyle(node).color);
      const b = luminance(background);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
}

test('licensing page stays isolated when storage is denied and an inline text request fails', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const calls: string[] = [];
    (window as unknown as { licenseCalls: string[] }).licenseCalls = calls;
    Object.defineProperty(window, 'localStorage', {
      get: () => {
        throw new DOMException('Denied', 'SecurityError');
      },
    });
    indexedDB.open = () => {
      calls.push('database');
      throw new Error('No diary');
    };
    window.BroadcastChannel = class {
      constructor() {
        calls.push('channel');
      }
    } as unknown as typeof BroadcastChannel;
    if (navigator.serviceWorker)
      navigator.serviceWorker.register = async () => {
        calls.push('worker');
        throw new Error('No worker');
      };
  });
  await page.route('**/app/LICENSE', (route) => route.abort());
  await page.goto('licenses.html');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Licenses');
  await expect(page.locator('.legal-status').first()).toContainText('could not be loaded');
  await page.getByRole('button', { name: 'Português', exact: true }).click();
  await expect(page.locator('.legal-status').first()).toContainText('Não foi possível carregar');
  await expect(page.locator('a[href="app/LICENSE"]')).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { licenseCalls: string[] }).licenseCalls),
  ).toEqual([]);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('original licensing files remain accessible without JavaScript', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(new URL('licenses.html', baseURL).href);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Licenses');
    const [response] = await Promise.all([
      page.waitForNavigation(),
      page.locator('a[href="app/LICENSE"]').click(),
    ]);
    expect(await response!.text()).toBe(await readFile('LICENSE', 'utf8'));
    await page.goBack();
    const [notices] = await Promise.all([
      page.waitForNavigation(),
      page.locator('a[href="app/third-party-notices.txt"]').click(),
    ]);
    expect(notices!.status()).toBe(200);
    await expect(page.locator('body')).toContainText(
      'Copyright (c) Meta Platforms, Inc. and affiliates.',
    );
    await expect(page.locator('body')).toContainText('Lucide Contributors 2022.');
    // Verify original bytes independently of Chromium's charset guess for a raw text navigation.
    const original = await context.request.get(notices!.url());
    expect(await original.body()).toEqual(await readFile('public/third-party-notices.txt'));
  } finally {
    await context.close();
  }
});

for (const language of ['en', 'pt-BR']) {
  for (const width of [320, 390, 1440]) {
    for (const scale of [1, 2]) {
      test(`licensing page ${language} ${width}px ${scale * 100}% text`, async ({
        page,
        baseURL,
        context,
      }) => {
        const license = await readFile('LICENSE', 'utf8');
        const notices = await readFile('public/third-party-notices.txt', 'utf8');
        await page.goto('./');
        await page
          .getByRole('button', { name: language === 'en' ? 'English' : 'Português', exact: true })
          .click();
        await page.locator('footer a').focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(new URL('licenses.html', baseURL).href);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(
          language === 'en' ? 'Licenses' : 'Licenças',
        );
        await expect(page.locator('#project-license')).toHaveText(license);
        await expect(page.locator('#third-party-license')).toHaveText(notices);
        expect(await page.locator('#project-license').textContent()).toBe(license);
        expect(await page.locator('#third-party-license').textContent()).toBe(notices);
        const other = page.getByRole('button', {
          name: language === 'en' ? 'Português' : 'English',
          exact: true,
        });
        await other.focus();
        await page.keyboard.press('Space');
        await expect(other).toBeFocused();
        await expect(page.locator('html')).toHaveAttribute(
          'lang',
          language === 'en' ? 'pt-BR' : 'en',
        );
        expect(await page.locator('#project-license').textContent()).toBe(license);
        await page
          .getByRole('button', { name: language === 'en' ? 'English' : 'Português', exact: true })
          .click();
        for (const [name, text] of [
          ['LICENSE', license],
          ['third-party-notices.txt', notices],
        ]) {
          const link = page.locator(`a[href="app/${name}"]`);
          await expect(link).toHaveCount(1);
          expect(await link.evaluate((node) => (node as HTMLAnchorElement).href)).toBe(
            new URL(`app/${name}`, baseURL).href,
          );
          const response = await context.request.get(new URL(`app/${name}`, baseURL).href);
          expect(response.status()).toBe(200);
          expect(await response.text()).toBe(text);
        }
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.evaluate((scale) => {
          document.documentElement.style.fontSize = `${scale * 100}%`;
        }, scale);
        for (const summary of await page.locator('details summary').all()) await summary.click();
        const outside = await page.evaluate(() =>
          [
            ...document.querySelectorAll<HTMLElement>(
              'main, header, h1, h2, button, a, details, pre',
            ),
          ]
            .filter((node) => {
              if (!node.getClientRects().length) return false;
              const rect = node.getBoundingClientRect();
              return (
                rect.left < -1 ||
                rect.right > innerWidth + 1 ||
                node.scrollWidth > node.clientWidth + 2
              );
            })
            .map((node) => node.tagName + '.' + node.className),
        );
        expect(outside).toEqual([]);
        expect(await textContrast(page, '#project-license')).toBeGreaterThanOrEqual(4.5);
        expect(await textContrast(page, '.legal-content .text-link')).toBeGreaterThanOrEqual(4.5);
        if (scale === 1 && [390, 1440].includes(width)) {
          for (const summary of await page.locator('details summary').all()) await summary.click();
          await page.evaluate(() => scrollTo(0, 0));
          await page.screenshot({
            path: `artifacts/landing-licenses/screenshots/${language}-${width}.png`,
            fullPage: true,
          });
        }
        const back = page.getByRole('link', {
          name: language === 'en' ? 'Back to the landing page' : 'Voltar à página inicial',
          exact: true,
        });
        await page.getByRole('button', { name: 'English', exact: true }).focus();
        await page.keyboard.press('Shift+Tab');
        await expect(back).toBeFocused();
        expect(await back.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe('none');
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(baseURL!);
        await expect(page.locator('html')).toHaveAttribute('lang', language);
      });
    }
  }
}

for (const language of ['en', 'pt-BR']) {
  test(`concise captions and one localized licensing entry ${language}`, async ({ page }) => {
    await page.goto('./');
    await page
      .getByRole('button', { name: language === 'en' ? 'English' : 'Português', exact: true })
      .click();
    await expect(page.locator('.hero-preview > .demo-note')).toHaveText(
      language === 'en'
        ? 'Interactive demo · Sample data'
        : 'Demonstração interativa · Dados de exemplo',
    );
    await expect(page.locator('.tour-stage > .demo-note')).toHaveText(
      language === 'en'
        ? 'Interactive demo · Sample data'
        : 'Demonstração interativa · Dados de exemplo',
    );
    await expect(page.locator('.demo-note')).toHaveCount(2);
    expect(await textContrast(page, '.demo-note')).toBeGreaterThanOrEqual(4.5);
    await expect(page.locator('footer a')).toHaveCount(1);
    await expect(page.locator('footer a')).toHaveText(language === 'en' ? 'Licenses' : 'Licenças');
    await expect(page.locator('footer a')).toHaveAttribute('href', 'licenses.html');
    await expect(page.locator('footer [data-i18n="rights"]')).toHaveCount(0);
  });
}
