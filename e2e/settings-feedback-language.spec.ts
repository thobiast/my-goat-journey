import { test, expect, type Page } from '@playwright/test';
import type { Dataset, Settings } from '../src/domain/types';
import { developmentModuleUrl } from './support/development-module';
import { nav, readDataset, setupScheduledHabits } from './support/habit-fixtures';
import en from '../src/i18n/en.json' with { type: 'json' };
import pt from '../src/i18n/pt.json' with { type: 'json' };

const copies = { en, pt };
type Language = Settings['language'];
type ExportResult = 'download' | 'size' | 'failure' | 'restored';

interface ExportProbe {
  release: () => void;
  state: () => { leases: number; blocked: boolean };
  dispose: () => void;
}

test.setTimeout(90_000);

async function openSettings(page: Page, language: Language) {
  await setupScheduledHabits(page);
  await nav(page, en.settingsNav).click();
  await switchLanguage(page, language);
}

async function switchLanguage(page: Page, language: Language) {
  const select = page.locator('#language');
  await select.selectOption(language);
  await expect(select).toHaveValue(language);
  await expect(
    page.getByRole('heading', { name: copies[language].settings, exact: true }),
  ).toBeVisible();
}

function withoutPreferenceRevision(data: Dataset) {
  const { revision: _revision, settings, ...facts } = data;
  const { language: _language, ...preferences } = settings;
  return { ...facts, settings: preferences };
}

for (const language of ['en', 'pt'] as const) {
  const other = language === 'en' ? 'pt' : 'en';

  for (const kind of ['invalid', 'size'] as const) {
    test(`retained ${kind} restore alert follows ${language} → ${other} → ${language} without remounting`, async ({
      page,
    }) => {
      await openSettings(page, language);
      const before = await readDataset(page);
      const select = await page.locator('#language').elementHandle();
      await page.locator('#backup-file').setInputFiles({
        name: `${kind}-fictional-backup.json`,
        mimeType: 'application/json',
        buffer: kind === 'size' ? Buffer.alloc(20 * 1024 * 1024 + 1, ' ') : Buffer.from('{}'),
      });
      const key = kind === 'size' ? 'fileTooLarge' : 'invalidBackup';
      await expect(page.getByRole('alert')).toHaveText(copies[language][key]);
      await switchLanguage(page, other);
      await expect(page.getByRole('alert')).toHaveText(copies[other][key]);
      await switchLanguage(page, language);
      await expect(page.getByRole('alert')).toHaveText(copies[language][key]);
      expect(await select!.evaluate((node) => node === document.getElementById('language'))).toBe(
        true,
      );
      await expect(page.locator('.confirmation')).toHaveCount(0);
      await expect(page.locator('.settings-content > [role="status"]')).toBeEmpty();
      expect(withoutPreferenceRevision(await readDataset(page))).toEqual(
        withoutPreferenceRevision(before),
      );
    });
  }

  test(`retained native download status follows ${language} → ${other} → ${language}`, async ({
    page,
  }) => {
    await openSettings(page, language);
    const before = await readDataset(page);
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: copies[language].exportBackup, exact: true }).click();
    expect((await pending).suggestedFilename()).toMatch(/^my-goat-journey-backup-.*\.json$/);
    const status = page.locator('.settings-content > [role="status"]');
    await expect(status).toHaveText(copies[language].downloadStarted);
    await expect(status).toHaveAttribute('aria-live', 'polite');
    await expect(status).toHaveAttribute('aria-atomic', 'true');
    await switchLanguage(page, other);
    await expect(status).toHaveText(copies[other].downloadStarted);
    await switchLanguage(page, language);
    await expect(status).toHaveText(copies[language].downloadStarted);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(withoutPreferenceRevision(await readDataset(page))).toEqual(
      withoutPreferenceRevision(before),
    );
  });
}

// Isolate callback timing from App's serialized persistence/busy ownership. The real
// component, parser, serializer and download boundary run unchanged; only fresh()
// and the replacement completion callback are held. This does not certify persistence.
async function controlledOperation(page: Page, language: Language, result: ExportResult) {
  await setupScheduledHabits(page);
  const data = await readDataset(page);
  const settingsUrl = await developmentModuleUrl(page, '/src/features/settings/SettingsPage.tsx');
  await page.evaluate(
    async ({ data, language, result, settingsUrl, copies }) => {
      const entry = new URL('./', location.href);
      const source = await (await fetch(new URL('src/main.tsx', entry))).text();
      const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
      const reactUrl = imports.find((url) => /\/react\.js\?/.test(url));
      const clientUrl = imports.find((url) => /\/react-dom_client\.js\?/.test(url));
      if (!reactUrl || !clientUrl) throw new Error('Expected Vite React entry imports');
      const settingsSource = await (await fetch(settingsUrl)).text();
      const backupUrl = [...settingsSource.matchAll(/from\s+["']([^"']+)["']/g)]
        .map((match) => match[1])
        .find((url) => new URL(url, location.origin).pathname.endsWith('/src/data/backup.ts'));
      if (!backupUrl) throw new Error('Expected Settings backup module import');
      const [
        { default: React },
        {
          default: { createRoot },
        },
        { SettingsPage },
        { BackupError },
      ] = await Promise.all([
        import(new URL(reactUrl, location.origin).href),
        import(new URL(clientUrl, location.origin).href),
        import(settingsUrl),
        import(new URL(backupUrl, location.origin).href),
      ]);
      let leases = 0;
      let blocked = false;
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const host = document.createElement('div');
      host.dataset.settingsFeedbackProbe = 'true';
      document.getElementById('root')!.hidden = true;
      document.body.append(host);
      const root = createRoot(host);
      const beginOperation = () => {
        ++leases;
        return () => {
          --leases;
        };
      };
      const blockUpdate = (value: boolean) => {
        blocked = value;
      };
      let current: Dataset = { ...data, settings: { ...data.settings, language } };
      const render = () =>
        root.render(
          React.createElement(SettingsPage, {
            data: current,
            copy: copies[current.settings.language],
            busy: false,
            beginOperation,
            blockUpdate,
            settings: (patch: Partial<Settings>) => {
              current = { ...current, settings: { ...current.settings, ...patch } };
              render();
            },
            fresh: async () => {
              await pending;
              if (result === 'size') throw new BackupError('size');
              if (result === 'failure') throw new Error('Controlled fresh read failure');
              return current;
            },
            edited: () => {},
            replace: (_candidate: Dataset, _revision: number, after: () => void) => {
              if (result !== 'restored') throw new Error('Unexpected replacement');
              void pending.then(after);
            },
            reset: () => {
              throw new Error('Unexpected reset');
            },
          }),
        );
      (window as unknown as { settingsFeedbackProbe: ExportProbe }).settingsFeedbackProbe = {
        release,
        state: () => ({ leases, blocked }),
        dispose: () => {
          root.unmount();
          host.remove();
        },
      };
      render();
    },
    { data, language, result, settingsUrl, copies },
  );
}

