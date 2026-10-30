import { test as base, expect, type Page, type BrowserContext } from '@playwright/test';
import { createServer, request as upstreamRequest, type ClientRequest } from 'node:http';
import type { Socket } from 'node:net';
import { writeFile } from 'node:fs/promises';
import { resolveSite } from '../config/site.mjs';
import { nav, readDataset } from './support/habit-fixtures';
import { documentHtml, documentIdentity, resume, shellSnapshot } from './support/pwa-update';

// Native compiled gate, not the failure-injection matrix. Prepare both task-only nginx
// fixtures on the browser-container network at port 8080, with the same SITE_PREFIX:
// B: current appearance build; C: identical inputs plus one harmless HTML comment,
// inserted BEFORE final-byte signing. No worker instrumentation or forced activation.
const incumbent = 'my-goat-journey-appearance-runtime';
const candidate = 'my-goat-journey-appearance-next';
const { appBase } = resolveSite();
const storageKey = `my-goat-journey:appearance:${appBase}`;
const cachePrefix = `my-goat-journey:${encodeURIComponent(appBase)}:`;
const guardLogKey = 'appearance-pwa-guard-observations';
const instant = new Date('2026-10-26T12:00:00Z');
type Appearance = 'light' | 'dark';

interface CompiledShell {
  base: string;
  version: string;
  files: string[];
  integrity: Record<string, string>;
}

interface AppearanceSample {
  appearance: string | undefined;
  preference: string | undefined;
  colorScheme: string;
  background: string;
  rootChildren: number;
}

interface Observation {
  firstResolved?: AppearanceSample;
  firstPaint?: AppearanceSample;
}

type ObservedWindow = typeof window & { appearancePwaObservation?: Observation };

interface AppProxy {
  origin: string;
  url: string;
  switchTo: (target: typeof incumbent | typeof candidate) => void;
  network: (available: boolean) => void;
}

const test = base.extend<{ app: AppProxy }>({
  app: async ({}, use, testInfo) => {
    expect(
      testInfo.config.metadata.appearancePwa,
      'Select playwright.appearance-pwa.config.ts with prepared compiled B/C fixtures',
    ).toBe(true);
    let target: typeof incumbent | typeof candidate = incumbent;
    let available = true;
    const sockets = new Set<Socket>();
    const requests = new Set<ClientRequest>();
    const server = createServer((incoming, outgoing) => {
      const path = new URL(incoming.url ?? '/', 'http://localhost').pathname;
      if (!available) {
        outgoing.destroy();
        return;
      }
      // Do not rewrite app paths, serve source modules, synthesize HTML or touch signed bytes.
      if (!path.startsWith(appBase)) {
        outgoing.writeHead(404);
        outgoing.end();
        return;
      }
      const upstream = upstreamRequest(
        {
          hostname: target,
          port: 8080,
          path: incoming.url,
          method: incoming.method,
          headers: { ...incoming.headers, host: `${target}:8080` },
          agent: false,
        },
        (response) => {
          outgoing.writeHead(response.statusCode ?? 502, response.headers);
          response.on('error', () => outgoing.destroy());
          response.pipe(outgoing);
        },
      );
      requests.add(upstream);
      upstream.once('close', () => requests.delete(upstream));
      upstream.on('error', () => {
        if (!outgoing.headersSent) outgoing.writeHead(502);
        outgoing.end('Compiled appearance fixture unavailable');
      });
      upstream.setTimeout(15_000, () => upstream.destroy(new Error('Upstream fixture timed out')));
      outgoing.once('close', () => upstream.destroy());
      incoming.pipe(upstream);
    });
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing ephemeral proxy port');
    const origin = `http://127.0.0.1:${address.port}`;
    try {
      await use({
        origin,
        url: origin + appBase,
        switchTo: (value) => {
          target = value;
        },
        network: (value) => {
          available = value;
          if (!value) {
            for (const request of requests) request.destroy();
            for (const socket of sockets) socket.destroy();
          }
        },
      });
    } finally {
      // Close normally first; bound keep-alive/in-flight socket cleanup even after a failed test.
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          for (const request of requests) request.destroy();
          for (const socket of sockets) socket.destroy();
        }, 1000);
        server.close((error) => {
          clearTimeout(timer);
          if (error) reject(error);
          else resolve();
        });
        server.closeIdleConnections();
      });
    }
  },
});

