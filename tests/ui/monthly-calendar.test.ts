import { expect, test } from 'vitest';
import { calendarMonths, trackingStart } from '../../src/features/progress/monthly';
import { calendarDays, periodStats, periodWindow } from '../../src/features/progress/calendar';
import { civilDate, parseLocalDate } from '../../src/domain/calendar';
import { facts } from '../domain/fixtures';
import { archiveHabit, editHabit, reactivateHabit } from '../../src/domain/lifecycle';
import { updateCompletion } from '../../src/domain/completion';
import { calculateProgress } from '../../src/domain/progress';
import type { CalendarScope } from '../../src/features/progress/calendar';
import type { LocalDate } from '../../src/domain/types';

test('February 2024 is a Monday-first leap-month block with inert alignment cells', () => {
  const window = { start: '2024-02-01', end: '2024-02-29', historyEnd: '2024-02-14' };
  const before = structuredClone(window);
  expect(calendarMonths(window)).toEqual([
    {
      key: '2024-02',
      start: '2024-02-01',
      end: '2024-02-29',
      cells: [
        null,
        null,
        null,
        ...Array.from(
          { length: 29 },
          (_, index) => `2024-02-${String(index + 1).padStart(2, '0')}`,
        ),
        null,
        null,
        null,
      ],
    },
  ]);
  expect(window).toEqual(before);
});

test.each([
  ['2100-02-01', '2100-02-28', 0, 28],
  ['2026-02-01', '2026-02-28', 6, 35],
  ['2026-08-01', '2026-08-31', 5, 42],
  ['2026-03-01', '2026-03-31', 6, 42],
  ['2026-11-01', '2026-11-30', 6, 42],
] as const)(
  'month %s has actual days and Monday-first whole rows',
  (start, end, leading, slots) => {
    const month = calendarMonths({ start, end, historyEnd: end })[0];
    const length = Number(end.slice(-2));
    expect(month).toMatchObject({ key: start.slice(0, 7), start, end });
    expect(month.cells).toHaveLength(slots);
    expect(month.cells.slice(0, leading)).toEqual(Array(leading).fill(null));
    expect(month.cells.slice(leading, leading + length)).toEqual(
      Array.from(
        { length },
        (_, index) => `${start.slice(0, 7)}-${String(index + 1).padStart(2, '0')}`,
      ),
    );
    expect(month.cells.slice(leading + length)).toEqual(Array(slots - leading - length).fill(null));
  },
);

test('partial December-to-January windows still contain two separate full months', () => {
  const months = calendarMonths({
    start: '2025-12-25',
    end: '2026-01-05',
    historyEnd: '2026-01-04',
  });
  expect(months.map(({ key, start, end }) => ({ key, start, end }))).toEqual([
    { key: '2025-12', start: '2025-12-01', end: '2025-12-31' },
    { key: '2026-01', start: '2026-01-01', end: '2026-01-31' },
  ]);
  const dates = months.flatMap((month) => month.cells.filter((date) => date !== null));
  expect(dates).toHaveLength(62);
  expect(new Set(dates).size).toBe(dates.length);
  expect(months[0].cells.at(-1)).toBe(null);
  expect(months[1].cells.slice(0, 3)).toEqual([null, null, null]);
});

test.each(['1m', '3m', '12m', '24m'] as const)(
  '%s preserves every date exactly once across selected month blocks',
  (interval) => {
    const window = periodWindow('2026-10-06', interval, 0);
    const months = calendarMonths(window);
    expect(months).toHaveLength(Number(interval.slice(0, -1)));
    expect(months[0].start).toBe(window.start);
    expect(months.at(-1)?.end).toBe(window.end);
    const dates = months.flatMap((month) => month.cells.filter((date) => date !== null));
    const expected = [];
    const cursor = parseLocalDate(window.start);
    for (
      let date = civilDate(cursor);
      date <= window.end;
      cursor.setUTCDate(cursor.getUTCDate() + 1), date = civilDate(cursor)
    ) {
      expected.push(date);
    }
    expect(dates).toEqual(expected);
    expect(new Set(dates).size).toBe(dates.length);
    for (const month of months) {
      expect(month.cells.length % 7).toBe(0);
      for (const [index, date] of month.cells.entries()) {
        if (date === null) continue;
        expect(date.slice(0, 7)).toBe(month.key);
        expect((parseLocalDate(date).getUTCDay() + 6) % 7).toBe(index % 7);
      }
    }
  },
);

