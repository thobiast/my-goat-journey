import { test, expect, type Page } from '@playwright/test';
import { developmentModuleUrl } from './support/development-module';
import { nav, readDataset, setupScheduledHabits } from './support/habit-fixtures';
import en from '../src/i18n/en.json' with { type: 'json' };
import pt from '../src/i18n/pt.json' with { type: 'json' };

test.beforeEach(() => {
  test.skip(
    (process.env.BASE_URL ?? '').includes('runtime'),
    'Controlled Repository failures require development modules',
  );
});

async function failureModules(page: Page) {
  return {
    modulePath: await developmentModuleUrl(page, '/src/data/database.ts'),
    errorsPath: await developmentModuleUrl(page, '/src/domain/errors.ts'),
  };
}

for (const [code, message] of [
  ['stale-revision', 'Stale dataset revision'],
  ['historical-conflict', 'Historical commitment conflict'],
] as const)
  for (const codeLike of [false, true])
    test(`a ${codeLike ? 'code-shaped' : 'plain'} error with diagnostic text "${message}" stays retryable`, async ({
      page,
    }) => {
      await setupScheduledHabits(page);
      await nav(page, en.pillars).click();
      await page.getByRole('button', { name: en.newPillar, exact: true }).click();
      const input = page.getByLabel(en.pillarName, { exact: true });
      const literal = '  Retained fictional draft 🎵  ';
      await input.fill(literal);
      const before = await readDataset(page);
      const modulePath = await developmentModuleUrl(page, '/src/data/database.ts');
      await page.evaluate(
        async ({ modulePath, message, code, codeLike }) => {
          const { Repository }: typeof import('../src/data/database') = await import(modulePath);
          const original = Repository.prototype.createPillar;
          Repository.prototype.createPillar = async function () {
            Repository.prototype.createPillar = original;
            const failure = new Error(message);
            throw codeLike ? Object.assign(failure, { name: 'DatasetError', code }) : failure;
          };
        },
        { modulePath, message, code, codeLike },
      );
      await page.getByRole('button', { name: en.savePillar, exact: true }).click();
      await expect(page.getByRole('alert')).toContainText(en.saveError);
      await expect(input).toHaveValue(literal);
      expect(await readDataset(page)).toEqual(before);
      await page.getByRole('button', { name: en.retry, exact: true }).click();
      await expect(
        page.getByRole('heading', { name: en.pillars, level: 1, exact: true }),
      ).toBeVisible();
      const after = await readDataset(page);
      expect(
        after.pillars.filter((pillar: { name: string }) => pillar.name === literal),
      ).toHaveLength(1);
      expect(after.revision).toBe(before.revision + 1);
    });

for (const language of ['en', 'pt'] as const)
  for (const code of ['stale-revision', 'historical-conflict'] as const)
    test(`${code} uses its code with changed diagnostic wording (${language})`, async ({
      page,
    }) => {
      await setupScheduledHabits(page);
      if (language === 'pt') {
        await nav(page, en.settingsNav).click();
        await page.getByLabel(en.language, { exact: true }).selectOption('pt');
        await expect(page.getByLabel(pt.language, { exact: true })).toHaveValue('pt');
      }
      const copy = language === 'pt' ? pt : en;
      await nav(page, copy.pillars).click();
      await page.getByRole('button', { name: copy.newPillar, exact: true }).click();
      const input = page.getByLabel(copy.pillarName, { exact: true });
      const literal = '  Unsaved fictional pillar 🎵  ';
      await input.fill(literal);
      const before = await readDataset(page);
      await page.evaluate(
        async ({ modulePath, errorsPath, code }) => {
          const { Repository }: typeof import('../src/data/database') = await import(modulePath);
          const { DatasetError }: typeof import('../src/domain/errors') = await import(errorsPath);
          const original = Repository.prototype.createPillar;
          Repository.prototype.createPillar = async function () {
            Repository.prototype.createPillar = original;
            throw new DatasetError(code, 'Changed diagnostic: not a control-flow identifier');
          };
        },
        { ...(await failureModules(page)), code },
      );
      await page.getByRole('button', { name: copy.savePillar, exact: true }).click();
      await expect(page.getByRole('alert')).toContainText(
        code === 'stale-revision' ? copy.staleError : copy.historicalConflict,
      );
      await expect(page.getByRole('button', { name: copy.retry, exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: copy.reload, exact: true })).toHaveCount(
        code === 'stale-revision' ? 1 : 0,
      );
      await expect(input).toHaveValue(literal);
      expect(await readDataset(page)).toEqual(before);
      if (code === 'stale-revision') {
        await page.getByRole('button', { name: copy.reload, exact: true }).click();
        await expect(input).toHaveCount(0);
        await page.getByRole('button', { name: copy.newPillar, exact: true }).click();
        await expect(input).toHaveValue('');
        expect(await readDataset(page)).toEqual(before);
      }
    });

