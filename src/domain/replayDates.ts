import { civilDate, parseLocalDate } from './calendar';
import type { Dataset, LocalDate } from './types';

/**
 * Replay saved transitions and a complete weekly cycle strictly AFTER each one.
 * In a stable gap there are no completions or exceptions: after seven closed
 * days every possible miss has reset its counters, and further misses/neutral
 * days are idempotent. The horizon itself is always retained (Today is open).
 *
 * Only read stored boundaries here. Resolving pending schedules eagerly would
 * change exceptions and participation consumers' short-circuit behavior. A
 * pending request plus definition boundaries and their witnesses expose its due
 * date, even when prospective edits repeatedly postpone the first opportunity.
 */
export function* replayDates(
  data: Dataset,
  through: Date,
  occurrenceDates: Iterable<LocalDate>,
): IterableIterator<LocalDate> {
  const first = data.habits.map((habit) => habit.createdOn).sort()[0] ?? civilDate(through);
  const start = parseLocalDate(first);
  if (start > through) return;

  const stored = new Set<LocalDate>([first]);
  for (const habit of data.habits) {
    stored.add(habit.createdOn);
    for (const version of habit.versions) stored.add(version.effectiveFrom);
    for (const membership of habit.memberships) stored.add(membership.effectiveFrom);
    for (const period of habit.periods) {
      stored.add(period.start);
      // Witness offset one also retains the first day AFTER an inclusive end.
      if (period.end) stored.add(period.end);
      if (period.archivedOn) stored.add(period.archivedOn);
      if (period.reactivatedOn) stored.add(period.reactivatedOn);
    }
    if (habit.pendingReactivation) stored.add(habit.pendingReactivation.requestedOn);
    // Memberships already contain the prospective move boundary; do not resolve it again.
    if (habit.pendingMove) stored.add(habit.pendingMove.requestedOn);
  }
  for (const date of occurrenceDates) stored.add(date);

  // trackingStart intentionally searches seven days beyond its last stored date,
  // even at the upper calendar endpoint. Keep that original carrier/horizon.
  const last = through.getUTCFullYear() > 9999 ? '9999-12-31' : civilDate(through);
  const checkpoints = new Set<number>([start.getTime(), through.getTime()]);
  for (const date of stored) {
    if (date < first || date > last) continue;
    let checkpoint: Date;
    try {
      checkpoint = parseLocalDate(date);
    } catch {
      // Public projection also accepts unvalidated in-memory/legacy facts. Do not
      // make checkpoint collection a new validator: retain daily traversal for
      // malformed in-range boundaries and let the original consumer decide.
      const cursor = new Date(start);
      while (cursor <= through) {
        yield civilDate(cursor);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      return;
    }
    checkpoints.add(checkpoint.getTime());
  }

  const ordered = [...checkpoints].sort((a, b) => a - b);
  for (const [index, checkpoint] of ordered.entries()) {
    const cursor = new Date(checkpoint);
    const next = ordered[index + 1] ?? Infinity;
    for (let offset = 0; offset <= 7 && cursor.getTime() < next && cursor <= through; offset++) {
      yield civilDate(cursor);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
}