test('month structures do not project history states onto today or future dates', () => {
  const data = facts();
  const window = periodWindow('2026-10-06', '1m', 0);
  const months = calendarMonths(window);
  expect(months[0].cells).toContain('2026-10-06');
  expect(months[0].cells).toContain('2026-10-31');
  expect(calendarDays(data, { kind: 'all' }, window).map((day) => day.date)).toEqual([
    '2026-10-01',
    '2026-10-02',
    '2026-10-03',
    '2026-10-04',
    '2026-10-05',
  ]);
  expect(periodStats(calendarDays(data, { kind: 'all' }, window))).toEqual({
    completed: 0,
    eligible: 2,
    percent: 0,
  });
});

test('habit tracking start is its exact creation date, not the first required or credited day', () => {
  expect(trackingStart(facts(), { kind: 'habit', id: 'read' })).toBe('2026-09-27');
});

test.each([{ kind: 'all' }, { kind: 'pillar', id: 'mind' }] as const)(
  '%j begins at unchecked optional historical participation',
  (scope) => {
    expect(trackingStart(facts(), scope)).toBe('2026-09-27');
  },
);

test('a conditional move begins destination tracking on its dated opportunity, not future membership', () => {
  const data = facts();
  editHabit(
    data,
    'read',
    { pillarId: 'body', goal: 'Read 10 pages', weekdays: [1, 3, 5] },
    new Date(2026, 9, 2, 12),
  );
  expect(data.habits[0].memberships.at(-1)?.effectiveFrom).toBe('2026-10-05');
  expect(trackingStart(data, { kind: 'pillar', id: 'mind' })).toBe('2026-09-27');
  expect(trackingStart(data, { kind: 'pillar', id: 'body' })).toBe('2026-10-02');
  expect(
    calendarDays(
      data,
      { kind: 'pillar', id: 'body' },
      {
        start: '2026-10-02',
        end: '2026-10-02',
        historyEnd: '2026-10-02',
      },
    )[0],
  ).toMatchObject({ applicable: true, state: 'unscheduled' });
});

test.each([false, true])(
  'first destination participation waits for pending reactivation (changed schedule: %s)',
  (changedSchedule) => {
    const data = facts();
    archiveHabit(data, 'read', new Date(2026, 9, 2, 12));
    data.habits[0].memberships.push({ effectiveFrom: '2026-10-03', pillarId: 'body' });
    if (changedSchedule)
      data.habits[0].versions.push({
        effectiveFrom: '2026-10-04',
        goal: 'Read 10 pages',
        weekdays: [2],
      });
    reactivateHabit(data, 'read', new Date(2026, 9, 3, 12));
    const before = structuredClone(data);
    expect(trackingStart(data, { kind: 'pillar', id: 'body' })).toBe(
      changedSchedule ? '2026-10-06' : '2026-10-05',
    );
    expect(trackingStart(data, { kind: 'pillar', id: 'mind' })).toBe('2026-09-27');
    expect(trackingStart(data, { kind: 'all' })).toBe('2026-09-27');
    expect(data).toEqual(before);
  },
);

test('a full-week pending delay includes the first scheduled opportunity at the scan boundary', () => {
  const data = facts();
  data.habits[0].versions[0].weekdays = [6];
  archiveHabit(data, 'read', new Date(2026, 9, 2, 12));
  data.habits[0].memberships.push({ effectiveFrom: '2026-10-03', pillarId: 'body' });
  reactivateHabit(data, 'read', new Date(2026, 9, 3, 12));
  expect(trackingStart(data, { kind: 'pillar', id: 'body' })).toBe('2026-10-10');
});

test('an older habit retains aggregate and pillar beginnings after a newer habit joins', () => {
  const data = facts();
  const older = structuredClone(data.habits[0]);
  older.id = 'older';
  older.createdOn = '2024-02-29';
  older.versions[0].effectiveFrom = '2024-02-29';
  older.memberships = [
    { effectiveFrom: '2024-02-29', pillarId: 'mind' },
    { effectiveFrom: '2026-09-01', pillarId: 'body' },
  ];
  older.periods[0].start = '2024-02-29';
  data.habits.push(older);
  expect(trackingStart(data, { kind: 'all' })).toBe('2024-02-29');
  expect(trackingStart(data, { kind: 'pillar', id: 'mind' })).toBe('2024-02-29');
  expect(trackingStart(data, { kind: 'pillar', id: 'body' })).toBe('2026-09-01');
  expect(trackingStart(data, { kind: 'habit', id: 'read' })).toBe('2026-09-27');
});

