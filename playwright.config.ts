import { defineConfig } from '@playwright/test';
import { resolveAppURL } from './config/site.mjs';

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 30000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'artifacts/playwright-report' }]],
  outputDir: 'artifacts/test-results',
  use: {
    baseURL: resolveAppURL(process.env.BASE_URL || 'http://my-goat-journey-dev:5173'),
    viewport: { width: 360, height: 800 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
