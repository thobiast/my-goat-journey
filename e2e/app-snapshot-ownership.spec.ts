import { test, expect, type Page } from '@playwright/test';
import type { Dataset } from '../src/domain/types';
import { developmentModuleUrl } from './support/development-module';
import { nav, readDataset, setupScheduledHabits, abortNextWrite } from './support/habit-fixtures';
import en from '../src/i18n/en.json' with { type: 'json' };

test.setTimeout(60_000);

type DeliveryMode = 'readonly' | 'readwrite';

/** Like pwa-update's native barrier: storage commits before App receives completion. */
async function nativeDelivery(page: Page) {
  return page.evaluateHandle(() => {
    const transaction = IDBDatabase.prototype.transaction;
    const put = IDBObjectStore.prototype.put;
    const counts = { readonly: 0, readwrite: 0, puts: 0 };
    const gates: {
      mode: DeliveryMode;
      ordinal: number;
      release?: () => void;
    }[] = [];
    let active = true;

    IDBDatabase.prototype.transaction = function (...args: Parameters<typeof transaction>) {
      const result = transaction.apply(this, args);
      if (this.name !== 'my-goat-journey' || !result.objectStoreNames.contains('dataset'))
        return result;
      const mode = result.mode;
      if (mode !== 'readonly' && mode !== 'readwrite') return result;
      const ordinal = ++counts[mode];
      const gate = gates.find((gate) => gate.mode === mode && gate.ordinal === ordinal);
      if (gate) {
        result.addEventListener(
          'complete',
          (event) => {
            if (!active) return;
            event.stopImmediatePropagation();
            gate.release = () => {
              gates.splice(gates.indexOf(gate), 1);
              result.oncomplete?.call(result, event);
            };
          },
          { once: true },
        );
      }
      return result;
    };
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      if (this.name === 'dataset' && this.transaction.db.name === 'my-goat-journey') ++counts.puts;
      return put.apply(this, args);
    };

    return {
      arm(mode: DeliveryMode) {
        gates.push({ mode, ordinal: counts[mode] + 1 });
      },
      held: (mode: DeliveryMode) => gates.some((gate) => gate.mode === mode && !!gate.release),
      release(mode: DeliveryMode) {
        const gate = gates.find((gate) => gate.mode === mode && gate.release);
        if (!gate?.release) throw new Error(`No held ${mode} completion`);
        gate.release();
      },
      counts: () => ({ ...counts }),
      dispose() {
        active = false;
        IDBDatabase.prototype.transaction = transaction;
        IDBObjectStore.prototype.put = put;
        for (const gate of [...gates]) gate.release?.();
      },
    };
  });
}

async function onboarding(page: Page) {
  await page.clock.install({ time: new Date('2026-09-27T12:00:00') });
  await page.goto('./');
  await page.getByRole('button', { name: en.start, exact: true }).click();
  await expect(page.getByRole('heading', { name: en.mind, exact: true })).toBeVisible();
}

