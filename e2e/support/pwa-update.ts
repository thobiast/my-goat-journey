import { expect, type Page } from '@playwright/test';

/** Native transactions still commit; only completion delivery to the app is held. */
export async function holdNextCommit(page: Page, mode: 'readonly' | 'readwrite' = 'readwrite') {
  await page.evaluate((mode) => {
    const original = IDBDatabase.prototype.transaction;
    const state = window as typeof window & { pwaTestRelease?: () => void; pwaTestHeld?: boolean };
    state.pwaTestHeld = false;
    IDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) {
      const transaction = original.apply(this, args);
      if ((args[1] ?? 'readonly') === mode) {
        IDBDatabase.prototype.transaction = original;
        transaction.addEventListener(
          'complete',
          (event) => {
            event.stopImmediatePropagation();
            state.pwaTestHeld = true;
            state.pwaTestRelease = () => {
              state.pwaTestHeld = false;
              transaction.oncomplete?.call(transaction, event);
            };
          },
          { once: true },
        );
      }
      return transaction;
    };
  }, mode);
}

export async function releaseCommit(page: Page) {
  await page.evaluate(() =>
    (window as typeof window & { pwaTestRelease?: () => void }).pwaTestRelease?.(),
  );
}

export async function commitHeld(page: Page) {
  return page.evaluate(() => !!(window as typeof window & { pwaTestHeld?: boolean }).pwaTestHeld);
}

/** Serialize the actual parsed Document, including fixture comments after </html>.
 * page.content() omits siblings outside documentElement and loses that marker.
 */
export async function documentHtml(page: Page) {
  return page.evaluate(() => new XMLSerializer().serializeToString(document));
}

