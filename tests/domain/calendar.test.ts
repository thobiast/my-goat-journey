import { expect, test } from 'vitest';
import { localDate, nextScheduledDate, weekday } from '../../src/domain/calendar';

test('uses the device-local calendar rather than UTC dates', () => {
  const date = new Date(2026, 8, 30, 23, 59);
  expect(localDate(date)).toBe('2026-09-30');
});
test('calendar stepping crosses month and daylight-saving boundaries without fixed 24-hour arithmetic', () => {
  expect(nextScheduledDate('2026-03-07', [0])).toBe('2026-03-08');
  expect(nextScheduledDate('2026-10-31', [0])).toBe('2026-11-01');
  expect(nextScheduledDate('2026-12-31', [5])).toBe('2027-01-01');
  expect(() => nextScheduledDate('2026-02-30', [1])).toThrow('Invalid local date');
  expect(() => nextScheduledDate('2026-09-30', [])).toThrow();
});
test('regular commitments start strictly after creation on selected weekdays', () => {
  expect(nextScheduledDate('2026-09-30', [3, 5])).toBe('2026-10-02');
  expect(weekday('2026-10-02')).toBe(5);
});
