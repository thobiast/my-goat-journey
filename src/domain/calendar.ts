import type { Clock, LocalDate } from './types';

export const deviceClock: Clock = { now: () => new Date() };

export function localDate(date: Date): LocalDate {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function parseLocalDate(value: LocalDate): Date {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || localDate(date) !== value)
    throw new Error('Invalid local date');
  return date;
}

export function weekday(date: LocalDate): number {
  return parseLocalDate(date).getDay();
}

export function nextScheduledDate(after: LocalDate, weekdays: number[]): LocalDate {
  const date = parseLocalDate(after);
  for (let day = 0; day < 7; day++) {
    date.setDate(date.getDate() + 1);
    if (weekdays.includes(date.getDay())) return localDate(date);
  }
  throw new Error('Select at least one valid weekday');
}
