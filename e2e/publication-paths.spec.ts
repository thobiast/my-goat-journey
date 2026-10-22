import { test as base, expect, type Page } from '@playwright/test';
import { createServer, request as upstreamRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { resolveSite } from '../config/site.mjs';
import { nav, readDataset } from './support/habit-fixtures';

const site = resolveSite();
const fictionalGoal = 'Publication fixture: read a fictional field note 🎵';
const fixtureTime = '2026-10-07T12:00:00Z';
const legacyScript = '/legacy-worker.js';
const legacyCache = 'publication-test-only-legacy-shell';
const legacyHeading = 'Legacy root shell fixture';

type Publication = {
  origin: string;
  landingURL: string;
  appURL: string;
  mode: 'development' | 'production';
  disconnect: () => void;
};

// Every server and browser context is disposable. Loopback is inside the browser
// container, not a host-published port; secure-context APIs remain real/enabled.
// All production bytes are forwarded unchanged. Only the named legacy fixture
// endpoints below are synthetic; they are never added to the publication output.
const test = base.extend<{ publication: Publication }>({
  publication: async ({ baseURL }, use) => {
    if (!baseURL) throw new Error('Publication fixtures require Playwright baseURL');
    const configured = new URL(baseURL);
    const mode =
      configured.hostname === 'my-goat-journey-dev' || configured.port === '5173'
        ? 'development'
        : 'production';
    const upstream = new URL(
      mode === 'development'
        ? 'http://my-goat-journey-dev:5173'
        : 'http://my-goat-journey-runtime:8080',
    );
    const sockets = new Set<Duplex>();
    let networkAvailable = true;
    const legacyWorker = `
// TEST ONLY: generic former root scope with a pre-cached navigation fallback.
const CACHE = ${JSON.stringify(legacyCache)};
const SHELL = '/__publication_legacy_shell__';
let cacheFirst = false;
self.addEventListener('message', event => {
  if (event.data?.type === 'LEGACY_CACHE_FIRST') { cacheFirst = true; event.ports[0]?.postMessage({ ready: true }); }
});
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cache.put(SHELL, new Response('<!doctype html><h1>${legacyHeading}</h1>', { headers: { 'content-type': 'text/html' } }));
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') event.respondWith((async () => {
    if (cacheFirst) return (await caches.open(CACHE)).match(SHELL);
    try { return await fetch(event.request); }
    catch { return (await caches.open(CACHE)).match(SHELL); }
  })());
});`;
    const server: Server = createServer((incoming, outgoing) => {
      if (!networkAvailable) {
        outgoing.destroy();
        return;
      }
      const pathname = new URL(incoming.url ?? '/', 'http://fixture.invalid').pathname;
      if (pathname === legacyScript) {
        outgoing.writeHead(200, {
          'content-type': 'text/javascript',
          'cache-control': 'no-store',
          'service-worker-allowed': '/',
        });
        outgoing.end(legacyWorker);
        return;
      }
      if (pathname === '/legacy.webmanifest') {
        // Exactly the former relative root start/scope, with NO explicit id.
        outgoing.writeHead(200, { 'content-type': 'application/manifest+json' });
        outgoing.end(
          JSON.stringify({
            name: 'Isolated legacy publication fixture',
            start_url: './',
            scope: './',
            display: 'standalone',
          }),
        );
        return;
      }
      if (pathname === '/legacy-fixture/') {
        outgoing.writeHead(200, { 'content-type': 'text/html' });
        outgoing.end(
          '<!doctype html><link rel="manifest" href="/legacy.webmanifest"><h1>Isolated legacy fixture owner</h1>',
        );
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
      request.on('error', (error) => {
        if (!outgoing.headersSent) outgoing.writeHead(502);
        outgoing.end(`Publication upstream unavailable: ${error.message}`);
      });
      outgoing.on('close', () => request.destroy());
      incoming.pipe(request);
    });
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
      socket.on('error', () => socket.destroy());
    });
    // Forward Vite's real WebSocket upgrade rather than silently disabling HMR.
    server.on('upgrade', (incoming, socket, head) => {
      if (!networkAvailable) {
        socket.destroy();
        return;
      }
      const request = upstreamRequest({
        hostname: upstream.hostname,
        port: upstream.port,
        path: incoming.url,
        headers: { ...incoming.headers, host: upstream.host },
      });
      request.on('upgrade', (response, peer, peerHead) => {
        sockets.add(peer);
        peer.once('close', () => sockets.delete(peer));
        peer.on('error', () => {
          peer.destroy();
          socket.destroy();
        });
        socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`);
        for (let index = 0; index < response.rawHeaders.length; index += 2)
          socket.write(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}\r\n`);
        socket.write('\r\n');
        if (peerHead.length) socket.write(peerHead);
        if (head.length) peer.write(head);
        peer.pipe(socket);
        socket.pipe(peer);
        socket.once('close', () => peer.destroy());
        peer.once('close', () => socket.destroy());
      });
      request.on('response', () => socket.destroy());
      request.on('error', () => socket.destroy());
      request.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      await use({
        origin,
        landingURL: origin + site.prefix,
        appURL: origin + site.appBase,
        mode,
        disconnect: () => {
          networkAvailable = false;
        },
      });
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
});

test.use({ channel: 'chromium', serviceWorkers: 'allow', timezoneId: 'UTC' });
test.setTimeout(90_000);

async function landingProbe(page: Page) {
  await page.addInitScript((prefix) => {
    if (location.pathname !== prefix) return; // Never instrument the app diary.
    const calls: string[] = [];
    Object.assign(window, { publicationLandingCalls: calls });
    for (const key of ['open', 'deleteDatabase', 'databases'] as const) {
      const original = indexedDB[key].bind(indexedDB);
      Object.defineProperty(indexedDB, key, {
        configurable: true,
        value: (...args: unknown[]) => {
          calls.push(`indexedDB.${key}`);
          return Reflect.apply(original, indexedDB, args);
        },
      });
    }
    window.BroadcastChannel = new Proxy(window.BroadcastChannel, {
      construct(target, args) {
        calls.push(`BroadcastChannel:${String(args[0])}`);
        return Reflect.construct(target, args);
      },
    });
  }, site.prefix);
}

async function verifyLanding(page: Page, publication: Publication) {
  const response = await page.goto(publication.landingURL);
  expect(response?.status()).toBe(200);
  expect(page.url()).toBe(publication.landingURL);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Small habits.');
  const link = page.getByRole('link', { name: 'Open the app', exact: true });
  await expect(link).toHaveAttribute('href', 'app/');
  expect(await link.evaluate((element: HTMLAnchorElement) => element.href)).toBe(
    publication.appURL,
  );
  expect(await page.evaluate(() => isSecureContext)).toBe(true);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { publicationLandingCalls: string[] }).publicationLandingCalls,
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null),
  ).toBeNull();
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
}

