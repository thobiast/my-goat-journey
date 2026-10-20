import {
  activationAt,
  definitionAt,
  membershipAt,
  nextHabitScheduledDate,
  pendingReactivationDate,
} from './agenda';
import { weekday } from './calendar';
import type { Dataset, LocalDate, Pillar } from './types';

/** Check prospective participation across every timeline interval, not just the
 * final owner. Sampling each boundary and its next scheduled date covers sparse
 * schedules without walking every day. Closed archive dates and retained current
 * credit are history, not a reason to block removal of a moved/archived source.
 */
export function pillarHasProspectiveHabits(
  data: Dataset,
  pillarId: string,
  date: LocalDate,
): boolean {
  return data.habits.some((habit) => {
    const occurrences = data.occurrences.filter((o) => o.habitId === habit.id);
    const reactivation = pendingReactivationDate(habit);
    const boundaries = new Set(
      [
        date,
        habit.createdOn,
        ...habit.memberships.map((m) => m.effectiveFrom),
        ...habit.versions.map((v) => v.effectiveFrom),
        ...habit.periods.map((p) => p.start),
        ...(reactivation ? [reactivation] : []),
        ...occurrences.map((o) => o.date),
      ].filter((boundary) => boundary >= date),
    );
    const candidates = new Set(boundaries);
    for (const boundary of boundaries) candidates.add(nextHabitScheduledDate(habit, boundary));
    return [...candidates].some((candidate) => {
      const period = activationAt(habit, candidate);
      if (!period || (period.end && period.end <= candidate)) return false;
      if (
        candidate !== habit.createdOn &&
        !definitionAt(habit, candidate)?.weekdays.includes(weekday(candidate))
      )
        return false;
      const occurrence = occurrences.find((o) => o.date === candidate);
      if (occurrence?.exempt || (candidate === date && occurrence?.assignmentLocked)) return false;
      return (occurrence?.pillarId ?? membershipAt(habit, candidate)?.pillarId) === pillarId;
    });
  });
}

/** Management destinations exclude removed records; historical resolvers must not. */
export function requireActivePillar(data: Dataset, pillarId: string): Pillar {
  const pillar = data.pillars.find((p) => p.id === pillarId && !p.removedOn);
  if (!pillar) throw new Error('Select a valid active pillar');
  return pillar;
}
