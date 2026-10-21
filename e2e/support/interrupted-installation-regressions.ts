import { test, expect, type Page } from '@playwright/test';
import { readDataset, nav } from './habit-fixtures';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { shellSnapshot } from './pwa-update';
import { NativeTransferStall } from './native-transfer-stall';
import {
  seedInterruptedInstallation,
  installationMarker,
  triggerRecovery,
  observeNativeWorkers,
} from './interrupted-installation';

export function interruptedInstallationRegressions(fixture: {
  appBase: string;
  cachePrefix: string;
  origin: string;
  evidence: string;
  setup: (page: Page) => Promise<void>;
  setupBeforeRegistration: (page: Page) => Promise<void>;
  pointer: (page: Page, name: 'active' | 'installed') => Promise<string | undefined>;
  switchBuild: (page: Page) => Promise<string>;
  switchLaterBuild: (page: Page) => Promise<string>;
  acceptSettings: (page: Page, version: string) => Promise<void>;
  candidate: () => void;
  incumbent: () => void;
  offline: () => void;
  online: () => void;
  stall: (stall: NativeTransferStall | undefined) => void;
}) {
  const { appBase, cachePrefix, origin, setup, pointer } = fixture;
  const metadataCache = `${cachePrefix}clients`;
  const orphan = '1'.repeat(64);
  const marker = (page: Page, version = orphan) =>
    installationMarker(page, appBase, cachePrefix, version);
  const hasOrphan = (page: Page) =>
    page.evaluate((name) => caches.has(name), `${cachePrefix}shell:${orphan}`);
  async function offlineReopen(
    page: Page,
    version: string,
    saved: Awaited<ReturnType<typeof readDataset>>,
  ) {
    const context = page.context();
    const exactHtml = await page.evaluate(
      async ({ name, path }) =>
        Array.from(
          new Uint8Array(await (await (await caches.open(name)).match(path))!.arrayBuffer()),
        ),
      { name: `${cachePrefix}shell:${version}`, path: `${appBase}index.html` },
    );
    await page.close();
    fixture.offline();
    await context.setOffline(true);
    const fresh = await context.newPage();
    const response = await fresh.goto(`${origin}/`);
    expect(response?.fromServiceWorker()).toBe(true);
    expect(await response!.body()).toEqual(Buffer.from(exactHtml));
    await expect(fresh.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    expect(await pointer(fresh, 'active')).toBe(version);
    expect(await readDataset(fresh)).toEqual(saved);
    return fresh;
  }

  test('native first-install recovery retries identical compiled worker after actual installing-worker termination without clearing storage', async ({
    page,
    context,
  }, testInfo) => {
    // Delay only the application's initial register call, never worker code or
    // responses. The fictional diary is created through the normal network UI.
    await page.addInitScript(() => {
      const original = ServiceWorkerContainer.prototype.register;
      ServiceWorkerContainer.prototype.register = function (...args) {
        ServiceWorkerContainer.prototype.register = original;
        return new Promise((resolve, reject) => {
          (
            window as typeof window & { releaseFirstRegistration?: () => void }
          ).releaseFirstRegistration = () => {
            original.apply(this, args).then(resolve, reject);
          };
        });
      };
    });
    fixture.candidate();
    await fixture.setupBeforeRegistration(page);
    await page.getByRole('checkbox').first().click();
    await expect(page.getByRole('checkbox').first()).toBeChecked();
    await nav(page, 'Journey').click();
    await expect(page.getByText('10 XP', { exact: true })).toBeVisible();
    const saved = await readDataset(page);
    expect(saved.habits).toHaveLength(1);
    expect(saved.occurrences.filter((row) => row.done)).toHaveLength(1);
    expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
    expect(
      await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
    ).toBe(0);
    expect(await page.evaluate(() => caches.keys())).toEqual([]);
    const source = await (await context.request.get(`${origin}/sw.js`)).body();
    const config = JSON.parse(source.toString().match(/const CONFIG = (.+);/)![1]) as {
      version: string;
      files: string[];
    };
    const version = config.version;
    const name = `${cachePrefix}shell:${version}`;
    const expected = new Map<string, Buffer>();
    for (const path of config.files) {
      const response = await context.request.get(new URL(path, origin).href);
      expect(response.ok()).toBe(true);
      expected.set(path, await response.body());
    }
    const observed = await observeNativeWorkers(page, `${origin}/sw.js`);
    const stall = new NativeTransferStall('headers');
    fixture.stall(stall);
    const state: Record<string, unknown> = {
      version,
      emittedWorkerSha256: createHash('sha256').update(source).digest('hex'),
      fileHashes: Object.fromEntries(
        [...expected].map(([path, bytes]) => [
          path,
          createHash('sha256').update(bytes).digest('hex'),
        ]),
      ),
      label: 'actual first installing-worker stop; no registration, cache or diary seeding',
    };
    try {
      await page.evaluate(() =>
        (window as typeof window & { releaseFirstRegistration?: () => void })
          .releaseFirstRegistration!(),
      );
      await expect.poll(() => stall.startedAt).toBeTruthy();
      const partial = await shellSnapshot(page, name);
      state.partialFiles = partial;
      expect(partial.length).toBeGreaterThan(0);
      expect(await pointer(page, 'active')).toBeUndefined();
      expect(await pointer(page, 'installed')).toBeUndefined();
      state.markerBeforeStop = await page.evaluate(
        async ({ metadataCache, appBase, version }) => {
          const response = await (
            await caches.open(metadataCache)
          ).match(`${appBase}__app_shell__/installing/${version}`);
          return response
            ? { body: await response.text(), phase: response.headers.get('X-App-Shell-Phase') }
            : null;
        },
        { metadataCache, appBase, version },
      );
      state.locksBeforeStop = await page.evaluate(() => navigator.locks.query());
      expect(
        (state.locksBeforeStop as { held?: { name: string }[] }).held?.some(
          (lock) => lock.name === `${cachePrefix}shell-lifecycle`,
        ),
      ).toBe(true);
      state.termination = await observed.stopInstalling();
      await page.evaluate(
        (lock) => navigator.locks.request(lock, () => undefined),
        `${cachePrefix}shell-lifecycle`,
      );
      state.locksAfterStop = await page.evaluate(() => navigator.locks.query());
      expect(
        (state.locksAfterStop as { held?: { name: string }[] }).held?.some(
          (lock) => lock.name === `${cachePrefix}shell-lifecycle`,
        ),
      ).toBe(false);
      state.orphanAfterStop = await page.evaluate((name) => caches.has(name), name);
      expect(state.orphanAfterStop).toBe(true);
      expect(await shellSnapshot(page, name)).toEqual(partial);
      expect(await marker(page, version)).toBe(version);
      expect(await readDataset(page)).toEqual(saved);
      // Restore the held socket only after proving termination left native files.
      stall.dispose();
      fixture.stall(undefined);
      expect(await (await context.request.get(`${origin}/sw.js`)).body()).toEqual(source);
      // Chromium may remove a failed first registration. Retry via the normal
      // browser registration API, preserving any surviving failed registration.
      state.registrationAfterStop = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return registration
          ? {
              scope: registration.scope,
              active: registration.active?.state,
              waiting: registration.waiting?.state,
              installing: registration.installing?.state,
            }
          : null;
      });
      await page.evaluate(async (appBase) => {
        await navigator.serviceWorker.register(`${appBase}sw.js`, { scope: appBase });
      }, appBase);
      await expect
        .poll(() =>
          page.evaluate(
            async () => (await navigator.serviceWorker.getRegistration())?.active?.state,
          ),
        )
        .toBe('activated');
      expect(await pointer(page, 'installed')).toBe(version);
      expect(await pointer(page, 'active')).toBe(version);
      expect(await marker(page, version)).toBeUndefined();
      expect(await readDataset(page)).toEqual(saved);
      expect(await (await context.request.get(`${origin}/sw.js`)).body()).toEqual(source);
      await page.close();
      fixture.offline();
      await context.setOffline(true);
      const fresh = await context.newPage();
      const response = await fresh.goto(`${origin}/`);
      expect(response?.fromServiceWorker()).toBe(true);
      expect(await response!.body()).toEqual(expected.get(`${appBase}index.html`));
      await expect(fresh.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
      expect(await fresh.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
      const offlineFiles: Record<string, unknown> = {};
      for (const [path, bytes] of expected) {
        if (path === `${appBase}index.html`) continue; // Exact native navigation body asserted above.
        const actual = await fresh.evaluate(async (path) => {
          const response = await fetch(path, { cache: 'no-store' });
          const bytes = await response.arrayBuffer();
          const digest = await crypto.subtle.digest('SHA-256', bytes);
          return {
            ok: response.ok,
            length: bytes.byteLength,
            sha256: Array.from(new Uint8Array(digest), (byte) =>
              byte.toString(16).padStart(2, '0'),
            ).join(''),
          };
        }, path);
        expect(actual).toEqual({
          ok: true,
          length: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
        offlineFiles[path] = actual;
      }
      state.offlineFiles = offlineFiles;
      expect(await readDataset(fresh)).toEqual(saved);
      await expect(fresh.getByRole('checkbox').first()).toBeChecked();
      for (const destination of ['Pillars', 'Journey', 'Progress', 'Settings', 'Today'])
        await nav(fresh, destination).click();
      await nav(fresh, 'Journey').click();
      await expect(fresh.getByText('10 XP', { exact: true })).toBeVisible();
      expect(await readDataset(fresh)).toEqual(saved);
      state.complete = true;
    } finally {
      state.events = observed.events;
      state.transfer = stall.snapshot();
      const body = JSON.stringify(state, null, 2);
      await writeFile(`${fixture.evidence}/first-install-actual-termination.json`, body);
      await testInfo.attach('actual-first-install-termination-identical-version-retry', {
        body,
        contentType: 'application/json',
      });
      fixture.stall(undefined);
      stall.dispose();
      await observed.close().catch(() => {});
    }
  });

  for (const boundary of ['intent', 'partial', 'complete', 'deleted'] as const)
    test(`native interrupted-install recovery seeded ${boundary} boundary preserves completed waiting shell and exact diary`, async ({
      page,
    }, testInfo) => {
      await setup(page);
      const a = (await pointer(page, 'active'))!;
      const saved = await readDataset(page);
      const b = await fixture.switchBuild(page);
      const aKey = `${cachePrefix}shell:${a}`;
      const bKey = `${cachePrefix}shell:${b}`;
      const [aBefore, bBefore] = await Promise.all([
        shellSnapshot(page, aKey),
        shellSnapshot(page, bKey),
      ]);
      const seeded = await seedInterruptedInstallation(page, {
        appBase,
        cachePrefix,
        version: orphan,
        sourceVersion: a,
        boundary,
      });
      expect(await marker(page)).toBe(orphan);
      await triggerRecovery(page, appBase);
      await expect.poll(() => marker(page)).toBeUndefined();
      expect(await hasOrphan(page)).toBe(false);
      expect(await shellSnapshot(page, aKey)).toEqual(aBefore);
      expect(await shellSnapshot(page, bKey)).toEqual(bBefore);
      expect(await pointer(page, 'installed')).toBe(b);
      expect(await readDataset(page)).toEqual(saved);
      // Repetition is an idempotence check, not a timer-based expiry.
      await triggerRecovery(page, appBase);
      expect(await hasOrphan(page)).toBe(false);
      await testInfo.attach('seeded-crash-equivalent-boundary', {
        body: JSON.stringify({ a, b, seeded }),
        contentType: 'application/json',
      });
      await fixture.acceptSettings(page, b);
      await offlineReopen(page, b, saved);
    });

  test('native interrupted-install recovery protects completed markers, pending assignment and unmarked foreign caches', async ({
    page,
  }, testInfo) => {
    await setup(page);
    const a = (await pointer(page, 'active'))!;
    const b = await fixture.switchBuild(page);
    const saved = await readDataset(page);
    await seedInterruptedInstallation(page, {
      appBase,
      cachePrefix,
      version: orphan,
      sourceVersion: a,
      boundary: 'partial',
      pendingAssignment: true,
    });
    const unmarked = `${cachePrefix}shell:${'2'.repeat(64)}`;
    const foreign = `my-goat-journey:${encodeURIComponent('/other-application/app/')}:shell:${orphan}`;
    await page.evaluate(
      async ({ metadataCache, appBase, a, b, unmarked, foreign }) => {
        const metadata = await caches.open(metadataCache);
        for (const version of [a, b])
          await metadata.put(
            `${appBase}__app_shell__/installing/${version}`,
            new Response(version),
          );
        for (const name of [unmarked, foreign])
          await (await caches.open(name)).put('/preserve', new Response('Exact unrelated bytes'));
      },
      { metadataCache, appBase, a, b, unmarked, foreign },
    );
    const names = [
      `${cachePrefix}shell:${a}`,
      `${cachePrefix}shell:${b}`,
      `${cachePrefix}shell:${orphan}`,
      unmarked,
      foreign,
    ];
    const before = await Promise.all(names.map((name) => shellSnapshot(page, name)));
    await triggerRecovery(page, appBase);
    await expect.poll(() => marker(page, b)).toBeUndefined();
    expect(await marker(page, a)).toBeUndefined();
    expect(await marker(page)).toBe(orphan);
    expect(await Promise.all(names.map((name) => shellSnapshot(page, name)))).toEqual(before);
    expect(await readDataset(page)).toEqual(saved);
    await testInfo.attach('seeded-preservation-evidence', {
      body: JSON.stringify({ a, b, names, before }),
      contentType: 'application/json',
    });
    await fixture.acceptSettings(page, b);
    await offlineReopen(page, b, saved);
  });

  test('native interrupted-install recovery defers unknown peers then reclaims scratch after close', async ({
    page,
    context,
  }) => {
    await setup(page);
    const a = (await pointer(page, 'active'))!;
    const saved = await readDataset(page);
    const peer = await context.newPage();
    await peer.goto(new URL('__pwa_test_unknown_peer__.html', `${origin}/`).href);
    await expect(peer).toHaveTitle('Unknown disposable PWA peer');
    await seedInterruptedInstallation(page, {
      appBase,
      cachePrefix,
      version: orphan,
      sourceVersion: a,
      boundary: 'partial',
    });
    await triggerRecovery(page, appBase);
    // The lock roundtrip lets the native cleanup decision settle without aging a lease.
    await page.evaluate(
      (name) => navigator.locks.request(name, () => undefined),
      `${cachePrefix}shell-lifecycle`,
    );
    expect(await marker(page)).toBe(orphan);
    expect(await hasOrphan(page)).toBe(true);
    await peer.close();
    await triggerRecovery(page, appBase);
    await expect.poll(() => marker(page)).toBeUndefined();
    expect(await hasOrphan(page)).toBe(false);
    await offlineReopen(page, a, saved);
  });

  test('native interrupted-install recovery same-version retry discards seeded partial responses before real signed transfer', async ({
    page,
  }, testInfo) => {
    await setup(page);
    const a = (await pointer(page, 'active'))!;
    const saved = await readDataset(page);
    fixture.candidate();
    const source = await (await page.context().request.get(`${origin}/sw.js`)).text();
    const b = (JSON.parse(source.match(/const CONFIG = (.+);/)![1]) as { version: string }).version;
    const exactBHtml = await (await page.context().request.get(`${origin}/index.html`)).body();
    fixture.incumbent();
    await seedInterruptedInstallation(page, {
      appBase,
      cachePrefix,
      version: b,
      sourceVersion: a,
      boundary: 'partial',
    });
    // Native scratch data is deliberately not a verified retained shell. This
    // response is seeded storage, never an edit to emitted/signed build bytes.
    await page.evaluate(
      async ({ name, path }) =>
        (await caches.open(name)).put(
          path,
          new Response('seeded incomplete scratch; not signed HTML'),
        ),
      { name: `${cachePrefix}shell:${b}`, path: `${appBase}index.html` },
    );
    const installed = await fixture.switchBuild(page);
    expect(installed).toBe(b);
    expect(await marker(page, b)).toBeUndefined();
    expect(
      await page.evaluate(
        async ({ name, path }) =>
          Array.from(
            new Uint8Array(await (await (await caches.open(name)).match(path))!.arrayBuffer()),
          ),
        { name: `${cachePrefix}shell:${b}`, path: `${appBase}index.html` },
      ),
    ).toEqual([...exactBHtml]);
    await fixture.acceptSettings(page, b);
    expect(await readDataset(page)).toEqual(saved);
    await testInfo.attach('seeded-same-version-retry', {
      body: JSON.stringify({ a, b, label: 'seeded crash-equivalent scratch; real compiled retry' }),
      contentType: 'application/json',
    });
    await offlineReopen(page, b, saved);
  });

  test('native interrupted-install recovery after actual CDP installing-worker termination reclaims owned partial cache', async ({
    page,
  }, testInfo) => {
    await setup(page);
    const a = (await pointer(page, 'active'))!;
    const saved = await readDataset(page);
    const aKey = `${cachePrefix}shell:${a}`;
    const before = await shellSnapshot(page, aKey);
    const observed = await observeNativeWorkers(page, `${origin}/sw.js`);
    const stall = new NativeTransferStall('headers');
    fixture.stall(stall);
    fixture.candidate();
    const source = await (await page.context().request.get(`${origin}/sw.js`)).text();
    const b = (JSON.parse(source.match(/const CONFIG = (.+);/)![1]) as { version: string }).version;
    // Seed only the old retirement record; the new B cache, transfer, and
    // installing-worker termination below are produced by native Chromium.
    expect(await page.evaluate((name) => caches.has(name), `${cachePrefix}shell:${b}`)).toBe(false);
    await page.evaluate(
      async ({ metadataCache, appBase, b, cachePrefix }) =>
        navigator.locks.request(`${cachePrefix}shell-lifecycle`, async () => {
          await (
            await caches.open(metadataCache)
          ).put(`${appBase}__app_shell__/retired/${b}`, new Response(b));
        }),
      { metadataCache, appBase, b, cachePrefix },
    );
    let retirementDuringInstall: string | undefined;
    let termination: unknown;
    let orphanAfterStop: boolean | undefined;
    let partialFiles: string[] = [];
    let heldBeforeStop: unknown;
    let locksAfterStop: unknown;
    let c: string | undefined;
    try {
      await page.evaluate(async () => {
        void (await navigator.serviceWorker.getRegistration())!.update().catch(() => {});
      });
      await expect.poll(() => stall.startedAt).toBeTruthy();
      fixture.incumbent();
      expect(await page.evaluate((name) => caches.has(name), `${cachePrefix}shell:${b}`)).toBe(
        true,
      );
      partialFiles = await page.evaluate(
        async (name) => (await (await caches.open(name)).keys()).map((request) => request.url),
        `${cachePrefix}shell:${b}`,
      );
      expect(partialFiles.length).toBeGreaterThan(0);
      heldBeforeStop = await page.evaluate(() => navigator.locks.query());
      expect(
        (heldBeforeStop as { held?: { name: string }[] }).held?.some(
          (lock) => lock.name === `${cachePrefix}shell-lifecycle`,
        ),
      ).toBe(true);
      retirementDuringInstall = await page.evaluate(
        async ({ metadataCache, appBase, b }) =>
          (
            await (await caches.open(metadataCache)).match(`${appBase}__app_shell__/retired/${b}`)
          )?.text(),
        { metadataCache, appBase, b },
      );
      termination = await observed.stopInstalling();
      expect(retirementDuringInstall).toBeUndefined();
      // Stopping the installing execution releases its actual origin-wide lock.
      await page.evaluate(
        (name) => navigator.locks.request(name, () => undefined),
        `${cachePrefix}shell-lifecycle`,
      );
      locksAfterStop = await page.evaluate(() => navigator.locks.query());
      expect(
        (locksAfterStop as { held?: { name: string }[] }).held?.some(
          (lock) => lock.name === `${cachePrefix}shell-lifecycle`,
        ),
      ).toBe(false);
      orphanAfterStop = await page.evaluate((name) => caches.has(name), `${cachePrefix}shell:${b}`);
      expect(orphanAfterStop).toBe(true); // A caught transfer rejection is not this regression.
      expect(await marker(page, b)).toBe(b);
      await triggerRecovery(page, appBase);
      await expect.poll(() => marker(page, b)).toBeUndefined();
      expect(await page.evaluate((name) => caches.has(name), `${cachePrefix}shell:${b}`)).toBe(
        false,
      );
      expect(await pointer(page, 'installed')).toBe(a);
      expect(await shellSnapshot(page, aKey)).toEqual(before);
      expect(await readDataset(page)).toEqual(saved);
      stall.release();
      fixture.stall(undefined);
      const offlineA = await offlineReopen(page, a, saved);
      await page.context().setOffline(false);
      fixture.online();
      await offlineA.keyboard.press('Tab'); // The later C download must remain quiet in this interacted document.
      c = await fixture.switchLaterBuild(offlineA);
      await fixture.acceptSettings(offlineA, c);
      expect(await readDataset(offlineA)).toEqual(saved);
      expect(await offlineA.evaluate((name) => caches.has(name), `${cachePrefix}shell:${b}`)).toBe(
        false,
      );
      await offlineReopen(offlineA, c, saved);
    } finally {
      await testInfo.attach('actual-native-worker-stop-not-seeded', {
        body: JSON.stringify(
          {
            a,
            b,
            termination,
            orphanAfterStop,
            partialFiles,
            heldBeforeStop,
            locksAfterStop,
            priorRetirement:
              'seeded stale retired/B with no cache; new B installation and stop are actual',
            retirementDuringInstall: retirementDuringInstall ?? null,
            c,
            events: observed.events,
            transfer: stall.snapshot(),
          },
          null,
          2,
        ),
        contentType: 'application/json',
      });
      fixture.stall(undefined);
      stall.dispose();
      await observed.close().catch(() => {});
    }
  });
}
