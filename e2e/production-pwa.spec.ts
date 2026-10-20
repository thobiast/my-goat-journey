import { test, expect, chromium, type Page } from '@playwright/test';
import { createServer, request as upstreamRequest, type Server } from 'node:http';
import { readFile, mkdir, mkdtemp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolveSite } from '../config/site.mjs';
import type { Dataset } from '../src/domain/types';
import { nav, readDataset, abortNextWrite } from './support/habit-fixtures';
import en from '../src/i18n/en.json' with { type: 'json' };
import pt from '../src/i18n/pt.json' with { type: 'json' };
import { instrumentPendingAssignmentRace } from './support/pending-assignment-race';
import {
  holdNextCommit,
  releaseCommit,
  commitHeld,
  documentIdentity,
  documentHtml,
  unchangedDocument,
  background,
  resume,
  shellSnapshot,
  workerMessage,
  forceTestActivation,
  instrumentCompiledWorker,
} from './support/pwa-update';

test.use({ channel: 'chromium' });
const evidence = process.env.PRODUCTION_PWA_EVIDENCE ?? 'artifacts/production-pwa';
// Browser-container loopback proxy: actual non-root compiled nginx A/B/C,
// no host port, origin migration, disabled security or normal-user dataset.
const { prefix, appBase } = resolveSite();
const requestOrigin = 'http://127.0.0.1:4185';
// Existing fixture paths append /path; directory entry must append / as well.
const origin = requestOrigin + appBase.slice(0, -1);
const cachePrefix = `my-goat-journey:${encodeURIComponent(appBase)}:`;
const metadataCache = `${cachePrefix}clients`;
const shellLifecycleLock = `${cachePrefix}shell-lifecycle`;
// A real in-scope document, outside extensionless navigation fallback and signed assets.
const unknownPeerPath = `${appBase}__pwa_test_unknown_peer__.html`;
const unknownPeerTitle = 'Unknown disposable PWA peer';
let unknownPeerRequests = 0;
const first = 'my-goat-journey-runtime';
const next = 'my-goat-journey-pwa-update-next';
const third = 'my-goat-journey-pwa-update-later';
let target = first;
let networkAvailable = true;
let failInstallAsset = false;
let blockedAssetRequests = 0;
let instrumentWorkers = false;
let holdRollbackCache = false;
let pendingAssignmentRace = false;
let proxy: Server;

test.beforeAll(async () => {
  proxy = createServer((incoming, outgoing) => {
    if (!networkAvailable) {
      outgoing.destroy();
      return;
    }
    if (incoming.url?.split('?')[0] === unknownPeerPath) {
      ++unknownPeerRequests;
      outgoing.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      outgoing.end(
        `<!doctype html><title>${unknownPeerTitle}</title><main id="pwa-test-unknown-peer">Synthetic peer without application initialization</main>`,
      );
      return;
    }
    if (failInstallAsset && incoming.url?.split('?')[0] === `${appBase}icons/favicon-16-v1.png`) {
      ++blockedAssetRequests;
      outgoing.writeHead(503);
      outgoing.end('Isolated interrupted installation');
      return;
    }
    const upstream = upstreamRequest(
      {
        hostname: target,
        port: 8080,
        path: incoming.url,
        method: incoming.method,
        headers: { ...incoming.headers, host: `${target}:8080` },
      },
      (response) => {
        if (instrumentWorkers && incoming.url?.split('?')[0] === `${appBase}sw.js`) {
          const chunks: Buffer[] = [];
          response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          response.on('end', () => {
            try {
              let body = instrumentCompiledWorker(
                Buffer.concat(chunks).toString(),
                holdRollbackCache,
              );
              if (pendingAssignmentRace)
                body = instrumentPendingAssignmentRace(
                  body,
                  process.env.PWA_UNSAFE_PROMOTION_MUTATION === '1',
                );
              const headers = { ...response.headers };
              delete headers['content-length'];
              delete headers.etag;
              delete headers['last-modified'];
              outgoing.writeHead(response.statusCode ?? 502, headers);
              outgoing.end(body);
            } catch (error) {
              outgoing.writeHead(500);
              outgoing.end(String(error));
            }
          });
        } else {
          outgoing.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(outgoing);
        }
      },
    );
    upstream.on('error', () => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end('Production target unavailable');
    });
    incoming.pipe(upstream);
  });
  await new Promise<void>((resolve) => proxy.listen(4185, '127.0.0.1', resolve));
  await mkdir(`${evidence}/screenshots`, { recursive: true });
});
test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    proxy.close((error) => (error ? reject(error) : resolve())),
  );
});
test.beforeEach(async ({}, testInfo) => {
  test.skip(
    !testInfo.config.metadata.productionPwa,
    'Use playwright.production-pwa.config.ts with fresh compiled A/B/C fixtures.',
  );
  target = first;
  networkAvailable = true;
  failInstallAsset = false;
  blockedAssetRequests = 0;
  instrumentWorkers = false;
  holdRollbackCache = false;
  pendingAssignmentRace = false;
  unknownPeerRequests = 0;
});

const update = (page: Page, language: 'en' | 'pt' = 'en') =>
  page.getByRole('button', { name: language === 'en' ? 'Update' : 'Atualizar', exact: true });

async function controlled(page: Page) {
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker?.controller)).toBe(true);
}

async function pointer(page: Page, name: 'active' | 'installed') {
  try {
    return await page.evaluate(
      async ({ name, metadataCache, appBase }) => {
        const cache = await caches.open(metadataCache);
        return (await cache.match(`${appBase}__app_shell__/${name}`))?.text();
      },
      { name, metadataCache, appBase },
    );
  } catch (error) {
    // The poll can cross the exact accepted reload it is verifying.
    if (
      error instanceof Error &&
      /Execution context was destroyed|Cannot find context with specified id/.test(error.message)
    )
      return undefined;
    throw error;
  }
}

async function shellKeys(page: Page) {
  return page.evaluate(
    async (cachePrefix) =>
      (await caches.keys()).filter(
        (key) => key.startsWith(`${cachePrefix}shell:`) && /:shell:[a-f0-9]{64}$/.test(key),
      ),
    cachePrefix,
  );
}

async function setup(
  page: Page,
  language: 'en' | 'pt' = 'en',
  reloadFirst = true,
  stopEntry = true,
) {
  await page.goto(`${origin}/`);
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
  if (language === 'pt') await page.getByLabel('Language', { exact: true }).selectOption('pt');
  await page
    .getByRole('button', { name: language === 'en' ? 'Start' : 'Começar', exact: true })
    .click();
  await page
    .getByLabel(language === 'en' ? 'What do you want to do?' : 'O que você quer fazer?')
    .fill('Offline real-world habit');
  await page
    .getByRole('button', { name: language === 'en' ? 'Continue' : 'Continuar', exact: true })
    .click();
  for (const name of language === 'en'
    ? ['Body', 'Nutrition', 'Hygiene']
    : ['Corpo', 'Alimentação', 'Higiene']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await page
      .getByRole('button', {
        name: language === 'en' ? 'Skip for now' : 'Pular por enquanto',
        exact: true,
      })
      .click();
  }
  await page
    .getByRole('button', {
      name: language === 'en' ? 'Start my journey' : 'Começar minha jornada',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('heading', { name: language === 'en' ? 'Today' : 'Hoje', exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state),
    )
    .toBe('activated');
  // An interacted first installation is neither claimed nor unconditionally reloaded.
  if (reloadFirst) {
    await page.reload();
    await controlled(page);
  }
  if (stopEntry) await page.keyboard.press('Tab'); // A later install must remain quiet in this interacted session.
}

async function switchBuild(page: Page, build = next, mayActivate = false) {
  const before = await pointer(page, 'installed');
  target = build;
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())!.update();
  });
  await expect.poll(() => pointer(page, 'installed')).not.toBe(before);
  await expect
    .poll(() =>
      page.evaluate(async (mayActivate) => {
        const registration = await navigator.serviceWorker.getRegistration();
        return (
          !!registration?.waiting ||
          (mayActivate &&
            registration?.active?.state === 'activated' &&
            registration.active !== navigator.serviceWorker.controller)
        );
      }, mayActivate),
    )
    .toBe(true);
  return (await pointer(page, 'installed'))!;
}