test('a transient off-schedule membership counts even without a saved or required occurrence', () => {
  const data = facts();
  data.habits[0].memberships.push(
    { effectiveFrom: '2026-10-03', pillarId: 'body' },
    { effectiveFrom: '2026-10-04', pillarId: 'mind' },
  );
  expect(trackingStart(data, { kind: 'pillar', id: 'body' })).toBe('2026-10-03');
  expect(
    calendarDays(
      data,
      { kind: 'pillar', id: 'body' },
      {
        start: '2026-10-03',
        end: '2026-10-03',
        historyEnd: '2026-10-03',
      },
    )[0],
  ).toMatchObject({ applicable: true, state: 'unscheduled', items: [] });
  expect(data.occurrences).toEqual([]);
});

test.each(['definition', 'membership', 'activation'] as const)(
  'aggregate history waits for actual %s instead of using creation alone',
  (boundary) => {
    const data = facts();
    if (boundary === 'definition') data.habits[0].versions[0].effectiveFrom = '2026-10-04';
    if (boundary === 'membership') data.habits[0].memberships[0].effectiveFrom = '2026-10-04';
    if (boundary === 'activation') data.habits[0].periods[0].start = '2026-10-04';
    expect(trackingStart(data, { kind: 'all' })).toBe('2026-10-04');
    expect(trackingStart(data, { kind: 'pillar', id: 'mind' })).toBe('2026-10-04');
    expect(trackingStart(data, { kind: 'habit', id: 'read' })).toBe('2026-09-27');
  },
);

test('locked credited assignment delays destination tracking until dated membership actually applies', () => {
  const data = facts();
  const now = new Date(2026, 9, 2, 12);
  updateCompletion(data, 'read', '2026-10-02', true, now);
  editHabit(data, 'read', { pillarId: 'body', goal: 'Read new goal', weekdays: [1, 3, 5] }, now);
  expect(trackingStart(data, { kind: 'pillar', id: 'body' })).toBe('2026-10-05');
  expect(
    calendarDays(
      data,
      { kind: 'pillar', id: 'mind' },
      {
        start: '2026-10-02',
        end: '2026-10-02',
        historyEnd: '2026-10-02',
      },
    )[0],
  ).toMatchObject({ applicable: true, state: 'completed' });
});

test('authoritative occurrence ownership extends the scan beyond creation and membership boundaries', () => {
  const data = facts();
  updateCompletion(data, 'read', '2026-10-05', true, new Date(2026, 9, 5, 12));
  data.occurrences[0].pillarId = 'body';
  expect(trackingStart(data, { kind: 'pillar', id: 'body' })).toBe('2026-10-05');
  expect(data.habits[0].memberships.at(-1)?.pillarId).toBe('mind');
});

test('membership entirely inside an archived gap cannot invent pillar participation', () => {
  const data = facts();
  archiveHabit(data, 'read', new Date(2026, 9, 2, 12));
  data.habits[0].memberships.push(
    { effectiveFrom: '2026-10-03', pillarId: 'body' },
    { effectiveFrom: '2026-10-10', pillarId: 'mind' },
  );
  expect(trackingStart(data, { kind: 'pillar', id: 'body' })).toBeUndefined();
  expect(trackingStart(data, { kind: 'all' })).toBe('2026-09-27');
  expect(trackingStart(data, { kind: 'habit', id: 'read' })).toBe('2026-09-27');
});

test('saved activation periods after an archive gap are scanned without a pending request or occurrence', () => {
  const data = facts();
  archiveHabit(data, 'read', new Date(2026, 9, 2, 12));
  data.habits[0].memberships.push({ effectiveFrom: '2026-10-03', pillarId: 'body' });
  data.habits[0].periods.push({ id: 'later', start: '2026-10-12', reactivatedOn: '2026-10-10' });
  expect(trackingStart(data, { kind: 'pillar', id: 'body' })).toBe('2026-10-12');
});

test('empty and unknown scopes have no fabricated tracking date', () => {
  const data = facts();
  expect(trackingStart(data, { kind: 'habit', id: 'unknown' })).toBeUndefined();
  expect(trackingStart(data, { kind: 'pillar', id: 'body' })).toBeUndefined();
  expect(trackingStart(data, { kind: 'pillar', id: 'unknown' })).toBeUndefined();
  data.habits = [];
  expect(trackingStart(data, { kind: 'all' })).toBeUndefined();
  expect(trackingStart(data, { kind: 'pillar', id: 'mind' })).toBeUndefined();
});