for (const language of ['en', 'pt'] as const) {
  const other = language === 'en' ? 'pt' : 'en';
  for (const result of ['download', 'size', 'failure'] as const) {
    test(`pending export ${result} completes in current copy after ${language} → ${other}`, async ({
      page,
    }) => {
      test.skip(
        (process.env.BASE_URL ?? '').includes('runtime'),
        'Controlled fresh promise uses development modules',
      );
      await controlledOperation(page, language, result);
      const probe = page.locator('[data-settings-feedback-probe]');
      const select = await probe.locator('#language').elementHandle();
      const button = probe.getByRole('button', {
        name: copies[language].exportBackup,
        exact: true,
      });
      const state = () =>
        page.evaluate(() =>
          (
            window as unknown as { settingsFeedbackProbe: ExportProbe }
          ).settingsFeedbackProbe.state(),
        );
      await button.click();
      await expect(button).toBeDisabled();
      await expect.poll(state).toEqual({ leases: 1, blocked: true });
      await probe.locator('#language').selectOption(other);
      await expect(probe.locator('#language')).toHaveValue(other);
      const download = result === 'download' ? page.waitForEvent('download') : undefined;
      await page.evaluate(() =>
        (
          window as unknown as { settingsFeedbackProbe: ExportProbe }
        ).settingsFeedbackProbe.release(),
      );
      if (download) expect((await download).suggestedFilename()).toMatch(/\.json$/);
      const key = result === 'size' ? 'backupTooLarge' : 'saveError';
      const feedback = probe.getByRole(result === 'download' ? 'status' : 'alert');
      await expect(feedback).toHaveText(
        result === 'download' ? copies[other].downloadStarted : copies[other][key],
      );
      await expect.poll(state).toEqual({ leases: 0, blocked: false });
      await probe.locator('#language').selectOption(language);
      await expect(feedback).toHaveText(
        result === 'download' ? copies[language].downloadStarted : copies[language][key],
      );
      expect(await select!.evaluate((node) => node.isConnected)).toBe(true);
      await page.evaluate(() =>
        (
          window as unknown as { settingsFeedbackProbe: ExportProbe }
        ).settingsFeedbackProbe.dispose(),
      );
    });
  }

  test(`pending restore callback completes in current copy after ${language} → ${other}`, async ({
    page,
  }) => {
    test.skip(
      (process.env.BASE_URL ?? '').includes('runtime'),
      'Controlled replacement callback uses development modules',
    );
    await controlledOperation(page, language, 'restored');
    const probe = page.locator('[data-settings-feedback-probe]');
    const { revision: _revision, ...dataset } = await readDataset(page);
    await probe.locator('#backup-file').setInputFiles({
      name: 'fictional-callback-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'my-goat-journey-backup',
          formatVersion: 1,
          exportedAt: '2026-09-27T12:00:00.000Z',
          dataset,
        }),
      ),
    });
    await expect(
      probe.getByRole('heading', { name: copies[language].backupReady, exact: true }),
    ).toBeVisible();
    await probe.getByRole('button', { name: copies[language].replaceData, exact: true }).click();
    await probe.locator('#language').selectOption(other);
    await expect(
      probe.getByRole('heading', { name: copies[other].backupReady, exact: true }),
    ).toBeVisible();
    await page.evaluate(() =>
      (window as unknown as { settingsFeedbackProbe: ExportProbe }).settingsFeedbackProbe.release(),
    );
    await expect(probe.getByRole('status')).toHaveText(copies[other].backupRestored);
    await expect(probe.locator('.confirmation')).toHaveCount(0);
    await probe.locator('#language').selectOption(language);
    await expect(probe.getByRole('status')).toHaveText(copies[language].backupRestored);
    await page.evaluate(() =>
      (window as unknown as { settingsFeedbackProbe: ExportProbe }).settingsFeedbackProbe.dispose(),
    );
  });
}