async function applied(page: Page, version: string, language: 'en' | 'pt' = 'en') {
  await expect.poll(() => pointer(page, 'active')).toBe(version);
  await expect(
    page.getByRole('heading', { name: language === 'en' ? 'Today' : 'Hoje', exact: true }),
  ).toBeVisible();
  await controlled(page);
}

async function acceptSettings(page: Page, version: string, language: 'en' | 'pt' = 'en') {
  await nav(page, language === 'en' ? 'Settings' : 'Ajustes').click();
  await expect(update(page, language)).toBeEnabled();
  const reload = page.waitForEvent('load');
  await update(page, language).click();
  await reload;
  await applied(page, version, language);
}

async function safeResume(page: Page, version: string, language: 'en' | 'pt' = 'en') {
  const identity = await documentIdentity(page);
  await resume(page);
  await expect
    .poll(async () => {
      try {
        return (await documentIdentity(page)) !== identity;
      } catch (error) {
        // The accepted reload can destroy the sampled execution context. It is
        // still pending, not proof of a new document; require its actual identity.
        if (
          error instanceof Error &&
          /Execution context was destroyed|Cannot find context with specified id/.test(
            error.message,
          )
        )
          return false;
        throw error;
      }
    })
    .toBe(true);
  await applied(page, version, language);
}

async function quiet(page: Page, identity: string) {
  // Let a bounded local activation/message turn settle; not an installation barrier.
  await page.waitForTimeout(250);
  await unchangedDocument(page, identity);
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function backup(page: Page) {
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup', exact: true }).click();
  return readFile((await (await downloaded).path())!);
}

async function holdParse(page: Page) {
  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = function () {
      File.prototype.text = original;
      return new Promise<string>((resolve, reject) => {
        (
          window as typeof window & { pwaTestParseRelease?: () => void; pwaTestParseHeld?: boolean }
        ).pwaTestParseHeld = true;
        (window as typeof window & { pwaTestParseRelease?: () => void }).pwaTestParseRelease =
          () => {
            original.call(this).then(resolve, reject);
          };
      });
    };
  });
}

test('offline reload, writes, destinations, XP and native backup survive reopening', async ({
  page,
  context,
}) => {
  await setup(page);
  networkAvailable = false;
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await page.getByRole('checkbox').first().click();
  await expect(page.getByRole('checkbox').first()).toBeChecked();
  for (const name of ['Pillars', 'Journey', 'Progress', 'Settings', 'Today'])
    await nav(page, name).click();
  await page.getByRole('button', { name: 'Add habit', exact: true }).click();
  await page.getByLabel('What do you want to do?').fill('Created while offline');
  await page.getByRole('button', { name: 'Save habit', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  const saved = await readDataset(page);
  expect(saved.habits).toHaveLength(2);
  expect(saved.occurrences.filter((row) => row.done)).toHaveLength(1);
  await nav(page, 'Journey').click();
  await expect(page.getByText('10 XP', { exact: true })).toBeVisible();
  await nav(page, 'Settings').click();
  const bytes = await backup(page);
  expect(JSON.parse(bytes.toString()).dataset.habits).toHaveLength(2);
  await page
    .getByLabel('Choose backup file', { exact: true })
    .setInputFiles({ name: 'offline.json', mimeType: 'application/json', buffer: bytes });
  await expect(page.getByText('Backup ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Replace current data', exact: true }).click();
  await expect(page.getByText('Backup restored.', { exact: true })).toBeVisible();
  const restored = await readDataset(page);
  expect(restored.habits).toEqual(saved.habits);
  expect(restored.occurrences).toEqual(saved.occurrences);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(`${origin}/progress`);
  await expect(reopened.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  expect(await readDataset(reopened)).toEqual(restored);
  await nav(reopened, 'Journey').click();
  await expect(reopened.getByText('10 XP', { exact: true })).toBeVisible();
  await noOverflow(reopened);
  await reopened.screenshot({
    path: `${evidence}/screenshots/offline-journey-en-360.png`,
    fullPage: true,
  });
});

for (const language of ['en', 'pt'] as const)
  test(`clean new document automatically applies compiled B once before interaction (${language})`, async ({
    page,
    context,
  }, testInfo) => {
    instrumentWorkers = true;
    await setup(page, language);
    await nav(page, language === 'en' ? 'Settings' : 'Ajustes').click();
    await page
      .getByLabel(language === 'en' ? 'Reduce motion' : 'Reduzir movimento', { exact: true })
      .click();
    await expect(
      page.getByLabel(language === 'en' ? 'Reduce motion' : 'Reduzir movimento', { exact: true }),
    ).toBeChecked();
    await nav(page, language === 'en' ? 'Progress' : 'Progresso').click();
    await page.getByRole('button', { name: '1m', exact: true }).click();
    await expect(page.getByRole('button', { name: '1m', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const saved = await readDataset(page);
    const identity = await documentIdentity(page);
    const version = await switchBuild(page);
    await quiet(page, identity); // download is quiet after interaction
    // Observe actual documents and activation requests across reloads. A last-client
    // reload may naturally activate B before serving the first navigation; only an
    // A document needs a guarded, exactly-once second navigation.
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'entry-activation-requests',
        sessionStorage.getItem('entry-activation-requests') ?? '0',
      );
      const original = ServiceWorker.prototype.postMessage;
      ServiceWorker.prototype.postMessage = function (
        message: unknown,
        transferOrOptions?: Transferable[] | StructuredSerializeOptions,
      ) {
        if ((message as { type?: string })?.type === 'ACTIVATE_WHEN_ALONE')
          sessionStorage.setItem(
            'entry-activation-requests',
            String(Number(sessionStorage.getItem('entry-activation-requests')) + 1),
          );
        return original.call(
          this,
          message,
          Array.isArray(transferOrOptions) ? { transfer: transferOrOptions } : transferOrOptions,
        );
      };
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          const comments: string[] = [];
          const walker = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
          while (walker.nextNode()) comments.push(walker.currentNode.textContent ?? '');
          const documents = JSON.parse(sessionStorage.getItem('entry-documents') ?? '[]');
          documents.push({ comments, url: location.href });
          sessionStorage.setItem('entry-documents', JSON.stringify(documents));
        },
        { once: true },
      );
    });
    let documents = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) ++documents;
    });
    await page.reload();
    await applied(page, version, language);
    // Retain this historical literal for compatibility with existing compiled fixtures.
    const marker = 'Stage5A isolated Automatic update B; no app behavior change.';
    await expect.poll(async () => (await documentHtml(page)).includes(marker)).toBe(true);
    const entry = await page.evaluate(() => ({
      documents: JSON.parse(sessionStorage.getItem('entry-documents') ?? '[]') as {
        comments: string[];
        url: string;
      }[],
      requests: Number(sessionStorage.getItem('entry-activation-requests')),
    }));
    expect(entry.documents.length).toBeGreaterThanOrEqual(1);
    expect(entry.documents.length).toBeLessThanOrEqual(2);
    expect(documents).toBe(entry.documents.length);
    expect(entry.documents.at(-1)!.comments.some((comment) => comment.includes(marker))).toBe(true);
    if (entry.documents.length === 2)
      expect(entry.documents[0].comments.some((comment) => comment.includes(marker))).toBe(false);
    expect(
      entry.documents.filter((document) =>
        document.comments.some((comment) => comment.includes(marker)),
      ),
    ).toHaveLength(1); // exactly one B document
    expect(entry.requests).toBeLessThanOrEqual(1); // no repeated activation attempts, including already-controller races
    const worker = await workerMessage(page, 'active', 'PWA_TEST_STATUS');
    expect(worker.version).toBe(version);
    expect(worker.clients).toHaveLength(1);
    expect(worker.clients[0].url).toBe(page.url());
    const assignment = await page.evaluate(
      async ({ id, metadataCache, appBase }) =>
        (
          await (
            await caches.open(metadataCache)
          ).match(`${appBase}__app_shell__/client/${encodeURIComponent(id)}`)
        )?.text(),
      { id: worker.clients[0].id, metadataCache, appBase },
    );
    expect(assignment).toBe(version);
    expect(
      await page.evaluate(async (appBase) => {
        const registration = (await navigator.serviceWorker.getRegistration())!;
        return (
          !registration.waiting &&
          !registration.installing &&
          navigator.serviceWorker.controller === registration.active &&
          registration.active?.state === 'activated' &&
          registration.active.scriptURL === new URL(`${appBase}sw.js`, location.origin).href
        );
      }, appBase),
    ).toBe(true);
    expect(await readDataset(page)).toEqual(saved);
    await page.waitForTimeout(1000);
    expect(documents).toBe(entry.documents.length);
    expect(
      await page.evaluate(() => Number(sessionStorage.getItem('entry-activation-requests'))),
    ).toBe(entry.requests);
    await testInfo.attach('bounded-clean-entry', {
      body: JSON.stringify({ version, entry, assignment, worker }, null, 2),
      contentType: 'application/json',
    });
    networkAvailable = false;
    await context.setOffline(true);
    await page.reload();
    await applied(page, version, language);
    expect((await documentHtml(page)).includes(marker)).toBe(true);
    expect(await readDataset(page)).toEqual(saved);
  });

