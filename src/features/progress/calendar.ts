import { civilDate, parseLocalDate } from '../../domain/calendar';
import {
  activationAt,
  createAgendaProjection,
  definitionAt,
  membershipAt,
  summarize,
} from '../../domain/agenda';
import type { AgendaItem, Dataset, Habit, LocalDate } from '../../domain/types';

export type CalendarScope =
  { kind: 'habit'; id: string } | { kind: 'pillar'; id: string } | { kind: 'all' };
export type DayState = 'completed' | 'partial' | 'incomplete' | 'unscheduled';

export interface CalendarDay {
  date: LocalDate;
  state: DayState;
  applicable: boolean;
  items: AgendaItem[];
}

function participationPillar(habit: Habit, date: LocalDate, item?: AgendaItem): string | undefined {
  if (date < habit.createdOn || !activationAt(habit, date) || !definitionAt(habit, date))
    return undefined;
  return item?.pillarId ?? membershipAt(habit, date)?.pillarId;
}

export function participates(
  data: Dataset,
  scope: CalendarScope,
  date: LocalDate,
  items: AgendaItem[],
): boolean {
  const byHabit = new Map(items.map((item) => [item.habit.id, item]));
  return data.habits.some((habit) => {
    if (scope.kind === 'habit' && habit.id !== scope.id) return false;
    const pillarId = participationPillar(habit, date, byHabit.get(habit.id));
    // Valid habits always have a membership while active.
    return scope.kind === 'pillar' ? pillarId === scope.id : pillarId !== undefined;
  });
}

/** Project one range for all cards. Dated agendas and grouping are discarded after this call. */
export function calendarCards(
  data: Dataset,
  scopes: CalendarScope[],
  window: PeriodWindow,
): CalendarDay[][] {
  const cards: CalendarDay[][] = scopes.map(() => []);
  const cursor = parseLocalDate(window.start);
  const lastDate = parseLocalDate(window.historyEnd);
  if (!scopes.length) return cards;
  const projection = createAgendaProjection(data);
  const habits = new Map(data.habits.map((habit) => [habit.id, habit]));
  for (
    let date = civilDate(cursor);
    cursor <= lastDate;
    cursor.setUTCDate(cursor.getUTCDate() + 1), date = civilDate(cursor)
  ) {
    const allItems = projection.agenda(date);
    const byHabit = new Map<string, AgendaItem[]>();
    const byPillar = new Map<string, AgendaItem[]>();
    for (const item of allItems) {
      byHabit.set(item.habit.id, [item]);
      let items = byPillar.get(item.pillarId);
      if (!items) byPillar.set(item.pillarId, (items = []));
      items.push(item);
    }
    const participating = new Set<string>();
    for (const habit of data.habits) {
      const pillarId = participationPillar(habit, date, byHabit.get(habit.id)?.[0]);
      if (pillarId !== undefined) participating.add(pillarId);
    }
    scopes.forEach((scope, index) => {
      const items =
        scope.kind === 'all'
          ? allItems
          : scope.kind === 'habit'
            ? (byHabit.get(scope.id) ?? [])
            : (byPillar.get(scope.id) ?? []);
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
      const habit = scope.kind === 'habit' ? habits.get(scope.id) : undefined;
      const applicable =
        scope.kind === 'habit'
          ? !!habit && habit.createdOn <= date
          : scope.kind === 'all'
            ? participating.size > 0
            : participating.has(scope.id);
      cards[index].push({ date, state, applicable, items });
    });
  }
  return cards;
}

/** Project authoritative obligations without changing progress or saved facts. */
export function calendarDays(
  data: Dataset,
  scope: CalendarScope,
  window: PeriodWindow,
): CalendarDay[] {
  return calendarCards(data, [scope], window)[0];
}

/** Participation includes unchecked optional opportunities and real off-days, not just saved credit. */
export function hasEarlierHistory(data: Dataset, scope: CalendarScope, start: LocalDate): boolean {
  const lastDate = parseLocalDate(start);
  const first = data.habits.map((habit) => habit.createdOn).sort()[0];
  if (!first || first >= start) return false;
  const cursor = parseLocalDate(first);
  const projection = createAgendaProjection(data);
  for (
    let date = civilDate(cursor);
    cursor < lastDate;
    cursor.setUTCDate(cursor.getUTCDate() + 1), date = civilDate(cursor)
  ) {
    if (participates(data, scope, date, projection.agenda(date))) return true;
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
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const end = new Date(yesterday);
  const start = new Date(yesterday);
  if (interval === '7d') {
    end.setUTCDate(end.getUTCDate() - offset * 7);
    start.setUTCFullYear(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - 6);
  } else {
    const months = Number(interval.slice(0, -1));
    // Anchor on day one before changing months to avoid month-end overflow.
    end.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() - offset * months + 1);
    end.setUTCDate(0);
    start.setUTCDate(1);
    start.setUTCMonth(start.getUTCMonth() - offset * months - months + 1);
  }
  const endDate = civilDate(end);
  return {
    start: civilDate(start),
    end: endDate,
    historyEnd: endDate < civilDate(yesterday) ? endDate : civilDate(yesterday),
  };
}
