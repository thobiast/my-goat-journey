import { test, expect, type Page } from '@playwright/test';
import type { Dataset } from '../src/domain/types';
import { validateDataset } from '../src/data/backup';
import en from '../src/i18n/en.json' with { type: 'json' };
import { developmentModuleUrl } from './support/development-module';
import {
  nav,
  onDate,
  readDataset,
  scheduledHabitGoals,
  setupScheduledHabits,
} from './support/habit-fixtures';

test.use({ timezoneId: 'UTC' });
test.setTimeout(60_000);

/** Real reads and peer transactions; only delivery/failure is controlled. */
async function refreshProbe(page: Page) {
  test.skip(
    (await page.locator('script[src*="/@vite/client"]').count()) === 0,
    'Controlled Repository read delivery requires development modules',
  );
  const modulePath = await developmentModuleUrl(page, '/src/data/database.ts');
  return page.evaluateHandle(async (modulePath) => {
    const { Repository }: typeof import('../src/data/database') = await import(modulePath);
    const load = Repository.prototype.load;
    const put = IDBObjectStore.prototype.put;
    const calls: { expected?: number; snapshot?: Dataset }[] = [];
    const gates: { held: boolean; release?: (reject: boolean) => void }[] = [];
    let puts = 0;
    let received = 0;
    // Created after App's listener: receipt witnesses synchronous epoch invalidation.
    const witness = new BroadcastChannel('my-goat-journey-dataset');
    witness.onmessage = () => ++received;
    const sender = new BroadcastChannel('my-goat-journey-dataset');
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      if (this.name === 'dataset' && this.transaction.db.name === 'my-goat-journey') ++puts;
      return put.apply(this, args);
    };
    Repository.prototype.load = async function (now, expected) {
      const call: (typeof calls)[number] = { expected };
      calls.push(call);
      const gate = gates.find((gate) => !gate.held);
      // Capture the actual persisted read before blocking its consumer.
      const state = await load.call(this, now, expected);
      call.snapshot = state;
      if (gate) {
        await new Promise<void>((resolve, reject) => {
          gate.held = true;
          gate.release = (fail) => {
            gates.splice(gates.indexOf(gate), 1);
            if (fail) reject(new Error('Controlled obsolete read rejection'));
            else resolve();
          };
        });
      }
      return state;
    };
    return {
      arm: () => gates.push({ held: false }),
      held: () => gates.some((gate) => gate.held),
      release(fail = false) {
        const gate = gates.find((gate) => gate.held);
        if (!gate?.release) throw new Error('No held read');
        gate.release(fail);
      },
      calls: () => calls,
      received: () => received,
      puts: () => puts,
      async replace(candidate: Dataset) {
        const peer = new Repository();
        try {
          const current = await load.call(peer, new Date());
          const state = await peer.replaceDataset(candidate, current.revision, new Date());
          sender.postMessage({ revision: state.revision });
          return state;
        } finally {
          await peer.close();
        }
      },
      async reset() {
        const peer = new Repository();
        try {
          const current = await load.call(peer, new Date());
          const state = await peer.resetDataset(current.revision, new Date());
          sender.postMessage({ revision: state.revision });
          return state;
        } finally {
          await peer.close();
        }
      },
      dispose() {
        Repository.prototype.load = load;
        IDBObjectStore.prototype.put = put;
        for (const gate of [...gates]) gate.release?.(false);
        witness.close();
        sender.close();
      },
    };
  }, modulePath);
}