/** Observe real Repository calls; only the explicitly armed coded failure is synthetic. */
async function repositoryProbe(page: Page) {
  test.skip(
    (await page.locator('script[src*="/@vite/client"]').count()) === 0,
    'Repository observation and coded failure injection require development modules',
  );
  const modulePath = await developmentModuleUrl(page, '/src/data/database.ts');
  const errorsPath = await developmentModuleUrl(page, '/src/domain/errors.ts');
  return page.evaluateHandle(
    async ({ modulePath, errorsPath }) => {
      const { Repository }: typeof import('../src/data/database') = await import(modulePath);
      const { DatasetError }: typeof import('../src/domain/errors') = await import(errorsPath);
      const saveDraft = Repository.prototype.saveDraft;
      const load = Repository.prototype.load;
      const createPillar = Repository.prototype.createPillar;
      const postMessage = BroadcastChannel.prototype.postMessage;
      const saves: { revision: number | undefined; goal: string; step: number }[] = [];
      const loads: { revision: number | undefined }[] = [];
      const notifications: number[] = [];
      let stalePillar = false;
      let notified = 0;
      // Created after App's channel, so this witness observes the same delivery
      // after App's synchronous receipt-time epoch/feedback invalidation.
      const observer = new BroadcastChannel('my-goat-journey-dataset');
      observer.onmessage = (event) => {
        if (typeof event.data?.revision === 'number') ++notified;
      };
      BroadcastChannel.prototype.postMessage = function (message: unknown) {
        if (
          this.name === 'my-goat-journey-dataset' &&
          message !== null &&
          typeof message === 'object' &&
          'revision' in message &&
          typeof message.revision === 'number'
        )
          notifications.push(message.revision);
        return postMessage.call(this, message);
      };
      Repository.prototype.saveDraft = function (draft, revision) {
        saves.push({ revision, goal: draft.goals[0].goal, step: draft.step });
        return saveDraft.call(this, draft, revision);
      };
      Repository.prototype.load = function (now, revision) {
        loads.push({ revision });
        return load.call(this, now, revision);
      };
      Repository.prototype.createPillar = function (...args: Parameters<typeof createPillar>) {
        if (stalePillar) {
          stalePillar = false;
          return Promise.reject(new DatasetError('stale-revision', 'Controlled review conflict'));
        }
        return createPillar.apply(this, args);
      };

      return {
        calls: () => ({ saves: [...saves], loads: [...loads] }),
        notifications: () => [...notifications],
        notified: () => notified,
        failNextPillar: () => {
          stalePillar = true;
        },
        async replace(candidate: Dataset) {
          const peer = new Repository();
          try {
            const replacement = await peer.replaceDataset(
              candidate,
              candidate.revision,
              new Date(),
            );
            // Repository does not broadcast: deliver the real committed peer revision
            // through App's existing channel, never assign it as UI authority.
            const sender = new BroadcastChannel('my-goat-journey-dataset');
            sender.postMessage({ revision: replacement.revision });
            sender.close();
            return replacement;
          } finally {
            await peer.close();
          }
        },
        dispose() {
          Repository.prototype.saveDraft = saveDraft;
          Repository.prototype.load = load;
          Repository.prototype.createPillar = createPillar;
          BroadcastChannel.prototype.postMessage = postMessage;
          observer.close();
        },
      };
    },
    { modulePath, errorsPath },
  );
}

test('sequential autosaves adopt the preceding revision without replacing newer literal input or saving feedback', async ({
  page,
}) => {
  await onboarding(page);
  const before = await readDataset(page);
  const delivery = await nativeDelivery(page);
  const input = page.getByLabel(en.goal, { exact: true });
  const older = 'First fictional draft';
  const newer = '  Newer fictional draft 🎵  ';
  try {
    await delivery.evaluate((probe) => probe.arm('readwrite'));
    await input.fill(older);
    await expect.poll(() => delivery.evaluate((probe) => probe.held('readwrite'))).toBe(true);
    const first = await readDataset(page);
    expect(first.revision).toBe(before.revision + 1);
    expect(first.draft!.goals[0].goal).toBe(older);

    // Same epoch, no peer notification: the second autosave waits for adoption of
    // the first result, not for a React effect to promote its expected revision.
    await input.fill(newer);
    await expect(page.getByRole('status')).toHaveText(en.saving);
    expect(await delivery.evaluate((probe) => probe.counts().readwrite)).toBe(1);
    await delivery.evaluate((probe) => {
      probe.arm('readwrite');
      probe.release('readwrite');
    });
    await expect.poll(() => delivery.evaluate((probe) => probe.held('readwrite'))).toBe(true);
    await expect(input).toHaveValue(newer);
    await expect(page.getByRole('status')).toHaveText(en.saving);
    await expect(page.getByRole('alert')).toHaveCount(0);
    const second = await readDataset(page);
    expect(second).toEqual({
      ...first,
      revision: first.revision + 1,
      draft: {
        ...first.draft!,
        goals: first.draft!.goals.map((goal, index) =>
          index === 0 ? { ...goal, goal: newer } : goal,
        ),
      },
    });
    expect(await delivery.evaluate((probe) => probe.counts().puts)).toBe(2);

    await delivery.evaluate((probe) => probe.release('readwrite'));
    await expect(page.getByRole('status')).toHaveText(en.draftSaved);
    await expect(input).toHaveValue(newer);
    expect(await delivery.evaluate((probe) => probe.counts().readwrite)).toBe(2);
    expect(await readDataset(page)).toEqual(second);
  } finally {
    await delivery.evaluate((probe) => probe.dispose());
    await delivery.dispose();
  }
});

