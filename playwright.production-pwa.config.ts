import { defineConfig } from '@playwright/test';
import shared from './playwright.config';

export default defineConfig({
  ...shared,
  testMatch: 'production-pwa.spec.ts',
  timeout: 90_000,
  metadata: { productionPwa: true },
  outputDir: `${process.env.PRODUCTION_PWA_EVIDENCE ?? 'artifacts/production-pwa'}/production-results`,
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: `${process.env.PRODUCTION_PWA_EVIDENCE ?? 'artifacts/production-pwa'}/production-results.json`,
      },
    ],
  ],
});
