import { defineConfig } from '@playwright/test';
import shared from './playwright.config';

export default defineConfig({
  ...shared,
  testMatch: 'heading-focus.spec.ts',
  timeout: 60_000,
  outputDir: 'artifacts/heading-focus/results',
  reporter: [['list'], ['json', { outputFile: 'artifacts/heading-focus/results.json' }]],
  use: { ...shared.use, channel: 'chromium' },
});
