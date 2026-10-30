import { test, expect } from '@playwright/test';
import { createServer, request as upstreamRequest, type Server } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { nav, readDataset } from './support/habit-fixtures';
import { expandFixturePillars } from './support/management-fixtures';
import { resolveSite, resolveAppURL } from '../config/site.mjs';

// Opt-in publication evidence only; all records originate in a disposable context.
// BASE_URL selects the app server; paths derive from the shared contract.
const enabled = process.env.PUBLICATION_CAPTURE === '1';
const site = resolveSite();
const upstream = new URL(
  resolveAppURL(process.env.BASE_URL ?? 'http://my-goat-journey-runtime:8080'),
);
const origin = 'http://127.0.0.1:4193';
const appUrl = `${origin}${upstream.pathname}`;
const evidence = process.env.PUBLICATION_EVIDENCE ?? 'artifacts/publication-captures';
const landingPath = process.env.PUBLICATION_LANDING_PATH ?? site.prefix;
const localLanding = !process.env.PUBLICATION_LANDING_PATH;
const goals = [
  'Read ten pages',
  'Take a twenty-minute walk',
  'Prepare a fruit snack',
  'Complete my evening care',
];
let server: Server;
test.use({ channel: 'chromium', viewport: { width: 760, height: 1180 }, serviceWorkers: 'block' });
test.setTimeout(120_000);