for (const language of ['en', 'pt'] as const)
  test(`Settings manual feedback current/offline/network failure/checking held install/awaiting uses real compiled worker (${language})`, async ({
    page,
    context,
  }, testInfo) => {
    instrumentWorkers = true;
    await setup(page, language);
    const copy = language === 'en' ? en : pt;
    await nav(page, copy.settingsNav).click();
    const saved = await readDataset(page);
    const identity = await documentIdentity(page);
    const original = await pointer(page, 'active');
    const check = page.getByRole('button', { name: copy.updateCheck, exact: true });
    const feedback = page.locator('.settings-update').getByRole('status');
    // Let the initial/background check settle before starting explicit feedback.
    await expect(check).toBeEnabled();
    await check.click();
    await expect(feedback).toHaveText(copy.updateCurrent);
    await expect(update(page, language)).toHaveCount(0);
    await quiet(page, identity);
    await context.setOffline(true);
    await check.click();
    await expect(feedback).toHaveText(copy.updateOffline);
    await quiet(page, identity);
    networkAvailable = false;
    await context.setOffline(false);
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    await check.click();
    await expect(feedback).toHaveText(copy.updateCheckFailed);
    await expect(check).toBeEnabled();
    await quiet(page, identity);
    networkAvailable = true;
    target = next;
    holdRollbackCache = true;
    await check.click();
    await expect
      .poll(async () => {
        try {
          return (await workerMessage(page, 'installing', 'PWA_TEST_STATUS')).opened;
        } catch {
          return false;
        }
      })
      .toBe(true);
    await expect(feedback).toHaveText(copy.updateChecking);
    await expect(
      page.getByRole('button', { name: copy.updateChecking, exact: true }),
    ).toBeDisabled();
    await expect(update(page, language)).toHaveCount(0);
    expect(await pointer(page, 'installed')).toBe(original);
    await quiet(page, identity);
    await expect(feedback).toHaveText(copy.updateChecking);
    await workerMessage(page, 'installing', 'PWA_TEST_RELEASE_CACHE_OPEN');
    await expect(feedback).toHaveText(copy.updateAwaitingSafe);
    await expect(check).toBeEnabled();
    await expect(update(page, language)).toBeEnabled();
    const candidate = await pointer(page, 'installed');
    expect(candidate).not.toBe(original);
    expect(await pointer(page, 'active')).toBe(original);
    await quiet(page, identity);
    expect(await readDataset(page)).toEqual(saved);
    await testInfo.attach('localized-manual-feedback', {
      body: JSON.stringify({
        language,
        original,
        candidate,
        states: ['current', 'offline', 'network-failure', 'checking-held-install', 'awaiting'],
      }),
      contentType: 'application/json',
    });
  });

