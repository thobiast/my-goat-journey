import { test, expect } from '@playwright/test';
import { setupScheduledHabits, nav, readDataset, abortNextWrite } from './support/habit-fixtures';
import { readFile } from 'node:fs/promises';
import en from '../src/i18n/en.json' with { type: 'json' };
import pt from '../src/i18n/pt.json' with { type: 'json' };

test.setTimeout(90_000);

for (const language of ['en', 'pt'] as const)
  test(`Invalid UTF-8 and failed byte reads preserve data and allow confirmed recovery (${language})`, async ({
    page,
  }) => {
    await setupScheduledHabits(page);
    await nav(page, en.settingsNav).click();
    if (language === 'pt') {
      await page.getByLabel(en.language, { exact: true }).selectOption('pt');
      await expect(page.getByRole('heading', { name: pt.settings, exact: true })).toBeVisible();
    }
    const copy = language === 'en' ? en : pt;
    const before = await readDataset(page);
    const { revision: _revision, ...dataset } = structuredClone(before);
    dataset.habits[0].versions[0].goal = 'ENCODING_MARKER: ação 🎵 日本語 �';
    const bytes = Buffer.from(
      JSON.stringify({
        format: 'my-goat-journey-backup',
        formatVersion: 1,
        exportedAt: '2026-09-27T12:00:00.000Z',
        dataset,
      }),
    );
    const corrupted = Buffer.from(bytes);
    const offset = corrupted.indexOf('ENCODING_MARKER');
    expect(offset).toBeGreaterThan(0);
    corrupted[offset] = 0xff;
    expect(JSON.parse(corrupted.toString('utf8')).dataset.habits[0].versions[0].goal).toBe(
      '�NCODING_MARKER: ação 🎵 日本語 �',
    );
    const input = page.getByLabel(copy.chooseBackup, { exact: true });
    for (const failure of ['encoding', 'read'] as const) {
      if (failure === 'read')
        await page.evaluate(() => {
          const original = File.prototype.arrayBuffer;
          File.prototype.arrayBuffer = function () {
            File.prototype.arrayBuffer = original;
            return Promise.reject(new Error('Controlled backup byte read failure'));
          };
        });
      await input.setInputFiles({
        name: 'fictional-backup.json',
        mimeType: 'application/json',
        buffer: failure === 'encoding' ? corrupted : bytes,
      });
      await expect(page.getByRole('alert')).toHaveText(copy.invalidBackup);
      await expect(page.getByRole('heading', { name: copy.backupReady, exact: true })).toHaveCount(
        0,
      );
      await expect(page.getByRole('button', { name: copy.replaceData, exact: true })).toHaveCount(
        0,
      );
      await expect(page.getByText(copy.checkingBackup, { exact: true })).toHaveCount(0);
      await expect(input).toBeEnabled();
      await expect(input).toHaveValue('');
      expect(await readDataset(page)).toEqual(before);
    }
    await input.setInputFiles({
      name: 'fictional-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]),
    });
    await expect(page.getByRole('heading', { name: copy.backupReady, exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await readDataset(page)).toEqual(before);
    await page.getByRole('button', { name: copy.replaceData, exact: true }).click();
    await expect(page.getByText(copy.backupRestored, { exact: true })).toBeVisible();
    const after = await readDataset(page);
    expect(after.revision).toBeGreaterThan(before.revision);
    expect(after).toEqual({ ...dataset, schemaVersion: 2, revision: after.revision });
    await page.reload();
    await expect(page.getByRole('heading', { name: copy.today, exact: true })).toBeVisible();
    expect(await readDataset(page)).toEqual(after);
  });

test('Restore validates before confirmation, cancel and native abort retain the diary, replacement never merges', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await nav(page, 'Settings').click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup', exact: true }).click();
  const file = await downloaded;
  const bytes = await readFile((await file.path())!);
  await nav(page, 'Today').click();
  await page.getByRole('button', { name: 'Add habit', exact: true }).click();
  await page.getByLabel('What do you want to do?').fill('A habit not present in the backup');
  await page.getByRole('button', { name: 'Save habit', exact: true }).click();
  await nav(page, 'Settings').click();
  await page.getByLabel('Language', { exact: true }).selectOption('pt');
  await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
  await page.getByLabel('Idioma', { exact: true }).selectOption('en');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Reduce motion', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Reduce motion', exact: true })).toBeChecked();
  const before = await readDataset(page);
  await expect(page.getByLabel('Choose backup file', { exact: true })).toBeVisible({
    timeout: 1500,
  });
  await page.getByLabel('Choose backup file', { exact: true }).setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{}'),
  });
  await expect(page.getByRole('alert')).toContainText('Invalid or unsupported backup');
  await expect(page.getByRole('button', { name: 'Replace current data', exact: true })).toHaveCount(
    0,
  );
  expect(await readDataset(page)).toEqual(before);

  const choose = () =>
    page
      .getByLabel('Choose backup file', { exact: true })
      .setInputFiles({ name: 'valid.json', mimeType: 'application/json', buffer: bytes });

  await choose();
  await expect(page.getByText('Backup ready', { exact: true })).toBeVisible();
  await page.screenshot({
    path: 'artifacts/habit-management/screenshots/restore-review-en-360.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await readDataset(page)).toEqual(before);
  await choose();
  await expect(page.getByText('Backup ready', { exact: true })).toBeVisible();
  await abortNextWrite(page);
  await page.getByRole('button', { name: 'Replace current data', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not save');
  expect(await readDataset(page)).toEqual(before);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('Backup restored.', { exact: true })).toBeVisible();
  const after = await readDataset(page);
  expect(after.revision).toBeGreaterThan(before.revision);
  const { revision: _revision, ...facts } = after;
  expect(facts).toEqual(JSON.parse(bytes.toString('utf8')).dataset);
  await choose();
  await expect(page.getByText('Backup ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Replace current data', exact: true }).click();
  await expect(page.getByText('Backup restored.', { exact: true })).toBeVisible();
  const again = await readDataset(page);
  expect(again.occurrences).toEqual(after.occurrences);
  expect(again.habits).toEqual(after.habits);
  await page.reload();
  expect((await readDataset(page)).habits).toEqual(after.habits);
});
