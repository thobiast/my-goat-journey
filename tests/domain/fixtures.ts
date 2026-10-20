import type { Dataset } from '../../src/domain/types';

export function facts(): Dataset {
  return {
    schemaVersion: 2,
    revision: 0,
    onboardingComplete: true,
    draft: null,
    settings: { language: 'en', reducedMotion: false },
    pillars: [
      { id: 'mind', name: 'Mind' },
      { id: 'body', name: 'Body' },
    ],
    habits: [
      {
        id: 'read',
        createdOn: '2026-09-27',
        versions: [{ effectiveFrom: '2026-09-27', goal: 'Read 10 pages', weekdays: [1, 3, 5] }],
        memberships: [{ effectiveFrom: '2026-09-27', pillarId: 'mind' }],
        periods: [{ id: 'initial', start: '2026-09-27' }],
      },
    ],
    occurrences: [],
    permanentUnlocks: [],
  };
}
