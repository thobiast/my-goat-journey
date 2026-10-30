import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { landingExamples, defaultLandingDemoIds } from '../tests/fixtures/landing-catalog';
import { resolveSite } from '../config/site.mjs';

async function chooseLanguage(page: Page, language: string) {
  await page
    .getByRole('button', { name: language === 'en' ? 'English' : 'Português', exact: true })
    .click();
}

test('English fallback and paired translations keep the product identity without app code', async ({
  browser,
  baseURL,
  page,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const fallback = await context.newPage();
    await fallback.goto(baseURL!);
    await expect(fallback.locator('h1')).toHaveText('Small habits. A greater you.');
    await expect(fallback).toHaveTitle('My GOAT Journey — Small habits. A greater you.');
    await expect(fallback.locator('#pillars li h3')).toHaveText([
      'Mind',
      'Body',
      'Nutrition',
      'Hygiene',
    ]);
  } finally {
    await context.close();
  }
  await page.goto('./');
  const catalog = await page.evaluate(async () => {
    const { copy } = await import(new URL('assets/translations.js', location.href).href);
    return { en: Object.keys(copy.en).sort(), pt: Object.keys(copy['pt-BR']).sort() };
  });
  expect(catalog.en).toEqual(catalog.pt);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    'Build meaningful habits across different areas of life. Track your consistency and follow your journey up the mountain. No account required.',
  );
});

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

  await page.goto('./');
  await expect(page.locator('.idea')).toHaveCount(16);
  for (const kind of ['mind', 'body', 'nutrition', 'hygiene']) {
    const item = page.locator(`#pillars [data-pillar="${kind}"]`);
    expect(
      await item
        .locator('svg path')
        .evaluateAll((paths) => paths.map((path) => path.getAttribute('d'))),
    ).toEqual(expected[kind]);
    await expect(item.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  }
  for (const { id, pillar } of landingExamples) {
    expect(
      await page
        .locator(`[data-idea="${id}"]`)
        .locator('svg path')
        .evaluateAll((paths) => paths.map((path) => path.getAttribute('d'))),
    ).toEqual(expected[pillar]);
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
  await page.locator('#more-ideas summary').click();
  for (const { id, pillar } of landingExamples) {
    await page.locator(`[data-idea="${id}"]`).click();
    for (const demo of ['#hero-demo', '#tour-today']) {
      const icon = page.locator(`${demo} [data-pillar="${pillar}"] .group-heading svg`);
      expect(
        await icon
          .locator('path')
          .evaluateAll((paths) => paths.map((path) => path.getAttribute('d'))),
      ).toEqual(expected[pillar]);
      await expect(icon).toHaveAttribute('aria-hidden', 'true');
    }
  }
});

test('pillars introduce life areas before the tour and all four initial ideas', async ({
  page,
}) => {
  await page.goto('./');
  for (const language of ['en', 'pt-BR']) {
    await chooseLanguage(page, language);
    const english = language === 'en';
    const pillars = page.locator('#pillars');
    await expect(pillars.getByRole('heading', { level: 2 })).toHaveText(
      english ? 'Every habit shapes your journey.' : 'Cada hábito dá forma à sua jornada.',
    );
    expect(
      await pillars.evaluate((node) => ({
        before: node.previousElementSibling?.className,
        after: node.nextElementSibling?.id,
      })),
    ).toEqual({ before: 'trust-strip', after: 'tour' });
    await expect(pillars.locator('li h3')).toHaveText(
      english
        ? ['Mind', 'Body', 'Nutrition', 'Hygiene']
        : ['Mente', 'Corpo', 'Nutrição', 'Higiene'],
    );
    await expect(pillars.locator('li p')).toHaveText(
      english
        ? [
            'Learning and reflection.',
            'Movement and physical activity.',
            'Eating habits.',
            'Everyday personal care.',
          ]
        : [
            'Aprendizado e reflexão.',
            'Movimento e atividade física.',
            'Hábitos de alimentação.',
            'Cuidados pessoais do dia a dia.',
          ],
    );
    await expect(pillars).toContainText(
      english ? 'create your own pillars' : 'criar seus próprios pilares',
    );
    await expect(pillars.locator('button, a, [tabindex]')).toHaveCount(0);
    await expect(page.locator('#initial-ideas strong')).toHaveText(
      english
        ? ['Read a book', 'Walk', 'Eat a piece of fruit', 'Floss']
        : ['Ler um livro', 'Caminhar', 'Comer uma fruta', 'Usar fio dental'],
    );
    await expect(page.locator('#initial-ideas .goal')).toHaveText(
      english
        ? ['10 pages', '20 minutes', 'Afternoon snack', 'Before bed']
        : ['10 páginas', '20 minutos', 'Lanche da tarde', 'Antes de dormir'],
    );
    await expect(page.locator('#initial-ideas .frequency')).toHaveText(
      english
        ? ['Every day', 'Mon, Wed, Fri', 'Every day', 'Every day']
        : ['Todos os dias', 'Seg, Qua, Sex', 'Todos os dias', 'Todos os dias'],
    );
    const names = await page.locator('.idea strong').allTextContents();
    expect(new Set(names).size).toBe(16);
    await expect(page.locator('[data-idea="practice-english"] strong')).toHaveText(
      english ? 'Practice English' : 'Praticar inglês',
    );
  }
});

