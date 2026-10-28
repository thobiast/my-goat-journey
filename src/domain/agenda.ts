import { civilDate, parseLocalDate, weekday } from './calendar';
import { migrateDataset } from '../data/migrations';
import { replayDates } from './replayDates';
import type {
  ActivationPeriod,
  AgendaItem,
  AgendaSummary,
  CompatibleDataset,
  Habit,
  HabitVersion,
  MembershipVersion,
  LocalDate,
  Occurrence,
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
  limit.setUTCDate(limit.getUTCDate() + 7);
  while (cursor < limit) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const date = civilDate(cursor);
    if (definitionAt(habit, date)?.weekdays.includes(cursor.getUTCDay())) return date;
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

/** Read-only operation context. Discard before mutating facts; never cache by revision or identity. */
export function createAgendaProjection(input: CompatibleDataset) {
  const data = migrateDataset(input);
  const habits = new Map(data.habits.map((habit) => [habit.id, habit]));
  const occurrences = new Map<string, Map<LocalDate, Occurrence>>();
  for (const occurrence of data.occurrences) {
    let dates = occurrences.get(occurrence.habitId);
    if (!dates) occurrences.set(occurrence.habitId, (dates = new Map()));
    // Match the original first-match lookup even before portable validation rejects duplicates.
    if (!dates.has(occurrence.date)) dates.set(occurrence.date, occurrence);
  }
  const firstRequiredDates = new Map<string, LocalDate>();

  function projectHabit(habit: Habit, date: LocalDate): AgendaItem | undefined {
    const period = activationAt(habit, date);
    if (date < habit.createdOn || !period) return undefined;
    const version = definitionAt(habit, date);
    const membership = membershipAt(habit, date);
    if (!version || !membership) return undefined;
    const optional = date === habit.createdOn;
    if (!optional && !version.weekdays.includes(weekday(date))) return undefined;
    const occurrence = occurrences.get(habit.id)?.get(date);
    let firstRequiredDate = firstRequiredDates.get(habit.id);
    if (!firstRequiredDate) {
      firstRequiredDate = nextHabitScheduledDate(habit, habit.createdOn);
      firstRequiredDates.set(habit.id, firstRequiredDate);
    }
    return {
      habit,
      date,
      weekdays: version.weekdays,
      goal: occurrence?.goal ?? version.goal,
      pillarId: occurrence?.pillarId ?? membership.pillarId,
      kind: occurrence?.kind ?? (optional ? 'optional' : 'required'),
      done: occurrence?.done ?? false,
      firstRequiredDate,
      activationId: occurrence?.activationId ?? period.id,
      pillarParticipation:
        occurrence?.pillarParticipation ?? (optional ? 'on-completion' : 'required'),
      completionProvenance: occurrence?.completionProvenance ?? 'never-credited',
      assignmentLocked: occurrence?.assignmentLocked ?? false,
      exempt: occurrence?.exempt ?? false,
    };
  }

  return {
    data,
    replayDates(through: Date): IterableIterator<LocalDate> {
      // Reuse indexed date keys; do not scan stored occurrences a second time.
      function* indexedDates() {
        for (const dates of occurrences.values()) yield* dates.keys();
      }
      return replayDates(data, through, indexedDates());
    },
    habit(habitId: string, date: LocalDate): AgendaItem | undefined {
      const habit = habits.get(habitId);
      return habit ? projectHabit(habit, date) : undefined;
    },
    agenda(date: LocalDate): AgendaItem[] {
      return data.habits
        .flatMap((habit) => {
          const item = projectHabit(habit, date);
          return item ? [item] : [];
        })
        .sort((a, b) => Number(a.kind === 'optional') - Number(b.kind === 'optional'));
    },
  };
}

export type AgendaProjection = ReturnType<typeof createAgendaProjection>;

export function agenda(input: CompatibleDataset, date: LocalDate): AgendaItem[] {
  return createAgendaProjection(input).agenda(date);
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