async function observeAppearance(context: BrowserContext) {
  await context.addInitScript(() => {
    const state: Observation = {};
    (window as ObservedWindow).appearancePwaObservation = state;
    const sample = (): AppearanceSample => {
      const root = document.documentElement;
      return {
        appearance: root?.dataset.appearance,
        preference: root?.dataset.appearancePreference,
        colorScheme: root ? getComputedStyle(root).colorScheme : '',
        background: root ? getComputedStyle(root).backgroundColor : '',
        rootChildren: document.getElementById('root')?.childElementCount ?? 0,
      };
    };
    const mutations = new MutationObserver(() => {
      if (document.documentElement?.dataset.appearance) {
        state.firstResolved = sample();
        mutations.disconnect();
      }
    });
    mutations.observe(document, { subtree: true, attributes: true, childList: true });
    new PerformanceObserver((entries) => {
      if (entries.getEntries().some((entry) => entry.name === 'first-paint')) {
        state.firstPaint = sample();
      }
    }).observe({ type: 'paint', buffered: true });
  });
}

async function expectAppearance(
  page: Page,
  appearance: Appearance,
  preference: 'system' | Appearance,
) {
  await expect(page.locator('html')).toHaveAttribute('data-appearance', appearance);
  await expect(page.locator('html')).toHaveAttribute('data-appearance-preference', preference);
  const background = appearance === 'dark' ? 'rgb(9, 11, 14)' : 'rgb(255, 250, 240)';
  await expect(page.locator('html')).toHaveCSS('color-scheme', appearance);
  await expect(page.locator('html')).toHaveCSS('background-color', background);
  await expect
    .poll(() => page.evaluate(() => (window as ObservedWindow).appearancePwaObservation))
    .toMatchObject({
      firstResolved: {
        appearance,
        preference,
        colorScheme: appearance,
        background,
        rootChildren: 0,
      },
      firstPaint: { appearance, preference, colorScheme: appearance, background },
    });
}

async function setupDiary(page: Page) {
  expect(await page.evaluate(() => isSecureContext)).toBe(true);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByLabel('What do you want to do?').fill('Fictional compiled appearance habit');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  for (const name of ['Body', 'Nutrition', 'Hygiene']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Start my journey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state),
    )
    .toBe('activated');
  await page.reload();
  await ready(page);
}

