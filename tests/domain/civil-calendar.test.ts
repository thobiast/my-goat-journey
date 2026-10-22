import { expect, test } from 'vitest';
import {
  civilDate,
  localDate,
  nextScheduledDate,
  parseLocalDate,
  weekday,
} from '../../src/domain/calendar';
import { calendarDays, periodWindow } from '../../src/features/progress/calendar';
import { calendarMonths } from '../../src/features/progress/monthly';
import { fullDate, rangeLabel } from '../../src/features/progress/ConsistencyCard';
import { displayDate } from '../../src/presentation/civilDate';
import { civilHistory } from '../helpers/civil-history';

test('a civil date remains valid even when the current device zone skipped it', () => {
  expect(() => parseLocalDate('2011-12-30')).not.toThrow();
  expect(weekday('2011-12-30')).toBe(5);
  expect(nextScheduledDate('2011-12-29', [5])).toBe('2011-12-30');
  expect(nextScheduledDate('2011-12-30', [6])).toBe('2011-12-31');
});

test.each(['0100-01-01', '2000-02-29', '2011-12-30', '9999-12-31'])(
  'civil carrier roundtrip preserves %s including supported year bounds',
  (value) => {
    const carrier = parseLocalDate(value);
    expect(civilDate(carrier)).toBe(value);
    expect(carrier.toISOString()).toBe(`${value}T00:00:00.000Z`);
  },
);

test('month navigation crosses leap and year boundaries without rollover', () => {
  expect(periodWindow('2024-03-01', '1m', 0)).toEqual({
    start: '2024-02-01',
    end: '2024-02-29',
    historyEnd: '2024-02-29',
  });
  expect(periodWindow('2012-01-01', '1m', 0)).toEqual({
    start: '2011-12-01',
    end: '2011-12-31',
    historyEnd: '2011-12-31',
  });
  expect(periodWindow('2012-01-01', '1m', 1)).toEqual({
    start: '2011-11-01',
    end: '2011-11-30',
    historyEnd: '2011-11-30',
  });
  for (const [start, end] of [
    ['0100-01-01', '0100-01-31'],
    ['9999-12-01', '9999-12-31'],
  ]) {
    const months = calendarMonths({ start, end, historyEnd: end });
    expect(months).toHaveLength(1);
    expect(months[0].cells.filter(Boolean)).toHaveLength(31);
    expect(months[0].start).toBe(start);
    expect(months[0].end).toBe(end);
  }
});

test('historical iteration and Monday-first geometry visit the skipped date exactly once', () => {
  const window = { start: '2011-12-29', end: '2011-12-31', historyEnd: '2011-12-31' };
  const days = calendarDays(civilHistory(), { kind: 'habit', id: 'read' }, window);
  expect(days.map(({ date, state }) => ({ date, state }))).toEqual([
    { date: '2011-12-29', state: 'unscheduled' },
    { date: '2011-12-30', state: 'completed' },
    { date: '2011-12-31', state: 'incomplete' },
  ]);
  const month = calendarMonths(window)[0];
  expect(month.cells.filter(Boolean)).toEqual(
    Array.from({ length: 31 }, (_, i) => `2011-12-${String(i + 1).padStart(2, '0')}`),
  );
  expect(month.cells.indexOf('2011-12-30') % 7).toBe(4);
  expect(periodWindow('2011-12-31', '7d', 0)).toEqual({
    start: '2011-12-24',
    end: '2011-12-30',
    historyEnd: '2011-12-30',
  });
});

test('English and Portuguese labels describe the civil Friday, not a shifted instant', () => {
  expect(fullDate('2011-12-30', 'en')).toBe('Friday, December 30, 2011');
  expect(fullDate('2011-12-30', 'pt')).toBe('sexta-feira, 30 de dezembro de 2011');
  expect(displayDate('2011-12-30', 'en')).toBe('Fri, Dec 30, 2011');
  expect(displayDate('2011-12-30', 'pt')).toBe('sex., 30 de dez. de 2011');
  expect(displayDate('2011-12-30', 'en', true)).toBe('Dec 30');
  expect(displayDate('2011-12-30', 'pt', true)).toBe('30 de dez.');
  expect(rangeLabel('2011-12-29', '2011-12-31', 'en')).toBe('Dec 29, 2011 – Dec 31, 2011');
});

test.each([
  '0099-12-31',
  '0000-01-01',
  '10000-01-01',
  '2011-02-29',
  '1900-02-29',
  '2026-04-31',
  '2026-00-01',
  '2026-13-01',
  '2026-01-00',
  '2026-1-01',
  'not-a-date',
])('invalid Gregorian date %s rejects rather than rolling over', (value) => {
  expect(() => parseLocalDate(value)).toThrow('Invalid local date');
});

test.each([
  ['0100-01-01', '0100-01-02'],
  ['2000-02-28', '2000-02-29'],
  ['2000-02-29', '2000-03-01'],
  ['2024-02-28', '2024-02-29'],
  ['2024-12-31', '2025-01-01'],
  ['2026-03-07', '2026-03-08'],
  ['2026-11-01', '2026-11-02'],
  ['9999-12-30', '9999-12-31'],
])('civil successor of %s is %s across leap, year and DST boundaries', (start, end) => {
  expect(nextScheduledDate(start, [0, 1, 2, 3, 4, 5, 6])).toBe(end);
});

test('Today follows the local device calendar on both sides of midnight', () => {
  expect(localDate(new Date(2026, 9, 22, 23, 59, 59))).toBe('2026-10-22');
  expect(localDate(new Date(2026, 9, 23, 0, 0, 0))).toBe('2026-10-23');
  const nearUtcMidnight = new Date('2026-10-22T00:30:00.000Z');
  const expected: Record<string, string> = {
    UTC: '2026-10-22',
    'Pacific/Apia': '2026-10-22',
    'America/New_York': '2026-10-21',
    'Asia/Tokyo': '2026-10-22',
  };
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(nearUtcMidnight)
      .map(({ type, value }) => [type, value]),
  );
  expect(localDate(nearUtcMidnight)).toBe(`${parts.year}-${parts.month}-${parts.day}`);
  const expectedForZone = expected[process.env.TZ ?? ''];
  if (expectedForZone) {
    expect(localDate(nearUtcMidnight)).toBe(expectedForZone);
  }
});
