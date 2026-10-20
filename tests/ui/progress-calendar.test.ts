import { expect, test } from 'vitest';
import {
  calendarDays,
  hasEarlierHistory,
  periodStats,
  periodWindow,
} from '../../src/features/progress/calendar';
import { facts } from '../domain/fixtures';
import { updateCompletion } from '../../src/domain/completion';
import type { Dataset } from '../../src/domain/types';
import { archiveHabit, editHabit, reactivateHabit } from '../../src/domain/lifecycle';
import { calculateProgress } from '../../src/domain/progress';

test('all required credit completes an aggregate even when a new optional habit stays unchecked', () => {
  const data = twoHabits();
  const optional = structuredClone(data.habits[0]);
  optional.id = 'optional';
  optional.createdOn = '2026-10-02';
  optional.versions[0].effectiveFrom = '2026-10-02';
  optional.memberships[0].effectiveFrom = '2026-10-02';
  optional.periods[0].start = '2026-10-02';
  data.habits.push(optional);
  for (const id of ['read', 'write'])
    updateCompletion(data, id, '2026-10-02', true, new Date(2026, 9, 2, 12));
  expect(day(data, { kind: 'all' }, '2026-10-02').state).toBe('completed');
  expect(day(data, { kind: 'pillar', id: 'mind' }, '2026-10-02').state).toBe('completed');
});

test('period denominators exclude creation, off-days, exemptions and archived gaps', () => {
  const data = facts();
  updateCompletion(data, 'read', '2026-09-28', true, new Date(2026, 8, 28, 12));
  archiveHabit(data, 'read', new Date(2026, 8, 30, 12));
  const days = calendarDays(
    data,
    { kind: 'habit', id: 'read' },
    { start: '2026-09-27', end: '2026-10-05', historyEnd: '2026-10-05' },
  );
  expect(periodStats(days)).toEqual({ completed: 1, eligible: 1, percent: 100 });
});

test('completed today never enters monthly history or its denominator', () => {
  const data = facts();
  updateCompletion(data, 'read', '2026-10-02', true, new Date(2026, 9, 2, 12));
  const days = calendarDays(
    data,
    { kind: 'habit', id: 'read' },
    periodWindow('2026-10-02', '1m', 0),
  );
  expect(days.map((d) => d.date)).toEqual(['2026-10-01']);
  expect(periodStats(days)).toEqual({ completed: 0, eligible: 0, percent: null });
});

test.each(['2026-03-09', '2026-11-02'])(
  'calendar traversal preserves local date sequence around DST %s',
  (today) => {
    const days = calendarDays(facts(), { kind: 'all' }, periodWindow(today, '7d', 0));
    expect(days.map((d) => d.date)).toEqual(
      today === '2026-03-09'
        ? [
            '2026-03-02',
            '2026-03-03',
            '2026-03-04',
            '2026-03-05',
            '2026-03-06',
            '2026-03-07',
            '2026-03-08',
          ]
        : [
            '2026-10-26',
            '2026-10-27',
            '2026-10-28',
            '2026-10-29',
            '2026-10-30',
            '2026-10-31',
            '2026-11-01',
          ],
    );
  },
);

test('earlier history includes optional unchecked creation and implicit misses without saved successes', () => {
  const data = facts();
  expect(hasEarlierHistory(data, { kind: 'habit', id: 'read' }, '2026-09-27')).toBe(false);
  for (const scope of [
    { kind: 'habit', id: 'read' },
    { kind: 'pillar', id: 'mind' },
    { kind: 'all' },
  ] as const) {
    expect(hasEarlierHistory(data, scope, '2026-09-28')).toBe(true);
    expect(hasEarlierHistory(data, scope, '2026-10-01')).toBe(true);
  }
  expect(hasEarlierHistory(data, { kind: 'pillar', id: 'body' }, '2026-10-01')).toBe(false);
  expect(hasEarlierHistory(data, { kind: 'habit', id: 'missing' }, '2026-10-01')).toBe(false);
  data.habits = [];
  expect(hasEarlierHistory(data, { kind: 'all' }, '2026-10-01')).toBe(false);
});

test('earlier pillar history crosses archive gaps and moves without relying on current membership', () => {
  const data = facts();
  editHabit(
    data,
    'read',
    { pillarId: 'body', goal: 'Read 10 pages', weekdays: [1, 3, 5] },
    new Date(2026, 9, 2, 12),
  );
  archiveHabit(data, 'read', new Date(2026, 9, 5, 12));
  const before = structuredClone(data);
  expect(hasEarlierHistory(data, { kind: 'pillar', id: 'mind' }, '2026-11-01')).toBe(true);
  expect(hasEarlierHistory(data, { kind: 'pillar', id: 'body' }, '2026-10-03')).toBe(true);
  expect(hasEarlierHistory(data, { kind: 'habit', id: 'read' }, '2026-11-01')).toBe(true);
  expect(data).toEqual(before);
});