async function ready(page: Page) {
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

async function chooseAppearance(page: Page, appearance: Appearance) {
  await nav(page, 'Settings').click();
  const group = page.getByRole('group', { name: 'Appearance', exact: true });
  const radio = group.getByRole('radio', {
    name: appearance === 'dark' ? 'Dark' : 'Light',
    exact: true,
  });
  await radio.locator('..').click();
  await expect(radio).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', appearance);
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(appearance);
}

async function shellPointer(page: Page, role: 'active' | 'installed') {
  try {
    return await page.evaluate(
      async ({ cachePrefix, appBase, role }) => {
        const metadata = await caches.open(`${cachePrefix}clients`);
        return (await metadata.match(`${appBase}__app_shell__/${role}`))?.text();
      },
      { cachePrefix, appBase, role },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      /Execution context was destroyed|Cannot find context with specified id/.test(error.message)
    )
      return undefined;
    throw error;
  }
}

function parseShell(source: string): CompiledShell {
  const encoded = source.match(/const CONFIG = (.+);/);
  if (!encoded) throw new Error('Expected an emitted production worker CONFIG');
  const shell = JSON.parse(encoded[1]) as CompiledShell;
  expect(shell.base).toBe(appBase);
  expect(shell.version).toMatch(/^[a-f0-9]{64}$/);
  expect(shell.files).toContain(`${appBase}index.html`);
  expect(shell.files.length).toBeGreaterThan(1);
  expect(Object.keys(shell.integrity).sort()).toEqual([...shell.files].sort());
  return shell;
}

async function signedBytes(page: Page, shell: CompiledShell) {
  const rows = await page.evaluate(async (shell) => {
    const rows = [];
    const cache = await caches.open(
      `my-goat-journey:${encodeURIComponent(shell.base)}:shell:${shell.version}`,
    );
    for (const path of shell.files) {
      // Plain fetch(index.html) is deliberately outside the navigation-only fallback.
      // Its exact bytes are checked in the verified cache AND against each real navigation.
      const response =
        path === `${shell.base}index.html`
          ? await cache.match(path)
          : await fetch(path, { cache: 'no-store' });
      if (!response) throw new Error(`Missing signed shell response: ${path}`);
      const digest = new Uint8Array(
        await crypto.subtle.digest('SHA-256', await response.arrayBuffer()),
      );
      rows.push({
        path,
        status: response.status,
        redirected: response.redirected,
        integrity: `sha256-${btoa(String.fromCharCode(...digest))}`,
        sha256: Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join(''),
      });
    }
    return rows;
  }, shell);
  expect(rows).toHaveLength(shell.files.length);
  for (const row of rows) {
    expect(row.status, row.path).toBe(200);
    expect(row.redirected, row.path).toBe(false);
    expect(row.integrity, row.path).toBe(shell.integrity[row.path]);
  }
  const cached = await shellSnapshot(page, `${cachePrefix}shell:${shell.version}`);
  expect(cached.map((row) => new URL(row.url).pathname).sort()).toEqual([...shell.files].sort());
  for (const row of cached) {
    const path = new URL(row.url).pathname;
    expect(row.status, path).toBe(200);
    expect(row.sha256, path).toBe(rows.find((entry) => entry.path === path)!.sha256);
  }
  return rows;
}

// Passive native-channel observation only: return the original objects/results and
// send no extra activation messages. The app still owns every decision and acknowledgement.
async function observeGuard(context: BrowserContext) {
  await context.addInitScript((key) => {
    const ports = new WeakMap<MessagePort, MessagePort>();
    const guarded = new WeakSet<MessagePort>();
    const append = (event: object) => {
      const log = JSON.parse(sessionStorage.getItem(key) ?? '[]');
      log.push(event);
      sessionStorage.setItem(key, JSON.stringify(log));
    };
    const NativeChannel = window.MessageChannel;
    window.MessageChannel = class extends NativeChannel {
      constructor() {
        super();
        ports.set(this.port2, this.port1);
        // Observe before the app installs its own onmessage/reload callback.
        this.port1.addEventListener('message', (event) => {
          if (guarded.has(this.port1)) {
            append({ event: 'ack', accepted: event.data?.accepted });
          }
        });
      }
    };
    const post = ServiceWorker.prototype.postMessage;
    ServiceWorker.prototype.postMessage = function (
      message: unknown,
      options?: Transferable[] | StructuredSerializeOptions,
    ) {
      if ((message as { type?: string })?.type === 'ACTIVATE_WHEN_ALONE') {
        append({ event: 'request', state: this.state });
        const transfer = Array.isArray(options) ? options : options?.transfer;
        const port = transfer?.[0];
        if (port instanceof MessagePort) {
          const observer = ports.get(port);
          if (observer) guarded.add(observer);
        }
      }
      return post.call(this, message, Array.isArray(options) ? { transfer: options } : options);
    };
  }, guardLogKey);
}

async function guardLog(page: Page) {
  return page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? '[]'), guardLogKey);
}

async function quietDraft(page: Page, identity: string, literal: string) {
  // Bounded settle for unsolicited reloads; installation itself uses explicit pointers/state.
  await page.waitForTimeout(250);
  expect(await documentIdentity(page)).toBe(identity);
  await expect(page.getByLabel('What do you want to do?')).toHaveValue(literal);
  await expect(
    page.getByRole('dialog', { name: 'Leave without saving?', exact: true }),
  ).toHaveCount(0);
  expect(await guardLog(page)).toEqual([]);
}

