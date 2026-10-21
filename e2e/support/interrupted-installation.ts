import { expect, type Page, type CDPSession } from '@playwright/test';

/** Persisted crash-equivalent fixtures, not evidence that a browser process crashed.
 * All data lives in a fresh Playwright context; no emitted shell bytes are edited.
 */
export async function seedInterruptedInstallation(
  page: Page,
  options: {
    appBase: string;
    cachePrefix: string;
    version: string;
    sourceVersion: string;
    boundary: 'intent' | 'partial' | 'complete' | 'deleted';
    pendingAssignment?: boolean;
  },
) {
  return page.evaluate(async (options) => {
    const { appBase, cachePrefix, version, sourceVersion, boundary, pendingAssignment } = options;
    return navigator.locks.request(`${cachePrefix}shell-lifecycle`, async () => {
      const metadata = await caches.open(`${cachePrefix}clients`);
      await metadata.put(`${appBase}__app_shell__/installing/${version}`, new Response(version));
      const name = `${cachePrefix}shell:${version}`;
      if (boundary === 'partial' || boundary === 'complete') {
        const source = await caches.open(`${cachePrefix}shell:${sourceVersion}`);
        const destination = await caches.open(name);
        const keys = await source.keys();
        for (const request of boundary === 'partial' ? keys.slice(0, 2) : keys)
          await destination.put(request, (await source.match(request))!);
      }
      if (pendingAssignment)
        await metadata.put(
          `${appBase}__app_shell__/client/seeded-pending-navigation`,
          new Response(version, { headers: { 'X-App-Shell-Pending': '1' } }),
        );
      return {
        label: 'seeded persisted crash-equivalent state; not actual termination',
        boundary,
        name,
        marker: `${appBase}__app_shell__/installing/${version}`,
        cachePresent: await caches.has(name),
      };
    });
  }, options);
}

export async function installationMarker(
  page: Page,
  appBase: string,
  cachePrefix: string,
  version: string,
) {
  return page.evaluate(
    async ({ appBase, cachePrefix, version }) =>
      (
        await (
          await caches.open(`${cachePrefix}clients`)
        ).match(`${appBase}__app_shell__/installing/${version}`)
      )?.text(),
    { appBase, cachePrefix, version },
  );
}

/** Start recovery in a fresh native active-worker global, reading only persisted
 * CacheStorage state. The seed itself remains explicitly crash-equivalent.
 * Shell fetch schedules cleanup in event.waitUntil; callers poll its effect.
 */
export async function triggerRecovery(page: Page, appBase: string) {
  const observed = await observeNativeWorkers(page, new URL(`${appBase}sw.js`, page.url()).href);
  try {
    await observed.stopActive();
  } finally {
    await observed.close();
  }
  expect(
    await page.evaluate(
      async (path) => (await fetch(path, { cache: 'no-store' })).status,
      `${appBase}icons/favicon-32-v1.png`,
    ),
  ).toBe(200);
}

type NativeVersion = {
  versionId: string;
  registrationId: string;
  scriptURL: string;
  status: string;
  runningStatus: string;
};

/** Observe native versions before requesting an update; scope the installing ID
 * to this isolated app registration, not another worker/browser profile.
 */
export async function observeNativeWorkers(page: Page, scriptURL: string) {
  const session: CDPSession = await page.context().newCDPSession(page);
  const versions = new Map<string, NativeVersion>();
  const events: NativeVersion[] = [];
  session.on(
    'ServiceWorker.workerVersionUpdated',
    ({ versions: updates }: { versions: NativeVersion[] }) => {
      for (const version of updates) {
        if (version.scriptURL !== scriptURL) continue;
        versions.set(version.versionId, version);
        events.push({ ...version });
      }
    },
  );
  await session.send('ServiceWorker.enable');
  return {
    events,
    async stopInstalling() {
      await expect
        .poll(
          () =>
            [...versions.values()].find((version) => version.status === 'installing')?.versionId,
        )
        .toBeTruthy();
      const installing = [...versions.values()].find((version) => version.status === 'installing')!;
      const startedAt = Date.now();
      await session.send('ServiceWorker.stopWorker', { versionId: installing.versionId });
      await expect.poll(() => versions.get(installing.versionId)?.runningStatus).toBe('stopped');
      return { method: 'ServiceWorker.stopWorker', installing, startedAt, stoppedAt: Date.now() };
    },
    async stopActive() {
      await expect
        .poll(
          () => [...versions.values()].find((version) => version.status === 'activated')?.versionId,
        )
        .toBeTruthy();
      const active = [...versions.values()].find((version) => version.status === 'activated')!;
      await session.send('ServiceWorker.stopWorker', { versionId: active.versionId });
      await expect.poll(() => versions.get(active.versionId)?.runningStatus).toBe('stopped');
    },
    close: () => session.detach(),
  };
}
