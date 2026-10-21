import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function chooseLanguage(page: Page, language: string) {
  await page
    .getByRole('button', { name: language === 'en' ? 'English' : 'Português', exact: true })
    .click();
}

for (const language of ['en', 'pt-BR']) {
  for (const width of [320, 390, 1440]) {
    test(`color header symbol ${language} ${width}px`, async ({ page, context, baseURL }) => {
      await page.setViewportSize({ width, height: 900 });
      const original = await readFile('public/branding/My_GOAT_Journey_app_icon.png');
      for (const entry of ['./', 'licenses.html']) {
        await page.goto(entry);
        await chooseLanguage(page, language);
        const image = page.locator('.wordmark img');
        await expect(image).toHaveAttribute('src', 'assets/My_GOAT_Journey_color_symbol.png');
        await expect(image).toHaveAttribute('alt', '');
        await expect
          .poll(() =>
            image.evaluate(
              (node) =>
                (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth,
            ),
          )
          .toBe(1254);
        const geometry = await page.locator('.wordmark').evaluate((node) => {
          const image = node.querySelector('img')!.getBoundingClientRect();
          const text = node.querySelector('span')!.getBoundingClientRect();
          return {
            width: image.width,
            height: image.height,
            gap: text.left - image.right,
            alignment: Math.abs(image.top + image.height / 2 - text.top - text.height / 2),
            overflow: document.documentElement.scrollWidth > innerWidth,
          };
        });
        expect(geometry.width).toBe(width > 760 ? 52 : 54);
        expect(geometry.height).toBe(geometry.width);
        expect(geometry.gap).toBe(9);
        expect(geometry.alignment).toBeLessThanOrEqual(1);
        expect(geometry.overflow).toBe(false);
        await expect(page.locator('.wordmark > span')).toHaveText(/My GOAT\s*Journey/);
        const asset = await context.request.get(
          new URL('assets/My_GOAT_Journey_color_symbol.png', baseURL).href,
        );
        expect(asset.status()).toBe(200);
        expect(await asset.body()).toEqual(original);
        if (entry === './' && width !== 320)
          await page
            .locator('.masthead')
            .screenshot({ path: `artifacts/landing-color-brand/${language}-${width}-header.png` });
      }
    });
  }
}

test('canonical pillar geometry is reused in every idea and both Today demonstrations', async ({
  page,
}) => {
  const source = await readFile('src/features/pillars/PillarIcon.tsx', 'utf8');
  const body = await readFile('src/features/pillars/icons/biceps-flexed.svg', 'utf8');
  const expected: Record<string, string[]> = {
    body: [...body.matchAll(/<path d="([^"]+)"/g)].map((match) => match[1]),
  };
  for (const kind of ['mind', 'nutrition', 'hygiene']) {
    const match = source.match(new RegExp(`${kind}\\s*:\\s*'([^']+)'`));
    if (!match) throw new Error(`Missing canonical ${kind} icon path in PillarIcon.tsx`);
    expected[kind] = [match[1]];
  }
  const mapping = [
    'mind',
    'body',
    'mind',
    'hygiene',
    'body',
    'body',
    'mind',
    'nutrition',
    'body',
    'mind',
    'mind',
    'mind',
  ];
  await page.goto('./');
  await expect(page.locator('.idea')).toHaveCount(12);
  for (let i = 0; i < mapping.length; i++) {
    expect(
      await page
        .locator('.idea')
        .nth(i)
        .locator('svg path')
        .evaluateAll((paths) => paths.map((path) => path.getAttribute('d'))),
    ).toEqual(expected[mapping[i]]);
  }
  await page.locator('[data-view="today"]').click();
  for (const demo of ['#hero-demo', '#tour-today']) {
    await expect(page.locator(`${demo} .group-heading svg`)).toHaveCount(4);
    for (const kind of ['mind', 'body', 'nutrition', 'hygiene']) {
      const icon = page.locator(`${demo} [data-pillar="${kind}"] .group-heading svg`);
      expect(
        await icon
          .locator('path')
          .evaluateAll((paths) => paths.map((path) => path.getAttribute('d'))),
      ).toEqual(expected[kind]);
      await expect(icon).toHaveAttribute('aria-hidden', 'true');
    }
  }
});

test('completed habits retain neutral background and normal text in both previews', async ({
  page,
}) => {
  await page.goto('./');
  await page.locator('[data-view="today"]').click();
  for (const demo of ['#hero-demo', '#tour-today']) {
    const row = page.locator(`${demo} [data-habit="0"]`);
    const check = row.getByRole('checkbox');
    await check.uncheck();

    const appearance = () =>
      row.evaluate((node) => {
        const title = getComputedStyle(node.querySelector('.habit-name')!);
        return {
          background: getComputedStyle(node).backgroundColor,
          color: title.color,
          opacity: title.opacity,
          decoration: title.textDecorationLine,
        };
      });

    const pending = await appearance();
    await check.check();
    expect(await appearance()).toEqual(pending);
    expect(pending.opacity).toBe('1');
    expect(pending.decoration).toBe('none');
    await expect(check).toBeChecked();
  }
});

test('compact editorial composition starts with Progress and preserves tour state', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('./');
  await expect(page.locator('[data-view="progress"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#progress-view')).toBeVisible();
  const geometry = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();

    return {
      page: rect('.page').width,
      hero: rect('#hero-demo').width,
      tour: rect('#progress-view').width,
      copyGap: rect('.tour-copy').top - rect('#tour-controls').bottom,
    };
  });
  expect(geometry.page).toBeLessThanOrEqual(1280);
  expect(geometry.hero).toBeGreaterThanOrEqual(420);
  expect(geometry.hero).toBeLessThanOrEqual(480);
  expect(geometry.tour).toBeGreaterThanOrEqual(420);
  expect(geometry.tour).toBeLessThanOrEqual(480);
  expect(geometry.copyGap).toBeLessThanOrEqual(32);
  await expect(page.locator('.product-limit')).toHaveCount(0);
  await expect(page.locator('.wordmark img')).toHaveAttribute(
    'src',
    'assets/My_GOAT_Journey_color_symbol.png',
  );
  for (const language of ['en', 'pt-BR']) {
    await chooseLanguage(page, language);
    await expect(page.locator('h1 em')).toHaveText(
      language === 'en' ? 'A journey of your own.' : 'Um caminho seu.',
    );
    expect(
      await page.locator('h1 em').evaluate((node) => ({
        color: getComputedStyle(node).color,
        style: getComputedStyle(node).fontStyle,
      })),
    ).toEqual({ color: 'rgb(37, 91, 67)', style: 'italic' });
  }
  await chooseLanguage(page, 'en');
  await page.getByRole('button', { name: 'October 8, 2026: Missed', exact: true }).click();
  await page.locator('[data-view="journey"]').click();
  await page.getByRole('button', { name: 'Level 3', exact: true }).click();
  await page.locator('[data-view="today"]').click();
  await page.locator('#tour-today input').first().check();
  await chooseLanguage(page, 'pt-BR');
  await page.locator('[data-view="progress"]').click();
  await expect(page.locator('#calendar-detail')).toHaveText('8 de outubro de 2026 · Não concluído');
  await page.locator('[data-view="journey"]').click();
  await expect(page.locator('#level-detail')).toHaveText('Nível 3 · À frente · 200 XP');
  await expect(page.locator('#journey-view progress')).toHaveAttribute('value', '70');
});