test('compiled first paint, signed bytes and retained overrides survive fresh offline documents', async ({
  browser,
  request,
  app,
}, testInfo) => {
  const htmlResponse = await request.get(app.url);
  expect(htmlResponse.status()).toBe(200);
  const html = await htmlResponse.text();
  expect(html).not.toContain('/@vite/client');
  expect(html).not.toContain('/src/main.tsx');
  const workerResponse = await request.get(`${app.url}sw.js`);
  expect(workerResponse.status()).toBe(200);
  const shell = parseShell(await workerResponse.text());
  const entry = [...html.matchAll(/<script\b[^>]*>/g)]
    .find(([tag]) => /type="module"/.test(tag))?.[0]
    .match(/src="([^"]+)"/)?.[1];
  expect(entry, 'Compiled module entry must exist').toBeTruthy();
  const evidence = [];
  for (const system of ['light', 'dark'] as const) {
    const context = await browser.newContext({
      colorScheme: system,
      timezoneId: 'UTC',
      viewport: { width: 390, height: 844 },
      serviceWorkers: 'allow',
    });
    await observeAppearance(context);
    try {
      const page = await context.newPage();
      await page.clock.setFixedTime(instant);
      let release = () => {};
      let entryHeld = false;
      let entryContinued: Promise<void> | undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(new URL(entry!, app.url).href, async (route) => {
        entryHeld = true;
        entryContinued = held.then(() => route.continue());
        await entryContinued;
      });
      try {
        await page.goto(app.url, { waitUntil: 'commit' });
        await expect.poll(() => entryHeld).toBe(true);
        // A network-blocked real compiled entry cannot initialize React or register a worker.
        await expectAppearance(page, system, 'system');
        await expect(page.locator('#root')).toBeEmpty();
        expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBeNull();
        expect(
          await page.evaluate(async () => navigator.serviceWorker.getRegistration()),
        ).toBeUndefined();
        // Do not screenshot while a module response is intentionally held: Playwright
        // waits for document fonts/load, which cannot settle until that response is released.
      } finally {
        release();
        await entryContinued;
        await page.unroute(new URL(entry!, app.url).href);
      }
      await setupDiary(page);
      const saved = await readDataset(page);
      const override: Appearance = system === 'light' ? 'dark' : 'light';
      await chooseAppearance(page, override);
      expect(await readDataset(page)).toEqual(saved);
      await page.reload();
      await ready(page);
      await expectAppearance(page, override, override);
      expect(await readDataset(page)).toEqual(saved);
      const online = await signedBytes(page, shell);
      const oldDocument = await documentIdentity(page);
      await page.close();
      app.network(false);
      // Independently prove the origin cannot reach upstream; browser offline is separate.
      await expect(
        request.get(`${app.url}__appearance_network_probe__.txt`, { timeout: 3000 }),
      ).rejects.toThrow();
      await context.setOffline(true);
      const reopened = await context.newPage();
      await reopened.clock.setFixedTime(instant);
      const response = await reopened.goto(app.url);
      expect(response?.fromServiceWorker()).toBe(true);
      expect(await response!.text()).toBe(html);
      await ready(reopened);
      expect(await documentIdentity(reopened)).not.toBe(oldDocument);
      await expectAppearance(reopened, override, override);
      expect(await readDataset(reopened)).toEqual(saved); // includes the exact revision
      const offline = await signedBytes(reopened, shell);
      expect(offline).toEqual(online);
      await nav(reopened, 'Settings').click();
      await expect(
        reopened.getByRole('radio', {
          name: override === 'dark' ? 'Dark' : 'Light',
          exact: true,
        }),
      ).toBeChecked();
      await reopened.screenshot({
        path: testInfo.outputPath(`fresh-offline-${override}.png`),
        fullPage: true,
      });
      evidence.push({ system, override, version: shell.version, online, offline, saved });
    } finally {
      await context.close();
      app.network(true);
    }
  }
  await writeFile(
    testInfo.outputPath('compiled-offline-evidence.json'),
    JSON.stringify(evidence, null, 2),
  );
});

