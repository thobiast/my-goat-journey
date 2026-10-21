import { localDate, parseLocalDate } from '../../src/domain/calendar';
import { DEFAULT_PILLARS, type Dataset } from '../../src/domain/types';

/** Fictional deterministic scale fixture; validate outside measured operations. */
export function longHistory(
  habitCount = 20,
  dateCount = 730,
): {
  data: Dataset;
  dates: string[];
  today: string;
} {
  const cursor = parseLocalDate('2024-10-22');
  const dates = Array.from({ length: dateCount }, () => {
    const date = localDate(cursor);
    cursor.setDate(cursor.getDate() + 1);
    return date;
  });
  const createdOn = dates[0];
  const data: Dataset = {
    schemaVersion: 2,
    revision: 0,
    onboardingComplete: true,
    draft: null,
    settings: { language: 'en', reducedMotion: true, progressInterval: '24m' },
    pillars: DEFAULT_PILLARS.map((id) => ({ id, name: id, defaultKey: id })),
    habits: Array.from({ length: habitCount }, (_, index) => ({
      id: `fictional-habit-${index}`,
      createdOn,
      versions: [
        {
          effectiveFrom: createdOn,
          goal: `Fictional practice ${index}`,
          weekdays: [0, 1, 2, 3, 4, 5, 6],
        },
      ],
      memberships: [{ effectiveFrom: createdOn, pillarId: DEFAULT_PILLARS[index % 4] }],
      periods: [{ id: `fictional-period-${index}`, start: createdOn }],
    })),
    occurrences: [],
    permanentUnlocks: [],
  };
  // Habit-major ordering is deliberate and stable for a reproducible dense lookup workload.
  data.occurrences = data.habits.flatMap((habit, habitIndex) =>
    dates.map((date, dateIndex) => {
      const done = (dateIndex + habitIndex) % 11 !== 0;
      return {
        habitId: habit.id,
        date,
        pillarId: habit.memberships[0].pillarId,
        goal: habit.versions[0].goal,
        kind: date === createdOn ? ('optional' as const) : ('required' as const),
        done,
        activationId: habit.periods[0].id,
        pillarParticipation:
          date === createdOn ? ('on-completion' as const) : ('required' as const),
        completionProvenance: done ? ('credited' as const) : ('never-credited' as const),
        assignmentLocked: done,
        recordedAt: `${date}T12:00:00.000Z`,
        timezone: 'UTC',
        offsetMinutes: 0,
      };
    }),
  );
  return { data, dates, today: dates.at(-1)! };
}