for (const notifications of [2, 4]) {
  test(`${notifications} external notifications during a pending read publish only the latest persisted dataset`, async ({
    page,
  }, testInfo) => {
    await setupScheduledHabits(page);
    const before = await readDataset(page);
    const probe = await refreshProbe(page);
    try {
      await probe.evaluate((probe) => probe.arm());
      const obsolete = structuredClone(before);
      obsolete.habits[0].versions[0].goal = 'Obsolete fictional diary';
      const first = await probe.evaluate((probe, state) => probe.replace(state), obsolete);
      await expect.poll(() => probe.evaluate((probe) => probe.held())).toBe(true);
      expect((await probe.evaluate((probe) => probe.calls()))[0].snapshot).toEqual(first);
      for (let index = 2; index < notifications; ++index) {
        const intermediate = structuredClone(before);
        intermediate.habits[0].versions[0].goal = `Intermediate fictional diary ${index}`;
        await probe.evaluate((probe, state) => probe.replace(state), intermediate);
        await expect.poll(() => probe.evaluate((probe) => probe.received())).toBe(index);
      }
      const latest = await probe.evaluate((probe) => probe.reset());
      await expect.poll(() => probe.evaluate((probe) => probe.received())).toBe(notifications);
      expect(latest.revision).toBe(before.revision + notifications);
      expect(latest.onboardingComplete).toBe(false);
      expect(await readDataset(page)).toEqual(latest);
      // The next real load is also held, exposing any obsolete publication or feedback.
      await probe.evaluate((probe) => {
        probe.arm();
        probe.release();
      });
      try {
        await expect.poll(() => probe.evaluate((probe) => probe.held())).toBe(true);
        await expect(page.getByRole('heading', { name: en.today, exact: true })).toBeVisible();
        await expect(page.getByText('Obsolete fictional diary', { exact: true })).toHaveCount(0);
        await expect(
          page.getByRole('checkbox', { name: `Done: ${scheduledHabitGoals[0]}`, exact: true }),
        ).toBeVisible();
        await expect(page.getByRole('alert')).toHaveCount(0);
        await probe.evaluate((probe) => probe.release());
        await expect(page.getByRole('button', { name: en.start, exact: true })).toBeVisible();
        await expect(page.getByRole('alert')).toContainText(en.staleError);
        await expect(page.getByRole('button', { name: en.retry, exact: true })).toHaveCount(0);
        expect(
          (await probe.evaluate((probe) => probe.calls())).map((call) => call.snapshot),
        ).toEqual([first, latest]);
        expect(await probe.evaluate((probe) => probe.puts())).toBe(notifications);
        expect(await readDataset(page)).toEqual(latest);
      } finally {
        await testInfo.attach('race-observation.json', {
          body: JSON.stringify(
            {
              calls: await probe.evaluate((probe) => probe.calls()),
              persisted: await readDataset(page),
              feedback: await page.getByRole('alert').allTextContents(),
            },
            null,
            2,
          ),
          contentType: 'application/json',
        });
      }
    } finally {
      await probe.evaluate((probe) => probe.dispose());
      await probe.dispose();
    }
  });
}

test('obsolete read rejection cannot overwrite newer validation feedback while the latest read is pending', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  const before = await readDataset(page);
  const probe = await refreshProbe(page);
  try {
    await probe.evaluate((probe) => probe.arm());
    await probe.evaluate((probe, state) => probe.replace(state), before);
    await expect.poll(() => probe.evaluate((probe) => probe.held())).toBe(true);
    const latest = await probe.evaluate((probe, state) => probe.replace(state), before);
    await expect.poll(() => probe.evaluate((probe) => probe.received())).toBe(2);
    await nav(page, en.pillars).click();
    await page.getByRole('button', { name: en.mind, exact: true }).click();
    await page.getByRole('button', { name: en.addHabit, exact: true }).first().click();
    await page.getByRole('button', { name: en.saveHabit, exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText(en.goalError);
    await probe.evaluate((probe) => {
      probe.arm();
      probe.release(true);
    });
    await expect.poll(() => probe.evaluate((probe) => probe.held())).toBe(true);
    await expect(page.getByRole('alert')).toHaveText(en.goalError);
    await probe.evaluate((probe) => probe.release());
    await expect(page.getByRole('heading', { name: en.pillars, exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await readDataset(page)).toEqual(latest);
    expect(await probe.evaluate((probe) => probe.puts())).toBe(2);
  } finally {
    await probe.evaluate((probe) => probe.dispose());
    await probe.dispose();
  }
});

async function restore(page: Page, candidate: Dataset) {
  expect(validateDataset(candidate)).toEqual(candidate);
  const { revision: _revision, ...dataset } = candidate;
  await page.getByLabel(en.chooseBackup, { exact: true }).setInputFiles({
    name: 'fictional-refresh.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        format: 'my-goat-journey-backup',
        formatVersion: 1,
        exportedAt: '2026-09-27T12:00:00Z',
        dataset,
      }),
    ),
  });
  await expect(page.getByText(en.backupReady, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: en.replaceData, exact: true }).click();
  await expect(page.getByText(en.backupRestored, { exact: true })).toBeVisible();
  return readDataset(page);
}

