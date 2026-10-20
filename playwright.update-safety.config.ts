import { defineConfig } from '@playwright/test';
import shared from './playwright.config';

// Development-only lifecycle interception. Never count this as real-worker proof.
export default defineConfig({
  ...shared,
  testMatch: 'update-safety.spec.ts',
  timeout: 90_000,
  outputDir: `${process.env.UPDATE_SAFETY_EVIDENCE ?? 'artifacts/update-safety'}/results`,
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: `${process.env.UPDATE_SAFETY_EVIDENCE ?? 'artifacts/update-safety'}/results.json`,
      },
    ],
  ],
});