async function activeAppWorker(page: Page, publication: Publication) {
  await expect
    .poll(
      () =>
        page.evaluate(async (appURL) => {
          const registration = await navigator.serviceWorker.getRegistration(appURL);
          return registration?.scope === appURL && registration.active?.state === 'activated';
        }, publication.appURL),
      { timeout: 20_000 },
    )
    .toBe(true);
}

async function controlledApp(page: Page, publication: Publication) {
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null))
    .toBe(publication.appURL + 'sw.js');
  expect(
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope),
  ).toBe(publication.appURL);
}

async function createFictionalDiary(page: Page, publication: Publication) {
  await page.clock.install({ time: new Date(fixtureTime) });
  expect((await page.goto(publication.appURL))?.status()).toBe(200);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mind', exact: true })).toBeVisible();
  await page.getByLabel('What do you want to do?', { exact: true }).fill(fictionalGoal);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  for (const name of ['Body', 'Nutrition', 'Hygiene']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Start my journey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  const checkbox = page.getByRole('checkbox', { name: `Done: ${fictionalGoal}`, exact: true });
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await expect(checkbox).toBeEnabled();
  const saved = await readDataset(page);
  expect(saved.schemaVersion).toBe(2);
  expect(saved.habits).toHaveLength(1);
  expect(saved.habits[0].versions[0].goal).toBe(fictionalGoal);
  expect(saved.occurrences).toHaveLength(1);
  expect(saved.occurrences[0]).toMatchObject({
    habitId: saved.habits[0].id,
    goal: fictionalGoal,
    done: true,
    date: '2026-10-07',
  });
  return saved;
}

async function nativeManifest(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const result = await cdp.send('Page.getAppManifest');
    expect(result.errors).toEqual([]);
    expect(result.data).toBeTruthy();
    return result;
  } finally {
    await cdp.detach();
  }
}