for (const interaction of ['pointer', 'keyboard', 'input', 'change'] as const)
  test(`trusted ${interaction} ends entry eligibility; safe hidden-visible resume retries`, async ({
    page,
  }) => {
    await setup(page, 'en', true, false);
    // Each is a genuine Playwright/browser input, not dispatchEvent with isTrusted=false.
    if (interaction === 'pointer') await nav(page, 'Journey').click();
    if (interaction === 'keyboard') await page.keyboard.press('Tab');
    if (interaction === 'input') {
      await page.getByRole('button', { name: 'Add habit', exact: true }).click();
      await page.getByLabel('What do you want to do?').fill('Temporary');
      await page.getByLabel('What do you want to do?').fill('');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    if (interaction === 'change') {
      await nav(page, 'Settings').click();
      await page.getByLabel('Reduce motion', { exact: true }).click();
      await expect(page.getByLabel('Reduce motion', { exact: true })).toBeChecked();
    }
    const identity = await documentIdentity(page);
    const saved = await readDataset(page);
    const version = await switchBuild(page);
    await quiet(page, identity);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('pageshow'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await quiet(page, identity); // focus/pageshow/visible→visible are not resume authorization
    await safeResume(page, version);
    expect(await readDataset(page)).toEqual(saved);
  });

for (const form of ['habit', 'pillar'] as const)
  for (const outcome of ['saved', 'discarded', 'failed-save'] as const)
    test(`automatic resume protects dirty ${form}: ${outcome}`, async ({ page }) => {
      await setup(page);
      const before = await readDataset(page);
      if (form === 'habit')
        await page.getByRole('button', { name: 'Add habit', exact: true }).click();
      else {
        await nav(page, 'Pillars').click();
        await page.getByRole('button', { name: 'New pillar', exact: true }).click();
      }
      const field = page.getByRole('textbox');
      const literal = `${form} retained literal 🎵`;
      await field.fill(literal);
      const identity = await documentIdentity(page);
      const version = await switchBuild(page);
      await resume(page);
      await quiet(page, identity);
      await expect(field).toHaveValue(literal);
      expect(await readDataset(page)).toEqual(before);
      if (outcome === 'discarded') {
        await nav(page, 'Today').click();
        await expect(
          page.getByRole('dialog', { name: 'Leave without saving?', exact: true }),
        ).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(field).toHaveValue(literal);
        await nav(page, 'Today').click();
        await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
        await expect(field).toHaveValue(literal);
        await nav(page, 'Today').click();
        await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
      } else {
        if (outcome === 'failed-save') await abortNextWrite(page);
        await page
          .getByRole('button', {
            name: form === 'habit' ? 'Save habit' : 'Save pillar',
            exact: true,
          })
          .click();
        if (outcome === 'failed-save') {
          await expect(page.getByRole('alert')).toContainText(en.saveError);
          await resume(page);
          await quiet(page, identity);
          await expect(field).toHaveValue(literal);
          expect(await readDataset(page)).toEqual(before);
          await page.getByRole('button', { name: 'Retry', exact: true }).click();
        }
        await expect(field).toHaveCount(0);
      }
      const saved = await readDataset(page);
      if (outcome === 'discarded') expect(saved).toEqual(before);
      else if (form === 'habit') expect(saved.habits.at(-1)!.versions.at(-1)!.goal).toBe(literal);
      else expect(saved.pillars.at(-1)!.name).toBe(literal);
      await quiet(page, identity); // becoming clean alone is not another entry boundary
      await safeResume(page, version);
      expect(await readDataset(page)).toEqual(saved);
    });

for (const peerKind of ['editing', 'frozen', 'unknown'] as const)
  test(`any ${peerKind} in-scope peer defers automatic and manual activation until it closes`, async ({
    page,
    context,
  }, testInfo) => {
    instrumentWorkers = true;
    await setup(page);
    await nav(page, 'Settings').click();
    const saved = await readDataset(page);
    const original = await pointer(page, 'active');
    const peer = await context.newPage();
    const peerUrl = peerKind === 'unknown' ? requestOrigin + unknownPeerPath : `${origin}/`;
    const peerResponse = await peer.goto(peerUrl);
    if (peerKind === 'unknown') {
      // Establish the fixture's identity BEFORE any activation-denial assertion.
      expect(peerResponse?.status()).toBe(200);
      expect(peerResponse?.fromServiceWorker()).toBe(false);
      expect(peer.url()).toBe(peerUrl);
      await expect(peer).toHaveTitle(unknownPeerTitle);
      await expect(peer.locator('#pwa-test-unknown-peer')).toHaveText(
        'Synthetic peer without application initialization',
      );
      await expect(peer.locator('#root, script')).toHaveCount(0);
      expect(unknownPeerRequests).toBe(1);
    }
    if (peerKind === 'editing') {
      await peer.getByRole('button', { name: 'Add habit', exact: true }).click();
      await peer.getByLabel('What do you want to do?').fill('Peer must retain literal');
    }
    const cdp = await context.newCDPSession(peer);
    if (peerKind === 'frozen') await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
    await page.bringToFront();
    const identity = await documentIdentity(page);
    const version = await switchBuild(page);
    const status = await workerMessage(page, 'waiting', 'PWA_TEST_STATUS');
    expect(status.clients).toHaveLength(2);
    expect(status.clients.map((client: { url: string }) => client.url).sort()).toEqual(
      [page.url(), peerUrl].sort(),
    );
    expect(new Set(status.clients.map((client: { id: string }) => client.id)).size).toBe(2);
    if (peerKind === 'unknown') {
      const peerId = status.clients.find((client: { url: string }) => client.url === peerUrl)!.id;
      const assignment = await page.evaluate(
        async ({ peerId, metadataCache, appBase }) =>
          (
            await (
              await caches.open(metadataCache)
            ).match(`${appBase}__app_shell__/client/${encodeURIComponent(peerId)}`)
          )?.text(),
        { peerId, metadataCache, appBase },
      );
      expect(assignment).toBeUndefined(); // Not an initialized app with a shell assignment.
    }
    await testInfo.attach('verified-peer-before-denial', {
      body: JSON.stringify({ peerKind, peerUrl, unknownPeerRequests, status }, null, 2),
      contentType: 'application/json',
    });
    // The obsolete protocol must not force native activation around these peers.
    await page.evaluate(async () => {
      (await navigator.serviceWorker.getRegistration())!.waiting!.postMessage({
        type: 'SKIP_WAITING',
      });
    });
    const result = await workerMessage(page, 'waiting', 'ACTIVATE_WHEN_ALONE');
    expect(result).toEqual({ accepted: false });
    await resume(page);
    await quiet(page, identity);
    await expect(update(page)).toBeEnabled();
    await update(page).click();
    await quiet(page, identity);
    expect(await pointer(page, 'active')).toBe(original);
    expect(await readDataset(page)).toEqual(saved);
    if (peerKind === 'editing')
      await expect(peer.getByLabel('What do you want to do?')).toHaveValue(
        'Peer must retain literal',
      );
    if (peerKind === 'frozen') await cdp.send('Page.setWebLifecycleState', { state: 'active' });
    await peer.close();
    await safeResume(page, version);
    expect(await readDataset(page)).toEqual(saved);
  });

test('sole-client manual fallback works from an initially uncontrolled interacted first tab', async ({
  page,
}) => {
  await setup(page, 'en', false);
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
  const saved = await readDataset(page);
  const version = await switchBuild(page, next, true);
  await acceptSettings(page, version);
  expect(await readDataset(page)).toEqual(saved);
});

for (const language of ['en', 'pt'] as const)
  test(`Settings optional check is quiet and pending fallback preserves diary (${language})`, async ({
    page,
    context,
  }) => {
    await setup(page, language);
    await nav(page, language === 'en' ? 'Settings' : 'Ajustes').click();
    const saved = await readDataset(page);
    const identity = await documentIdentity(page);
    const version = await switchBuild(page);
    await page
      .getByRole('button', {
        name: language === 'en' ? 'Check for updates' : 'Verificar atualizações',
        exact: true,
      })
      .click();
    await quiet(page, identity);
    await expect(
      page.getByRole('button', { name: language === 'en' ? 'Later' : 'Depois', exact: true }),
    ).toHaveCount(0);
    await expect(update(page, language)).toBeEnabled();
    await noOverflow(page);
    await page.screenshot({
      path: `${evidence}/screenshots/settings-pending-${language}-360.png`,
      fullPage: true,
    });
    const loaded = page.waitForEvent('load');
    await update(page, language).click();
    await loaded;
    await applied(page, version, language);
    expect(await readDataset(page)).toEqual(saved);
    networkAvailable = false;
    await context.setOffline(true);
    await page.reload();
    await applied(page, version, language);
    expect(await readDataset(page)).toEqual(saved);
  });

test('queued readonly resume and native completion write defer automatic transition and Settings acceptance', async ({
  page,
}) => {
  await setup(page);
  const identity = await documentIdentity(page);
  const version = await switchBuild(page);
  const show = await background(page);
  await holdNextCommit(page, 'readonly');
  // Queue the refresh read before visible entry can inert the app; the held
  // native completion then proves preparation drains it instead of racing it.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => commitHeld(page)).toBe(true);
  await show();
  await quiet(page, identity);
  await releaseCommit(page);
  await expect.poll(() => pointer(page, 'active')).toBe(version);
  await expect.poll(() => documentIdentity(page)).not.toBe(identity);
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  const writeIdentity = await documentIdentity(page);
  await page.keyboard.press('Tab');
  target = third;
  const laterVersion = await switchBuild(page, third);
  await page.getByRole('checkbox').first().click();
  await expect(page.getByRole('checkbox').first()).toBeChecked();
  await holdNextCommit(page);
  await page.getByRole('checkbox').first().click();
  await expect.poll(() => commitHeld(page)).toBe(true);
  await resume(page);
  await quiet(page, writeIdentity);
  await releaseCommit(page);
  await expect(page.getByRole('checkbox').first()).not.toBeChecked();
  const saved = await readDataset(page);
  await acceptSettings(page, laterVersion);
  expect(await readDataset(page)).toEqual(saved);
});

test('backup export lease blocks automatic/manual apply through a native read', async ({
  page,
}) => {
  await setup(page);
  await nav(page, 'Settings').click();
  const identity = await documentIdentity(page);
  const version = await switchBuild(page);
  await holdNextCommit(page, 'readonly');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup', exact: true }).click();
  await expect.poll(() => commitHeld(page)).toBe(true);
  await expect(update(page)).toBeDisabled();
  await resume(page);
  await quiet(page, identity);
  await releaseCommit(page);
  const bytes = await readFile((await (await downloaded).path())!);
  const saved = await readDataset(page);
  expect(JSON.parse(bytes.toString()).dataset.habits).toEqual(saved.habits);
  await safeResume(page, version);
  expect(await readDataset(page)).toEqual(saved);
});

for (const leave of [false, true])
  test(`backup parsing lease survives ${leave ? 'Settings disposal' : 'visible confirmation'} and never opens discard`, async ({
    page,
  }) => {
    await setup(page);
    await nav(page, 'Settings').click();
    const bytes = await backup(page);
    const saved = await readDataset(page);
    const identity = await documentIdentity(page);
    const version = await switchBuild(page);
    await holdParse(page);
    await page
      .getByLabel('Choose backup file', { exact: true })
      .setInputFiles({ name: 'private.json', mimeType: 'application/json', buffer: bytes });
    await expect
      .poll(() =>
        page.evaluate(
          () => !!(window as typeof window & { pwaTestParseHeld?: boolean }).pwaTestParseHeld,
        ),
      )
      .toBe(true);
    if (leave) await nav(page, 'Today').click();
    else await expect(update(page)).toBeDisabled();
    await resume(page);
    await quiet(page, identity);
    await page.evaluate(() =>
      (window as typeof window & { pwaTestParseRelease?: () => void }).pwaTestParseRelease?.(),
    );
    if (!leave) {
      await expect(page.getByText('Backup ready', { exact: true })).toBeVisible();
      await expect(update(page)).toBeDisabled();
      await resume(page);
      await quiet(page, identity);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    await safeResume(page, version);
    expect(await readDataset(page)).toEqual(saved);
  });

for (const operation of ['restore', 'delete'] as const)
  test(`${operation} confirmation and native commit block automatic/manual activation`, async ({
    page,
  }) => {
    await setup(page);
    await nav(page, 'Settings').click();
    const bytes = await backup(page);
    const before = await readDataset(page);
    // A semantically different replacement guarantees a native write, not a revision-only no-op.
    const candidate = JSON.parse(bytes.toString());
    candidate.dataset.settings.reducedMotion = !candidate.dataset.settings.reducedMotion;
    const identity = await documentIdentity(page);
    const version = await switchBuild(page);
    if (operation === 'restore') {
      await page.getByLabel('Choose backup file', { exact: true }).setInputFiles({
        name: 'changed.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(candidate)),
      });
      await expect(page.getByText('Backup ready', { exact: true })).toBeVisible();
    } else await page.getByRole('button', { name: 'Delete all data…', exact: true }).click();
    await expect(update(page)).toBeDisabled();
    await resume(page);
    await quiet(page, identity);
    expect(await readDataset(page)).toEqual(before);
    await holdNextCommit(page);
    await page
      .getByRole('button', {
        name: operation === 'restore' ? 'Replace current data' : 'Delete all data',
        exact: true,
      })
      .click();
    await expect.poll(() => commitHeld(page)).toBe(true);
    await resume(page);
    await quiet(page, identity);
    await releaseCommit(page);
    if (operation === 'restore') {
      await expect(page.getByText('Backup restored.', { exact: true })).toBeVisible();
      await safeResume(page, version);
      expect((await readDataset(page)).settings.reducedMotion).toBe(
        candidate.dataset.settings.reducedMotion,
      );
    } else {
      await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
      const saved = await readDataset(page);
      await resume(page);
      await expect.poll(() => pointer(page, 'active')).toBe(version);
      await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
      expect(await readDataset(page)).toEqual(saved);
    }
  });

test('failed unsaved onboarding, queued autosaves and finalization defer automatic application', async ({
  page,
}) => {
  await page.goto(`${origin}/`);
  await expect
    .poll(() =>
      page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state),
    )
    .toBe('activated');
  await page.reload();
  await controlled(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mind', exact: true })).toBeVisible();
  const identity = await documentIdentity(page);
  const version = await switchBuild(page);
  await abortNextWrite(page);
  await page.getByLabel('What do you want to do?').fill('Failed setup literal');
  await expect(page.getByRole('alert')).toContainText(en.saveError);
  await resume(page);
  await quiet(page, identity);
  await expect(page.getByLabel('What do you want to do?')).toHaveValue('Failed setup literal');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Draft saved');
  await holdNextCommit(page);
  await page.getByLabel('What do you want to do?').fill('First queued setup');
  await expect.poll(() => commitHeld(page)).toBe(true);
  await page.getByLabel('What do you want to do?').fill('Last queued setup');
  await resume(page);
  await quiet(page, identity);
  await releaseCommit(page);
  await expect(page.getByRole('status')).toContainText('Draft saved');
  expect((await readDataset(page)).draft!.goals[0].goal).toBe('Last queued setup');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  for (const name of ['Body', 'Nutrition', 'Hygiene']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
  }
  await holdNextCommit(page);
  await page.getByRole('button', { name: 'Start my journey', exact: true }).click();
  await expect.poll(() => commitHeld(page)).toBe(true);
  await resume(page);
  await quiet(page, identity);
  await releaseCommit(page);
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  const saved = await readDataset(page);
  expect(saved.habits).toHaveLength(1);
  await safeResume(page, version);
  expect(await readDataset(page)).toEqual(saved);
});

for (const quota of ['all', 'active'] as const)
  test(`native activation metadata quota ${quota}: guarded completed B stays usable offline with exact records`, async ({
    page,
    context,
  }, testInfo) => {
    instrumentWorkers = true;
    await setup(page);
    await nav(page, 'Settings').click();
    const saved = await readDataset(page);
    const identity = await documentIdentity(page);
    const a = (await pointer(page, 'active'))!;
    const aKey = (await shellKeys(page)).find((key) => key.endsWith(a))!;
    const aEntries = await shellSnapshot(page, aKey);
    await page.evaluate(async () => {
      await (
        await caches.open('unrelated-pwa-test-quota')
      ).put('/untouched', new Response('User cache must not change'));
    });
    const unrelated = await shellSnapshot(page, 'unrelated-pwa-test-quota');
    const b = await switchBuild(page);
    const bKey = (await shellKeys(page)).find((key) => key.endsWith(b))!;
    const bEntries = await shellSnapshot(page, bKey);
    // Arm AFTER the candidate has completely installed. Only native metadata put
    // calls reject; shell puts, all reads, old-worker globals and user caches stay real.
    const armed = await workerMessage(
      page,
      'waiting',
      quota === 'all' ? 'PWA_TEST_QUOTA_ALL' : 'PWA_TEST_QUOTA_ACTIVE',
    );
    expect(armed.armed).toBe(quota);
    expect(armed.state).toBe('installed');
    expect(await pointer(page, 'installed')).toBe(b);
    const guarded = await workerMessage(page, 'waiting', 'ACTIVATE_WHEN_ALONE');
    expect(guarded).toEqual({ accepted: true });
    await expect
      .poll(() =>
        page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state),
      )
      .toBe('activated');
    const beforeReload = await workerMessage(page, 'active', 'PWA_TEST_STATUS');
    expect(beforeReload.version).toBe(b);
    expect(beforeReload.quotaMode).toBe(quota);
    expect(beforeReload.quotaPutsRejected).toBeGreaterThan(0);
    await testInfo.attach('native-quota-before-offline-navigation', {
      body: JSON.stringify({ quota, armed, guarded, a, b, beforeReload }, null, 2),
      contentType: 'application/json',
    });
    await unchangedDocument(page, identity);
    expect(await readDataset(page)).toEqual(saved);
    expect(await shellSnapshot(page, aKey)).toEqual(aEntries);
    expect(await shellSnapshot(page, bKey)).toEqual(bEntries);
    networkAvailable = false;
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await controlled(page);
    expect(
      (await documentHtml(page)).includes(
        'Stage5A isolated Automatic update B; no app behavior change.',
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        async () => (await fetch(new URL('icons/favicon-32-v1.png', document.baseURI))).ok,
      ),
    ).toBe(true);
    expect(await readDataset(page)).toEqual(saved);
    expect(await shellSnapshot(page, bKey)).toEqual(bEntries);
    expect(await shellSnapshot(page, 'unrelated-pwa-test-quota')).toEqual(unrelated);
    const afterReload = await workerMessage(page, 'active', 'PWA_TEST_STATUS');
    expect(afterReload.version).toBe(b);
    expect(afterReload.quotaMode).toBe(quota);
    if (quota === 'all')
      expect(afterReload.quotaPutsRejected).toBeGreaterThan(beforeReload.quotaPutsRejected); // sustained navigation/asset rejection
    else expect(afterReload.quotaPutsRejected).toBe(beforeReload.quotaPutsRejected); // activeKey-only is not navigation quota
    await testInfo.attach('native-quota-api-interception-not-disk-exhaustion', {
      body: JSON.stringify({ quota, armed, guarded, a, b, beforeReload, afterReload }, null, 2),
      contentType: 'application/json',
    });
  });

test('failed/interrupted C candidate leaves completed B available and A usable offline', async ({
  page,
  context,
}) => {
  await setup(page);
  await nav(page, 'Settings').click();
  const original = await pointer(page, 'active');
  const saved = await readDataset(page);
  const identity = await documentIdentity(page);
  const version = await switchBuild(page);
  const candidateKey = (await shellKeys(page)).find((key) => key.endsWith(version))!;
  const before = await shellSnapshot(page, candidateKey);
  target = third;
  failInstallAsset = true;
  const terminal = await page.evaluate(async () => {
    const registration = (await navigator.serviceWorker.getRegistration())!;
    const done = new Promise<string>((resolve) =>
      registration.addEventListener(
        'updatefound',
        () => {
          const worker = registration.installing!;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'redundant' || worker.state === 'installed') resolve(worker.state);
          });
        },
        { once: true },
      ),
    );
    await registration.update();
    return done;
  });
  expect(terminal).toBe('redundant');
  expect(blockedAssetRequests).toBeGreaterThan(0);
  await quiet(page, identity);
  expect(await pointer(page, 'installed')).toBe(version);
  expect(await pointer(page, 'active')).toBe(original);
  expect(await shellSnapshot(page, candidateKey)).toEqual(before);
  target = next;
  failInstallAsset = false;
  await acceptSettings(page, version);
  expect(await readDataset(page)).toEqual(saved);
  networkAvailable = false;
  await context.setOffline(true);
  await page.reload();
  await applied(page, version);
  expect(await readDataset(page)).toEqual(saved);
});

