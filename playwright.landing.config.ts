import { defineConfig } from '@playwright/test';
import { resolveSite } from './config/site.mjs';

const site = resolveSite();
export default defineConfig({
  testDir: './e2e',
  testMatch: ['landing.spec.ts', 'landing-licenses.spec.ts'],
  workers: 1,
  timeout: 30000,
  reporter: [['list']],
  outputDir: 'artifacts/landing-refinement/results',
  use: {
    baseURL: new URL(site.prefix, process.env.BASE_URL || 'http://my-goat-journey-dev:5173').href,
    viewport: { width: 1440, height: 1050 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