test('older autosave completion cannot make a failed newer literal draft update-safe after the queue drains', async ({
  page,
}) => {
  type SafetyWindow = Window & { snapshotOwnershipCanAccept?: () => boolean };
  // Observe the real App predicate at its existing development controller seam.
  // Do not enable updates, replace its result or read hook/ref positions.
  await page.route('**/src/pwa/update.ts*', async (route) => {
    const response = await route.fetch();
    const original = await response.text();
    const anchor = 'const sw = options.serviceWorker';
    expect(original).toContain(anchor);
    await route.fulfill({
      response,
      body: original.replace(
        anchor,
        'globalThis.snapshotOwnershipCanAccept = options.canAccept; ' + anchor,
      ),
    });
  });
  try {
    await onboarding(page);
    test.skip(
      (await page.locator('script[src*="/@vite/client"]').count()) === 0,
      'Observing the real update-safety callback requires development modules',
    );
    const canAccept = () =>
      page.evaluate(() => (window as SafetyWindow).snapshotOwnershipCanAccept!());
    await expect.poll(canAccept).toBe(true);
    const before = await readDataset(page);
    const delivery = await nativeDelivery(page);
    const input = page.getByLabel(en.goal, { exact: true });
    const newer = '  Failed newer fictional draft 🎵  ';
    try {
      await delivery.evaluate((probe) => probe.arm('readwrite'));
      await input.fill('Older successful fictional draft');
      await expect.poll(() => delivery.evaluate((probe) => probe.held('readwrite'))).toBe(true);
      const first = await readDataset(page);
      expect(first.revision).toBe(before.revision + 1);
      await input.fill(newer);
      await expect(page.getByRole('status')).toHaveText(en.saving);
      await abortNextWrite(page);
      await delivery.evaluate((probe) => probe.release('readwrite'));
      // This error consumer runs after enqueue's finally has drained both saves.
      // With no pending work left, only unsaved ownership must block acceptance.
      await expect(page.getByRole('alert')).toContainText(en.saveError);
      await expect(input).toHaveValue(newer);
      await expect(page.getByRole('status')).toBeEmpty();
      expect(await readDataset(page)).toEqual(first);
      expect(await delivery.evaluate((probe) => probe.counts().readwrite)).toBe(2);
      expect(await canAccept()).toBe(false);
      await page.getByRole('button', { name: en.retry, exact: true }).click();
      await expect(page.getByRole('status')).toHaveText(en.draftSaved);
      await expect.poll(canAccept).toBe(true);
      await expect(input).toHaveValue(newer);
      const saved = await readDataset(page);
      expect(saved.revision).toBe(first.revision + 1);
      expect(saved.draft!.goals[0].goal).toBe(newer);
      expect(await delivery.evaluate((probe) => probe.counts().readwrite)).toBe(3);
    } finally {
      await delivery.evaluate((probe) => probe.dispose());
      await delivery.dispose();
    }
  } finally {
    await page.unrouteAll({ behavior: 'wait' });
    await page.evaluate(() => {
      delete (window as SafetyWindow).snapshotOwnershipCanAccept;
    });
  }
});

