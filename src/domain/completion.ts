import { nextHabitScheduledDate } from './agenda';
import { localDate, parseLocalDate } from './calendar';
import { editableOccurrences } from './history';
import type { Dataset, LocalDate } from './types';

/**
 * Updates the eligible dated fact. First credit of a stored conditional occurrence also
 * dates its membership and clears a matching pending move and its prospective membership.
 * Undo retains membership history. Repository commits these effects atomically.
 */
export function updateCompletion(
  data: Dataset,
  habitId: string,
  date: LocalDate,
  done: boolean,
  now: Date,
): void {
  parseLocalDate(date);
  if (typeof done !== 'boolean' || Number.isNaN(now.getTime()))
    throw new Error('Invalid completion');
  const today = localDate(now);
  const item = editableOccurrences(data, habitId, today).find((i) => i.date === date);
  if (!item) throw new Error('No eligible occurrence in correction window');
  const existing = data.occurrences.find((o) => o.habitId === habitId && o.date === date);
  if (existing) {
    existing.done = done;
    if (done) {
      if (
        existing.pillarParticipation === 'on-completion' &&
        existing.completionProvenance === 'never-credited'
      ) {
        const habit = data.habits.find((h) => h.id === habitId)!;
        const intent = habit.pendingMove;
        if (intent?.requestedOn === date && intent.pillarId === existing.pillarId) {
          const due = nextHabitScheduledDate(habit, intent.requestedOn);
          habit.memberships = habit.memberships.filter((m) => m.effectiveFrom !== due);
          delete habit.pendingMove;
        }
        habit.memberships = habit.memberships.filter((m) => m.effectiveFrom !== date);
        habit.memberships.push({ effectiveFrom: date, pillarId: existing.pillarId });
        habit.memberships.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
      }
      existing.completionProvenance = 'credited';
      existing.assignmentLocked = true;
    }
    return;
  }
  data.occurrences.push({
    habitId,
    date,
    pillarId: item.pillarId,
    goal: item.goal,
    kind: item.kind,
    done,
    activationId: item.activationId,
    pillarParticipation: item.pillarParticipation,
    completionProvenance: done ? 'credited' : 'never-credited',
    assignmentLocked: done,
    recordedAt: now.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    offsetMinutes: now.getTimezoneOffset(),
  });
}