test('cache isolation only: forced TEST activation retains live old A and prunes superseded waiting B', async ({
  page,
  context,
}) => {
  instrumentWorkers = true;
  await setup(page);
  await nav(page, 'Journey').click();
  const original = await pointer(page, 'active');
  const originalKey = (await shellKeys(page)).find((key) => key.endsWith(original!))!;
  const saved = await readDataset(page);
  await page.evaluate(async () => {
    await (
      await caches.open('unrelated-pwa-test-test')
    ).put('/unrelated', new Response('preserve'));
  });
  const older = await context.newPage();
  await older.goto(`${origin}/`);
  await controlled(older);
  await older.getByRole('button', { name: 'Add habit', exact: true }).click();
  await older.getByLabel('What do you want to do?').fill('Older coherent draft');
  const b = await switchBuild(page);
  const bKey = (await shellKeys(page)).find((key) => key.endsWith(b))!;
  const c = await switchBuild(page, third);
  await forceTestActivation(page);
  await page.reload();
  await applied(page, c);
  await expect.poll(() => page.evaluate((key) => caches.has(key), bKey)).toBe(false);
  expect(await page.evaluate((key) => caches.has(key), originalKey)).toBe(true);
  expect(await page.evaluate(() => caches.has('unrelated-pwa-test-test'))).toBe(true);
  await expect(older.getByLabel('What do you want to do?')).toHaveValue('Older coherent draft');
  expect(await readDataset(page)).toEqual(saved);
});

