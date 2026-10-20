import { localDate, parseLocalDate } from '../../domain/calendar';
import { activationAt, agenda, definitionAt, membershipAt, summarize } from '../../domain/agenda';
import type { AgendaItem, Dataset, LocalDate } from '../../domain/types';

export type CalendarScope =
  { kind: 'habit'; id: string } | { kind: 'pillar'; id: string } | { kind: 'all' };
export type DayState = 'completed' | 'partial' | 'incomplete' | 'unscheduled';

export interface CalendarDay {
  date: LocalDate;
  state: DayState;
  applicable: boolean;
  items: AgendaItem[];
}

function participates(
  data: Dataset,
  scope: CalendarScope,
  date: LocalDate,
  items: AgendaItem[],
): boolean {
  return data.habits.some((habit) => {
    if (date < habit.createdOn || !activationAt(habit, date) || !definitionAt(habit, date))
      return false;
    const item = items.find((item) => item.habit.id === habit.id);
    const pillarId = item?.pillarId ?? membershipAt(habit, date)?.pillarId;
    return scope.kind === 'habit'
      ? habit.id === scope.id
      : scope.kind === 'all'
        ? pillarId !== undefined
        : pillarId === scope.id;
  });
}

/** Project authoritative obligations without changing progress or saved facts. */
export function calendarDays(
  data: Dataset,
  scope: CalendarScope,
  window: PeriodWindow,
): CalendarDay[] {
  const days: CalendarDay[] = [];
  const cursor = parseLocalDate(window.start);
  for (
    let date = localDate(cursor);
    date <= window.historyEnd;
    cursor.setDate(cursor.getDate() + 1), date = localDate(cursor)
  ) {
    const allItems = agenda(data, date);
    const items = allItems.filter(
      (item) =>
        scope.kind === 'all' ||
        (scope.kind === 'habit' ? item.habit.id === scope.id : item.pillarId === scope.id),
    );
    const summary = summarize(items, scope.kind === 'pillar' ? 'pillar' : 'habit');
    const state: DayState =
      summary.status === 'complete'
        ? 'completed'
        : summary.status === 'neutral'
          ? 'unscheduled'
          : items.some((item) => item.done) && scope.kind !== 'habit'
            ? 'partial'
            : 'incomplete';
    // Habit cards keep archive gaps gray; pillars only show actual historical participation.
    const applicable =
      scope.kind === 'habit'
        ? data.habits.some((habit) => habit.id === scope.id && habit.createdOn <= date)
        : participates(data, scope, date, allItems);
    days.push({ date, state, applicable, items });
  }
  return days;
}

/** Participation includes unchecked optional opportunities and real off-days, not just saved credit. */
export function hasEarlierHistory(data: Dataset, scope: CalendarScope, start: LocalDate): boolean {
  parseLocalDate(start);
  const first = data.habits.map((habit) => habit.createdOn).sort()[0];
  if (!first || first >= start) return false;
  const cursor = parseLocalDate(first);
  for (
    let date = localDate(cursor);
    date < start;
    cursor.setDate(cursor.getDate() + 1), date = localDate(cursor)
  ) {
    if (participates(data, scope, date, agenda(data, date))) return true;
  }
  return false;
}

/** Whole-percent display ratio; gray or inapplicable dates never enter the denominator. */
export function periodStats(days: CalendarDay[]): {
  completed: number;
  eligible: number;
  percent: number | null;
} {
  const eligible = days.filter((day) => day.applicable && day.state !== 'unscheduled');
  const completed = eligible.filter((day) => day.state === 'completed').length;
  return {
    completed,
    eligible: eligible.length,
    percent: eligible.length ? Math.round((completed / eligible.length) * 100) : null,
  };
}

export type Interval = '7d' | '1m' | '3m' | '12m' | '24m';

export interface PeriodWindow {
  start: LocalDate;
  end: LocalDate;
  historyEnd: LocalDate;
}

/** Closed local dates, not elapsed 24-hour durations. */
export function periodWindow(today: LocalDate, interval: Interval, offset: number): PeriodWindow {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid period offset');
  const yesterday = parseLocalDate(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const end = new Date(yesterday);
  const start = new Date(yesterday);
  if (interval === '7d') {
    end.setDate(end.getDate() - offset * 7);
    start.setFullYear(end.getFullYear(), end.getMonth(), end.getDate() - 6);
  } else {
    const months = Number(interval.slice(0, -1));
    // Anchor on day one before changing months to avoid month-end overflow.
    end.setDate(1);
    end.setMonth(end.getMonth() - offset * months + 1);
    end.setDate(0);
    start.setDate(1);
    start.setMonth(start.getMonth() - offset * months - months + 1);
  }
  const endDate = localDate(end);
  return {
    start: localDate(start),
    end: endDate,
    historyEnd: endDate < localDate(yesterday) ? endDate : localDate(yesterday),
  };
}