for (const known of [true, false])
  test(`onboarding autosave ${known ? 'coded stale failure' : 'unknown rejection'} preserves literal input`, async ({
    page,
  }) => {
    await page.goto('./');
    await page.getByRole('button', { name: en.start, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Mind', exact: true })).toBeVisible();
    const before = await readDataset(page);
    await page.evaluate(
      async ({ modulePath, errorsPath, known }) => {
        const { Repository }: typeof import('../src/data/database') = await import(modulePath);
        const { DatasetError }: typeof import('../src/domain/errors') = await import(errorsPath);
        const original = Repository.prototype.saveDraft;
        Repository.prototype.saveDraft = async function () {
          Repository.prototype.saveDraft = original;
          throw known ? new DatasetError('stale-revision', 'Autosave diagnostic changed') : null;
        };
      },
      { ...(await failureModules(page)), known },
    );
    const literal = '  Unsaved onboarding text 🎵  ';
    const input = page.getByLabel(en.goal, { exact: true });
    await input.fill(literal);
    await expect(page.getByRole('alert')).toContainText(known ? en.staleError : en.saveError);
    await expect(input).toHaveValue(literal);
    expect(await readDataset(page)).toEqual(before);
    if (known) {
      await expect(page.getByRole('button', { name: en.retry, exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: en.reload, exact: true })).toBeVisible();
    } else {
      await page.getByRole('button', { name: en.retry, exact: true }).click();
      await expect(page.getByRole('alert')).toHaveCount(0);
      const after = await readDataset(page);
      expect(after.draft!.goals[0].goal).toBe(literal);
      expect(after.revision).toBe(before.revision + 1);
    }
  });

for (const known of [true, false])
  test(`guarded refresh ${known ? 'recognizes a reworded stale error' : 'does not retry an unrelated error'}`, async ({
    page,
  }) => {
    await setupScheduledHabits(page);
    await nav(page, en.pillars).click();
    await page.getByRole('button', { name: en.newPillar, exact: true }).click();
    const input = page.getByLabel(en.pillarName, { exact: true });
    await input.fill('Retained until an external revision is reviewed');
    const before = await readDataset(page);
    const probe = await page.evaluateHandle(
      async ({ modulePath, errorsPath, known }) => {
        const { Repository }: typeof import('../src/data/database') = await import(modulePath);
        const { DatasetError }: typeof import('../src/domain/errors') = await import(errorsPath);
        const original = Repository.prototype.load;
        let unguarded = 0;
        let guarded = 0;
        Repository.prototype.load = async function (now, revision) {
          if (revision === undefined) ++unguarded;
          else {
            ++guarded;
            if (!known) throw new Error('Stale dataset revision');
          }
          try {
            return await original.call(this, now, revision);
          } catch (failure: unknown) {
            if (failure instanceof DatasetError) failure.message = 'Refresh diagnostic changed';
            throw failure;
          }
        };
        // Simulate an external write without a BroadcastChannel notification.
        await new Repository().createPillar('External fictional pillar');
        window.dispatchEvent(new Event('focus'));
        return { counts: () => ({ guarded, unguarded }) };
      },
      { ...(await failureModules(page)), known },
    );
    await expect.poll(() => probe.evaluate((probe) => probe.counts().guarded)).toBe(1);
    if (known) {
      await expect(input).toHaveCount(0);
      expect(await probe.evaluate((probe) => probe.counts().unguarded)).toBe(1);
      await page.getByRole('button', { name: en.newPillar, exact: true }).click();
      await expect(input).toHaveValue('');
    } else {
      // A second queued read establishes that the first failure has settled.
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect.poll(() => probe.evaluate((probe) => probe.counts().guarded)).toBe(2);
      expect(await probe.evaluate((probe) => probe.counts().unguarded)).toBe(0);
      await expect(input).toHaveValue('Retained until an external revision is reviewed');
    }
    const after = await readDataset(page);
    expect(after.revision).toBe(before.revision + 1);
    expect(after.habits).toEqual(before.habits);
    expect(after.occurrences).toEqual(before.occurrences);
    await probe.dispose();
  });