for (const mode of ['invalid', 'blocked'] as const) {
  test(`language ${mode} preference falls back to English without touching application storage`, async ({
    page,
  }) => {
    await page.addInitScript((mode) => {
      const calls: string[] = [];
      (window as unknown as { landingCalls: string[] }).landingCalls = calls;
      const getItem = Storage.prototype.getItem;
      const setItem = Storage.prototype.setItem;
      Storage.prototype.getItem = function (key) {
        calls.push(`read:${key}`);
        if (mode === 'blocked') throw new DOMException('Storage denied', 'SecurityError');
        return key === 'my-goat-journey.landing.language'
          ? 'invalid-language'
          : getItem.call(this, key);
      };
      Storage.prototype.setItem = function (key, value) {
        calls.push(`write:${key}`);
        if (mode === 'blocked') throw new DOMException('Storage denied', 'SecurityError');
        setItem.call(this, key, value);
      };
      indexedDB.open = () => {
        calls.push('database');
        throw new Error('Landing must not open a diary');
      };
      window.BroadcastChannel = class {
        constructor() {
          calls.push('channel');
          throw new Error('Landing must not coordinate with app');
        }
      } as unknown as typeof BroadcastChannel;
      if (navigator.serviceWorker)
        navigator.serviceWorker.register = async () => {
          calls.push('worker');
          throw new Error('Landing must not register a worker');
        };
    }, mode);
    await page.goto('./');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await chooseLanguage(page, 'pt-BR');
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    await page.locator('#hero-demo input').first().check();
    await page.locator('#install-tab-computer').click();
    await page.locator('#install-tab-android').click();
    expect(
      await page.evaluate(() => (window as unknown as { landingCalls: string[] }).landingCalls),
    ).toEqual(['read:my-goat-journey.landing.language', 'write:my-goat-journey.landing.language']);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
}

test('keyboard controls, feedback expiry, reduced motion, FAQ and real app navigation', async ({
  page,
  baseURL,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await page.goto('./');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe(
    'auto',
  );
  await page.locator('.idea').nth(1).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.idea').nth(1)).toHaveAttribute('aria-pressed', 'true');
  const check = page.locator('#hero-demo input').first();
  await check.focus();
  await page.keyboard.press('Space');
  await expect(check).toBeChecked();
  await expect(check).toBeFocused();
  await expect(page.locator('#hero-demo [role=status]')).toHaveText('+10 XP');
  await chooseLanguage(page, 'pt-BR');
  await page.clock.fastForward(1700);
  await expect(page.locator('#hero-demo [role=status]')).toBeEmpty();
  await page.keyboard.press('Tab');
  await page.locator('.faq summary').nth(1).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.faq details').nth(1)).toHaveAttribute('open');
  await expect(page.locator('.faq details').nth(1)).toContainText('históricos não são mesclados');
  const links = await page
    .locator('a[href="app/"]')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLAnchorElement).href));
  expect(links.length).toBeGreaterThanOrEqual(4);
  expect(links.every((url) => url === new URL('app/', baseURL).href)).toBe(true);
  await page.locator('a[href="#tour"]').first().click();
  await expect(page).toHaveURL(/#tour$/);
  await page.locator('a[href="app/"]').first().click();
  await expect(page).toHaveURL(new URL('app/', baseURL).href);
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
});

for (const language of ['en', 'pt-BR']) {
  for (const width of [320, 375, 390, 430, 768, 1440]) {
    for (const scale of [1, 2]) {
      test(`layout ${language} ${width}px ${scale * 100}% text`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        const requests: string[] = [];
        page.on('request', (request) => requests.push(request.url()));
        await page.goto('./');
        await chooseLanguage(page, language);
        await page.evaluate((scale) => {
          document.documentElement.style.fontSize = `${scale * 100}%`;
        }, scale);
        await page.locator('#more-ideas summary').click();
        for (const view of ['today', 'progress', 'journey']) {
          await page.locator(`[data-view="${view}"]`).click();
          const geometry = await page.evaluate(() => {
            const visible = [
              ...document.querySelectorAll<HTMLElement>(
                'main, header, footer, button, select, summary, .habit-name, .calendar-weekdays > span, h1, h2, .button',
              ),
            ].filter((node) => node.getClientRects().length);
            return {
              viewport: innerWidth,
              page: document.documentElement.scrollWidth,
              outside: visible
                .filter((node) => {
                  const r = node.getBoundingClientRect();
                  return (
                    r.left < -1 ||
                    r.right > innerWidth + 1 ||
                    node.scrollWidth > node.clientWidth + 2
                  );
                })
                .map(
                  (node) => `${node.tagName}.${node.className}:${node.textContent?.slice(0, 60)}`,
                ),
            };
          });
          expect(geometry.outside, JSON.stringify(geometry)).toEqual([]);
          expect(geometry.page).toBeLessThanOrEqual(geometry.viewport + 1);
          await expect(page.locator('.habit-name').first()).not.toBeEmpty();
          if (scale === 2 && width === 320) {
            await page.locator(`#${view}-view`).screenshot({
              path: `artifacts/landing-refinement/screenshots/${language}-${width}-large-${view}.png`,
            });
          }
        }
        for (const platform of ['iphone', 'android', 'computer']) {
          await page.locator(`#install-tab-${platform}`).click();
          await expect(page.getByRole('tabpanel')).toHaveCount(1);
          const overflow = await page.locator('#install').evaluate((section) =>
            [...section.querySelectorAll<HTMLElement>('*')]
              .filter((node) => node.getClientRects().length)
              .filter((node) => {
                const rect = node.getBoundingClientRect();
                return (
                  rect.left < -1 ||
                  rect.right > innerWidth + 1 ||
                  node.scrollWidth > node.clientWidth + 2
                );
              })
              .map((node) => `${node.tagName}.${node.className}`),
          );
          expect(overflow).toEqual([]);
          await expect(page.locator('header a[href="#install"]')).toBeVisible();
          if ([320, 390, 1440].includes(width)) {
            await page.locator('#install').screenshot({
              path: `artifacts/install/${language}-${width}-${scale}-${platform}.png`,
            });
          }
        }
        const missingCopy = await page
          .locator('[data-i18n], [data-rich-i18n], [data-label]')
          .evaluateAll((nodes) =>
            nodes
              .filter((node) =>
                node.hasAttribute('data-label')
                  ? !node.getAttribute('aria-label')
                  : !node.textContent?.trim() || node.textContent === 'undefined',
              )
              .map((node) => node.outerHTML),
          );
        expect(missingCopy).toEqual([]);
        expect(errors).toEqual([]);
        expect(requests.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(
          true,
        );
        if (scale === 1 && [390, 1440].includes(width)) {
          await mkdir(resolve('artifacts/landing-refinement/screenshots'), { recursive: true });
          await page.locator('#more-ideas summary').click();
          await page.locator('[data-view="progress"]').click();
          await page.evaluate(() => scrollTo(0, 0));
          await page.screenshot({
            path: `artifacts/landing-refinement/screenshots/${language}-${width}-full.png`,
            fullPage: true,
          });
          await page.screenshot({
            path: `artifacts/landing-refinement/screenshots/${language}-${width}-hero.png`,
          });
          await testInfo.attach('landing-capture', {
            path: `artifacts/landing-refinement/screenshots/${language}-${width}-full.png`,
            contentType: 'image/png',
          });
        }
      });
    }
  }
}

test('installation copy uses concise localized introduction and offline guidance', async ({
  page,
}) => {
  await page.goto('./');
  for (const language of ['en', 'pt-BR']) {
    await chooseLanguage(page, language);
    await expect(page.locator('.install-lead')).toHaveText(
      language === 'en'
        ? 'Add My GOAT Journey to your Home Screen and open it like an app. Keep tracking your habits offline after initial setup.'
        : 'Adicione o My GOAT Journey à tela inicial e abra pelo ícone, como um app. Continue acompanhando seus hábitos offline após a preparação inicial.',
    );
    await expect(page.locator('.install-offline p')).toHaveText(
      language === 'en'
        ? 'Open the installed app while connected and let offline preparation finish. Reopen it once online before using it offline.'
        : 'Abra o app instalado com conexão à internet e aguarde a preparação para uso offline terminar. Feche e abra novamente uma vez com conexão antes de usá-lo offline.',
    );
  }
});

test('installation steps emphasize localized action labels without interpreting HTML', async ({
  page,
}) => {
  await page.goto('./');
  for (const language of ['en', 'pt-BR']) {
    await chooseLanguage(page, language);
    const english = language === 'en';
    const labels = {
      iphone: english
        ? ['Share', 'Add to Home Screen', 'More', 'Share', 'Open as Web App', 'Add']
        : [
            'Compartilhar',
            'Adicionar à Tela de Início',
            'Mais',
            'Compartilhar',
            'Abrir como App da Web',
            'Adicionar',
          ],
      android: english
        ? ['Install and create shortcut', 'Install', 'Install app', 'Add to Home screen']
        : ['Instalar e criar atalho', 'Instalar', 'Instalar app', 'Adicionar à tela inicial'],
      computer: english
        ? ['Cast, save, and share', 'Install page as app…']
        : ['Transmitir, salvar e compartilhar', 'Instalar página como app…'],
    };
    for (const platform of ['iphone', 'android', 'computer'] as const) {
      await page.locator(`#install-tab-${platform}`).click();
      const panel = page.getByRole('tabpanel');
      await expect(panel.locator('li')).toHaveCount(3);
      await expect(panel.locator('strong')).toHaveText(labels[platform]);
      await expect(panel.locator('strong').first()).toHaveCSS('color', 'rgb(38, 60, 49)');
    }
    await expect(page.locator('#install-computer li').nth(0)).toHaveText(
      english
        ? 'Open the app in a browser that supports installation, such as Chrome.'
        : 'Abra o app em um navegador compatível com instalação, como o Chrome.',
    );
    await expect(page.locator('#install-computer li').nth(1)).toHaveText(
      english
        ? 'Use its install control or menu. In Chrome: Cast, save, and share → Install page as app…'
        : 'Use o controle ou menu de instalação. No Chrome: Transmitir, salvar e compartilhar → Instalar página como app…',
    );
    await expect(page.locator('#install-computer li').nth(2)).toHaveText(
      english
        ? 'Confirm installation. If unavailable, keep using the app in your browser or bookmark it.'
        : 'Confirme a instalação. Se a opção não aparecer, continue no navegador ou salve o app nos favoritos.',
    );
  }
  await page.evaluate(async () => {
    const url = new URL('assets/translations.js', location.href).href;
    const { copy } = await import(url);
    copy.en.installIphone2 = ['<img src=x onerror=alert(1)>', { strong: '<b>Share</b>' }];
  });
  await chooseLanguage(page, 'en');
  await page.locator('#install-tab-iphone').click();
  const step = page.locator('#install-iphone li').nth(1);
  await expect(step).toHaveText('<img src=x onerror=alert(1)><b>Share</b>');
  await expect(step.locator('strong')).toHaveText('<b>Share</b>');
  await expect(step.locator('img, b')).toHaveCount(0);
});

test('installation section sits between tour and privacy with localized app entry', async ({
  page,
  baseURL,
}) => {
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  for (const language of ['en', 'pt-BR']) {
    await chooseLanguage(page, language);
    const section = page.locator('#install');
    await expect(section.getByRole('heading', { level: 2 })).toHaveText(
      language === 'en'
        ? 'Your journey, on your Home Screen.'
        : 'Sua jornada, na sua tela inicial.',
    );
    expect(
      await section.evaluate((node) => ({
        before: node.previousElementSibling?.id,
        after: node.nextElementSibling?.id,
      })),
    ).toEqual({ before: 'tour', after: 'privacy' });
    const navigation = page.locator('header nav').getByRole('link', {
      name: language === 'en' ? 'How to install' : 'Como instalar',
      exact: true,
    });
    await navigation.click();
    await expect(page).toHaveURL(/#install$/);
    const entry = section.getByRole('link', {
      name: language === 'en' ? 'Open the app to install' : 'Abrir o app para instalar',
      exact: true,
    });
    await expect(entry).toHaveAttribute('href', 'app/');
    expect(await entry.evaluate((node) => (node as HTMLAnchorElement).href)).toBe(
      new URL('app/', baseURL).href,
    );
    await expect(section).toContainText(
      language === 'en' ? 'Installation is optional' : 'A instalação é opcional',
    );
    await expect(section.locator('.install-offline')).toContainText(
      language === 'en' ? 'once online' : 'uma vez com conexão',
    );
  }
  await page.locator('#install a[href="app/"]').click();
  await expect(page).toHaveURL(new URL('app/', baseURL).href);
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
});

test('installation tabs support keyboard selection and retain platform across languages', async ({
  page,
}) => {
  await page.goto('./');
  const tabs = page.locator('#install-platforms');
  await expect(tabs).toHaveAccessibleName('Installation platform');
  const iphone = tabs.getByRole('tab', { name: 'iPhone', exact: true });
  const android = tabs.getByRole('tab', { name: 'Android', exact: true });
  const computer = tabs.getByRole('tab', { name: 'Computer', exact: true });
  await expect(iphone).toHaveAttribute('aria-selected', 'true');
  await iphone.focus();
  expect(await iphone.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe('none');
  await page.keyboard.press('ArrowRight');
  await expect(android).toBeFocused();
  await expect(android).toHaveAttribute('aria-selected', 'true');
  await expect(iphone).toHaveAttribute('tabindex', '-1');
  await expect(page.getByRole('tabpanel')).toHaveCount(1);
  await expect(page.getByRole('tabpanel')).toHaveAccessibleName('Android');
  await expect(page.getByRole('tabpanel')).toContainText('Install and create shortcut');
  await page.keyboard.press('End');
  await expect(computer).toBeFocused();
  await expect(page.getByRole('tabpanel')).toContainText('Cast, save, and share');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('tabpanel')).toBeFocused();
  await chooseLanguage(page, 'pt-BR');
  await expect(page.getByRole('tablist')).toHaveAccessibleName('Plataforma de instalação');
  await expect(page.getByRole('tab', { name: 'Computador', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('tabpanel')).toHaveAccessibleName('Computador');
  await expect(page.getByRole('tabpanel')).toContainText('favoritos');
  await page.getByRole('tab', { name: 'Computador', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(iphone).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Computador', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(iphone).toBeFocused();
  await expect(page.getByRole('tabpanel')).toContainText('Abrir como App da Web');
  await android.click();
  await chooseLanguage(page, 'en');
  await expect(android).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toHaveAccessibleName('Android');
  for (const tab of await tabs.getByRole('tab').all()) {
    const panelId = await tab.getAttribute('aria-controls');
    await expect(page.locator(`#${panelId}`)).toHaveAttribute(
      'aria-labelledby',
      (await tab.getAttribute('id'))!,
    );
  }
});

for (const width of [390, 1440]) {
  test(`installation illustration pairs with instructions at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('./');
    const illustration = page.locator('.install-illustration');
    const guide = page.locator('.install-guide');
    const image = illustration.locator('img');
    await expect(image).toHaveAttribute('src', 'assets/My_GOAT_Journey_color_symbol.png');
    const art = (await illustration.boundingBox())!;
    const instructions = (await guide.boundingBox())!;
    if (width > 760) {
      expect(art.x + art.width).toBeLessThan(instructions.x);
      expect(Math.abs(art.y - instructions.y)).toBeLessThan(2);
    } else {
      expect(art.y + art.height).toBeLessThan(instructions.y);
    }
    expect((await image.boundingBox())!.width).toBeLessThanOrEqual(112);
    await expect(page.locator('#install-tab-iphone')).toHaveCSS(
      'background-color',
      'rgb(37, 91, 67)',
    );
  });
}

test('narrow header retains the real application entry', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('./');
  await expect(
    page.locator('header').getByRole('link', { name: 'Open the app', exact: true }),
  ).toBeVisible();
});

test('tour exposes localized calendar details and bounded level states without losing selection', async ({
  page,
}) => {
  await page.goto('./');
  const controls = page.locator('#tour-controls');
  await controls.getByRole('button', { name: 'Progress', exact: true }).click();
  await expect(page.locator('#progress-view')).toBeVisible();
  await expect(page.locator('#progress-view')).toContainText('86%');
  await page.getByRole('button', { name: 'October 8, 2026: Missed', exact: true }).click();
  await expect(page.locator('#calendar-detail')).toHaveText('October 8, 2026 · Missed');
  await chooseLanguage(page, 'pt-BR');
  await expect(page.locator('#calendar-detail')).toHaveText('8 de outubro de 2026 · Não concluído');
  await expect(controls.getByRole('button', { name: 'Progresso', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await controls.getByRole('button', { name: 'Sua jornada', exact: true }).click();
  await page.getByRole('button', { name: 'Nível 2', exact: true }).click();
  await expect(page.locator('#level-detail')).toHaveText('Nível 2 · À frente · 100 XP');
  await expect(page.locator('#journey-view progress')).toHaveAttribute('value', '60');
  await controls.getByRole('button', { name: 'Hoje', exact: true }).click();
  await page.locator('#tour-today input').first().check();
  await expect(page.locator('#hero-demo .xp-badge')).toHaveText('70 XP');
});

test('twelve illustrative choices update an isolated checklist with coherent XP and preserved language state', async ({
  page,
}) => {
  await page.goto('./');
  await expect(page.locator('#initial-ideas button')).toHaveCount(4);
  await expect(page.locator('#additional-ideas button')).toHaveCount(8);
  await expect(page.locator('#more-ideas')).not.toHaveAttribute('open');
  const hero = page.locator('#hero-demo');
  await expect(hero.getByRole('checkbox')).toHaveCount(4);
  await expect(hero.locator('.xp-badge')).toHaveText('60 XP');
  await hero.getByRole('checkbox').first().check();
  await expect(hero.locator('.xp-badge')).toHaveText('70 XP');
  await expect(hero.getByRole('status')).toHaveText('+10 XP');
  await expect(page.locator('#journey-strip')).toContainText('30 XP to the next level');
  await chooseLanguage(page, 'pt-BR');
  await expect(hero.getByRole('checkbox').first()).toBeChecked();
  await page.locator('#more-ideas summary').click();
  for (const locale of ['en', 'pt-BR']) {
    await chooseLanguage(page, locale);
    for (let i = 0; i < 12; i++) {
      const idea = page.locator('.idea').nth(i);
      const action = await idea.locator('strong').textContent();
      const frequency = await idea.locator('.frequency').textContent();
      await idea.click();
      await expect(idea).toHaveAttribute('aria-pressed', 'true');
      await expect(hero.locator('.habit-name').first()).toHaveText(action!);
      await expect(hero.locator('.habit-detail').first()).toContainText(frequency!);
    }
  }
  for (const check of await hero.getByRole('checkbox').all()) await check.check();
  await expect(hero.getByRole('status')).toHaveText(
    'Muito bem! Todos os hábitos de hoje concluídos.',
  );
  await expect(hero.locator('progress')).toHaveAttribute('value', '4');
  await expect(hero.locator('.xp-badge')).toHaveText('90 XP');
  await expect(page.locator('#journey-strip')).toContainText('10 XP para o próximo nível');
  await chooseLanguage(page, 'en');
  await expect(hero.getByRole('status')).toHaveText('Good job! All habits completed today.');
  await chooseLanguage(page, 'pt-BR');
  await hero.getByRole('checkbox').first().uncheck();
  await expect(hero.locator('.xp-badge')).toHaveText('80 XP');
  await page.reload();
  await expect(hero.locator('.xp-badge')).toHaveText('60 XP');
});

test('English first visit ignores browser language; explicit Portuguese selection survives reload', async ({
  page,
}) => {
  await page
    .context()
    .addInitScript(() => Object.defineProperty(navigator, 'language', { value: 'pt-BR' }));
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'One step today. A journey of your own.',
  );
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  const english = page.getByRole('button', { name: 'English', exact: true });
  await expect(english).toHaveAttribute('aria-pressed', 'true');
  const language = page.getByRole('button', { name: 'Português', exact: true });
  for (const button of [english, language]) {
    const box = await button.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await language.focus();
  expect(await language.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe('none');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Um passo hoje. Um caminho seu.',
  );
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await expect(language).toBeFocused();
  await expect(language).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'English', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await expect(page).toHaveTitle('My GOAT Journey — um caminho seu');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    /Construa hábitos/,
  );
  await english.focus();
  await page.keyboard.press('Space');
  await expect(english).toBeFocused();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle('My GOAT Journey — a journey of your own');
});
