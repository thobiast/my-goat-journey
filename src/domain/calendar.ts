import type { Clock, LocalDate } from './types';

export const deviceClock: Clock = { now: () => new Date() };

export function localDate(date: Date): LocalDate {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Read a civil-calendar carrier, never an actual event timestamp. */
export function civilDate(date: Date): LocalDate {
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Parse a Gregorian civil date (0100–9999) into a UTC-backed calendar carrier.
 * Use UTC getters/setters and timeZone: 'UTC' when formatting this value.
 * It is not the instant of midnight in the device's zone; localDate is for instants.
 */
export function parseLocalDate(value: LocalDate): Date {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || year < 100 || civilDate(date) !== value)
    throw new Error('Invalid local date');
  return date;
}

export function weekday(date: LocalDate): number {
  return parseLocalDate(date).getUTCDay();
}

export function nextScheduledDate(after: LocalDate, weekdays: number[]): LocalDate {
  const date = parseLocalDate(after);
  for (let day = 0; day < 7; day++) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (weekdays.includes(date.getUTCDay())) return civilDate(date);
  }
  throw new Error('Select at least one valid weekday');
}
