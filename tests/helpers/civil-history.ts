import type { Dataset } from '../../src/domain/types';

/** Fictional facts assigned in UTC before a device timezone change. */
export function civilHistory(): Dataset {
  return {
    schemaVersion: 2,
    revision: 0,
    onboardingComplete: true,
    draft: null,
    settings: { language: 'en', reducedMotion: false, progressInterval: '1m' },
    pillars: [
      { id: 'mind', name: 'Mind', defaultKey: 'mind' },
      { id: 'body', name: 'Body', defaultKey: 'body' },
      { id: 'nutrition', name: 'Nutrition', defaultKey: 'nutrition' },
      { id: 'hygiene', name: 'Hygiene', defaultKey: 'hygiene' },
    ],
    habits: [
      {
        id: 'read',
        createdOn: '2011-12-29',
        versions: [
          {
            effectiveFrom: '2011-12-29',
            goal: 'Fictional reading',
            weekdays: [0, 1, 2, 3, 4, 5, 6],
          },
        ],
        memberships: [{ effectiveFrom: '2011-12-29', pillarId: 'mind' }],
        periods: [{ id: 'initial', start: '2011-12-29' }],
      },
    ],
    occurrences: [
      {
        habitId: 'read',
        date: '2011-12-30',
        pillarId: 'mind',
        goal: 'Fictional reading',
        kind: 'required',
        done: true,
        recordedAt: '2011-12-30T12:00:00.000Z',
        timezone: 'UTC',
        offsetMinutes: 0,
        activationId: 'initial',
        pillarParticipation: 'required',
        completionProvenance: 'credited',
        assignmentLocked: true,
      },
    ],
    permanentUnlocks: [],
  };
}
