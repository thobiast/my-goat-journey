import { test, expect, type Page } from '@playwright/test';
import { setupScheduledHabits, nav, readDataset, abortNextWrite } from './support/habit-fixtures';
import {
  holdNextCommit,
  commitHeld,
  releaseCommit,
  documentIdentity,
  unchangedDocument,
  resume,
} from './support/pwa-update';
import en from '../src/i18n/en.json' with { type: 'json' };
import pt from '../src/i18n/pt.json' with { type: 'json' };

test.setTimeout(90_000);
test.use({ channel: 'chromium' });
test.afterEach(async ({ page }, testInfo) => {
  if (page.isClosed()) return;
  // Finish intercepted module requests before Playwright closes the page. Do
  // not suppress route failures or let teardown abort an accepted reload.
  await page.unrouteAll({ behavior: 'wait' });
  const diagnostic = await page
    .evaluate(() => {
      const state = window as typeof window & {
        pwaTestNativePending?: number;
        pwaTestSnapshot?: unknown;
      };
      return {
        snapshot: state.pwaTestSnapshot,
        nativePending: state.pwaTestNativePending,
        visibility: document.visibilityState,
        accepted: sessionStorage.getItem('update-accepted'),
        nativeVisibility: JSON.parse(sessionStorage.getItem('pwa-test-native-visibility') ?? '[]'),
        safetyChecks: JSON.parse(sessionStorage.getItem('pwa-test-safety-checks') ?? '[]'),
      };
    })
    .catch((error) => ({ evaluationError: String(error) }));
  await testInfo.attach('development-real-safety-diagnostic', {
    body: JSON.stringify(diagnostic, null, 2),
    contentType: 'application/json',
  });
});

// Development lifecycle seam only. Production acceptance/cache isolation is in
// production-pwa.spec.ts against real emitted workers and nginx A/B/C.
async function updates(page: Page, pendingOnEntry = false) {
  await page.route('**/src/pwa/update.ts*', async (route) => {
    // Retry only Playwright's documented transient ECONNRESET transport failure;
    // do not retry HTTP/application failures or alter lifecycle assertions.
    const response = await route.fetch({ maxRetries: 2 });
    const injection = `options.enabled = true; options.timeoutMs = 500;
      const pwaTestAccept = options.canAccept, pwaTestChanged = options.changed;
      options.canAccept = () => {
        const result = pwaTestAccept();
        const checks = JSON.parse(sessionStorage.getItem('pwa-test-safety-checks') ?? '[]');
        checks.push({ result, visibility: document.visibilityState, nativePending: globalThis.pwaTestNativePending, stack: new Error().stack });
        sessionStorage.setItem('pwa-test-safety-checks', JSON.stringify(checks)); return result;
      };
      options.changed = snapshot => { globalThis.pwaTestSnapshot = snapshot; pwaTestChanged(snapshot); };
      const sw = options.serviceWorker`;
    const body = (await response.text()).replace('const sw = options.serviceWorker', injection);
    if (body === (await response.text()))
      throw new Error('Development update injection anchor missing');
    await route.fulfill({ response, body });
  });
  await page.addInitScript(
    ({ pendingOnEntry }) => {
      const state = window as typeof window & {
        pwaTestOffer?: () => void;
        pwaTestActivationMode?: 'allow' | 'deny' | 'fail' | 'silent';
        pwaTestChecks?: number;
      };
      const worker = Object.assign(new EventTarget(), {
        state: 'installed',
        postMessage(message: { type: string }, transfer: MessagePort[]) {
          if (message.type !== 'ACTIVATE_WHEN_ALONE' || !transfer?.[0])
            throw new Error('Unexpected/unacknowledged activation contract');
          const mode = state.pwaTestActivationMode ?? 'allow';
          if (mode === 'fail') throw new Error('Isolated activation rejection');
          if (mode === 'silent') return;
          transfer[0].postMessage({ accepted: mode === 'allow' });
          if (mode === 'deny') return;
          sessionStorage.setItem(
            'update-accepted',
            String(Number(sessionStorage.getItem('update-accepted') ?? 0) + 1),
          );
          queueMicrotask(() => {
            worker.state = 'activated';
            registration.waiting = null;
            registration.active = worker;
            worker.dispatchEvent(new Event('statechange'));
            container.controller = worker;
            container.dispatchEvent(new Event('controllerchange'));
          });
        },
      });
      const registration = Object.assign(new EventTarget(), {
        active: {} as object,
        waiting: pendingOnEntry && !sessionStorage.getItem('update-accepted') ? worker : null,
        installing: null as typeof worker | null,
        update: async (): Promise<void> => {
          state.pwaTestChecks = (state.pwaTestChecks ?? 0) + 1;
        },
      });
      const container = Object.assign(new EventTarget(), {
        controller: {} as object,
        register: async () => registration,
      });
      state.pwaTestOffer = () => {
        registration.waiting = worker;
        registration.installing = worker;
        registration.dispatchEvent(new Event('updatefound'));
        worker.dispatchEvent(new Event('statechange'));
        registration.installing = null;
      };
      Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container });
    },
    { pendingOnEntry },
  );
}