test('development serves shared landing/app paths with real HMR and never registers a worker', async ({
  page,
  context,
  publication,
}, testInfo) => {
  test.skip(
    publication.mode !== 'development',
    'Development target only; run with BASE_URL naming my-goat-journey-dev:5173.',
  );
  await landingProbe(page);
  const errors: string[] = [];
  const workerRequests: string[] = [];
  const workerCalls: string[] = [];
  const hmr: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  context.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/sw.js')) workerRequests.push(request.url());
  });
  await context.exposeBinding('__publicationWorkerAttempt', (_source, url: string) => {
    workerCalls.push(url);
  });
  page.on('websocket', (socket) =>
    socket.on('framereceived', (event) => {
      if (String(event.payload).includes('"type":"connected"')) hmr.push(socket.url());
    }),
  );
  await context.addInitScript(() => {
    if (!navigator.serviceWorker) return;
    const calls: string[] = [];
    Object.assign(window, { publicationWorkerCalls: calls });
    const register = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    navigator.serviceWorker.register = (...args: Parameters<typeof register>) => {
      calls.push(String(args[0]));
      void (
        window as typeof window & { __publicationWorkerAttempt: (url: string) => Promise<void> }
      ).__publicationWorkerAttempt(String(args[0]));
      return register(...args);
    };
  });
  await verifyLanding(page, publication);
  expect((await page.reload())?.status()).toBe(200);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { publicationLandingCalls: string[] }).publicationLandingCalls,
    ),
  ).toEqual([]);
  await page.getByRole('link', { name: 'Open the app', exact: true }).click();
  expect(page.url()).toBe(publication.appURL);
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  await expect.poll(() => hmr.length).toBeGreaterThan(0);
  const connectedBeforeReload = hmr.length;
  expect((await page.reload())?.status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  await expect.poll(() => hmr.length).toBeGreaterThan(connectedBeforeReload);
  expect(
    await page.evaluate(
      () => (window as typeof window & { publicationWorkerCalls: string[] }).publicationWorkerCalls,
    ),
  ).toEqual([]);
  const direct = await context.newPage();
  direct.on('pageerror', (error) => errors.push(error.message));
  expect((await direct.goto(publication.appURL))?.status()).toBe(200);
  await expect(direct.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  await direct.close();
  expect(
    await page.evaluate(async () =>
      (await navigator.serviceWorker.getRegistrations()).map((registration) => registration.scope),
    ),
  ).toEqual([]);
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
  expect(workerCalls).toEqual([]);
  expect(workerRequests).toEqual([]);
  expect(errors).toEqual([]);
  await testInfo.attach('development-publication-paths', {
    body: JSON.stringify(
      { ...site, upstream: 'my-goat-journey-dev:5173', hmr, workerCalls, workerRequests, errors },
      null,
      2,
    ),
    contentType: 'application/json',
  });
});

test('production direct/reload/link entry preserves relative manifest identity and app-only worker scope', async ({
  page,
  context,
  publication,
}, testInfo) => {
  test.skip(
    publication.mode !== 'production',
    'Compiled production target only; run with BASE_URL naming my-goat-journey-runtime:8080.',
  );
  await landingProbe(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await verifyLanding(page, publication);
  expect((await page.reload())?.status()).toBe(200);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { publicationLandingCalls: string[] }).publicationLandingCalls,
    ),
  ).toEqual([]);
  await page.getByRole('link', { name: 'Open the app', exact: true }).click();
  expect(page.url()).toBe(publication.appURL);
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  const manifestURL = await page
    .locator('link[rel="manifest"]')
    .evaluate((element: HTMLLinkElement) => element.href);
  expect(manifestURL).toBe(publication.appURL + 'site-v1.webmanifest');
  const response = await context.request.get(manifestURL);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/manifest+json');
  const manifest = await response.json();
  expect(manifest).toMatchObject({ start_url: './', scope: './', display: 'standalone' });
  expect(manifest).not.toHaveProperty('id'); // Identity defaults to Chromium's resolved start URL.
  expect(new URL(manifest.start_url, manifestURL).href).toBe(publication.appURL);
  expect(new URL(manifest.scope, manifestURL).href).toBe(publication.appURL);
  const iconFiles = ['app-icon-192-v1.png', 'app-icon-512-v1.png', 'app-icon-maskable-512-v1.png'];
  expect(manifest.icons.map((icon: { src: string }) => icon.src)).toEqual(
    iconFiles.map((file) => `icons/${file}`),
  );
  const iconURLs: string[] = [];
  for (const [index, file] of iconFiles.entries()) {
    const url = new URL(manifest.icons[index].src, manifestURL).href;
    expect(url).toBe(publication.appURL + `icons/${file}`);
    iconURLs.push(url);
    const icon = await context.request.get(url);
    expect(icon.status(), url).toBe(200);
    expect(icon.headers()['content-type']).toContain('image/png');
    const size = await page.evaluate(async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      return `${image.naturalWidth}x${image.naturalHeight}`;
    }, url);
    expect(size).toBe(manifest.icons[index].sizes);
  }
  const parsed = await nativeManifest(page);
  expect(parsed.url).toBe(manifestURL);
  expect(parsed.manifest?.startUrl).toBe(publication.appURL);
  expect(parsed.manifest?.scope).toBe(publication.appURL);
  expect(parsed.manifest?.id).toBe(publication.appURL);
  expect(parsed.manifest?.icons?.map((icon) => icon.url)).toEqual(iconURLs);
  await activeAppWorker(page, publication);
  expect((await page.reload())?.status()).toBe(200);
  await controlledApp(page, publication);
  const direct = await context.newPage();
  expect((await direct.goto(publication.appURL))?.status()).toBe(200);
  await expect(direct.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  await controlledApp(direct, publication);
  await direct.close();
  await verifyLanding(page, publication); // Active app worker must NOT claim landing.
  expect(
    await page.evaluate(async () =>
      (await navigator.serviceWorker.getRegistrations()).map((registration) => registration.scope),
    ),
  ).toEqual([publication.appURL]);
  expect(errors).toEqual([]);
  await testInfo.attach('production-manifest-and-scope', {
    body: JSON.stringify({ ...site, manifestURL, manifest, parsed, iconURLs, errors }, null, 2),
    contentType: 'application/json',
  });
});

