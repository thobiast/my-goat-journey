import { parseLocalDate } from '../domain/calendar';
import type { Language, LocalDate } from '../domain/types';

/** Format a civil-calendar identity, not an event timestamp. */
export function displayDate(date: LocalDate, language: Language, short = false): string {
  return new Intl.DateTimeFormat(
    language === 'pt' ? 'pt-BR' : 'en',
    short
      ? { timeZone: 'UTC', day: 'numeric', month: 'short' }
      : { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' },
  ).format(parseLocalDate(date));
}