test('completed habits retain neutral background and normal text in both previews', async ({
  page,
}) => {
  await page.goto('./');
  await page.locator('[data-view="today"]').click();
  for (const demo of ['#hero-demo', '#tour-today']) {
    const row = page.locator(`${demo} [data-habit="read-book"]`);
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
      language === 'en' ? 'A greater you.' : 'Uma versão melhor de você.',
    );
    await expect(page.locator('.hero .lead')).toHaveText(
      language === 'en'
        ? 'Build meaningful habits across different areas of life. Track your consistency, celebrate your progress, and follow your journey up the mountain.'
        : 'Crie hábitos em diferentes áreas da vida. Acompanhe sua constância, celebre seu progresso e avance na sua jornada pela montanha.',
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
    ).toEqual([
      `read:my-goat-journey:appearance:${resolveSite().appBase}`,
      'read:my-goat-journey.landing.language',
      'write:my-goat-journey.landing.language',
    ]);
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
  await page.locator('[data-idea="walk"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-idea="walk"]')).toHaveAttribute('aria-pressed', 'true');
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
                'main, header, footer, button, select, summary, .habit-name, .calendar-weekdays > span, h1, h2, .button, .pillar-summaries li, .pillar-summaries p, .level-name, .level-state',
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
          if (view === 'journey' && [390, 1440].includes(width)) {
            await page.locator('#journey-view').screenshot({
              path: `artifacts/landing-messaging/screenshots/${language}-${width}-${scale}-journey.png`,
            });
          }
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

test('tour copy invites action and mountain signs retain accurate progression', async ({
  page,
}) => {
  await page.goto('./');
  for (const language of ['en', 'pt-BR']) {
    await chooseLanguage(page, language);
    const english = language === 'en';
    await page.locator('[data-view="journey"]').click();
    await expect(page.locator('#tour-description')).toHaveText(
      english
        ? 'See your effort take shape. Complete habits, earn XP, and follow your progress along the mountain trail.'
        : 'Veja seu esforço ganhar forma. Conclua hábitos, ganhe XP e acompanhe seu progresso pela trilha da montanha.',
    );
    await expect(page.locator('.mountain-contour')).toHaveCount(1);
    await expect(page.locator('.trail-drawing')).toHaveAttribute('aria-hidden', 'true');
    const states = english
      ? ['Current level', 'Ahead', 'Ahead']
      : ['Nível atual', 'À frente', 'À frente'];
    await expect(page.locator('.level-state')).toHaveText(states);
    for (let level = 1; level <= 3; level++) {
      await expect(page.locator(`[data-level="${level}"]`)).toHaveAccessibleDescription(
        states[level - 1],
      );
    }
    for (const xp of [60, 70]) {
      if (xp === 70) await page.locator('#hero-demo input').first().check();
      await expect(page.locator('#journey-view progress')).toHaveAttribute('value', String(xp));
      const distance = await page.locator('.trail-drawing').evaluate((svg, xp) => {
        const path = svg.querySelector<SVGPathElement>('.trail-traveled')!;
        const marker = svg.querySelector<SVGCircleElement>('.trail-position')!;
        const point = path.getPointAtLength((path.getTotalLength() * xp) / 200);
        return Math.hypot(point.x - marker.cx.baseVal.value, point.y - marker.cy.baseVal.value);
      }, xp);
      expect(distance).toBeLessThan(0.01);
    }
    await page.locator('#hero-demo input').first().uncheck();
  }
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

test('sixteen illustrative choices update an isolated checklist with coherent XP and preserved language state', async ({
  page,
}) => {
  await page.goto('./');
  await expect(page.locator('#initial-ideas button')).toHaveCount(4);
  await expect(page.locator('#additional-ideas button')).toHaveCount(12);
  await expect(page.locator('#more-ideas summary')).toHaveText('12 more ideas to inspire you');
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
  await expect(page.locator('#more-ideas summary')).toHaveText('Mais 12 ideias para se inspirar');
  await page.locator('#more-ideas summary').click();
  for (const locale of ['en', 'pt-BR']) {
    await chooseLanguage(page, locale);
    for (const { id } of landingExamples) {
      const idea = page.locator(`[data-idea="${id}"]`);
      const action = await idea.locator('strong').textContent();
      const frequency = await idea.locator('.frequency').textContent();
      await idea.click();
      await expect(idea).toHaveAttribute('aria-pressed', 'true');
      await expect(hero.locator('.habit-name').first()).toHaveText(action!);
      await expect(hero.locator('.habit-detail').first()).toContainText(frequency!);
      const ideaGeometry = await idea
        .locator('svg path')
        .evaluateAll((paths) => paths.map((path) => path.getAttribute('d')));
      expect(
        await hero
          .locator('.demo-group')
          .first()
          .locator('.group-heading svg path')
          .evaluateAll((paths) => paths.map((path) => path.getAttribute('d'))),
      ).toEqual(ideaGeometry);
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

for (const width of [390, 1440]) {
  for (const reordered of [false, true]) {
    test(`stable catalog identities at ${width}px with ${reordered ? 'reordered fixture' : 'published order'}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      const entries = reordered ? [...landingExamples].reverse() : landingExamples;
      if (reordered) {
        // Test-only module responses reorder presentation and copy independently.
        // The real renderer runs unchanged; production has no injection API.
        await page.route('**/assets/habit-catalog.js', (route) =>
          route.fulfill({
            contentType: 'text/javascript',
            body: `export const habitCatalog = ${JSON.stringify(entries.map(({ id, pillar, placement }) => ({ id, pillar, placement })))};
            export const defaultDemoIds = ${JSON.stringify(defaultLandingDemoIds)};`,
          }),
        );
        const translations = await readFile('landing/assets/translations.js', 'utf8');
        await page.route('**/assets/translations.js', (route) =>
          route.fulfill({
            contentType: 'text/javascript',
            body: `${translations}\nfor (const t of Object.values(copy)) {
            t.ideas = Object.fromEntries(Object.entries(t.ideas).sort(([a], [b]) => a.localeCompare(b)));
          }`,
          }),
        );
      }
      await page.goto('./');
      await page.locator('[data-view="today"]').click();
      await page.locator('#more-ideas summary').click();
      for (const placement of ['initial', 'additional']) {
        expect(
          await page
            .locator(`#${placement}-ideas .idea`)
            .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.idea)),
        ).toEqual(
          entries.filter((entry) => entry.placement === placement).map((entry) => entry.id),
        );
      }
      await expect(page.locator('[data-idea="read-book"]')).toHaveAttribute('aria-pressed', 'true');
      const check = (demo: string, id: string) =>
        page.locator(`${demo} [data-habit="${id}"] input`);
      const select = async (id: string) => {
        const idea = page.locator(`[data-idea="${id}"]`);
        await idea.click();
        await expect(idea).toBeFocused();
        await expect(idea).toHaveAttribute('aria-pressed', 'true');
      };
      const totals = async (count: number, locale: string) => {
        const xp = 50 + count * 10;
        for (const demo of ['#hero-demo', '#tour-today']) {
          await expect(page.locator(`${demo} .xp-badge`)).toHaveText(`${xp} XP`);
          await expect(page.locator(`${demo} .completion-summary strong`)).toHaveText(
            `${count}/4 ${locale === 'en' ? 'completed' : 'concluídos'}`,
          );
          await expect(page.locator(`${demo} progress`)).toHaveAttribute('value', String(count));
          await expect(page.locator(`${demo} progress`)).toHaveAttribute('max', '4');
        }
        await expect(page.locator('#journey-strip progress')).toHaveAttribute('value', String(xp));
        await expect(page.locator('#journey-view progress')).toHaveAttribute('value', String(xp));
      };
      await totals(1, 'en');
      for (const demo of ['#hero-demo', '#tour-today']) {
        await expect(check(demo, 'eat-fruit')).toBeChecked();
        await expect(check(demo, 'read-book')).not.toBeChecked();
      }
      for (const [locale, key] of [
        ['en', 'en'],
        ['pt-BR', 'pt'],
      ] as const) {
        await chooseLanguage(page, locale);
        for (const example of landingExamples) {
          const idea = page.locator(`[data-idea="${example.id}"]`);
          const [action, goal, frequency] = example[key];
          await expect(idea.locator('strong')).toHaveText(action);
          await expect(idea.locator('.goal')).toHaveText(goal);
          await expect(idea.locator('.frequency')).toHaveText(frequency);
          await select(example.id);
          for (const demo of ['#hero-demo', '#tour-today']) {
            const row = page.locator(
              `${demo} [data-pillar="${example.pillar}"] [data-habit="${example.id}"]`,
            );
            await expect(row.locator('.habit-name')).toHaveText(action);
            await expect(row.locator('.habit-detail')).toHaveText(`${goal} · ${frequency}`);
            await expect(row.getByRole('checkbox')).toHaveAccessibleName(
              `${locale === 'en' ? 'Complete' : 'Concluir'}: ${action} — ${goal}`,
            );
          }
        }
      }
      await chooseLanguage(page, 'en');
      await select('floss');
      await check('#tour-today', 'floss').check();
      await check('#hero-demo', 'read-book').check();
      await totals(3, 'en');
      await select('exercise'); // Floss is hidden, not forgotten. Body has two rows.
      await totals(2, 'en');
      for (const demo of ['#hero-demo', '#tour-today']) {
        await expect(page.locator(`${demo} [data-pillar="body"] .group-count`)).toHaveText(
          '0/2 completed',
        );
        await expect(page.locator(`${demo} [data-pillar="mind"] .group-count`)).toHaveText(
          '1/1 completed',
        );
        await expect(page.locator(`${demo} [data-pillar="nutrition"] .group-count`)).toHaveText(
          '1/1 completed',
        );
        await expect(check(demo, 'floss')).toHaveCount(0);
      }
      await check('#hero-demo', 'exercise').check();
      await totals(3, 'en');
      await chooseLanguage(page, 'pt-BR');
      await expect(page.getByRole('button', { name: 'Português', exact: true })).toBeFocused();
      await expect(page.locator('[data-idea="exercise"]')).toHaveAttribute('aria-pressed', 'true');
      await totals(3, 'pt-BR');
      for (const demo of ['#hero-demo', '#tour-today']) {
        await expect(check(demo, 'exercise')).toBeChecked();
        await expect(page.locator(`${demo} [data-pillar="body"] .group-count`)).toHaveText(
          '1/2 concluídos',
        );
      }
      await check('#tour-today', 'exercise').uncheck();
      await totals(2, 'pt-BR');
      await select('meditate');
      await totals(2, 'pt-BR');
      for (const demo of ['#hero-demo', '#tour-today']) {
        await expect(page.locator(`${demo} [data-pillar="mind"] .group-count`)).toHaveText(
          '1/2 concluídos',
        );
      }
      await select('floss');
      await totals(3, 'pt-BR');
      for (const demo of ['#hero-demo', '#tour-today'])
        await expect(check(demo, 'floss')).toBeChecked();
      await check('#tour-today', 'eat-fruit').uncheck();
      await select('exercise');
      await totals(1, 'pt-BR');
      await expect(check('#hero-demo', 'exercise')).not.toBeChecked();
      await chooseLanguage(page, 'en');
      await totals(1, 'en');
      for (const id of ['exercise', 'read-book', 'walk', 'eat-fruit'])
        await check('#hero-demo', id).check();
      await totals(4, 'en');
      for (const demo of ['#hero-demo', '#tour-today'])
        await expect(page.locator(`${demo} [role="status"]`)).toHaveText(
          'Good job! All habits completed today.',
        );
      await check('#tour-today', 'exercise').uncheck();
      await totals(3, 'en');
      for (const demo of ['#hero-demo', '#tour-today'])
        await expect(page.locator(`${demo} [role="status"]`)).toBeEmpty();
    });
  }
}

test('English first visit ignores browser language; explicit Portuguese selection survives reload', async ({
  page,
}) => {
  await page
    .context()
    .addInitScript(() => Object.defineProperty(navigator, 'language', { value: 'pt-BR' }));
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Small habits. A greater you.');
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
    'Pequenos hábitos. Uma versão melhor de você.',
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
  await expect(page).toHaveTitle('My GOAT Journey — Pequenos hábitos. Uma versão melhor de você.');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    'Crie hábitos em diferentes áreas da vida. Acompanhe sua constância e avance na sua jornada pela montanha. Sem necessidade de conta.',
  );
  await english.focus();
  await page.keyboard.press('Space');
  await expect(english).toBeFocused();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle('My GOAT Journey — Small habits. A greater you.');
});

for (const id of ['make-bed', 'add-vegetables', 'prepare-snack', 'prepare-clothes']) {
  test(`new idea ${id} preserves selection and completion through language changes`, async ({
    page,
  }) => {
    const example = landingExamples.find((entry) => entry.id === id)!;
    await page.goto('./');
    await page.locator('#more-ideas summary').click();
    await page.locator(`[data-idea="${id}"]`).click();
    await page.locator('[data-view="today"]').click();
    const check = page.locator(`#hero-demo [data-habit="${id}"] input`);
    await check.check();
    for (const [locale, key] of [
      ['pt-BR', 'pt'],
      ['en', 'en'],
    ] as const) {
      await chooseLanguage(page, locale);
      await expect(page.locator(`[data-idea="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
      for (const demo of ['#hero-demo', '#tour-today']) {
        const row = page.locator(`${demo} [data-pillar="${example.pillar}"] [data-habit="${id}"]`);
        await expect(row.locator('.habit-name')).toHaveText(example[key][0]);
        await expect(row.getByRole('checkbox')).toBeChecked();
        await expect(page.locator(`${demo} input`)).toHaveCount(4);
        await expect(page.locator(`${demo} .xp-badge`)).toHaveText('70 XP');
      }
    }
    await check.uncheck();
    await expect(page.locator('#tour-today .xp-badge')).toHaveText('60 XP');
    await expect(page.locator(`#tour-today [data-habit="${id}"] input`)).not.toBeChecked();
    await page.reload();
    await expect(page.locator('[data-idea="read-book"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#hero-demo .xp-badge')).toHaveText('60 XP');
  });
}

for (const width of [320, 390, 768, 1440]) {
  test(`GitHub header link is localized and keyboard accessible at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('./');
    const link = page.locator(
      '.header-actions a[href="https://github.com/thobiast/my-goat-journey"]',
    );
    await expect(link).toHaveCount(1);
    await expect(page.locator('a[href="https://github.com/thobiast/my-goat-journey"]')).toHaveCount(
      1,
    );
    await expect(link.locator('svg')).toHaveAttribute('aria-hidden', 'true');
    for (const locale of ['en', 'pt-BR']) {
      await chooseLanguage(page, locale);
      await expect(link).toHaveAccessibleName(
        locale === 'en' ? 'View the project on GitHub' : 'Ver o projeto no GitHub',
      );
      await page.getByRole('button', { name: 'Português', exact: true }).focus();
      await page.keyboard.press('Tab');
      await expect(page.locator('[data-appearance-choice="light"]')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.locator('[data-appearance-choice="dark"]')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(link).toBeFocused();
      expect(await link.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe('none');
      const box = (await link.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      if (width > 400) await expect(link.locator('span')).toBeVisible();
      else await expect(link.locator('span')).toBeHidden();
      await expect(page.locator('.header-actions a[href="app/"]')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page
        .locator('.masthead')
        .screenshot({ path: testInfo.outputPath(`${locale}-${width}-header.png`) });
    }
    // Exercise the ordinary anchor without contacting a third-party server.
    await page.route('https://github.com/thobiast/my-goat-journey', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<title>GitHub destination fixture</title>',
      }),
    );
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('https://github.com/thobiast/my-goat-journey');
    await expect(page).toHaveTitle('GitHub destination fixture');
  });
}