test('off-schedule historical pillar participation enables earlier navigation', () => {
  const data = facts();
  const habit = data.habits[0];
  habit.memberships = [
    { effectiveFrom: '2026-09-27', pillarId: 'mind' },
    { effectiveFrom: '2026-09-29', pillarId: 'body' },
    { effectiveFrom: '2026-09-30', pillarId: 'mind' },
  ];
  const before = structuredClone(data);
  expect(hasEarlierHistory(data, { kind: 'pillar', id: 'body' }, '2026-09-29')).toBe(false);
  expect(hasEarlierHistory(data, { kind: 'pillar', id: 'body' }, '2026-09-30')).toBe(true);
  expect(day(data, { kind: 'pillar', id: 'body' }, '2026-09-29')).toMatchObject({
    state: 'unscheduled',
    applicable: true,
    items: [],
  });
  expect(data).toEqual(before);
});

test('future-created habits and pending activation intent cannot invent earlier history', () => {
  const data = facts();
  expect(hasEarlierHistory(data, { kind: 'all' }, '2026-09-26')).toBe(false);
  const habit = data.habits[0];
  habit.memberships = [
    { effectiveFrom: '2026-09-27', pillarId: 'mind' },
    { effectiveFrom: '2026-10-03', pillarId: 'body' },
  ];
  archiveHabit(data, 'read', new Date(2026, 9, 2, 12));
  reactivateHabit(data, 'read', new Date(2026, 9, 3, 12));
  expect(hasEarlierHistory(data, { kind: 'pillar', id: 'body' }, '2026-10-05')).toBe(false);
  expect(hasEarlierHistory(data, { kind: 'pillar', id: 'body' }, '2026-10-06')).toBe(true);
});

test('period stats count fully complete days over every nongray eligible date', () => {
  const data = twoHabits();
  updateCompletion(data, 'read', '2026-09-30', true, new Date(2026, 8, 30, 12));
  updateCompletion(data, 'write', '2026-09-30', true, new Date(2026, 8, 30, 12));
  updateCompletion(data, 'read', '2026-10-02', true, new Date(2026, 9, 2, 12));
  const days = calendarDays(data, { kind: 'all' }, periodWindow('2026-10-06', '7d', 0));
  expect(periodStats(days)).toEqual({ completed: 1, eligible: 3, percent: 33 });
  expect(periodStats([])).toEqual({ completed: 0, eligible: 0, percent: null });
  expect(periodStats([day(data, { kind: 'all' }, '2026-09-29')])).toEqual({
    completed: 0,
    eligible: 0,
    percent: null,
  });
  expect(periodStats([day(data, { kind: 'habit', id: 'read' }, '2026-09-30')])).toEqual({
    completed: 1,
    eligible: 1,
    percent: 100,
  });
});

test('optional credit contributes partial but never completes an outstanding required aggregate', () => {
  const data = twoHabits();
  data.habits[1].createdOn = '2026-10-02';
  data.habits[1].versions[0].effectiveFrom = '2026-10-02';
  data.habits[1].memberships[0].effectiveFrom = '2026-10-02';
  data.habits[1].periods[0].start = '2026-10-02';
  updateCompletion(data, 'write', '2026-10-02', true, new Date(2026, 9, 2, 12));
  expect(day(data, { kind: 'all' }, '2026-10-02').state).toBe('partial');
  expect(day(data, { kind: 'pillar', id: 'mind' }, '2026-10-02').state).toBe('partial');
  expect(day(data, { kind: 'habit', id: 'write' }, '2026-10-02').state).toBe('completed');
  expect(periodStats([day(data, { kind: 'all' }, '2026-10-02')])).toEqual({
    completed: 0,
    eligible: 1,
    percent: 0,
  });
});

test('dated snapshot goals and pillar credit survive later edits and Undo/Redo', () => {
  const data = facts();
  const now = new Date(2026, 9, 2, 12);
  updateCompletion(data, 'read', '2026-10-02', true, now);
  editHabit(data, 'read', { pillarId: 'body', goal: 'Read new goal', weekdays: [1, 3, 5] }, now);
  updateCompletion(data, 'read', '2026-10-02', false, now);
  updateCompletion(data, 'read', '2026-10-02', true, now);
  const before = structuredClone(data);
  expect(day(data, { kind: 'pillar', id: 'mind' }, '2026-10-02')).toMatchObject({
    state: 'completed',
    applicable: true,
  });
  expect(day(data, { kind: 'pillar', id: 'mind' }, '2026-10-02').items[0]).toMatchObject({
    goal: 'Read 10 pages',
    pillarId: 'mind',
    done: true,
  });
  expect(day(data, { kind: 'pillar', id: 'body' }, '2026-10-02').applicable).toBe(false);
  expect(day(data, { kind: 'habit', id: 'read' }, '2026-10-05').items[0]).toMatchObject({
    goal: 'Read new goal',
    pillarId: 'body',
  });
  expect(data).toEqual(before);
});

