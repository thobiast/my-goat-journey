import type { Dataset, Settings } from '../src/domain/types';
import { test, expect, type Page } from '@playwright/test';
import {
  abortNextWrite,
  nav,
  onDate,
  readDataset,
  setupScheduledHabits,
} from './support/habit-fixtures';
import { developmentModuleUrl } from './support/development-module';

// The fixture intentionally writes unsupported interval values without validating them.
type IntervalFixture = Omit<Dataset, 'settings'> & {
  settings: Omit<Settings, 'progressInterval'> & { progressInterval?: unknown };
};

type IntervalProbeWindow = Window & {
  releaseIntervalSave?: () => void;
  intervalRenders?: string[];
};

test.setTimeout(60_000);
test('empty-state navigation cannot steal pending interval-save feedback', async ({ page }) => {
  test.skip(
    (process.env.BASE_URL ?? '').includes('runtime'),
    'Controlled repository promise seam is development-only; compiled busy state is asserted by the unit renderer.',
  );
  await setupIntervalProfile(page);
  await onDate(page, '2026-10-20');
  await nav(page, 'Progress').click();
  await page.locator('.progress-filters summary').click();
  await page.getByLabel('Pillar filter', { exact: true }).selectOption('body');
  const add = page
    .locator('.progress-empty')
    .getByRole('button', { name: 'Add habit', exact: true });
  const modulePath = await developmentModuleUrl(page, '/src/data/database.ts');
  await page.evaluate(async (modulePath) => {
    const { Repository }: typeof import('../src/data/database') = await import(modulePath);
    const original = Repository.prototype.setSettings;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    (window as IntervalProbeWindow).releaseIntervalSave = release;
    Repository.prototype.setSettings = async function (
      patch: Parameters<typeof original>[0],
      revision?: number,
    ) {
      if (Object.hasOwn(patch, 'progressInterval')) await gate;
      return original.call(this, patch, revision);
    };
  }, modulePath);
  try {
    await page.getByRole('button', { name: '3m', exact: true }).click();
    await expect(add).toBeDisabled();
    await page.evaluate(() => (window as IntervalProbeWindow).releaseIntervalSave!());
    await expect(page.getByRole('button', { name: '3m', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(add).toBeEnabled();
    await add.click();
    await expect(page.getByRole('heading', { name: 'Add habit', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('button', { name: '3m', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect((await readDataset(page)).settings.progressInterval).toBe('3m');
  } finally {
    await page
      .evaluate(() => (window as IntervalProbeWindow).releaseIntervalSave!())
      .catch(() => {});
  }
});

// Preference acceptance uses the minimal supported profile, not a long-calendar benchmark.
async function setupIntervalProfile(page: Page) {
  await page.clock.install({ time: new Date('2026-09-27T12:00:00') });
  await page.goto('./');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mind', exact: true })).toBeVisible();
  await page.getByLabel('What do you want to do?').fill('My interval preference habit');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  for (const name of ['Body', 'Nutrition', 'Hygiene']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Start my journey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
}

async function recordIntervalRenders(page: Page) {
  await page.evaluate(() => {
    const renders: string[] = [];
    (window as IntervalProbeWindow).intervalRenders = renders;
    new MutationObserver(() => {
      const current = document.querySelector(
        '.interval-selector button[aria-pressed="true"]',
      )?.textContent;
      if (current && current !== renders.at(-1)) renders.push(current);
    }).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-pressed'],
    });
  });
}

async function visibleDates(page: Page) {
  return page
    .locator('article.consistency-card')
    .evaluateAll((cards) =>
      cards.map((card) =>
        Array.from(card.querySelectorAll('[data-calendar-date]'), (cell) =>
          cell.getAttribute('data-calendar-date'),
        ),
      ),
    );
}

// Only isolated browser fixtures are edited to simulate an existing saved preference.
async function storedInterval(page: Page, interval: unknown) {
  await page.evaluate(
    (interval) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('my-goat-journey');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('dataset', 'readwrite');
          const store = tx.objectStore('dataset');
          const get = store.get('current');
          get.onsuccess = () => {
            // Setup guarantees the record exists; this seam deliberately corrupts one field.
            const data = get.result as IntervalFixture;
            data.settings.progressInterval = interval;
            data.revision++;
            store.put(data, 'current');
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
    interval,
  );
}

for (const interval of ['7d', '1m', '3m', '12m', '24m'] as const)
  test(`explicit ${interval} choice is the only persisted calendar preference and survives tabs, leaving and reload`, async ({
    page,
  }) => {
    await setupIntervalProfile(page);
    await onDate(page, '2026-10-20');
    await nav(page, 'Progress').click();
    const original = await readDataset(page);
    await page.getByRole('button', { name: interval, exact: true }).click();
    await expect(page.getByRole('button', { name: interval, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect
      .poll(async () => (await readDataset(page)).settings.progressInterval)
      .toBe(interval);
    await page.getByRole('tab', { name: 'Pillars', exact: true }).click();
    await expect(page.getByRole('button', { name: interval, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('tab', { name: 'Habits', exact: true }).click();
    await nav(page, 'Today').click();
    await nav(page, 'Progress').click();
    await expect(page.getByRole('button', { name: interval, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.reload();
    await expect(nav(page, 'Progress')).toBeVisible();
    await recordIntervalRenders(page);
    await nav(page, 'Progress').click();
    await expect(page.getByRole('button', { name: interval, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await page.evaluate(() => (window as IntervalProbeWindow).intervalRenders)).toEqual([
      interval,
    ]);
    const saved = await readDataset(page);
    expect(saved.settings).toEqual({ ...original.settings, progressInterval: interval });
    for (const key of [
      'pillars',
      'habits',
      'occurrences',
      'permanentUnlocks',
      'draft',
      'onboardingComplete',
    ] as const)
      expect(saved[key]).toEqual(original[key]);
  });

test('missing preference selects 7d from the first Progress render and all cards end yesterday', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await onDate(page, '2026-10-08');
  await recordIntervalRenders(page);
  await nav(page, 'Progress').click();
  await expect(page.getByRole('button', { name: '7d', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await page.evaluate(() => (window as IntervalProbeWindow).intervalRenders)).toEqual([
    '7d',
  ]);
  const dates = [
    '2026-10-01',
    '2026-10-02',
    '2026-10-03',
    '2026-10-04',
    '2026-10-05',
    '2026-10-06',
    '2026-10-07',
  ];
  expect(await visibleDates(page)).toEqual([dates, dates, dates, dates]);
  await expect(page.getByRole('button', { name: 'Next period', exact: true })).toBeDisabled();
  expect((await readDataset(page)).settings).not.toHaveProperty('progressInterval');
});

test('an existing saved valid preference is restored before the first Progress render', async ({
  page,
}) => {
  await setupIntervalProfile(page);
  await onDate(page, '2026-10-20');
  await storedInterval(page, '3m');
  await page.reload();
  await expect(nav(page, 'Progress')).toBeVisible();
  await recordIntervalRenders(page);
  await nav(page, 'Progress').click();
  await expect(page.getByRole('button', { name: '3m', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await page.evaluate(() => (window as IntervalProbeWindow).intervalRenders)).toEqual([
    '3m',
  ]);
});

test('an invalid saved interval safely falls back to 7d without a 3m render', async ({ page }) => {
  await setupIntervalProfile(page);
  await onDate(page, '2026-10-20');
  await storedInterval(page, '2m');
  await page.reload();
  await expect(nav(page, 'Progress')).toBeVisible();
  await recordIntervalRenders(page);
  await nav(page, 'Progress').click();
  await expect(page.getByRole('button', { name: '7d', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await page.evaluate(() => (window as IntervalProbeWindow).intervalRenders)).toEqual([
    '7d',
  ]);
  await page.getByRole('button', { name: '1m', exact: true }).click();
  await expect.poll(async () => (await readDataset(page)).settings.progressInterval).toBe('1m');
});

test('seven-day arrows are contiguous across every card and day-detail return preserves the window', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await onDate(page, '2026-10-20');
  await nav(page, 'Progress').click();
  const latest = [
    '2026-10-13',
    '2026-10-14',
    '2026-10-15',
    '2026-10-16',
    '2026-10-17',
    '2026-10-18',
    '2026-10-19',
  ];
  const prior = [
    '2026-10-06',
    '2026-10-07',
    '2026-10-08',
    '2026-10-09',
    '2026-10-10',
    '2026-10-11',
    '2026-10-12',
  ];
  const earlier = [
    '2026-09-29',
    '2026-09-30',
    '2026-10-01',
    '2026-10-02',
    '2026-10-03',
    '2026-10-04',
    '2026-10-05',
  ];
  const previous = page.getByRole('button', { name: 'Previous period', exact: true });
  const next = page.getByRole('button', { name: 'Next period', exact: true });
  const original = await readDataset(page);
  expect(await visibleDates(page)).toEqual([latest, latest, latest, latest]);
  await expect(next).toBeDisabled();
  await previous.click();
  expect(await visibleDates(page)).toEqual([prior, prior, prior, prior]);
  await previous.click();
  expect(await visibleDates(page)).toEqual([earlier, earlier, earlier, earlier]);
  expect(new Set([...earlier, ...prior, ...latest]).size).toBe(21);
  await next.click();
  expect(await visibleDates(page)).toEqual([prior, prior, prior, prior]);
  await page.getByRole('tab', { name: 'Pillars', exact: true }).click();
  expect(await visibleDates(page)).toEqual([prior, prior, prior, prior, prior]);
  await page.getByRole('tab', { name: 'Habits', exact: true }).click();
  const origin = page
    .locator('article.consistency-card')
    .first()
    .locator('[data-calendar-date="2026-10-12"]');
  await origin.click();
  await expect(page.locator('main.progress-day-page')).toBeVisible();
  await page.getByRole('button', { name: 'Back to Progress', exact: true }).click();
  await expect(origin).toBeFocused();
  expect(await visibleDates(page)).toEqual([prior, prior, prior, prior]);
  expect(await readDataset(page)).toEqual(original);
  await next.click();
  expect(await visibleDates(page)).toEqual([latest, latest, latest, latest]);
  await expect(next).toBeDisabled();
  await expect(page.locator('[data-calendar-date="2026-10-20"]')).toHaveCount(0);
  await previous.click();
  await page.getByRole('button', { name: '7d', exact: true }).click();
  await expect(next).toBeDisabled();
  expect(await visibleDates(page)).toEqual([latest, latest, latest, latest]);
});

test('keyboard interval selection retains focus after the preference commit', async ({ page }) => {
  await setupIntervalProfile(page);
  await onDate(page, '2026-10-20');
  await nav(page, 'Progress').click();
  const interval = page.getByRole('button', { name: '3m', exact: true });
  await interval.focus();
  await page.keyboard.press('Enter');
  await expect(interval).toHaveAttribute('aria-pressed', 'true');
  await expect(interval).toBeFocused();
});

test('failed preference save keeps the committed interval and offers existing Retry without diary changes', async ({
  page,
}) => {
  await setupIntervalProfile(page);
  await onDate(page, '2026-10-20');
  await nav(page, 'Progress').click();
  const original = await readDataset(page);
  await abortNextWrite(page);
  await page.getByRole('button', { name: '1m', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not save');
  await expect(page.getByRole('button', { name: '7d', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await readDataset(page)).toEqual(original);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('button', { name: '1m', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect((await readDataset(page)).settings.progressInterval).toBe('1m');
});