test('production fresh offline document reopens exact UI-created diary and commits offline checklist corrections', async ({
  page,
  context,
  publication,
}) => {
  test.skip(
    publication.mode !== 'production',
    'Compiled production only: development is not offline/cache evidence.',
  );
  const saved = await createFictionalDiary(page, publication);
  await activeAppWorker(page, publication);
  await page.reload();
  await controlledApp(page, publication);
  expect(await readDataset(page)).toEqual(saved);
  // Both browser networking and the fixture upstream are unavailable. This is
  // a fresh document, not a still-open SPA or HTTP-cache-only reload.
  publication.disconnect();
  await context.setOffline(true);
  await page.close();
  const reopened = await context.newPage();
  await reopened.clock.install({ time: new Date(fixtureTime) });
  const response = await reopened.goto(publication.appURL);
  expect(response?.fromServiceWorker()).toBe(true);
  await expect(reopened.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await controlledApp(reopened, publication);
  expect(await readDataset(reopened)).toEqual(saved);
  const checkbox = reopened.getByRole('checkbox', { name: `Done: ${fictionalGoal}`, exact: true });
  await expect(checkbox).toBeChecked();
  await checkbox.click();
  await expect(checkbox).not.toBeChecked();
  await expect(checkbox).toBeEnabled();
  const corrected = await readDataset(reopened);
  expect(corrected.occurrences).toEqual(
    saved.occurrences.map((occurrence: { done: boolean }) => ({ ...occurrence, done: false })),
  );
  expect({ ...corrected, occurrences: saved.occurrences, revision: saved.revision }).toEqual(saved);
  expect(corrected.revision).toBeGreaterThan(saved.revision);
  await nav(reopened, 'Settings').click();
  await nav(reopened, 'Today').click();
  await reopened.close();
  const fresh = await context.newPage();
  await fresh.clock.install({ time: new Date(fixtureTime) });
  expect((await fresh.goto(publication.appURL))?.fromServiceWorker()).toBe(true);
  await expect(
    fresh.getByRole('checkbox', { name: `Done: ${fictionalGoal}`, exact: true }),
  ).not.toBeChecked();
  expect(await readDataset(fresh)).toEqual(corrected);
});

test('isolated legacy root fallback can mask landing until exact owner retirement without deleting diary or app worker', async ({
  page,
  context,
  publication,
}, testInfo) => {
  test.skip(
    publication.mode !== 'production',
    'Legacy transition fixture requires real compiled app registration.',
  );
  expect((await page.goto(publication.origin + '/legacy-fixture/'))?.status()).toBe(200);
  const oldManifest = await nativeManifest(page);
  expect(oldManifest.manifest?.id).toBe(publication.origin + '/');
  const oldRaw = JSON.parse(oldManifest.data ?? '');
  expect(oldRaw).toMatchObject({ start_url: './', scope: './' });
  expect(oldRaw).not.toHaveProperty('id');
  await page.evaluate(async (script) => {
    await navigator.serviceWorker.register(script, { scope: '/' });
    await navigator.serviceWorker.ready;
  }, legacyScript);
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL))
    .toBe(publication.origin + legacyScript);
  // The generic old worker is network-first online, permitting actual new app
  // bytes/registration. Offline it can return its old root shell before any
  // server redirect executes. This is a fixture, not a proposed compatibility route.
  const app = await context.newPage();
  const saved = await createFictionalDiary(app, publication);
  await activeAppWorker(app, publication);
  await app.reload();
  await controlledApp(app, publication);
  const newManifest = await nativeManifest(app);
  expect(newManifest.manifest?.id).toBe(publication.appURL);
  expect(newManifest.manifest?.id).not.toBe(oldManifest.manifest?.id);
  expect(
    await app.evaluate(async () =>
      (await navigator.serviceWorker.getRegistrations())
        .map((registration) => registration.scope)
        .sort(),
    ),
  ).toEqual([publication.origin + '/', publication.appURL].sort());
  expect(await readDataset(app)).toEqual(saved);
  const landing = await context.newPage();
  expect((await landing.goto(publication.landingURL))?.status()).toBe(200);
  await expect(landing.getByRole('heading', { level: 1 })).toContainText('Small habits.');
  expect(await landing.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(
    publication.origin + legacyScript,
  );
  // Existing cache-first root shells can mask new entries ONLINE too. A server
  // redirect cannot retire them because the request need not reach nginx.
  await landing.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          channel.port1.close();
          resolve();
        };
        navigator.serviceWorker.controller!.postMessage({ type: 'LEGACY_CACHE_FIRST' }, [
          channel.port2,
        ]);
      }),
  );
  expect((await landing.reload())?.fromServiceWorker()).toBe(true);
  await expect(landing.getByRole('heading', { name: legacyHeading, exact: true })).toBeVisible();
  await context.setOffline(true);
  expect((await landing.reload())?.fromServiceWorker()).toBe(true);
  await expect(landing.getByRole('heading', { name: legacyHeading, exact: true })).toBeVisible();
  expect(landing.url()).toBe(publication.landingURL); // URL alone does not prove new landing bytes.
  await app.reload();
  await controlledApp(app, publication);
  await expect(app.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  expect(await readDataset(app)).toEqual(saved);
  await context.setOffline(false);
  // Explicit TEST-OWNER operation only. Never unregister-all, clear site data,
  // remove caches, delete IndexedDB, copy/merge records or change app safeguards.
  const retired = await app.evaluate(
    async ({ rootScope, scriptURL }) => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const exact = registrations.find(
        (registration) =>
          registration.scope === rootScope && registration.active?.scriptURL === scriptURL,
      );
      if (!exact) throw new Error('Exact disposable legacy fixture registration not found');
      return exact.unregister();
    },
    { rootScope: publication.origin + '/', scriptURL: publication.origin + legacyScript },
  );
  expect(retired).toBe(true);
  expect(
    await app.evaluate(async () =>
      (await navigator.serviceWorker.getRegistrations()).map((registration) => registration.scope),
    ),
  ).toEqual([publication.appURL]);
  expect(
    await app.evaluate(async (cache) => (await caches.keys()).includes(cache), legacyCache),
  ).toBe(true);
  expect(await readDataset(app)).toEqual(saved);
  // Unregister does not evict current controllers. Close the legacy-owned tabs
  // before proving fresh landing entry; do not misrepresent immediate takeover.
  await page.close();
  await landing.close();
  const cleanLanding = await context.newPage();
  await landingProbe(cleanLanding);
  await verifyLanding(cleanLanding, publication);
  await cleanLanding.close();
  publication.disconnect();
  await context.setOffline(true);
  await app.close();
  const freshApp = await context.newPage();
  await freshApp.clock.install({ time: new Date(fixtureTime) });
  expect((await freshApp.goto(publication.appURL))?.fromServiceWorker()).toBe(true);
  await controlledApp(freshApp, publication);
  await expect(
    freshApp.getByRole('checkbox', { name: `Done: ${fictionalGoal}`, exact: true }),
  ).toBeChecked();
  expect(await readDataset(freshApp)).toEqual(saved);
  await testInfo.attach('legacy-owner-transition', {
    body: JSON.stringify(
      {
        ...site,
        oldIdentity: oldManifest.manifest?.id,
        newIdentity: newManifest.manifest?.id,
        rootScript: publication.origin + legacyScript,
        retired,
        preservation:
          'Exact diary equality before/after targeted fixture retirement and fresh offline app reopen; app registration and legacy fixture cache retained.',
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
});
