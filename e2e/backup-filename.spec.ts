import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { setupScheduledHabits, nav, readDataset } from './support/habit-fixtures';

const cases = [
  {
    timezoneId: 'America/Sao_Paulo',
    instant: '2027-01-02T06:04:59.987Z',
    stamp: '2027-01-02_03-04',
  },
  {
    timezoneId: 'America/Sao_Paulo',
    instant: '2026-10-19T00:48:37.123Z',
    stamp: '2026-10-18_21-48',
  },
  { timezoneId: 'Asia/Tokyo', instant: '2026-12-31T15:05:42.456Z', stamp: '2027-01-01_00-05' },
];

// Isolated fictional diaries; browser timezones are independent of the test runner.
for (const { timezoneId, instant, stamp } of cases) {
  test.describe(`${timezoneId} at ${instant}`, () => {
    test.use({ timezoneId });
    for (const language of ['en', 'pt'] as const) {
      test(`Download suggests an exact local timestamp in ${language} from the exportedAt instant`, async ({
        page,
      }) => {
        await setupScheduledHabits(page);
        await nav(page, 'Settings').click();
        if (language === 'pt') {
          await page.getByLabel('Language', { exact: true }).selectOption('pt');
          await expect(page.getByLabel('Idioma', { exact: true })).toHaveValue('pt');
        }
        await page.clock.setFixedTime(new Date(instant));
        const committed = await readDataset(page);
        const pending = page.waitForEvent('download');
        await page
          .getByRole('button', {
            name: language === 'pt' ? 'Exportar backup' : 'Export backup',
            exact: true,
          })
          .click();
        const download = await pending;
        expect(download.suggestedFilename()).toBe(`my-goat-journey-backup-${stamp}.json`);
        const envelope = JSON.parse(await readFile((await download.path())!, 'utf8'));
        const { revision: _revision, ...portable } = committed;
        expect(envelope).toEqual({
          format: 'my-goat-journey-backup',
          formatVersion: 1,
          exportedAt: instant,
          dataset: portable,
        });
        expect(await readDataset(page)).toEqual(committed);
      });
    }
  });
}

test('Restore accepts timestamped, previous and user-renamed filenames without changing portable facts', async ({
  page,
}) => {
  await setupScheduledHabits(page);
  await nav(page, 'Settings').click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup', exact: true }).click();
  const download = await pending;
  const bytes = await readFile((await download.path())!);
  const envelope = JSON.parse(bytes.toString('utf8'));
  for (const name of [
    download.suggestedFilename(),
    'my-goat-journey-backup.json',
    'my-renamed-private-copy.txt',
  ]) {
    await page.getByRole('checkbox', { name: 'Reduce motion', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Reduce motion', exact: true })).toBeChecked();
    const before = await readDataset(page);
    await page
      .getByLabel('Choose backup file', { exact: true })
      .setInputFiles({ name, mimeType: 'application/json', buffer: bytes });
    await expect(page.getByRole('heading', { name: 'Backup ready', exact: true })).toBeVisible();
    expect(await readDataset(page)).toEqual(before);
    await page.getByRole('button', { name: 'Replace current data', exact: true }).click();
    await expect(page.getByText('Backup restored.', { exact: true })).toBeVisible();
    const { revision, ...portable } = await readDataset(page);
    expect(portable).toEqual(envelope.dataset);
    expect(revision).toBeGreaterThan(before.revision);
  }
});
