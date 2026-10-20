import { localDate, parseLocalDate, weekday } from './calendar';
import { migrateDataset } from '../data/migrations';
import type {
  ActivationPeriod,
  AgendaItem,
  AgendaSummary,
  CompatibleDataset,
  Habit,
  HabitVersion,
  MembershipVersion,
  LocalDate,
} from './types';

export function definitionAt(habit: Habit, date: LocalDate): HabitVersion | undefined {
  return [...habit.versions].reverse().find((v) => v.effectiveFrom <= date);
}

export function membershipAt(habit: Habit, date: LocalDate): MembershipVersion | undefined {
  return [...habit.memberships].reverse().find((v) => v.effectiveFrom <= date);
}

/** Resolve the pending intent from prospective definitions, never from elapsed time or Done. */
export function nextHabitScheduledDate(habit: Habit, after: LocalDate): LocalDate {
  const cursor = parseLocalDate(after);
  const limit = parseLocalDate(
    [after, ...habit.versions.map((v) => v.effectiveFrom)].sort().at(-1)!,
  );
  limit.setDate(limit.getDate() + 7);
  while (cursor < limit) {
    cursor.setDate(cursor.getDate() + 1);
    const date = localDate(cursor);
    if (definitionAt(habit, date)?.weekdays.includes(cursor.getDay())) return date;
  }
  throw new Error('No valid resumption schedule');
}

export function pendingReactivationDate(habit: Habit): LocalDate | undefined {
  return habit.pendingReactivation
    ? nextHabitScheduledDate(habit, habit.pendingReactivation.requestedOn)
    : undefined;
}

export function activationAt(habit: Habit, date: LocalDate): ActivationPeriod | undefined {
  const actual = habit.periods.find((p) => date >= p.start && (!p.end || date <= p.end));
  if (actual) return actual;
  const start = pendingReactivationDate(habit);
  return start && date >= start
    ? {
        id: habit.pendingReactivation!.periodId,
        start,
        reactivatedOn: habit.pendingReactivation!.requestedOn,
      }
    : undefined;
}

export function agenda(input: CompatibleDataset, date: LocalDate): AgendaItem[] {
  const data = migrateDataset(input);
  return data.habits
    .flatMap((habit) => {
      const period = activationAt(habit, date);
      if (date < habit.createdOn || !period) return [];
      const version = definitionAt(habit, date);
      const membership = membershipAt(habit, date);
      if (!version || !membership) return [];
      const optional = date === habit.createdOn;
      if (!optional && !version.weekdays.includes(weekday(date))) return [];
      const occurrence = data.occurrences.find((o) => o.habitId === habit.id && o.date === date);
      return [
        {
          habit,
          date,
          weekdays: version.weekdays,
          goal: occurrence?.goal ?? version.goal,
          pillarId: occurrence?.pillarId ?? membership.pillarId,
          kind: occurrence?.kind ?? (optional ? 'optional' : 'required'),
          done: occurrence?.done ?? false,
          firstRequiredDate: nextHabitScheduledDate(habit, habit.createdOn),
          activationId: occurrence?.activationId ?? period.id,
          pillarParticipation:
            occurrence?.pillarParticipation ?? (optional ? 'on-completion' : 'required'),
          completionProvenance: occurrence?.completionProvenance ?? 'never-credited',
          assignmentLocked: occurrence?.assignmentLocked ?? false,
          exempt: occurrence?.exempt ?? false,
        } satisfies AgendaItem,
      ];
    })
    .sort((a, b) => Number(a.kind === 'optional') - Number(b.kind === 'optional'));
}

export function summarize(items: AgendaItem[], scope: 'habit' | 'pillar' = 'habit'): AgendaSummary {
  const required = items.filter(
    (i) =>
      (!i.exempt || i.done) &&
      i.kind === 'required' &&
      (scope === 'habit' || i.pillarParticipation === 'required'),
  );
  const optional = items.filter((i) => (!i.exempt || i.done) && i.kind === 'optional');
  const requiredDone = required.filter((i) => i.done).length;
  const optionalDone = optional.filter((i) => i.done).length;
  const anyCompletion = items.some((i) => i.done);
  return {
    required: required.length,
    requiredDone,
    optional: optional.length,
    optionalDone,
    status:
      requiredDone < required.length
        ? 'pending'
        : required.length || anyCompletion
          ? 'complete'
          : 'neutral',
  };
}