test.beforeAll(async () => {
  if (!enabled) return;
  await mkdir(evidence, { recursive: true });
  server = createServer(async (incoming, outgoing) => {
    const path = new URL(incoming.url ?? '/', origin).pathname;
    if (
      localLanding &&
      (path === landingPath ||
        path === `${landingPath}index.html` ||
        path.startsWith(`${landingPath}assets/`))
    ) {
      const relative = decodeURIComponent(path.slice(landingPath.length)) || 'index.html';
      const root = resolve('landing');
      const file = resolve(root, relative);
      if (!file.startsWith(`${root}/`)) {
        outgoing.writeHead(403);
        outgoing.end();
        return;
      }
      try {
        const body = await readFile(file);
        const type =
          (
            {
              '.html': 'text/html',
              '.css': 'text/css',
              '.js': 'text/javascript',
              '.png': 'image/png',
              '.svg': 'image/svg+xml',
              '.webp': 'image/webp',
            } as Record<string, string>
          )[extname(file)] ?? 'application/octet-stream';
        outgoing.writeHead(200, { 'content-type': type });
        outgoing.end(body);
      } catch {
        outgoing.writeHead(404);
        outgoing.end();
      }
      return;
    }
    const request = upstreamRequest(
      {
        hostname: upstream.hostname,
        port: upstream.port,
        path: incoming.url,
        method: incoming.method,
        headers: { ...incoming.headers, host: upstream.host },
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    request.on('error', () => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end('Production target unavailable');
    });
    incoming.pipe(request);
  });
  await new Promise<void>((done) => server.listen(4193, '127.0.0.1', done));
});
test.afterAll(async () => {
  if (server)
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
});

test('capture current Today, Pillars and Progress with fictional UI-created history', async ({
  page,
}) => {
  test.skip(
    !enabled,
    'Opt-in only: PUBLICATION_CAPTURE=1 and BASE_URL must name an isolated capture target.',
  );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-10-07T12:00:00Z') });
  expect((await page.goto(appUrl))?.status()).toBe(200);
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
  // Advance only the test clock; make actual completion writes through the UI.
  for (let day = 7; day <= 14; day++) {
    await page.clock.setSystemTime(new Date(`2026-10-${String(day).padStart(2, '0')}T12:00:00Z`));
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    const boxes = page.getByRole('checkbox');
    await expect(boxes).toHaveCount(4);
    for (let index = 0; index < 4; index++) {
      if (day === 14 ? index < 2 : (day + index) % 5 !== 0) {
        await boxes.nth(index).click();
        await expect(boxes.nth(index)).toBeChecked();
        await expect(boxes.nth(index)).toBeEnabled();
      }
    }
  }
  await expect(page.getByText('2 of 4 habits completed', { exact: true })).toBeVisible();
  const saved = await readDataset(page);
  expect(
    saved.habits.map((habit: { versions: { goal: string }[] }) => habit.versions[0].goal),
  ).toEqual(goals);
  const before = JSON.stringify(saved);
  for (const [screen, filename] of [
    ['Today', 'today-en.png'],
    ['Pillars', 'pillars-en.png'],
    ['Progress', 'progress-en.png'],
  ] as const) {
    await nav(page, screen).click();
    await expect(page.getByRole('heading', { name: screen, exact: true, level: 1 })).toBeVisible();
    if (screen === 'Progress')
      await expect(page.getByRole('button', { name: '7d', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    if (screen === 'Pillars') await expandFixturePillars(page);
    // Use a real tall viewport with the real fixed navigation; no hidden UI or image compositing.
    const height = await page
      .locator('main')
      .evaluate((main) => Math.ceil(main.getBoundingClientRect().height) + 16);
    await page.setViewportSize({ width: 760, height: Math.max(640, height) });
    await page.evaluate(() => scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `${evidence}/${filename}`, animations: 'disabled' });
  }
  expect(JSON.stringify(await readDataset(page))).toBe(before);
  expect(errors).toEqual([]);
  await writeFile(
    `${evidence}/capture-provenance.json`,
    JSON.stringify(
      {
        upstream: upstream.href,
        appUrl,
        clock: '2026-10-07 through 2026-10-14 (UTC)',
        viewport: '760px wide; real viewport height fitted to main content per screen',
        fictionalGoals: goals,
        setup:
          'Four habits created through onboarding; all completion facts created through native checklist UI; fresh Playwright context, no user browser profile; service workers blocked for screenshot capture only.',
        habitCount: saved.habits.length,
        occurrenceCount: saved.occurrences.length,
        images: ['today-en.png', 'pillars-en.png', 'progress-en.png'],
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
});

test('landing is responsive, local-only and does not access diary storage', async ({ page }) => {
  test.skip(!enabled, 'Opt-in publication evidence only.');
  await page.addInitScript((landingPath) => {
    if (location.pathname !== landingPath) return;
    const accessed: string[] = [];
    Object.assign(window, { publicationStorageAccess: accessed });
    indexedDB.open = () => {
      accessed.push('indexedDB.open');
      throw new Error('Landing must not open a database');
    };
    window.BroadcastChannel = class {
      constructor() {
        accessed.push('BroadcastChannel');
        throw new Error('Landing must not open a channel');
      }
    } as unknown as typeof BroadcastChannel;
    navigator.serviceWorker.register = async () => {
      accessed.push('serviceWorker.register');
      throw new Error('Landing must not register a worker');
    };
  }, landingPath);
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  for (const viewport of [
    { width: 1280, height: 1000 },
    { width: 390, height: 844 },
    { width: 320, height: 780 },
  ]) {
    await page.setViewportSize(viewport);
    const response = await page.goto(`${origin}${landingPath}`);
    expect(response?.status()).toBe(200);
    expect(await response!.text()).toBe(await readFile('landing/index.html', 'utf8'));
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Small habits.');
    for (const image of await page.locator('img').all()) {
      await image.scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          image.evaluate(
            (image) =>
              image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
          ),
        )
        .toBe(true);
    }
    await page.locator('footer').scrollIntoViewIfNeeded();
    expect(
      await page
        .locator('img')
        .evaluateAll((images) =>
          images.every(
            (image) =>
              image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
          ),
        ),
    ).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(await page.locator('script').count()).toBe(2);
    await expect(page.locator('script[type="module"]')).toHaveAttribute('src', 'assets/landing.js');
    const appearance = page.locator('script:not([type])');
    await expect(appearance).toHaveAttribute('src', 'assets/appearance.js');
    await expect(appearance).not.toHaveAttribute('async');
    await expect(appearance).not.toHaveAttribute('defer');
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
    await expect(page.locator('#initial-ideas button')).toHaveCount(4);
    await expect(page.locator('#additional-ideas button')).toHaveCount(12);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { publicationStorageAccess: string[] }).publicationStorageAccess,
      ),
    ).toEqual([]);
    expect(
      await page.getByRole('link', { name: 'Open the app', exact: true }).getAttribute('href'),
    ).toBe('app/');
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `${evidence}/landing-${viewport.width}.png`, fullPage: true });
  }
  expect(requests.every((url) => new URL(url).origin === origin)).toBe(true);
  const scripts = [
    ...new Set(requests.map((url) => new URL(url).pathname).filter((path) => path.endsWith('.js'))),
  ];
  expect(scripts.sort()).toEqual(
    [
      'landing.js',
      'language.js',
      'translations.js',
      'demonstrations.js',
      'habit-catalog.js',
      'tour.js',
      'installation.js',
      'appearance.js',
    ]
      .map((name) => `${landingPath}assets/${name}`)
      .sort(),
  );
  expect(errors).toEqual([]);
  if (!localLanding) {
    await page.getByRole('link', { name: 'Open the app', exact: true }).click();
    expect(new URL(page.url()).pathname).toBe(upstream.pathname);
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  }
  await writeFile(
    `${evidence}/landing-provenance.json`,
    JSON.stringify(
      {
        upstream: upstream.href,
        landingPath,
        localLanding,
        viewports: [1280, 390, 320],
        externalRequests: requests.filter((url) => new URL(url).origin !== origin),
        diaryAccess: [],
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
});