test('optional unchecked creation is gray, but optional credit is complete', () => {
  const data = facts();
  expect(day(data, { kind: 'all' }, '2026-09-27')).toMatchObject({
    state: 'unscheduled',
    applicable: true,
  });
  updateCompletion(data, 'read', '2026-09-27', true, new Date(2026, 8, 27, 12));
  expect(day(data, { kind: 'all' }, '2026-09-27').state).toBe('completed');
  expect(day(data, { kind: 'habit', id: 'read' }, '2026-09-27').state).toBe('completed');
});

test('empty scopes and dates before creation have no applicable history', () => {
  const data = facts();
  expect(day(data, { kind: 'all' }, '2026-09-26')).toMatchObject({
    state: 'unscheduled',
    applicable: false,
    items: [],
  });
  expect(day(data, { kind: 'habit', id: 'read' }, '2026-09-26').applicable).toBe(false);
  expect(day(data, { kind: 'habit', id: 'unknown' }, '2026-10-02').applicable).toBe(false);
  expect(day(data, { kind: 'pillar', id: 'body' }, '2026-10-02')).toMatchObject({
    state: 'unscheduled',
    applicable: false,
    items: [],
  });
  data.habits = [];
  expect(day(data, { kind: 'all' }, '2026-10-02').applicable).toBe(false);
});

test('off-schedule days remain applicable historical participation with no synthetic agenda items', () => {
  const data = facts();
  for (const scope of [
    { kind: 'habit', id: 'read' },
    { kind: 'pillar', id: 'mind' },
    { kind: 'all' },
  ] as const) {
    expect(day(data, scope, '2026-09-29')).toMatchObject({
      state: 'unscheduled',
      applicable: true,
      items: [],
    });
  }
});

test('archival exemptions are gray while retained valid credit still completes the day', () => {
  const data = facts();
  archiveHabit(data, 'read', new Date(2026, 9, 2, 12));
  expect(day(data, { kind: 'all' }, '2026-10-02')).toMatchObject({
    state: 'unscheduled',
    applicable: true,
  });
  expect(day(data, { kind: 'habit', id: 'read' }, '2026-10-03')).toMatchObject({
    state: 'unscheduled',
    applicable: true,
  });
  expect(day(data, { kind: 'pillar', id: 'mind' }, '2026-10-03').applicable).toBe(false);
  const credited = facts();
  updateCompletion(credited, 'read', '2026-10-02', true, new Date(2026, 9, 2, 12));
  archiveHabit(credited, 'read', new Date(2026, 9, 2, 12));
  expect(day(credited, { kind: 'all' }, '2026-10-02').state).toBe('completed');
});

test('a conditional move keeps daily obligation but not a new pillar requirement', () => {
  const data = facts();
  editHabit(
    data,
    'read',
    { pillarId: 'body', goal: 'Read 10 pages', weekdays: [1, 3, 5] },
    new Date(2026, 9, 2, 12),
  );
  expect(day(data, { kind: 'all' }, '2026-10-02').state).toBe('incomplete');
  expect(day(data, { kind: 'habit', id: 'read' }, '2026-10-02').state).toBe('incomplete');
  expect(day(data, { kind: 'pillar', id: 'mind' }, '2026-10-02').applicable).toBe(false);
  expect(day(data, { kind: 'pillar', id: 'body' }, '2026-10-02')).toMatchObject({
    state: 'unscheduled',
    applicable: true,
  });
  updateCompletion(data, 'read', '2026-10-02', true, new Date(2026, 9, 2, 12));
  expect(day(data, { kind: 'pillar', id: 'body' }, '2026-10-02').state).toBe('completed');
});

test('pillar applicability follows historical membership and active periods rather than current membership', () => {
  const data = facts();
  editHabit(
    data,
    'read',
    { pillarId: 'body', goal: 'Read 10 pages', weekdays: [1, 3, 5] },
    new Date(2026, 9, 3, 12),
  );
  expect(day(data, { kind: 'pillar', id: 'mind' }, '2026-09-29').applicable).toBe(true);
  expect(day(data, { kind: 'pillar', id: 'body' }, '2026-09-29').applicable).toBe(false);
  expect(day(data, { kind: 'pillar', id: 'mind' }, '2026-10-06').applicable).toBe(false);
  expect(day(data, { kind: 'pillar', id: 'body' }, '2026-10-06').applicable).toBe(true);
  archiveHabit(data, 'read', new Date(2026, 9, 7, 12));
  reactivateHabit(data, 'read', new Date(2026, 9, 10, 12));
  expect(day(data, { kind: 'pillar', id: 'body' }, '2026-10-11').applicable).toBe(false);
  expect(day(data, { kind: 'pillar', id: 'body' }, '2026-10-12')).toMatchObject({
    state: 'incomplete',
    applicable: true,
  });
});

