import { agenda } from './agenda';
import { migrateDataset } from '../data/migrations';
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
  const data = migrateDataset(input);
  const habit = data.habits.find((h) => h.id === habitId);
  const cursor = parseLocalDate(today);
  if (!habit) return [];
  const result: AgendaItem[] = [];
  for (
    let date = localDate(cursor);
    date >= habit.createdOn;
    cursor.setDate(cursor.getDate() - 1), date = localDate(cursor)
  ) {
    const item = agenda(data, date).find((i) => i.habit.id === habitId);
    if (item && (!item.exempt || item.completionProvenance === 'credited')) {
      result.push(item);
      if (date < today) break;
    }
  }
  return result;
}

/** Includes implicit missed requirements, not just persisted successes. Newest first. */
export function habitHistory(
  input: CompatibleDataset,
  habitId: string,
  today: LocalDate,
): HabitHistoryItem[] {
  const data = migrateDataset(input);
  const habit = data.habits.find((h) => h.id === habitId);
  const cursor = parseLocalDate(today);
  if (!habit) return [];
  const editable = new Set(editableOccurrences(data, habitId, today).map((i) => i.date));
  const rows: HabitHistoryItem[] = [];
  for (
    let date = localDate(cursor);
    date >= habit.createdOn;
    cursor.setDate(cursor.getDate() - 1), date = localDate(cursor)
  ) {
    const item = agenda(data, date).find((i) => i.habit.id === habitId);
    if (!item) continue;
    const status: HistoryStatus = item.done
      ? 'completed'
      : item.exempt
        ? 'exempt'
        : item.kind === 'optional'
          ? 'optional-uncompleted'
          : date === today
            ? 'pending'
            : 'missed';
    rows.push({ ...item, status, editable: editable.has(date) });
  }
  return rows;
}
