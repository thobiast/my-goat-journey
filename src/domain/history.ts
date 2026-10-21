import { createAgendaProjection, type AgendaProjection } from './agenda';
import { localDate, parseLocalDate } from './calendar';
import type { AgendaItem, CompatibleDataset, LocalDate } from './types';

export type HistoryStatus = 'completed' | 'missed' | 'pending' | 'optional-uncompleted' | 'exempt';

export interface HabitHistoryItem extends AgendaItem {
  status: HistoryStatus;
  editable: boolean;
}

/** Today's opportunity and the immediately preceding eligible opportunity, newest first. */
export function editableOccurrences(
  input: CompatibleDataset,
  habitId: string,
  today: LocalDate,
): AgendaItem[] {
  const projection = createAgendaProjection(input);
  const habit = projection.data.habits.find((h) => h.id === habitId);
  const cursor = parseLocalDate(today);
  if (!habit) return [];
  const result: AgendaItem[] = [];
  for (
    let date = localDate(cursor);
    date >= habit.createdOn;
    cursor.setDate(cursor.getDate() - 1), date = localDate(cursor)
  ) {
    const item = projection.habit(habitId, date);
    if (item && (!item.exempt || item.completionProvenance === 'credited')) {
      result.push(item);
      if (date < today) break;
    }
  }
  return result;
}

function projectHabitHistory(
  projection: AgendaProjection,
  habitId: string,
  today: LocalDate,
): HabitHistoryItem[] {
  const habit = projection.data.habits.find((h) => h.id === habitId);
  const cursor = parseLocalDate(today);
  if (!habit) return [];
  const rows: HabitHistoryItem[] = [];
  let foundPrevious = false;
  for (
    let date = localDate(cursor);
    date >= habit.createdOn;
    cursor.setDate(cursor.getDate() - 1), date = localDate(cursor)
  ) {
    const item = projection.habit(habitId, date);
    if (!item) continue;
    const eligible = !item.exempt || item.completionProvenance === 'credited';
    const editable = eligible && (date === today || !foundPrevious);
    if (eligible && date < today) foundPrevious = true;
    const status: HistoryStatus = item.done
      ? 'completed'
      : item.exempt
        ? 'exempt'
        : item.kind === 'optional'
          ? 'optional-uncompleted'
          : date === today
            ? 'pending'
            : 'missed';
    rows.push({ ...item, status, editable });
  }
  return rows;
}

/** Includes implicit missed requirements, not just persisted successes. Newest first. */
export function habitHistory(
  input: CompatibleDataset,
  habitId: string,
  today: LocalDate,
): HabitHistoryItem[] {
  return projectHabitHistory(createAgendaProjection(input), habitId, today);
}

/** Historical assignments own membership; preserve habit order within each newest-first date. */
export function pillarHistory(input: CompatibleDataset, pillarId: string, today: LocalDate) {
  const projection = createAgendaProjection(input);
  const days = new Map<LocalDate, HabitHistoryItem[]>();
  for (const habit of projection.data.habits) {
    for (const item of projectHabitHistory(projection, habit.id, today)) {
      if (item.pillarId !== pillarId) continue;
      let items = days.get(item.date);
      if (!items) days.set(item.date, (items = []));
      items.push(item);
    }
  }
  return [...days.keys()]
    .sort()
    .reverse()
    .map((date) => ({ date, items: days.get(date)! }));
}