async function offer(page: Page) {
  await page.evaluate(() =>
    (window as typeof window & { pwaTestOffer?: () => void }).pwaTestOffer?.(),
  );
}

async function count(page: Page, key = 'update-accepted') {
  try {
    return await page.evaluate((key) => Number(sessionStorage.getItem(key) ?? 0), key);
  } catch (error) {
    // Polling may cross the very reload it is proving. Do not turn a destroyed
    // document into a test error, and do not hide any other evaluation failure.
    if (
      error instanceof Error &&
      /Execution context was destroyed|Cannot find context with specified id/.test(error.message)
    )
      return -1;
    throw error;
  }
}

async function deferred(page: Page, identity: string) {
  await page.waitForTimeout(100);
  expect(await count(page)).toBe(0);
  await unchangedDocument(page, identity);
}

const update = (page: Page, language: 'en' | 'pt' = 'en') =>
  page.getByRole('button', { name: language === 'en' ? en.updateNow : pt.updateNow, exact: true });

async function applyResume(page: Page) {
  const identity = await documentIdentity(page);
  await resume(page);
  await expect.poll(() => count(page)).toBe(1);
  await expect.poll(() => documentIdentity(page)).not.toBe(identity);
}

async function setup(page: Page) {
  await updates(page);
  await setupScheduledHabits(page);
}

async function fixture(page: Page) {
  const { revision: _revision, ...dataset } = await readDataset(page);
  return Buffer.from(
    JSON.stringify({
      format: 'my-goat-journey-backup',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      dataset,
    }),
  );
}

async function holdParse(page: Page) {
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      File.prototype.arrayBuffer = original;
      sessionStorage.setItem('parse-held', 'true');
      return new Promise<ArrayBuffer>((resolve, reject) => {
        (window as typeof window & { pwaTestParseRelease?: () => void }).pwaTestParseRelease =
          () => {
            original.call(this).then(resolve, reject);
          };
      });
    };
  });
}

async function releaseParse(page: Page) {
  await page.evaluate(() =>
    (window as typeof window & { pwaTestParseRelease?: () => void }).pwaTestParseRelease?.(),
  );
}

test('pristine document entry automatically applies a waiting worker exactly once', async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem(
      'update-documents',
      String(Number(sessionStorage.getItem('update-documents') ?? 0) + 1),
    ),
  );
  await updates(page, true);
  await page.goto('./');
  await expect.poll(() => count(page)).toBe(1);
  await expect.poll(() => count(page, 'update-documents')).toBe(2);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('button', { name: en.start, exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await page.waitForTimeout(100);
  expect(await count(page)).toBe(1);
  expect(await page.evaluate(() => Number(sessionStorage.getItem('update-documents')))).toBe(2);
});

