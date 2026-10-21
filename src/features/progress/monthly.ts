import { localDate, parseLocalDate } from '../../domain/calendar';
import type { Dataset, LocalDate } from '../../domain/types';
import { createAgendaProjection } from '../../domain/agenda';
import { participates, type CalendarScope, type PeriodWindow } from './calendar';

export interface CalendarMonth {
  key: string;
  start: LocalDate;
  end: LocalDate;
  cells: (LocalDate | null)[];
}

/** Full, separate months; alignment slots are never neighboring dates. */
export function calendarMonths(window: PeriodWindow): CalendarMonth[] {
  const cursor = parseLocalDate(window.start);
  const last = parseLocalDate(window.end);
  cursor.setDate(1);
  last.setDate(1);
  const months: CalendarMonth[] = [];
  while (cursor <= last) {
    const start = localDate(cursor);
    const monthEnd = new Date(cursor);
    monthEnd.setMonth(monthEnd.getMonth() + 1);
    monthEnd.setDate(0);
    const end = localDate(monthEnd);
    const cells: (LocalDate | null)[] = Array.from(
      { length: (cursor.getDay() + 6) % 7 },
      () => null,
    );
    const day = new Date(cursor);
    for (
      let date = localDate(day);
      date <= end;
      day.setDate(day.getDate() + 1), date = localDate(day)
    ) {
      cells.push(date);
    }
    while (cells.length % 7) cells.push(null);
    months.push({ key: start.slice(0, 7), start, end, cells });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

/** Presentation boundary only; authoritative applicability owns participation. */
export function trackingStart(data: Dataset, scope: CalendarScope): LocalDate | undefined {
  if (scope.kind === 'habit') return data.habits.find((habit) => habit.id === scope.id)?.createdOn;
  const created = data.habits.map((habit) => habit.createdOn).sort();
  const first = created[0];
  if (!first) return undefined;
  const knownDates = [
    ...created,
    ...data.occurrences.map((occurrence) => occurrence.date),
    ...data.habits.flatMap((habit) => [
      ...habit.versions.map((version) => version.effectiveFrom),
      ...habit.memberships.map((membership) => membership.effectiveFrom),
      ...habit.periods.flatMap((period) =>
        period.end ? [period.start, period.end] : [period.start],
      ),
      ...(habit.pendingReactivation ? [habit.pendingReactivation.requestedOn] : []),
    ]),
  ];
  // After the last saved boundary, a weekly schedule needs at most seven
  // local days to expose its first pending reactivation opportunity.
  const limit = parseLocalDate(knownDates.sort().at(-1)!);
  limit.setDate(limit.getDate() + 7);
  const last = localDate(limit);
  const cursor = parseLocalDate(first);
  const projection = createAgendaProjection(data);
  for (
    let date = localDate(cursor);
    date <= last;
    cursor.setDate(cursor.getDate() + 1), date = localDate(cursor)
  ) {
    if (participates(data, scope, date, projection.agenda(date))) return date;
  }
  return undefined;
}