async function customProfile(page: Page) {
  await setupScheduledHabits(page);
  const original = await readDataset(page);
  const custom = structuredClone(original);
  custom.pillars.push({ id: 'fictional-music', name: 'Fictional music' });
  custom.habits[0].memberships[0].pillarId = 'fictional-music';
  await nav(page, en.settingsNav).click();
  await restore(page, custom);
  await nav(page, en.progress).click();
  await page.locator('.progress-filters summary').click();
  await page.getByLabel(en.pillarFilter, { exact: true }).selectOption('fictional-music');
  await expect(page.locator('.filter-summary')).toHaveText(`${en.activeHabits} · Fictional music`);
  await expect(
    page.getByRole('button', { name: scheduledHabitGoals[0], exact: true }),
  ).toBeVisible();
  return { original, custom: await readDataset(page) };
}

for (const retained of ['missing', 'valid', 'removed'] as const) {
  test(`external replacement recovers a ${retained} pillar filter according to Progress options without writing view state`, async ({
    page,
    context,
  }, testInfo) => {
    const { original, custom } = await customProfile(page);
    await onDate(page, '2026-11-20');
    await page.getByRole('button', { name: '1m', exact: true }).click();
    await expect(page.getByRole('button', { name: '1m', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: en.previousPeriod, exact: true }).click();
    await expect(page.getByRole('button', { name: en.nextPeriod, exact: true })).toBeEnabled();
    const current = await readDataset(page);
    const peer = await context.newPage();
    await peer.clock.install({ time: new Date('2026-11-20T12:00:00') });
    await peer.goto('./');
    await nav(peer, en.settingsNav).click();
    const candidate = structuredClone(retained === 'valid' ? custom : original);
    candidate.settings.progressInterval = '1m';
    if (retained === 'removed')
      candidate.pillars.push({
        id: 'fictional-music',
        name: 'Fictional music',
        removedOn: '2026-09-27',
      });
    // Archived is independent of the pillar selection; exercise its preservation too.
    if (retained !== 'missing') {
      await page.getByRole('button', { name: en.archivedHabits, exact: true }).click();
    }
    const period = await page.locator('.period-navigation time').getAttribute('datetime');
    const writes = await page.evaluateHandle(() => {
      const put = IDBObjectStore.prototype.put;
      let count = 0;
      IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
        ++count;
        return put.apply(this, args);
      };
      return {
        count: () => count,
        dispose: () => {
          IDBObjectStore.prototype.put = put;
        },
      };
    });
    try {
      const adopted = await restore(peer, candidate);
      expect(adopted).toEqual({ ...candidate, revision: current.revision + 1 });
      await expect(page.getByRole('alert')).toContainText(en.staleError);
      const expectedPillar = retained === 'missing' ? 'all' : 'fictional-music';
      const expectedSummary = `${retained === 'missing' ? en.activeHabits : en.archivedHabits} · ${retained === 'missing' ? en.allPillars : 'Fictional music'}`;
      try {
        await expect(page.locator('.filter-summary')).toHaveText(expectedSummary);
        await expect(page.getByLabel(en.pillarFilter, { exact: true })).toHaveValue(expectedPillar);
        await expect(page.locator('.progress-filters')).toHaveAttribute('open', '');
        await expect(page.getByRole('button', { name: '1m', exact: true })).toHaveAttribute(
          'aria-pressed',
          'true',
        );
        await expect(page.locator('.period-navigation time')).toHaveAttribute('datetime', period!);
        if (retained === 'missing') {
          for (const goal of scheduledHabitGoals)
            await expect(page.getByRole('button', { name: goal, exact: true })).toBeVisible();
          await expect(page.getByText(en.noMatches, { exact: true })).toHaveCount(0);
        }
        await nav(page, en.today).click();
        await nav(page, en.progress).click();
        await expect(page.locator('.filter-summary')).toHaveText(expectedSummary);
        expect(await readDataset(page)).toEqual(adopted);
        expect(await writes.evaluate((probe) => probe.count())).toBe(0);
      } finally {
        await testInfo.attach('filter-observation.json', {
          body: JSON.stringify(
            {
              persisted: await readDataset(page),
              summary: await page.locator('.filter-summary').textContent(),
            },
            null,
            2,
          ),
          contentType: 'application/json',
        });
      }
    } finally {
      await writes.evaluate((probe) => probe.dispose());
      await writes.dispose();
      await peer.close();
    }
  });
}