test('quiet download after interaction and focus/pageshow do not authorize transition; genuine resume does', async ({
  page,
}) => {
  await setup(page);
  const identity = await documentIdentity(page);
  const before = await readDataset(page);
  await offer(page);
  await deferred(page, identity);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('pageshow'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await deferred(page, identity);
  await applyResume(page);
  expect(await readDataset(page)).toEqual(before);
});

for (const language of ['en', 'pt'] as const)
  test(`Settings optional check and pending manual fallback are localized and preserve facts ${language}`, async ({
    page,
  }) => {
    await setup(page);
    await nav(page, en.settings).click();
    if (language === 'pt') {
      await page.getByLabel(en.language, { exact: true }).selectOption('pt');
      await expect(page.getByRole('heading', { name: pt.settings, exact: true })).toBeVisible();
    }
    const copy = language === 'en' ? en : pt;
    const before = await readDataset(page);
    const identity = await documentIdentity(page);
    await offer(page);
    await page.getByRole('button', { name: copy.updateCheck, exact: true }).click();
    await deferred(page, identity);
    await expect(page.getByRole('button', { name: copy.updateLater, exact: true })).toHaveCount(0);
    await expect(update(page, language)).toBeEnabled();
    const loaded = page.waitForEvent('domcontentloaded');
    await update(page, language).click();
    await loaded;
    await expect.poll(() => count(page)).toBe(1);
    await expect(page.getByRole('heading', { name: copy.today, exact: true })).toBeVisible();
    expect(await readDataset(page)).toEqual(before);
  });

for (const form of ['habit', 'pillar'] as const)
  test(`dirty ${form} never gets automatic discard; explicit navigation keeps/discards existing guard`, async ({
    page,
  }) => {
    await setup(page);
    const before = await readDataset(page);
    if (form === 'habit')
      await page.getByRole('button', { name: en.addHabit, exact: true }).click();
    else {
      await nav(page, en.pillars).click();
      await page.getByRole('button', { name: en.newPillar, exact: true }).click();
    }
    const field = page.getByRole('textbox');
    await field.fill('Literal unsaved 🎵');
    const identity = await documentIdentity(page);
    await offer(page);
    await resume(page);
    await deferred(page, identity);
    await expect(field).toHaveValue('Literal unsaved 🎵');
    expect(await readDataset(page)).toEqual(before);
    await nav(page, en.settings).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(field).toHaveValue('Literal unsaved 🎵');
    await nav(page, en.settings).click();
    await page.getByRole('button', { name: en.keepEditing, exact: true }).click();
    await expect(field).toHaveValue('Literal unsaved 🎵');
    await nav(page, en.settings).click();
    await page.getByRole('button', { name: en.discardChanges, exact: true }).click();
    const loaded = page.waitForEvent('domcontentloaded');
    await update(page).click();
    await loaded;
    expect(await count(page)).toBe(1);
    expect(await readDataset(page)).toEqual(before);
  });

test('failed onboarding autosave remains unsaved through resume; Retry and a later safe resume preserve literal', async ({
  page,
}) => {
  await updates(page);
  await page.goto('./');
  await page.getByRole('button', { name: en.start, exact: true }).click();
  await expect(page.getByRole('heading', { name: en.mind, exact: true })).toBeVisible();
  await abortNextWrite(page);
  await page.locator('#goal').fill('Failed draft must survive');
  await expect(page.getByRole('alert')).toContainText(en.saveError);
  const identity = await documentIdentity(page);
  await offer(page);
  await resume(page);
  await deferred(page, identity);
  await expect(page.locator('#goal')).toHaveValue('Failed draft must survive');
  await page.getByRole('button', { name: en.retry, exact: true }).click();
  await expect(page.getByRole('status')).toContainText(en.draftSaved);
  await deferred(page, identity);
  await applyResume(page);
  await expect(page.locator('#goal')).toHaveValue('Failed draft must survive');
  expect((await readDataset(page)).draft!.goals[0].goal).toBe('Failed draft must survive');
});

test('all serialized onboarding writes remain protected, not just the first autosave', async ({
  page,
}) => {
  await updates(page);
  await page.goto('./');
  await page.getByRole('button', { name: en.start, exact: true }).click();
  await expect(page.getByRole('heading', { name: en.mind, exact: true })).toBeVisible();
  await holdNextCommit(page);
  await page.locator('#goal').fill('First draft');
  await expect.poll(() => commitHeld(page)).toBe(true);
  await page.locator('#goal').fill('Last queued draft');
  const identity = await documentIdentity(page);
  await offer(page);
  await resume(page);
  await deferred(page, identity);
  await releaseCommit(page);
  await expect(page.getByRole('status')).toContainText(en.draftSaved);
  expect((await readDataset(page)).draft!.goals[0].goal).toBe('Last queued draft');
  await applyResume(page);
  await expect(page.locator('#goal')).toHaveValue('Last queued draft');
});

test('resume readonly queue and export lease block automatic/manual acceptance until completion', async ({
  page,
}) => {
  await setup(page);
  await nav(page, en.settings).click();
  const identity = await documentIdentity(page);
  await offer(page);
  await holdNextCommit(page, 'readonly');
  await page.getByRole('button', { name: en.exportBackup, exact: true }).click();
  await expect.poll(() => commitHeld(page)).toBe(true);
  await expect(update(page)).toBeDisabled();
  await resume(page);
  await deferred(page, identity);
  await update(page).evaluate((button: HTMLButtonElement) => button.click());
  expect(await count(page)).toBe(0);
  await releaseCommit(page);
  await expect(update(page)).toBeEnabled();
  const before = await readDataset(page);
  await applyResume(page);
  expect(await readDataset(page)).toEqual(before);
});

for (const stage of ['read', 'download'] as const)
  test(`backup export ${stage} failure releases operation and update guards`, async ({ page }) => {
    await setup(page);
    await nav(page, en.settings).click();
    const before = await readDataset(page);
    const identity = await documentIdentity(page);
    await offer(page);
    await expect(update(page)).toBeEnabled();
    await page.evaluate((stage) => {
      if (stage === 'read') {
        const original = IDBObjectStore.prototype.get;
        IDBObjectStore.prototype.get = function (...args: Parameters<typeof original>) {
          IDBObjectStore.prototype.get = original;
          const request = original.apply(this, args);
          this.transaction.abort();
          return request;
        };
      } else {
        const original = URL.createObjectURL;
        URL.createObjectURL = () => {
          URL.createObjectURL = original;
          throw new Error('Isolated fictional download failure');
        };
      }
    }, stage);
    const downloads: string[] = [];
    page.on('download', (download) => downloads.push(download.suggestedFilename()));
    const exportButton = page.getByRole('button', { name: en.exportBackup, exact: true });
    await exportButton.click();
    await expect(page.getByRole('alert')).toContainText(en.saveError);
    await expect(exportButton).toBeEnabled();
    await expect(update(page)).toBeEnabled();
    expect(downloads).toEqual([]);
    expect(await count(page)).toBe(0);
    await unchangedDocument(page, identity);
    expect(await readDataset(page)).toEqual(before);

    const pending = page.waitForEvent('download');
    await exportButton.click();
    await pending;
    await expect(page.getByText(en.downloadStarted, { exact: true })).toBeVisible();
    await expect(update(page)).toBeEnabled();
    const loaded = page.waitForEvent('domcontentloaded');
    await update(page).click();
    await loaded;
    await expect.poll(() => count(page)).toBe(1);
    expect(await readDataset(page)).toEqual(before);
  });

test('backup parsing and visible restore/delete confirmations cannot be silently discarded', async ({
  page,
}) => {
  await setup(page);
  await nav(page, en.settings).click();
  const bytes = await fixture(page);
  const identity = await documentIdentity(page);
  await offer(page);
  await holdParse(page);
  await page
    .locator('#backup-file')
    .setInputFiles({ name: 'private.json', mimeType: 'application/json', buffer: bytes });
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('parse-held'))).toBe('true');
  await expect(update(page)).toBeDisabled();
  await resume(page);
  await deferred(page, identity);
  await releaseParse(page);
  await expect(page.getByText(en.backupReady, { exact: true })).toBeVisible();
  await expect(update(page)).toBeDisabled();
  await resume(page);
  await deferred(page, identity);
  await page.getByRole('button', { name: en.cancel, exact: true }).click();
  await expect(update(page)).toBeEnabled();
  await page.getByRole('button', { name: en.deleteOpen, exact: true }).click();
  await expect(update(page)).toBeDisabled();
  await resume(page);
  await deferred(page, identity);
  await page.getByRole('button', { name: en.cancel, exact: true }).click();
  await applyResume(page);
});