test('calendar is chronological, includes implicit misses, excludes today and preserves all progress facts', () => {
  const data = facts();
  const before = structuredClone(data);
  const progress = calculateProgress(data, '2026-10-06');
  const days = calendarDays(
    data,
    { kind: 'habit', id: 'read' },
    periodWindow('2026-10-06', '7d', 0),
  );
  expect(days.map((d) => d.date)).toEqual([
    '2026-09-29',
    '2026-09-30',
    '2026-10-01',
    '2026-10-02',
    '2026-10-03',
    '2026-10-04',
    '2026-10-05',
  ]);
  expect(days.filter((d) => d.state === 'incomplete').map((d) => d.date)).toEqual([
    '2026-09-30',
    '2026-10-02',
    '2026-10-05',
  ]);
  expect(
    calendarDays(data, { kind: 'all' }, periodWindow('2026-10-06', '1m', 0)).at(-1)?.date,
  ).toBe('2026-10-05');
  expect(data).toEqual(before);
  expect(calculateProgress(data, '2026-10-06')).toEqual(progress);
});

function twoHabits(): Dataset {
  const data = facts();
  data.habits.push({ ...structuredClone(data.habits[0]), id: 'write' });
  return data;
}

function day(data: Dataset, scope: Parameters<typeof calendarDays>[1], date: string) {
  return calendarDays(data, scope, { start: date, end: date, historyEnd: date })[0];
}

test('two required habits produce incomplete, partial, then complete aggregate dates', () => {
  const data = twoHabits();
  const date = '2026-10-02';
  expect(day(data, { kind: 'all' }, date)).toMatchObject({ state: 'incomplete', applicable: true });
  updateCompletion(data, 'read', date, true, new Date(2026, 9, 2, 12));
  expect(day(data, { kind: 'all' }, date).state).toBe('partial');
  expect(day(data, { kind: 'pillar', id: 'mind' }, date).state).toBe('partial');
  expect(day(data, { kind: 'habit', id: 'read' }, date).state).toBe('completed');
  expect(day(data, { kind: 'habit', id: 'write' }, date).state).toBe('incomplete');
  updateCompletion(data, 'write', date, true, new Date(2026, 9, 2, 12));
  expect(day(data, { kind: 'all' }, date).state).toBe('completed');
});

test('seven-day windows are complete contiguous local weeks ending yesterday', () => {
  expect(periodWindow('2026-01-01', '7d', 0)).toEqual({
    start: '2025-12-25',
    end: '2025-12-31',
    historyEnd: '2025-12-31',
  });
  expect(periodWindow('2026-01-01', '7d', 1)).toEqual({
    start: '2025-12-18',
    end: '2025-12-24',
    historyEnd: '2025-12-24',
  });
});

test.each([
  ['2024-03-01', '1m', 0, '2024-02-01', '2024-02-29', '2024-02-29'],
  ['2024-03-15', '1m', 0, '2024-03-01', '2024-03-31', '2024-03-14'],
  ['2024-03-15', '1m', 1, '2024-02-01', '2024-02-29', '2024-02-29'],
  ['2026-01-01', '3m', 0, '2025-10-01', '2025-12-31', '2025-12-31'],
  ['2026-01-01', '3m', 1, '2025-07-01', '2025-09-30', '2025-09-30'],
  ['2026-10-06', '12m', 0, '2025-11-01', '2026-10-31', '2026-10-05'],
  ['2026-10-06', '24m', 1, '2022-11-01', '2024-10-31', '2024-10-31'],
] as const)(
  'month window %s %s offset %s has actual boundaries',
  (today, interval, offset, start, end, historyEnd) => {
    expect(periodWindow(today, interval, offset)).toEqual({ start, end, historyEnd });
  },
);

test.each(['2026-03-09', '2026-11-02'])(
  'weeks around DST retain seven calendar dates for %s',
  (today) => {
    expect(periodWindow(today, '7d', 0)).toEqual(
      today === '2026-03-09'
        ? { start: '2026-03-02', end: '2026-03-08', historyEnd: '2026-03-08' }
        : { start: '2026-10-26', end: '2026-11-01', historyEnd: '2026-11-01' },
    );
  },
);

test.each([-1, 0.5, NaN, Infinity])('rejects an invalid backwards offset %s', (offset) => {
  expect(() => periodWindow('2026-10-06', '7d', offset)).toThrow();
});
