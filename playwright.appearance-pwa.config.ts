import { defineConfig } from '@playwright/test';
import shared from './playwright.config';

// Requires distinct, unmodified compiled nginx B/C fixtures; BASE_URL is not a fixture selector.
export default defineConfig({
  ...shared,
  testMatch: 'appearance-pwa.spec.ts',
  timeout: 150_000,
  expect: { timeout: 15_000 },
  metadata: { appearancePwa: true },
  outputDir: 'artifacts/appearance/pwa-results',
  reporter: [['list'], ['json', { outputFile: 'artifacts/appearance/pwa-results.json' }]],
  use: {
    ...shared.use,
    channel: 'chromium',
    timezoneId: 'UTC',
    colorScheme: 'light',
    serviceWorkers: 'allow',
  },
});