for (const operation of ['autosave', 'commit'] as const) {
  test(`peer invalidation during a successful pending ${operation} rejects old queued work and suppresses its obsolete consumer`, async ({
    page,
  }) => {
    await onboarding(page);
    const input = page.getByLabel(en.goal, { exact: true });
    if (operation === 'commit') {
      await input.fill('Local fictional commitment');
      await expect(page.getByRole('status')).toHaveText(en.draftSaved);
    }
    const repository = await repositoryProbe(page);
    const delivery = await nativeDelivery(page);
    try {
      await delivery.evaluate((probe) => probe.arm('readwrite'));
      if (operation === 'autosave') await input.fill('Older committed fictional draft');
      else await page.getByRole('button', { name: en.continue, exact: true }).click();
      await expect.poll(() => delivery.evaluate((probe) => probe.held('readwrite'))).toBe(true);
      const locallyCommitted = await readDataset(page);
      expect(locallyCommitted.draft!.step).toBe(operation === 'autosave' ? 1 : 2);
      if (operation === 'autosave') {
        await input.fill('Queued obsolete fictional draft');
        await expect(page.getByRole('status')).toHaveText(en.saving);
      } else {
        // Foreground commits disable editing. A real lifecycle callback can still
        // enqueue a read in the old epoch; it must not start after peer receipt.
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      }
      expect(await repository.evaluate((probe) => probe.calls())).toEqual({
        saves: [
          {
            revision: locallyCommitted.revision - 1,
            goal: locallyCommitted.draft!.goals[0].goal,
            step: locallyCommitted.draft!.step,
          },
        ],
        loads: [],
      });

      const candidate = structuredClone(locallyCommitted);
      candidate.draft!.step = 1;
      candidate.draft!.editingReview = false;
      candidate.draft!.goals[0].goal = 'Peer replacement fictional draft';
      candidate.draft!.goals[0].configured = false;
      const replacement = await repository.evaluate(
        (probe, candidate) => probe.replace(candidate),
        candidate,
      );
      await expect.poll(() => repository.evaluate((probe) => probe.notified())).toBe(1);
      expect(await readDataset(page)).toEqual(replacement);

      // Hold the peer refresh too: inspect the obsolete success continuation
      // before the replacement display could hide an accidental old publication.
      await delivery.evaluate((probe) => {
        probe.arm('readonly');
        probe.release('readwrite');
      });
      await expect.poll(() => delivery.evaluate((probe) => probe.held('readonly'))).toBe(true);
      await expect(page.getByRole('heading', { name: en.mind, exact: true })).toBeVisible();
      await expect(page.getByRole('status')).toBeEmpty();
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(input).toHaveValue(
        operation === 'autosave' ? 'Queued obsolete fictional draft' : 'Local fictional commitment',
      );
      const calls = await repository.evaluate((probe) => probe.calls());
      expect(calls.saves).toHaveLength(1);
      expect(calls.loads).toEqual([{ revision: undefined }]);
      expect(await repository.evaluate((probe) => probe.notifications())).toEqual([
        replacement.revision,
      ]);
      expect(await delivery.evaluate((probe) => probe.counts().readwrite)).toBe(2);
      expect(await delivery.evaluate((probe) => probe.counts().puts)).toBe(2);

      // No assertion cancels the already-committed transaction or forbids its
      // internal adoption. The later queued refresh owns the replacement display.
      await delivery.evaluate((probe) => probe.release('readonly'));
      await expect(input).toHaveValue('Peer replacement fictional draft');
      await expect(page.getByRole('heading', { name: en.mind, exact: true })).toBeVisible();
      await expect(page.getByRole('alert')).toContainText(en.staleError);
      await expect(page.getByRole('status')).toBeEmpty();
      await expect(page.getByRole('button', { name: en.retry, exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: en.reload, exact: true })).toBeEnabled();
      expect(await readDataset(page)).toEqual(replacement);
      expect(await delivery.evaluate((probe) => probe.counts().readwrite)).toBe(2);
    } finally {
      await repository.evaluate((probe) => probe.dispose());
      await delivery.evaluate((probe) => probe.dispose());
      await repository.dispose();
      await delivery.dispose();
    }
  });
}

test('explicit review discards a disposable dirty form even when the peer revision is already displayed', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  const repository = await repositoryProbe(page);
  try {
    const candidate = await readDataset(page);
    candidate.settings.reducedMotion = true;
    const replacement = await repository.evaluate(
      (probe, candidate) => probe.replace(candidate),
      candidate,
    );
    await expect(page.getByRole('alert')).toContainText(en.staleError);
    // Verify adoption in the UI before creating a new, disposable form. The
    // later Reload is equal-revision review, not another external replacement.
    await nav(page, en.settingsNav).click();
    await expect(page.getByRole('checkbox', { name: en.reducedMotion })).toBeChecked();
    await nav(page, en.pillars).click();
    await page.getByRole('button', { name: en.newPillar, exact: true }).click();
    const input = page.getByLabel(en.pillarName, { exact: true });
    const node = await input.elementHandle();
    await input.fill('  Disposable fictional pillar 🎵  ');
    await repository.evaluate((probe) => probe.failNextPillar());
    await page.getByRole('button', { name: en.savePillar, exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(en.staleError);
    await expect(input).toHaveValue('  Disposable fictional pillar 🎵  ');
    await expect(page.getByRole('button', { name: en.retry, exact: true })).toHaveCount(0);
    expect(await readDataset(page)).toEqual(replacement);

    await page.getByRole('button', { name: en.reload, exact: true }).click();
    await expect(input).toHaveCount(0);
    await expect(page.getByRole('heading', { name: en.pillars, exact: true })).toBeVisible();
    expect(await node!.evaluate((node) => node.isConnected)).toBe(false);
    expect(await readDataset(page)).toEqual(replacement);
    await page.getByRole('button', { name: en.newPillar, exact: true }).click();
    await expect(input).toHaveValue('');
    await expect(page.getByRole('button', { name: en.retry, exact: true })).toHaveCount(0);
    expect(await readDataset(page)).toEqual(replacement);
    await node!.dispose();
  } finally {
    await repository.evaluate((probe) => probe.dispose());
    await repository.dispose();
  }
});
