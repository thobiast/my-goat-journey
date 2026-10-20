import { expandFixturePillars } from './support/management-fixtures';
import { test, expect, type Page } from '@playwright/test';
import { developmentModuleUrl } from './support/development-module';

async function startDraft(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mind', exact: true })).toBeVisible();
}

async function finishSetup(page: Page) {
  await startDraft(page);
  for (const [index, goal] of [
    'Read my book',
    'Take my walk',
    'Prepare my snack',
    'Complete my care',
  ].entries()) {
    await expect(
      page.getByRole('heading', {
        name: ['Mind', 'Body', 'Nutrition', 'Hygiene'][index],
        exact: true,
      }),
    ).toBeVisible();
    await page.getByLabel('What do you want to do?').fill(goal);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Start my journey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
}

async function abortNextWrite(page: Page) {
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      IDBObjectStore.prototype.put = original;
      const result = original.apply(this, args);
      this.transaction.abort();
      return result;
    };
  });
}

for (const failure of ['autosave', 'foreground'] as const) {
  test(`foreground navigation owns feedback when ${failure} save fails behind queued draft input`, async ({
    page,
  }) => {
    test.skip(
      (process.env.BASE_URL ?? '').includes('runtime'),
      'Controlled repository promise seam is available only in the development module',
    );
    await startDraft(page);
    const modulePath = await developmentModuleUrl(page, '/src/data/database.ts');
    await page.evaluate(
      async ({ mode, modulePath }) => {
        const { Repository } = await import(modulePath);
        const original = Repository.prototype.saveDraft;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        let first = true;
        let failed = false;
        (window as unknown as { releaseDraft: () => void }).releaseDraft = release;
        Repository.prototype.saveDraft = async function (draft: { step: number }) {
          if (first) {
            first = false;
            await gate;
            if (mode === 'autosave') throw new Error('Injected autosave failure');
          }
          if (mode === 'foreground' && draft.step === 2 && !failed) {
            failed = true;
            throw new Error('Injected foreground failure');
          }
          return original.call(this, draft);
        };
      },
      { mode: failure, modulePath },
    );
    await page.getByLabel('What do you want to do?').fill('Read one chapter');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.evaluate(() => (window as unknown as { releaseDraft: () => void }).releaseDraft());
    if (failure === 'foreground') {
      await expect(page.getByRole('alert')).toContainText('Could not save');
      await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
      await expect(page.getByRole('status')).not.toHaveText('Draft saved');
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
    }
    await expect(page.getByRole('heading', { name: 'Body', exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Body', exact: true })).toBeVisible();
  });
}

test('editing failed habit creation invalidates obsolete Retry and saves the visible goal and schedule', async ({
  page,
}) => {
  await finishSetup(page);
  await page.getByRole('button', { name: 'Add habit', exact: true }).click();
  await page.getByLabel('What do you want to do?').fill('Obsolete goal');
  await abortNextWrite(page);
  await page.getByRole('button', { name: 'Save habit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await page.getByLabel('What do you want to do?').fill('Visible updated goal');
  await page.getByLabel('Pillar', { exact: true }).selectOption('body');
  await page.getByRole('button', { name: 'Monday', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save habit', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Visible updated goal', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Obsolete goal', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(
    page
      .getByRole('region', { name: 'Body', exact: true })
      .getByRole('heading', { name: 'Visible updated goal', exact: true }),
  ).toBeVisible();
});

test('editing failed pillar creation invalidates obsolete Retry and saves the visible name', async ({
  page,
}) => {
  await finishSetup(page);
  await page.getByRole('button', { name: 'Pillars', exact: true }).click();
  await expandFixturePillars(page);
  await page.getByRole('button', { name: 'New pillar', exact: true }).click();
  await page.getByLabel('Pillar name', { exact: true }).fill('Obsolete pillar');
  await abortNextWrite(page);
  await page.getByRole('button', { name: 'Save pillar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await page.getByLabel('Pillar name', { exact: true }).fill('Visible updated pillar');
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save pillar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pillars', exact: true, level: 1 })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Visible updated pillar', exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Pillars', exact: true }).click();
  await expandFixturePillars(page);
  await expect(
    page.getByRole('button', { name: 'Visible updated pillar', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Obsolete pillar', exact: true })).toHaveCount(0);
});