test('cache isolation only: failed retained A reinstall keeps exact old responses and live draft offline', async ({
  page,
  context,
}) => {
  instrumentWorkers = true;
  await setup(page);
  const a = (await pointer(page, 'active'))!;
  const aKey = (await shellKeys(page)).find((key) => key.endsWith(a))!;
  const entries = await shellSnapshot(page, aKey);
  const oldA = await context.newPage();
  await oldA.goto(`${origin}/`);
  await controlled(oldA);
  await oldA.getByRole('button', { name: 'Add habit', exact: true }).click();
  await oldA.getByLabel('What do you want to do?').fill('Retained A literal draft');
  const identity = await documentIdentity(oldA);
  const saved = await readDataset(page);
  const b = await switchBuild(page);
  await forceTestActivation(page);
  await page.reload();
  await applied(page, b);
  target = first;
  failInstallAsset = true;
  const state = await page.evaluate(async () => {
    const registration = (await navigator.serviceWorker.getRegistration())!;
    const terminal = new Promise<string>((resolve) =>
      registration.addEventListener(
        'updatefound',
        () => {
          const worker = registration.installing!;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'redundant' || worker.state === 'installed') resolve(worker.state);
          });
        },
        { once: true },
      ),
    );
    await registration.update();
    return terminal;
  });
  expect(state).toBe('redundant');
  expect(blockedAssetRequests).toBeGreaterThan(0);
  expect(await pointer(page, 'installed')).toBe(b);
  expect(await page.evaluate((key) => caches.has(key), aKey)).toBe(true);
  expect(await shellSnapshot(page, aKey)).toEqual(entries);
  await unchangedDocument(oldA, identity);
  await expect(oldA.getByLabel('What do you want to do?')).toHaveValue('Retained A literal draft');
  networkAvailable = false;
  await context.setOffline(true);
  expect(
    await oldA.evaluate(
      async () => (await fetch(new URL('icons/favicon-32-v1.png', document.baseURI))).ok,
    ),
  ).toBe(true);
  expect(await readDataset(oldA)).toEqual(saved);
});

