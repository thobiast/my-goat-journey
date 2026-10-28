import { expect, test } from 'vitest';
import { createAgendaProjection } from '../../src/domain/agenda';
import { civilDate, parseLocalDate } from '../../src/domain/calendar';
import { replayDates } from '../../src/domain/replayDates';
import { projectionDates } from '../helpers/projection-scenarios';
import { facts } from './fixtures';

function dates(data = facts(), through = '2026-12-31') {
  return [...createAgendaProjection(data).replayDates(parseLocalDate(through))];
}

test('retains creation plus seven strictly later witnesses, then the requested horizon', () => {
  expect(dates()).toEqual([...projectionDates('2026-09-27', '2026-10-04'), '2026-12-31']);
});

test('includes every stored transition and all occurrence dates, not just Done facts', () => {
  const data = facts();
  const habit = data.habits[0];
  habit.versions.push({ effectiveFrom: '2026-10-15', goal: 'Later goal', weekdays: [6] });
  habit.memberships.push({ effectiveFrom: '2026-11-01', pillarId: 'body' });
  habit.periods[0].end = '2026-11-15';
  habit.periods[0].archivedOn = '2026-11-15';
  habit.periods.push({ id: 'second', start: '2026-12-01', reactivatedOn: '2026-11-29' });
  habit.pendingReactivation = { periodId: 'pending', requestedOn: '2026-12-15' };
  habit.pendingMove = { requestedOn: '2026-12-20', pillarId: 'mind' };
  // Iterator coverage is independent of portable validity; never project these bare facts.
  const occurrenceDates = ['2026-10-10', '2026-10-25'];
  const checkpoints = [
    '2026-09-27',
    ...occurrenceDates,
    '2026-10-15',
    '2026-11-01',
    '2026-11-15',
    '2026-11-29',
    '2026-12-01',
    '2026-12-15',
    '2026-12-20',
    '2026-12-31',
  ].sort();
  const selected = [...replayDates(data, parseLocalDate('2026-12-31'), occurrenceDates)];
  for (const checkpoint of checkpoints) expect(selected).toContain(checkpoint);
  expect(selected).toContain('2026-11-16'); // Inclusive end's first inactive date.
  expect(selected).toEqual([...new Set(selected)].sort());
  expect(selected.length).toBeLessThanOrEqual(checkpoints.length * 8);
});

test('overlapping witness windows do not duplicate or reorder dense dates', () => {
  const data = facts();
  const dense = projectionDates('2026-09-27', '2026-10-20');
  expect([...replayDates(data, parseLocalDate(dense.at(-1)!), dense)]).toEqual(dense);
});

test.each([
  ['2011-12-27', '2012-01-03'],
  ['2024-02-27', '2024-03-05'],
  ['9999-12-24', '9999-12-31'],
])('retains civil weekdays and clips exactly at %s through %s', (first, last) => {
  const data = facts();
  const habit = data.habits[0];
  habit.createdOn = first;
  habit.versions[0].effectiveFrom = first;
  habit.memberships[0].effectiveFrom = first;
  habit.periods[0].start = first;
  // The shared fixture helper compares strings; after 9999, "10000" sorts
  // before "9999". Use numeric carriers here to keep the endpoint probe bounded.
  const expected: string[] = [];
  const cursor = parseLocalDate(first);
  const end = parseLocalDate(last);
  while (cursor <= end) {
    expected.push(civilDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  expect(dates(data, last)).toEqual(expected);
});

test('future identities do not expand or escape the original range', () => {
  expect(dates(facts(), '2026-09-26')).toEqual([]);
  expect(dates(facts(), '2026-09-29')).toEqual(['2026-09-27', '2026-09-28', '2026-09-29']);
  const data = facts();
  data.habits[0].versions.push({ effectiveFrom: '9999-12-31', goal: 'Future', weekdays: [] });
  expect(dates(data, '2026-10-20')).toEqual([
    ...projectionDates('2026-09-27', '2026-10-04'),
    '2026-10-20',
  ]);
});

test('empty date spans have the same at-most-eight-per-checkpoint traversal bound', () => {
  for (const through of ['0300-01-01', '9998-01-01']) {
    const data = facts();
    const habit = data.habits[0];
    habit.createdOn = '0100-01-01';
    habit.versions[0].effectiveFrom = habit.createdOn;
    habit.memberships[0].effectiveFrom = habit.createdOn;
    habit.periods[0].start = habit.createdOn;
    expect(dates(data, through)).toHaveLength(9);
  }
});

test('malformed in-range in-memory boundaries are not implicitly validated or repaired', () => {
  const data = facts();
  data.habits[0].memberships.push({ effectiveFrom: '2026-10-00', pillarId: 'body' });
  expect(dates(data, '2026-10-20')).toEqual(projectionDates('2026-09-27', '2026-10-20'));
});

test('iterator remains lazy and never resolves unreachable lifecycle schedules', () => {
  const data = facts();
  data.habits[0].pendingReactivation = { periodId: 'invalid', requestedOn: '9999-12-31' };
  data.habits[0].pendingMove = { requestedOn: 'not-a-date', pillarId: 'body' };
  const selected = createAgendaProjection(data).replayDates(parseLocalDate('2026-10-20'));
  expect(selected.next().value).toBe('2026-09-27');
  expect([...selected]).toContain('2026-10-20');
});
