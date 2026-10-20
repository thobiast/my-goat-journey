import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

test('development source edits reach the running app without rebuilding its image', async ({
  page,
}) => {
  test.skip(
    (process.env.BASE_URL ?? '').includes('runtime'),
    'Built runtime intentionally has no source mount',
  );
  const path = 'src/i18n/en.json';
  const original = readFileSync(path, 'utf8');
  const updated = JSON.parse(original);
  updated.welcome = 'Source refresh verified';
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  try {
    writeFileSync(path, JSON.stringify(updated, null, 2) + '\n');
    await expect(
      page.getByRole('heading', { name: 'Source refresh verified', exact: true }),
    ).toBeVisible();
  } finally {
    writeFileSync(path, original);
  }
});