test('a recently created habit leaves pre-creation dates outside every progress denominator', () => {
  const data = facts();
  data.habits[0].createdOn = '2026-09-30';
  data.habits[0].versions[0].effectiveFrom = '2026-09-30';
  data.habits[0].memberships[0].effectiveFrom = '2026-09-30';
  data.habits[0].periods[0].start = '2026-09-30';
  const scope = { kind: 'habit', id: 'read' } as const;
  const window = periodWindow('2026-10-01', '1m', 0);
  const days = calendarDays(data, scope, window);
  expect(calendarMonths(window)[0].cells.filter((date) => date !== null)).toHaveLength(30);
  expect(trackingStart(data, scope)).toBe('2026-09-30');
  expect(days.filter((day) => day.applicable).map((day) => day.date)).toEqual(['2026-09-30']);
  expect(
    days
      .filter((day) => day.date < '2026-09-30')
      .every((day) => !day.applicable && day.items.length === 0),
  ).toBe(true);
  expect(periodStats(days)).toEqual({ completed: 0, eligible: 0, percent: null });
  expect(calculateProgress(data, '2026-10-01')).toMatchObject({
    totalXp: 0,
    overall: { current: 0, best: 0 },
    awards: [],
  });
});

test('tracking begins independently of displayed periods and future intent without mutating facts or progress', () => {
  const data = facts();
  updateCompletion(data, 'read', '2026-09-28', true, new Date(2026, 8, 28, 12));
  editHabit(
    data,
    'read',
    { pillarId: 'body', goal: 'Read 10 pages', weekdays: [1, 3, 5] },
    new Date(2026, 9, 2, 12),
  );
  archiveHabit(data, 'read', new Date(2026, 9, 5, 12));
  reactivateHabit(data, 'read', new Date(2027, 0, 2, 12));
  const before = structuredClone(data);
  const progress = calculateProgress(data, '2026-10-06');
  const scopes: CalendarScope[] = [
    { kind: 'habit', id: 'read' },
    { kind: 'pillar', id: 'mind' },
    { kind: 'pillar', id: 'body' },
    { kind: 'all' },
  ];
  const expected: LocalDate[] = ['2026-09-27', '2026-09-27', '2026-10-02', '2026-09-27'];
  const projections = scopes.map((scope) =>
    calendarDays(data, scope, periodWindow('2026-10-06', '3m', 0)),
  );
  const stats = projections.map(periodStats);
  deepFreeze(data);
  for (const interval of ['7d', '1m', '3m', '12m', '24m'] as const) {
    for (const offset of [0, 1, 2]) {
      const window = periodWindow('2026-10-06', interval, offset);
      if (interval !== '7d') calendarMonths(window);
      for (const [index, scope] of scopes.entries()) {
        calendarDays(data, scope, window);
        expect(trackingStart(data, scope)).toBe(expected[index]);
      }
    }
  }
  expect(data).toEqual(before);
  expect(calculateProgress(data, '2026-10-06')).toEqual(progress);
  expect(
    scopes.map((scope) => calendarDays(data, scope, periodWindow('2026-10-06', '3m', 0))),
  ).toEqual(projections);
  expect(projections.map(periodStats)).toEqual(stats);
});

// Exercise this in isolated TZ processes; never change a concurrent runner's timezone.
test('civil month traversal retains every date across DST transition months', () => {
  for (const key of ['2026-03', '2026-10', '2026-11']) {
    const start = `${key}-01`;
    const last = parseLocalDate(start);
    last.setUTCMonth(last.getUTCMonth() + 1);
    last.setUTCDate(0);
    const end = civilDate(last);
    const month = calendarMonths({ start, end, historyEnd: end })[0];
    expect(month.cells.filter((date) => date !== null)).toEqual(
      Array.from(
        { length: last.getUTCDate() },
        (_, index) => `${key}-${String(index + 1).padStart(2, '0')}`,
      ),
    );
    for (const [index, date] of month.cells.entries()) {
      if (date !== null) expect((parseLocalDate(date).getUTCDay() + 6) % 7).toBe(index % 7);
    }
  }
});

function deepFreeze(value: object): void {
  Object.freeze(value);
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') deepFreeze(child);
  }
}