test('native B-to-C guarded adoption preserves dirty literal, exact diary and dark offline reopening', async ({
  browser,
  request,
  app,
}, testInfo) => {
  const bWorker = await request.get(`${app.url}sw.js`);
  expect(bWorker.status()).toBe(200);
  const b = parseShell(await bWorker.text());
  const bHtml = await (await request.get(app.url)).text();
  const context = await browser.newContext({
    colorScheme: 'light',
    timezoneId: 'UTC',
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'allow',
  });
  await observeAppearance(context);
  await observeGuard(context);
  try {
    const page = await context.newPage();
    await page.clock.setFixedTime(instant);
    await page.goto(app.url);
    await setupDiary(page);
    await chooseAppearance(page, 'dark');
    await nav(page, 'Today').click();
    const saved = await readDataset(page);
    expect(await shellPointer(page, 'active')).toBe(b.version);
    await signedBytes(page, b);
    await page.getByRole('button', { name: 'Add habit', exact: true }).click();
    const literal = '  Fictional unsaved "night" draft 🎵 ${keep}  ';
    await page.getByLabel('What do you want to do?').fill(literal);
    const identity = await documentIdentity(page);
    app.switchTo(candidate);
    const cWorker = await request.get(`${app.url}sw.js`);
    expect(cWorker.status()).toBe(200);
    const c = parseShell(await cWorker.text());
    const cHtmlResponse = await request.get(app.url);
    expect(cHtmlResponse.status()).toBe(200);
    const cHtml = await cHtmlResponse.text();
    expect(c.version).not.toBe(b.version);
    expect(c.files).toEqual(b.files);
    for (const path of c.files.filter((path) => path !== `${appBase}index.html`)) {
      expect(c.integrity[path], `C must be HTML-comment-only: ${path}`).toBe(b.integrity[path]);
    }
    expect(c.integrity[`${appBase}index.html`]).not.toBe(b.integrity[`${appBase}index.html`]);
    expect(cHtml.replace(/<!--[\s\S]*?-->/g, '')).toBe(bHtml.replace(/<!--[\s\S]*?-->/g, ''));
    const addedComments = [...cHtml.matchAll(/<!--([\s\S]*?)-->/g)]
      .map((match) => match[1])
      .filter((comment) => !bHtml.includes(`<!--${comment}-->`));
    expect(addedComments, 'C needs one distinguishable pre-signing HTML comment').toHaveLength(1);
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) throw new Error('Missing incumbent registration');
      await registration.update();
    });
    await expect.poll(() => shellPointer(page, 'installed')).toBe(c.version);
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state,
        ),
      )
      .toBe('installed');
    await resume(page); // Native dirty hidden-to-visible transition must not adopt.
    await quietDraft(page, identity, literal);
    expect(await shellPointer(page, 'active')).toBe(b.version);
    expect(await readDataset(page)).toEqual(saved);
    await page.screenshot({
      path: testInfo.outputPath('pending-c-dirty-dark.png'),
      fullPage: true,
    });
    await nav(page, 'Today').click();
    const dialog = page.getByRole('dialog', { name: 'Leave without saving?', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await quietDraft(page, identity, literal);
    expect(await readDataset(page)).toEqual(saved);
    await nav(page, 'Today').click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await page.waitForTimeout(250);
    expect(await documentIdentity(page)).toBe(identity); // Becoming clean is not permission.
    expect(await guardLog(page)).toEqual([]);
    expect(await readDataset(page)).toEqual(saved);
    const navigations: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations.push(frame.url());
    });
    const adoptedResponse = page.waitForResponse(
      (response) =>
        response.request().isNavigationRequest() && response.frame() === page.mainFrame(),
    );
    await resume(page); // Later clean native resume authorizes the real guarded protocol.
    const response = await adoptedResponse;
    expect(response.fromServiceWorker()).toBe(true);
    expect(await response.text()).toBe(cHtml);
    await ready(page);
    await expect.poll(() => shellPointer(page, 'active')).toBe(c.version);
    expect(
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return {
          active: registration?.active?.state,
          controlledByActive: navigator.serviceWorker.controller === registration?.active,
          waiting: !!registration?.waiting,
        };
      }),
    ).toEqual({ active: 'activated', controlledByActive: true, waiting: false });
    expect(await documentIdentity(page)).not.toBe(identity);
    expect(await documentHtml(page)).toContain(addedComments[0]);
    await expectAppearance(page, 'dark', 'dark');
    expect(await readDataset(page)).toEqual(saved);
    await expect
      .poll(() => guardLog(page))
      .toEqual([
        { event: 'request', state: 'installed' },
        { event: 'ack', accepted: true },
      ]);
    const online = await signedBytes(page, c);
    await page.waitForTimeout(300);
    expect(navigations).toEqual([app.url]);
    expect(await guardLog(page)).toHaveLength(2);
    await page.screenshot({ path: testInfo.outputPath('adopted-c-dark.png'), fullPage: true });
    await page.close();
    app.network(false);
    await expect(
      request.get(`${app.url}__appearance_network_probe__.txt`, { timeout: 3000 }),
    ).rejects.toThrow();
    await context.setOffline(true);
    const reopened = await context.newPage();
    await reopened.clock.setFixedTime(instant);
    const offlineResponse = await reopened.goto(app.url);
    expect(offlineResponse?.fromServiceWorker()).toBe(true);
    expect(await offlineResponse!.text()).toBe(cHtml);
    await ready(reopened);
    await expectAppearance(reopened, 'dark', 'dark');
    expect(await readDataset(reopened)).toEqual(saved);
    const offline = await signedBytes(reopened, c);
    expect(offline).toEqual(online);
    await nav(reopened, 'Settings').click();
    await expect(reopened.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
    await reopened.screenshot({
      path: testInfo.outputPath('adopted-c-fresh-offline-dark.png'),
      fullPage: true,
    });
    await writeFile(
      testInfo.outputPath('native-update-evidence.json'),
      JSON.stringify(
        {
          b: b.version,
          c: c.version,
          addedComments,
          navigations,
          online,
          offline,
          saved,
        },
        null,
        2,
      ),
    );
  } finally {
    await context.close();
    app.network(true);
  }
});