test('exact retained A rollback Cache-handle versus B cleanup interleaving preserves named shell and offline navigation', async ({
  page,
  context,
}, testInfo) => {
  instrumentWorkers = true;
  await setup(page);
  await nav(page, 'Journey').click();
  const a = (await pointer(page, 'active'))!;
  const aKey = (await shellKeys(page)).find((key) => key.endsWith(a))!;
  const entries = await shellSnapshot(page, aKey);
  const saved = await readDataset(page);
  await page.evaluate(async () => {
    await (
      await caches.open('unrelated-pwa-test-test')
    ).put('/unrelated', new Response('preserve'));
  });
  const oldA = await context.newPage();
  await oldA.goto(`${origin}/`);
  await controlled(oldA);
  await oldA.evaluate(() =>
    fetch(new URL('icons/favicon-32-v1.png', document.baseURI)).then((response) =>
      response.arrayBuffer(),
    ),
  ); // observe pending A assignment
  const b = await switchBuild(page);
  await forceTestActivation(page);
  await page.reload();
  await applied(page, b);
  await page.evaluate(() =>
    fetch(new URL('icons/favicon-32-v1.png', document.baseURI)).then((response) =>
      response.arrayBuffer(),
    ),
  );
  expect(await page.evaluate((key) => caches.has(key), aKey)).toBe(true);
  await page.keyboard.press('Tab'); // B is now an interacted session, not pristine entry.
  target = first;
  holdRollbackCache = true;
  // update() does not wait for the held install event to complete.
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())!.update();
  });
  await expect
    .poll(async () => {
      try {
        return (await workerMessage(page, 'installing', 'PWA_TEST_STATUS')).opened;
      } catch {
        return false;
      }
    })
    .toBe(true);
  expect(await pointer(page, 'installed')).toBe(b); // A is opened but not published
  const baseline = await workerMessage(page, 'active', 'PWA_TEST_STATUS');
  await oldA.close();
  // Do not await this fetch yet: a correct cross-worker lock may block cleanup.
  const trigger = page.evaluate(() =>
    fetch(new URL('icons/favicon-32-v1.png', document.baseURI))
      .then((response) => response.arrayBuffer())
      .then(() => true),
  );
  await expect
    .poll(async () => (await workerMessage(page, 'active', 'PWA_TEST_STATUS')).cleanupCalls)
    .toBeGreaterThan(baseline.cleanupCalls);
  // Wait for an actual lock waiter (fixed worker) OR completed cleanup (old
  // worker). Neither outcome depends on an arbitrary scheduling sleep.
  await expect
    .poll(async () => {
      const locks = await page.evaluate(() => navigator.locks.query());
      const status = await workerMessage(page, 'active', 'PWA_TEST_STATUS');
      return (
        !!locks.pending?.some((lock) => lock.name === shellLifecycleLock) ||
        status.cleanupCompleted > baseline.cleanupCompleted
      );
    })
    .toBe(true);
  const during = await workerMessage(page, 'active', 'PWA_TEST_STATUS');
  expect(during.deleted).not.toContain(aKey); // old worker would delete named A here
  expect(await page.evaluate((key) => caches.has(key), aKey)).toBe(true);
  expect(await shellSnapshot(page, aKey)).toEqual(entries);
  await workerMessage(page, 'installing', 'PWA_TEST_RELEASE_CACHE_OPEN');
  await expect.poll(() => pointer(page, 'installed')).toBe(a);
  await expect
    .poll(() =>
      page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting),
    )
    .toBe(true);
  await trigger;
  await forceTestActivation(page);
  await expect.poll(() => pointer(page, 'active')).toBe(a);
  expect(await shellSnapshot(page, aKey)).toEqual(entries);
  expect(await page.evaluate(() => caches.has('unrelated-pwa-test-test'))).toBe(true);
  await testInfo.attach('exact-cache-interleaving', {
    body: JSON.stringify({ a, b, aKey, entries, during }, null, 2),
    contentType: 'application/json',
  });
  networkAvailable = false;
  await context.setOffline(true);
  await page.reload();
  await applied(page, a);
  expect(await readDataset(page)).toEqual(saved);
});

test('production routes, reserved asset 404s and uncached offline failure remain truthful', async ({
  page,
  context,
  request,
}) => {
  await setup(page);
  // APIRequestContext bypasses workers: nginx serves only real static files,
  // not arbitrary state-routing pathnames. The landing remains outside scope.
  expect((await request.get(requestOrigin + prefix)).status()).toBe(200);
  for (const route of ['/', '/index.html']) {
    const response = await request.get(origin + route);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
    expect(await response.text()).not.toContain('/@vite/client');
  }
  for (const route of ['/today', '/pillars', '/journey', '/progress', '/settings', '/not-a-file']) {
    expect((await request.get(origin + route)).status()).toBe(404);
    // In contrast, worker-controlled in-scope navigation serves its verified
    // shell. The UI still routes by saved state, not by these URL pathnames.
    const response = await page.goto(origin + route);
    expect(response?.status()).toBe(200);
    expect(response?.fromServiceWorker()).toBe(true);
    expect(await response!.text()).not.toContain('/@vite/client');
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await controlled(page);
  }
  for (const path of ['/assets/missing.js', '/icons/missing.png', '/missing.webmanifest'])
    expect((await request.get(origin + path)).status()).toBe(404);
  const worker = await request.get(origin + '/sw.js');
  expect(worker.headers()['content-type']).toContain('javascript');
  expect(worker.headers()['cache-control']).toContain('no-cache');
  networkAvailable = false;
  await context.setOffline(true);
  const missing = await page.evaluate(async () => {
    try {
      const response = await fetch(new URL('assets/uncached.js', document.baseURI));
      return { status: response.status, type: response.headers.get('content-type') };
    } catch {
      return { status: 0, type: null };
    }
  });
  expect([0, 503]).toContain(missing.status);
  expect(missing.type ?? '').not.toContain('text/html');
  await nav(page, 'Pillars').click();
  await expect(page.getByRole('heading', { name: 'Pillars', exact: true })).toBeVisible();
});

test('saved diary and cached shell survive a full isolated browser process restart offline', async () => {
  await mkdir(`${evidence}/browser-profiles`, { recursive: true });
  const profile = await mkdtemp(`${evidence}/browser-profiles/isolated-`);
  let context = await chromium.launchPersistentContext(profile, {
    headless: true,
    viewport: { width: 390, height: 844 },
  });
  let saved: Dataset;
  try {
    const page = await context.newPage();
    await setup(page);
    await page.getByRole('checkbox').first().click();
    await expect(page.getByRole('checkbox').first()).toBeChecked();
    saved = await readDataset(page);
  } finally {
    await context.close();
  }
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    viewport: { width: 390, height: 844 },
  });
  try {
    networkAvailable = false;
    await context.setOffline(true);
    const page = await context.newPage();
    await page.goto(`${origin}/`);
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox').first()).toBeChecked();
    expect(await readDataset(page)).toEqual(saved);
  } finally {
    await context.close();
  }
});

test('fresh prefixed compiled worker preserves saved offline drafts after preview stops', async ({
  page,
  context,
  request,
}) => {
  const preview = spawn(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      '4186',
      '--strictPort',
      '--base',
      appBase,
      '--outDir',
      'dist/app',
    ],
    { stdio: 'ignore' },
  );
  const url = `http://127.0.0.1:4186${appBase}`;
  try {
    await expect
      .poll(async () => {
        try {
          return (await request.get(url)).status();
        } catch {
          return 0;
        }
      })
      .toBe(200);
    await page.goto(url);
    await expect
      .poll(() =>
        page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state),
      )
      .toBe('activated');
    expect(
      await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope),
    ).toBe(url);
    const client = await context.newCDPSession(page);
    const manifest = await client.send('Page.getAppManifest');
    expect(new URL(manifest.manifest?.id ?? '').pathname).toBe(appBase);
    await page.reload();
    await controlled(page);
    const stopped = new Promise<void>((resolve) => preview.once('exit', () => resolve()));
    preview.kill('SIGTERM');
    await stopped;
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await page.getByLabel('What do you want to do?').fill('Prefixed offline draft');
    await expect(page.getByRole('status')).toHaveText('Draft saved');
    await page.reload();
    await expect(page.getByLabel('What do you want to do?')).toHaveValue('Prefixed offline draft');
    expect(
      (await page.evaluate(() => caches.keys())).every((key) => key.startsWith(cachePrefix)),
    ).toBe(true);
  } finally {
    if (preview.exitCode === null) preview.kill('SIGTERM');
  }
});

