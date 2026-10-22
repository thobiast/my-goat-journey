import { test, expect, type Page } from '@playwright/test';
import { developmentModuleUrl } from './support/development-module';
import { nav, readDataset, setupScheduledHabits } from './support/habit-fixtures';
import en from '../src/i18n/en.json' with { type: 'json' };
import pt from '../src/i18n/pt.json' with { type: 'json' };

const copies = { en, pt };

async function holdPeerRefreshFailure(page: Page) {
  const modulePath = await developmentModuleUrl(page, '/src/data/database.ts');
  const probe = await page.evaluateHandle(async (modulePath) => {
    const { Repository }: typeof import('../src/data/database') = await import(modulePath);
    const original = Repository.prototype.load;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = false;
    Repository.prototype.load = async function () {
      Repository.prototype.load = original;
      entered = true;
      await gate;
      throw new Error('Controlled peer refresh failure');
    };
    const peer = new BroadcastChannel('my-goat-journey-dataset');
    peer.postMessage({ revision: -1 });
    peer.close();
    return { release, entered: () => entered };
  }, modulePath);
  await expect.poll(() => probe.evaluate((probe) => probe.entered())).toBe(true);
  return probe;
}

for (const language of ['en', 'pt'] as const) {
  const other = language === 'en' ? 'pt' : 'en';

  test(`peer refresh error retained across a queued language save uses current copy (${language} → ${other})`, async ({
    page,
  }) => {
    test.skip(
      (process.env.BASE_URL ?? '').includes('runtime'),
      'Controlled Repository failures require development modules',
    );
    await setupScheduledHabits(page);
    await nav(page, en.settingsNav).click();
    if (language === 'pt') {
      await page.locator('#language').selectOption(language);
      await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    }
    const before = await readDataset(page);
    const select = page.locator('#language');
    const node = await select.elementHandle();
    const probe = await holdPeerRefreshFailure(page);
    // Peer refresh is not a foreground commit. The real language control stays
    // enabled, and its save queues behind the held read without changing policy.
    await expect(select).toBeEnabled();
    await select.selectOption(other);
    await expect(select).toBeDisabled();
    await probe.evaluate((probe) => probe.release());
    await expect(select).toBeEnabled();
    await expect(select).toHaveValue(other);
    await expect(page.getByRole('alert')).toHaveText(copies[other].saveError);
    await expect(page.getByRole('button', { name: copies[other].retry, exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole('button', { name: copies[other].reload, exact: true })).toHaveCount(
      0,
    );
    expect(await readDataset(page)).toEqual({
      ...before,
      revision: before.revision + 1,
      settings: { ...before.settings, language: other },
    });
    expect(await node!.evaluate((node) => node === document.getElementById('language'))).toBe(true);
    // A normal later language change intentionally clears App feedback; do not
    // add artificial error retention just to exercise another translation.
    await select.selectOption(language);
    await expect(select).toHaveValue(language);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await probe.dispose();
  });

  for (const superseded of [false, true])
    test(`delayed preference failure ${superseded ? 'cannot replace peer-change feedback' : 'uses the selected language and remains retryable'} (${language} → ${other})`, async ({
      page,
      context,
    }) => {
      test.skip(
        (process.env.BASE_URL ?? '').includes('runtime'),
        'Controlled Repository failures require development modules',
      );
      await setupScheduledHabits(page);
      await nav(page, en.settingsNav).click();
      await page.locator('#language').selectOption(language);
      await expect(page.locator('#language')).toHaveValue(language);

      const peer = superseded ? await context.newPage() : undefined;
      if (peer) {
        await peer.clock.install({ time: new Date('2026-09-27T12:00:00') });
        await peer.goto('./');
        await nav(peer, copies[language].settingsNav).click();
      } else {
        await page.locator('#language').selectOption(other);
        await expect(page.locator('#language')).toHaveValue(other);
      }
      const before = await readDataset(page);
      const modulePath = await developmentModuleUrl(page, '/src/data/database.ts');
      const probe = await page.evaluateHandle(async (modulePath) => {
        const { Repository }: typeof import('../src/data/database') = await import(modulePath);
        const original = Repository.prototype.setSettings;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        let entered = false;
        let notified = false;
        const notifications = new BroadcastChannel('my-goat-journey-dataset');
        notifications.onmessage = () => {
          notified = true;
        };
        Repository.prototype.setSettings = async function () {
          Repository.prototype.setSettings = original;
          entered = true;
          await gate;
          throw new Error('Delayed obsolete preference failure');
        };
        return {
          release,
          entered: () => entered,
          notified: () => notified,
          dispose: () => notifications.close(),
        };
      }, modulePath);
      const current = superseded ? language : other;
      await page.getByRole('checkbox', { name: copies[current].reducedMotion }).click();
      await expect.poll(() => probe.evaluate((probe) => probe.entered())).toBe(true);
      // A foreground commit intentionally disables this tab's language control.
      // Only a real peer can change language while the mutation is held; that
      // notification invalidates the old operation rather than rebasing its Retry.
      await expect(page.locator('#language')).toBeDisabled();
      if (peer) {
        await peer.locator('#language').selectOption(other);
        await expect(peer.locator('#language')).toHaveValue(other);
        await expect.poll(() => probe.evaluate((probe) => probe.notified())).toBe(true);
      }
      await probe.evaluate((probe) => probe.release());
      await expect(page.locator('#language')).toBeEnabled();
      await expect(page.locator('#language')).toHaveValue(other);
      const copy = copies[other];
      await expect(page.getByRole('alert')).toContainText(
        superseded ? copy.staleError : copy.saveError,
      );
      await expect(page.getByRole('button', { name: copy.retry, exact: true })).toHaveCount(
        superseded ? 0 : 1,
      );
      await expect(page.getByRole('button', { name: copy.reload, exact: true })).toHaveCount(
        superseded ? 1 : 0,
      );
      await expect(page.getByRole('checkbox', { name: copy.reducedMotion })).not.toBeChecked();
      expect(await readDataset(page)).toEqual(
        superseded
          ? {
              ...before,
              revision: before.revision + 1,
              settings: { ...before.settings, language: other },
            }
          : before,
      );
      if (!superseded) {
        await page.getByRole('button', { name: copy.retry, exact: true }).click();
        await expect(page.getByRole('alert')).toHaveCount(0);
        await expect(page.getByRole('checkbox', { name: copy.reducedMotion })).toBeChecked();
        expect(await readDataset(page)).toEqual({
          ...before,
          revision: before.revision + 1,
          settings: { ...before.settings, reducedMotion: true },
        });
      }
      await probe.evaluate((probe) => probe.dispose());
      await probe.dispose();
      await peer?.close();
    });
}