/** A document identity survives route changes but never a reload. */
export async function documentIdentity(page: Page) {
  return page.evaluate(() => {
    const state = window as typeof window & { pwaTestDocument?: string };
    return (state.pwaTestDocument ??=
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`);
  });
}

export async function unchangedDocument(page: Page, identity: string) {
  expect(await documentIdentity(page)).toBe(identity);
  await expect(
    page.getByRole('dialog', { name: /Leave without saving\?|Sair sem salvar\?/ }),
  ).toHaveCount(0);
}

/** Disable Playwright's per-session focus/visibility override, not document state.
 * A new public CDP session cannot clear the override owned by Playwright's own
 * session. This guarded adapter is pinned to the installed Playwright 1.56 API.
 * Chromium still produces native, trusted visibilitychange events.
 */
async function nativeVisibility(page: Page) {
  type Internal = {
    _connection?: {
      toImpl?: (page: Page) => {
        delegate?: {
          _mainFrameSession?: {
            _client?: { send: (method: string, params: object) => Promise<unknown> };
          };
        };
      };
    };
  };
  const internal = page as Page & Internal;
  const client = internal._connection?.toImpl?.(page)?.delegate?._mainFrameSession?._client;
  if (!client)
    throw new Error('Pinned Playwright native visibility session adapter is unavailable');
  await client.send('Emulation.setFocusEmulationEnabled', { enabled: false });
}

/** Genuine Chromium hidden→visible lifecycle, not a synthetic focus event. */
export async function background(page: Page) {
  await page.evaluate(() => {
    const state = window as typeof window & { pwaTestNativePending?: number };
    if (state.pwaTestNativePending === undefined) {
      state.pwaTestNativePending = 0;
      const open = IDBFactory.prototype.open;
      const transaction = IDBDatabase.prototype.transaction;
      IDBFactory.prototype.open = function (...args: Parameters<typeof open>) {
        ++state.pwaTestNativePending!;
        try {
          const request = open.apply(this, args);

          const finished = () => {
            --state.pwaTestNativePending!;
          };

          request.addEventListener('success', finished, { once: true });
          request.addEventListener('error', finished, { once: true });
          return request;
        } catch (error) {
          --state.pwaTestNativePending!;
          throw error;
        }
      };
      IDBDatabase.prototype.transaction = function (...args: Parameters<typeof transaction>) {
        ++state.pwaTestNativePending!;
        try {
          const result = transaction.apply(this, args);

          const finished = () => {
            --state.pwaTestNativePending!;
          };

          result.addEventListener('complete', finished, { once: true, capture: true });
          result.addEventListener('abort', finished, { once: true, capture: true });
          return result;
        } catch (error) {
          --state.pwaTestNativePending!;
          throw error;
        }
      };
    }
    sessionStorage.setItem('pwa-test-native-visibility', '[]');
    document.addEventListener('visibilitychange', (event) => {
      const events = JSON.parse(sessionStorage.getItem('pwa-test-native-visibility') ?? '[]');
      events.push({ state: document.visibilityState, trusted: event.isTrusted });
      sessionStorage.setItem('pwa-test-native-visibility', JSON.stringify(events));
    });
  });
  await nativeVisibility(page);
  const backgroundTab = await page.context().newPage();
  await backgroundTab.goto('about:blank');
  await nativeVisibility(backgroundTab);
  await backgroundTab.bringToFront();
  await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('hidden');
  expect(
    await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem('pwa-test-native-visibility') ?? '[]'),
    ),
  ).toContainEqual({ state: 'hidden', trusted: true });
  // Visibility hides trigger a real repository refresh. Let its native work
  // finish before requesting a new clean resume; held app delivery/parse leases
  // remain held and are still protected by the app's unchanged safety checks.
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { pwaTestNativePending?: number }).pwaTestNativePending,
      ),
    )
    .toBe(0);
  return async () => {
    await page.bringToFront();
    await expect
      .poll(async () => {
        try {
          return await page.evaluate(() => document.visibilityState);
        } catch (error) {
          if (
            error instanceof Error &&
            /Execution context was destroyed|Cannot find context with specified id/.test(
              error.message,
            )
          )
            return 'transitioning';
          throw error;
        }
      })
      .toBe('visible');
    await backgroundTab.close();
    await expect
      .poll(async () => {
        try {
          return await page.evaluate(() =>
            JSON.parse(sessionStorage.getItem('pwa-test-native-visibility') ?? '[]'),
          );
        } catch (error) {
          if (
            error instanceof Error &&
            /Execution context was destroyed|Cannot find context with specified id/.test(
              error.message,
            )
          )
            return [];
          throw error;
        }
      })
      .toContainEqual({ state: 'visible', trusted: true });
  };
}

export async function resume(page: Page) {
  const show = await background(page);
  await show();
}

export async function shellSnapshot(page: Page, key: string) {
  return page.evaluate(async (key) => {
    const cache = await caches.open(key);
    const entries = await Promise.all(
      (await cache.keys()).map(async (request) => {
        const response = (await cache.match(request))!;
        const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
        return {
          url: request.url,
          status: response.status,
          type: response.headers.get('content-type'),
          sha256: Array.from(new Uint8Array(digest), (value) =>
            value.toString(16).padStart(2, '0'),
          ).join(''),
        };
      }),
    );
    return entries.sort((a, b) => a.url.localeCompare(b.url));
  }, key);
}

// Replies are tied to the explicit handlers appended by the isolated proxy (and the
// native guarded-activation handler), not caller-chosen arbitrary result types.
interface WorkerReplies {
  PWA_TEST_STATUS: {
    cleanupCalls: number;
    cleanupCompleted: number;
    deleted: string[];
    opened: boolean;
    released: boolean;
    quotaMode: 'none' | 'all' | 'active';
    quotaPutsRejected: number;
    version: string;
    clients: { id: string; url: string }[];
  };
  PWA_TEST_QUOTA_ALL: { armed: 'all'; state?: ServiceWorkerState };
  PWA_TEST_QUOTA_ACTIVE: { armed: 'active'; state?: ServiceWorkerState };
  PWA_TEST_RELEASE_CACHE_OPEN: { released: true };
  PWA_TEST_SKIP_WAITING: { forced: true };
  ACTIVATE_WHEN_ALONE: { accepted: boolean };
  PWA_TEST_ARM_PENDING_RACE: { armed: true; omitId: string };
  PWA_TEST_PENDING_RACE_STATUS: {
    armed: boolean;
    held: boolean;
    released: boolean;
    promotions: number;
    omitId?: string;
  };
  PWA_TEST_RELEASE_PENDING_RACE: { released: true };
}

export async function workerMessage<Type extends keyof WorkerReplies>(
  page: Page,
  role: 'active' | 'waiting' | 'installing',
  type: Type,
) {
  return page.evaluate(
    async ({ role, type }) => {
      const worker = (await navigator.serviceWorker.getRegistration())?.[role];
      if (!worker) throw new Error(`No ${role} service worker`);
      return new Promise<WorkerReplies[Type]>((resolve, reject) => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => {
          channel.port1.close();
          reject(new Error(type + ' acknowledgement timed out'));
        }, 5000);
        channel.port1.onmessage = (event) => {
          clearTimeout(timer);
          channel.port1.close();
          // The selected fixture handler owns this reply; no application validation runs.
          resolve(event.data as WorkerReplies[Type]);
        };
        worker.postMessage({ type }, [channel.port2]);
      });
    },
    { role, type },
  );
}

/** Cache-coherence isolation only: NEVER use this to prove product activation policy. */
export async function forceTestActivation(page: Page) {
  await workerMessage(page, 'waiting', 'PWA_TEST_SKIP_WAITING');
  await expect
    .poll(() =>
      page.evaluate(async () => !(await navigator.serviceWorker.getRegistration())?.waiting),
    )
    .toBe(true);
}

/** Compiled worker instrumentation is appended by the isolated proxy only.
 * The barrier is AFTER named CacheStorage.open returns its real Cache handle,
 * BEFORE candidate publication. It is not an asset/network pre-open pause.
 * CONFIG/version/integrity and every compiled application/shell byte stay intact.
 */
export function instrumentCompiledWorker(source: string, barrier = false) {
  const cleanup = 'async function cleanup() {';
  if (!source.includes(cleanup)) throw new Error('Compiled cleanup instrumentation anchor missing');
  const prefix = `globalThis.__pwaTest = { cleanupCalls: 0, cleanupCompleted: 0, deleted: [], opened: false, released: false, quotaMode: 'none', quotaPutsRejected: 0 };\n`;
  const suffix = `
// TEST ONLY: emitted by the disposable browser proxy, never shipped.
const __pwaTestOpen = caches.open.bind(caches), __pwaTestDelete = caches.delete.bind(caches);
const __pwaTestMetaHandles = new WeakSet(), __pwaTestPut = Cache.prototype.put;
Cache.prototype.put = function(request, response) {
  const url = typeof request === 'string' ? new URL(request, self.location.origin).href : request.url;
  if (__pwaTestMetaHandles.has(this) && (globalThis.__pwaTest.quotaMode === 'all' || globalThis.__pwaTest.quotaMode === 'active' && url === activeKey)) {
    ++globalThis.__pwaTest.quotaPutsRejected;
    return Promise.reject(new DOMException('Isolated native metadata put quota rejection', 'QuotaExceededError'));
  }
  return __pwaTestPut.call(this, request, response);
};
caches.delete = async name => { globalThis.__pwaTest.deleted.push(name); return __pwaTestDelete(name); };
caches.open = async name => {
  const cache = await __pwaTestOpen(name);
  if (name === META) __pwaTestMetaHandles.add(cache);
  ${
    barrier
      ? `if (name === CACHE && !globalThis.__pwaTest.opened) {
    globalThis.__pwaTest.opened = true;
    await new Promise(resolve => { globalThis.__pwaTest.release = resolve; });
  }`
      : ''
  }
  return cache;
};
self.addEventListener('message', event => {
  if (event.data?.type === 'PWA_TEST_QUOTA_ALL' || event.data?.type === 'PWA_TEST_QUOTA_ACTIVE') {
    globalThis.__pwaTest.quotaMode = event.data.type === 'PWA_TEST_QUOTA_ALL' ? 'all' : 'active';
    event.ports[0]?.postMessage({ armed: globalThis.__pwaTest.quotaMode, state: self.registration.waiting?.state });
  }
  if (event.data?.type === 'PWA_TEST_STATUS') event.waitUntil(windows().then(clients => event.ports[0]?.postMessage({ ...globalThis.__pwaTest, release: undefined, version: CONFIG.version, clients: clients.map(client => ({ id: client.id, url: client.url })) })));
  if (event.data?.type === 'PWA_TEST_RELEASE_CACHE_OPEN') {
    globalThis.__pwaTest.released = true; globalThis.__pwaTest.release?.(); event.ports[0]?.postMessage({ released: true });
  }
  if (event.data?.type === 'PWA_TEST_SKIP_WAITING') event.waitUntil(self.skipWaiting().then(() => event.ports[0]?.postMessage({ forced: true })));
});\n`;
  const observedCleanup = `async function cleanup() {
    ++globalThis.__pwaTest.cleanupCalls;
    try { return await __pwaTestOriginalCleanup(); } finally { ++globalThis.__pwaTest.cleanupCompleted; }
  }
`;
  return (
    prefix +
    source.replace(cleanup, 'async function __pwaTestOriginalCleanup() {') +
    observedCleanup +
    suffix
  );
}