for (const latestHasPillar of [true, false]) {
  test(`obsolete external snapshot cannot change the filter before the latest ${latestHasPillar ? 'retained' : 'missing'} pillar snapshot is accepted`, async ({
    page,
  }) => {
    const { original, custom } = await customProfile(page);
    const probe = await refreshProbe(page);
    try {
      await probe.evaluate((probe) => probe.arm());
      const obsolete = latestHasPillar ? original : custom;
      const first = await probe.evaluate((probe, state) => probe.replace(state), obsolete);
      await expect.poll(() => probe.evaluate((probe) => probe.held())).toBe(true);
      const latest = await probe.evaluate(
        (probe, state) => probe.replace(state),
        latestHasPillar ? custom : original,
      );
      await expect.poll(() => probe.evaluate((probe) => probe.received())).toBe(2);
      await probe.evaluate((probe) => {
        probe.arm();
        probe.release();
      });
      await expect.poll(() => probe.evaluate((probe) => probe.held())).toBe(true);
      // Neither obsolete missing options nor obsolete retained identities own
      // normalization. The prior published snapshot still owns this view.
      await expect(page.getByLabel(en.pillarFilter, { exact: true })).toHaveValue(
        'fictional-music',
      );
      await expect(page.locator('.filter-summary')).toHaveText(
        `${en.activeHabits} · Fictional music`,
      );
      await expect(
        page.getByRole('button', { name: scheduledHabitGoals[0], exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('alert')).toHaveCount(0);
      await probe.evaluate((probe) => probe.release());
      await expect(page.getByRole('alert')).toContainText(en.staleError);
      const expectedPillar = latestHasPillar ? 'fictional-music' : 'all';
      await expect(page.getByLabel(en.pillarFilter, { exact: true })).toHaveValue(expectedPillar);
      await expect(page.locator('.filter-summary')).toHaveText(
        `${en.activeHabits} · ${latestHasPillar ? 'Fictional music' : en.allPillars}`,
      );
      await expect(
        page.getByRole('button', { name: scheduledHabitGoals[0], exact: true }),
      ).toBeVisible();
      // Equal-revision explicit review must not resurrect the obsolete filter.
      await page.getByRole('button', { name: en.reload, exact: true }).click();
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(page.getByLabel(en.pillarFilter, { exact: true })).toHaveValue(expectedPillar);
      expect((await probe.evaluate((probe) => probe.calls())).map((call) => call.snapshot)).toEqual(
        [first, latest, latest],
      );
      expect(await readDataset(page)).toEqual(latest);
      expect(await probe.evaluate((probe) => probe.puts())).toBe(2);
    } finally {
      await probe.evaluate((probe) => probe.dispose());
      await probe.dispose();
    }
  });
}