test('backup parse lease survives explicit Settings disposal', async ({ page }) => {
  await setup(page);
  await nav(page, en.settings).click();
  const bytes = await fixture(page);
  const before = await readDataset(page);
  const identity = await documentIdentity(page);
  await offer(page);
  await holdParse(page);
  await page
    .locator('#backup-file')
    .setInputFiles({ name: 'private.json', mimeType: 'application/json', buffer: bytes });
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('parse-held'))).toBe('true');
  await nav(page, en.today).click();
  await resume(page);
  await deferred(page, identity);
  await releaseParse(page);
  await applyResume(page);
  expect(await readDataset(page)).toEqual(before);
});

for (const mode of ['deny', 'fail', 'silent'] as const)
  test(`activation ${mode} releases inert lock and never reloads; explicit fallback can retry`, async ({
    page,
  }) => {
    await setup(page);
    await nav(page, en.settings).click();
    const identity = await documentIdentity(page);
    const before = await readDataset(page);
    await page.evaluate((mode) => {
      (window as typeof window & { pwaTestActivationMode?: typeof mode }).pwaTestActivationMode =
        mode;
    }, mode);
    await offer(page);
    await update(page).click();
    await expect(update(page)).toBeEnabled();
    await deferred(page, identity);
    expect(await page.locator('main').evaluate((element) => (element as HTMLElement).inert)).toBe(
      false,
    );
    expect(await readDataset(page)).toEqual(before);
    await page.evaluate(() => {
      (window as typeof window & { pwaTestActivationMode?: string }).pwaTestActivationMode =
        'allow';
    });
    const loaded = page.waitForEvent('domcontentloaded');
    await update(page).click();
    await loaded;
    expect(await count(page)).toBe(1);
    expect(await readDataset(page)).toEqual(before);
  });
