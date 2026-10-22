import { validateDataset } from '../../src/data/backup';
import { civilDate, parseLocalDate } from '../../src/domain/calendar';
import type { Dataset, Habit, Occurrence } from '../../src/domain/types';
import type { CalendarScope, PeriodWindow } from '../../src/features/progress/calendar';

export const projectionToday = '2026-10-05';
export const projectionWindow: PeriodWindow = {
  start: '2026-09-26',
  end: '2026-10-12',
  historyEnd: '2026-10-09',
};

function emptyDataset(): Dataset {
  return {
    schemaVersion: 2,
    revision: 7,
    onboardingComplete: true,
    draft: null,
    settings: { language: 'en', reducedMotion: false },
    pillars: ['mind', 'body', 'nutrition', 'hygiene'].map((id) => ({
      id,
      name: id,
      defaultKey: id as 'mind' | 'body' | 'nutrition' | 'hygiene',
    })),
    habits: [],
    occurrences: [],
    permanentUnlocks: [{ id: 'fictional-keepsake', unlockedAt: '2026-09-28T12:00:00Z' }],
  };
}

function habit(id: string, createdOn: string, pillarId: string, weekdays: number[]): Habit {
  return {
    id,
    createdOn,
    versions: [{ effectiveFrom: createdOn, goal: `${id} original goal`, weekdays }],
    memberships: [{ effectiveFrom: createdOn, pillarId }],
    periods: [{ id: `${id}-initial`, start: createdOn }],
  };
}

function saved(
  habitId: string,
  date: string,
  pillarId: string,
  overrides: Partial<Occurrence> = {},
): Occurrence {
  return {
    habitId,
    date,
    pillarId,
    goal: `${habitId} original goal`,
    kind: 'required',
    done: true,
    recordedAt: `${date}T12:00:00Z`,
    timezone: 'UTC',
    offsetMinutes: 0,
    activationId: `${habitId}-initial`,
    pillarParticipation: 'required',
    completionProvenance: 'credited',
    assignmentLocked: true,
    ...overrides,
  };
}

/** Fictional portable facts: mixed ownership, implicit misses, archive gaps and future records. */
export function projectionScenario(): Dataset {
  const data = emptyDataset();
  const newcomer = habit('newcomer', '2026-10-05', 'mind', [1, 3, 5]);
  const read = habit('read', '2026-09-27', 'mind', [1, 3, 5]);
  read.versions.push({
    effectiveFrom: '2026-10-03',
    goal: 'read revised goal',
    weekdays: [1, 3, 5],
  });
  read.memberships.push({ effectiveFrom: '2026-10-05', pillarId: 'body' });
  read.periods[0] = {
    ...read.periods[0],
    end: '2026-10-02',
    archivedOn: '2026-10-02',
  };
  read.periods.push({ id: 'read-resumed', start: '2026-10-05', reactivatedOn: '2026-10-03' });
  const write = habit('write', '2026-09-27', 'mind', [1, 3, 5]);
  write.versions.push({ effectiveFrom: '2026-10-08', goal: 'write future goal', weekdays: [2, 4] });
  const walk = habit('walk', '2026-09-28', 'body', [0, 1, 2, 3, 4, 5, 6]);
  walk.periods[0] = { ...walk.periods[0], end: '2026-10-01', archivedOn: '2026-10-01' };
  walk.pendingReactivation = { periodId: 'walk-reserved', requestedOn: '2026-10-04' };
  const stretch = habit('stretch', '2026-09-29', 'body', [2, 4]);
  const retired = habit('retired', '2026-09-27', 'nutrition', [1, 3, 5]);
  retired.periods[0] = { ...retired.periods[0], end: '2026-09-30', archivedOn: '2026-09-30' };
  // Deliberately put the optional newcomer first: agenda must stably put required rows first.
  data.habits = [newcomer, read, write, walk, stretch, retired];
  data.occurrences = [
    saved('read', '2026-09-27', 'mind', { kind: 'optional', pillarParticipation: 'on-completion' }),
    saved('read', '2026-09-28', 'mind'),
    saved('read', '2026-10-02', 'mind', { done: false, exempt: true }),
    saved('read', '2026-10-09', 'body', {
      activationId: 'read-resumed',
      goal: 'read revised goal',
    }),
    saved('write', '2026-09-30', 'mind', { done: false }),
    saved('write', '2026-10-02', 'mind'),
    saved('write', '2026-10-08', 'mind', { goal: 'write future goal' }),
    saved('walk', '2026-10-01', 'body', { exempt: true }),
    saved('retired', '2026-09-30', 'nutrition', {
      done: false,
      completionProvenance: 'never-credited',
      assignmentLocked: false,
      exempt: true,
    }),
  ];
  return validateDataset(data);
}

export function projectionScopes(data: Dataset): CalendarScope[] {
  return [
    { kind: 'all' },
    ...data.pillars.map((pillar) => ({ kind: 'pillar' as const, id: pillar.id })),
    ...data.habits.map((h) => ({ kind: 'habit' as const, id: h.id })),
    { kind: 'habit', id: 'missing' },
    { kind: 'pillar', id: 'missing' },
    { kind: 'all' },
  ];
}

/** Small enough for deterministic units; every habit/date has a validated saved fact. */
export function projectionWorkScenario(): Dataset {
  const data = emptyDataset();
  const dates = projectionDates('2026-09-27', '2026-10-10');
  for (let index = 0; index < 12; index++) {
    const id = `work-${index}`;
    const pillarId = index % 2 ? 'body' : 'mind';
    data.habits.push(habit(id, dates[0], pillarId, [0, 1, 2, 3, 4, 5, 6]));
    for (const date of dates) {
      data.occurrences.push(
        saved(id, date, pillarId, {
          kind: date === dates[0] ? 'optional' : 'required',
          pillarParticipation: date === dates[0] ? 'on-completion' : 'required',
        }),
      );
    }
  }
  return validateDataset(data);
}

export function projectionDates(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = parseLocalDate(start);
  for (
    let date = civilDate(cursor);
    date <= end;
    cursor.setUTCDate(cursor.getUTCDate() + 1), date = civilDate(cursor)
  ) {
    dates.push(date);
  }
  return dates;
}

/** Count actual array-element visits, including find/filter/iteration, not wall-clock time. */
export function countOccurrenceVisits(data: Dataset): () => number {
  let visits = 0;
  data.occurrences = new Proxy(data.occurrences, {
    get(target, property, receiver) {
      if (typeof property === 'string' && /^(0|[1-9]\d*)$/.test(property)) visits++;
      return Reflect.get(target, property, receiver);
    },
  });
  return () => visits;
}

/** Observe public input evaluation without mocking projection internals. */
export function countDefinitionReads(habits: Habit[]): () => number {
  let reads = 0;
  for (const item of habits) {
    const versions = item.versions;
    Object.defineProperty(item, 'versions', {
      enumerable: true,
      configurable: true,
      get() {
        reads++;
        return versions;
      },
    });
  }
  return () => reads;
}
