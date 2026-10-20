import { defineConfig } from '@playwright/test';
import shared from './playwright.config';

export default defineConfig({
  ...shared,
  testMatch: [
    'onboarding.spec.ts',
    'progress-interval.spec.ts',
    'brand-icons.spec.ts',
    'habits.spec.ts',
    'restore.spec.ts',
    'pillars-ux-navigation.spec.ts',
    'revisions.spec.ts',
    'replacement-tabs.spec.ts',
    'privacy.spec.ts',
    'lifecycle-pt.spec.ts',
    'consistency-accessibility.spec.ts',
  ],
  outputDir: 'artifacts/production-pwa/compiled-regression-results',
  reporter: [
    ['list'],
    ['json', { outputFile: 'artifacts/production-pwa/compiled-regression-results.json' }],
  ],
});