for (const language of ['en', 'pt'] as const)
  for (const layout of [
    { width: 390, text: 100 },
    { width: 320, text: 200 },
    { width: 1280, text: 100 },
  ])
    test(`optional Settings update controls and keyboard destinations ${language} ${layout.width}px text${layout.text}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: layout.width, height: 900 });
      await setup(page, language);
      if (layout.text === 200)
        await page.addStyleTag({ content: 'html { font-size:32px !important; }' });
      await nav(page, language === 'en' ? 'Settings' : 'Ajustes').click();
      const identity = await documentIdentity(page);
      await switchBuild(page);
      await quiet(page, identity);
      const control = update(page, language);
      await expect(control).toBeVisible();
      await noOverflow(page);
      const geometry = await control.evaluate((button) => {
        const box = button.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(button);
        return {
          width: box.width,
          height: box.height,
          contained: Array.from(range.getClientRects()).every(
            (rect) => rect.left >= box.left - 0.5 && rect.right <= box.right + 0.5,
          ),
        };
      });
      expect(geometry.width).toBeGreaterThanOrEqual(44);
      expect(geometry.height).toBeGreaterThanOrEqual(44);
      expect(geometry.contained).toBe(true);
      for (const destination of language === 'en'
        ? ['Pillars', 'Journey', 'Progress', 'Settings', 'Today']
        : ['Pilares', 'Jornada', 'Progresso', 'Ajustes', 'Hoje']) {
        await nav(page, destination).focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('h1')).toBeFocused();
        await noOverflow(page);
        await page.screenshot({
          path: `${evidence}/screenshots/layout-${language}-${layout.width}-text${layout.text}-${destination}.png`,
          fullPage: true,
        });
      }
      await nav(page, language === 'en' ? 'Settings' : 'Ajustes').click();
      const check = page.getByRole('button', {
        name: language === 'en' ? 'Check for updates' : 'Verificar atualizações',
        exact: true,
      });
      await check.focus();
      await page.keyboard.press('Enter');
      await quiet(page, identity);
      await expect(control).toBeVisible();
      await page.screenshot({
        path: `${evidence}/screenshots/settings-layout-${language}-${layout.width}-text${layout.text}.png`,
        fullPage: true,
      });
      await control.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${evidence}/screenshots/settings-viewport-${language}-${layout.width}-text${layout.text}.png`,
      });
    });

test('native pending assignment promotion stays coherent across a lagged cleanup snapshot', async ({
  page,
  context,
}, testInfo) => {
  instrumentWorkers = true;
  pendingAssignmentRace = true;
  await setup(page);
  const saved = await readDataset(page);
  const a = (await pointer(page, 'active'))!;
  const b = await switchBuild(page);
  await forceTestActivation(page); // Cache-mechanism isolation, never product adoption policy.
  await expect.poll(() => pointer(page, 'active')).toBe(b);
  const fresh = await context.newPage();
  try {
    await fresh.goto(`${origin}/?coherence-new-B`);
    await expect(fresh.getByRole('heading', { name: en.today, exact: true })).toBeVisible();
    await controlled(fresh);
    await expect
      .poll(async () => {
        const state = await workerMessage(page, 'active', 'PWA_TEST_STATUS');
        return state.cleanupCalls - state.cleanupCompleted;
      })
      .toBe(0);
    const expected = await page.evaluate(
      async ({ cache, path }) => (await (await caches.open(cache)).match(path))!.text(),
      { cache: `${cachePrefix}shell:${a}`, path: `${appBase}site-v1.webmanifest` },
    );
    expect(JSON.parse(expected).description).toContain('fixture a');
    const armed = await workerMessage(page, 'active', 'PWA_TEST_ARM_PENDING_RACE');
    await page.evaluate(
      async ({ metadataCache, appBase, id, a }) => {
        // TEST ONLY pending flag on a real A document; no diary mutation.
        await (
          await caches.open(metadataCache)
        ).put(
          `${appBase}__app_shell__/client/${encodeURIComponent(id)}`,
          new Response(a, { headers: { 'X-App-Shell-Pending': '1' } }),
        );
      },
      { metadataCache, appBase, id: armed.omitId, a },
    );
    const before = await workerMessage(page, 'active', 'PWA_TEST_PENDING_RACE_STATUS');
    expect(
      await fresh.evaluate(
        (path) => fetch(path, { cache: 'no-store' }).then((response) => response.status),
        `${appBase}icons/favicon-16-v1.png`,
      ),
    ).toBe(200);
    await expect
      .poll(async () => (await workerMessage(page, 'active', 'PWA_TEST_PENDING_RACE_STATUS')).held)
      .toBe(true);
    await page.evaluate((path) => {
      const state = window as typeof window & {
        pendingRaceResponse?: { text?: string; error?: string };
      };
      void fetch(path, { cache: 'no-store' })
        .then(async (response) => {
          state.pendingRaceResponse = { text: await response.text() };
        })
        .catch((error) => {
          state.pendingRaceResponse = { error: String(error) };
        });
    }, `${appBase}site-v1.webmanifest`);
    // Accept explicit progress or a native lock waiter, never wait for promotion
    // while holding cleanup's lock (which would deadlock the corrected worker).
    await expect
      .poll(async () => {
        const state = await workerMessage(page, 'active', 'PWA_TEST_PENDING_RACE_STATUS');
        const waiting = await page.evaluate(
          async (name) =>
            (await navigator.locks.query()).pending?.some((lock) => lock.name === name),
          shellLifecycleLock,
        );
        return state.promotions > before.promotions || waiting;
      })
      .toBe(true);
    await workerMessage(page, 'active', 'PWA_TEST_RELEASE_PENDING_RACE');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as typeof window & { pendingRaceResponse?: object }).pendingRaceResponse !==
            undefined,
        ),
      )
      .toBe(true);
    expect(
      await page.evaluate(
        () => (window as typeof window & { pendingRaceResponse?: object }).pendingRaceResponse,
      ),
    ).toEqual({ text: expected });
    await expect
      .poll(async () => {
        const state = await workerMessage(page, 'active', 'PWA_TEST_STATUS');
        return state.cleanupCalls - state.cleanupCompleted;
      })
      .toBe(0);
    expect(await shellKeys(page)).toContain(`${cachePrefix}shell:${a}`);
    expect(
      await page.evaluate(
        async ({ metadataCache, appBase, id }) =>
          (
            await (
              await caches.open(metadataCache)
            ).match(`${appBase}__app_shell__/client/${encodeURIComponent(id)}`)
          )?.text(),
        { metadataCache, appBase, id: armed.omitId },
      ),
    ).toBe(a);
    expect(
      await page.evaluate(
        (path) => fetch(path, { cache: 'no-store' }).then((response) => response.text()),
        `${appBase}site-v1.webmanifest`,
      ),
    ).toBe(expected);
    expect(await readDataset(page)).toEqual(saved);
    await context.setOffline(true);
    expect(
      await page.evaluate(
        (path) => fetch(path, { cache: 'no-store' }).then((response) => response.text()),
        `${appBase}site-v1.webmanifest`,
      ),
    ).toBe(expected);
    await testInfo.attach('native-storage-locks-with-synthetic-enumeration-lag', {
      body: JSON.stringify({
        a,
        b,
        oldClient: armed.omitId,
        unsafeMutation: process.env.PWA_UNSAFE_PROMOTION_MUTATION === '1',
      }),
      contentType: 'application/json',
    });
  } finally {
    await workerMessage(page, 'active', 'PWA_TEST_RELEASE_PENDING_RACE').catch(() => {});
    await fresh.close();
  }
});
