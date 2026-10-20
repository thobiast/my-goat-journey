import { expect, test } from 'vitest';
import * as lookup from '../../src/domain/agenda';
import { calculateProgress } from '../../src/domain/progress';
import { editableOccurrences } from '../../src/domain/history';
import { facts } from './fixtures';
import { updateCompletion } from '../../src/domain/completion';

test('definition and membership lookups are independent effective timelines', () => {
  const data = facts();
  const habit = data.habits[0];
  habit.versions.push({ effectiveFrom: '2026-10-03', goal: 'Read 20 pages', weekdays: [2] });
  habit.memberships.push({ effectiveFrom: '2026-10-05', pillarId: 'body' });
  expect(lookup.definitionAt(habit, '2026-10-06')).toEqual(habit.versions[1]);
  expect(lookup.membershipAt(habit, '2026-10-06')).toEqual(habit.memberships[1]);
  expect(lookup.membershipAt(habit, '2026-10-03')).toEqual(habit.memberships[0]);
  expect(lookup.definitionAt(habit, '2026-09-26')).toBeUndefined();
  expect(lookup.agenda(data, '2026-10-06')[0]).toMatchObject({
    goal: 'Read 20 pages',
    pillarId: 'body',
    kind: 'required',
  });
});
test('pending reactivation resolves strictly after request using effective schedules without mutating actual periods', () => {
  const data = facts();
  const habit = data.habits[0];
  habit.periods[0].end = '2026-10-02';
  habit.pendingReactivation = { periodId: 'resume', requestedOn: '2026-10-02' };
  const before = structuredClone(data);
  expect(lookup.pendingReactivationDate(habit)).toBe('2026-10-05');
  expect(lookup.activationAt(habit, '2026-10-03')).toBeUndefined();
  expect(lookup.activationAt(habit, '2026-10-05')).toEqual({
    id: 'resume',
    start: '2026-10-05',
    reactivatedOn: '2026-10-02',
  });
  expect(lookup.agenda(data, '2026-10-05')[0]).toMatchObject({
    activationId: 'resume',
    kind: 'required',
  });
  expect(editableOccurrences(data, 'read', '2026-10-07').map((i) => i.date)).toEqual([
    '2026-10-07',
    '2026-10-05',
  ]);
  expect(calculateProgress(data, '2026-10-07').habits.read.current).toBe(0);
  expect(data).toEqual(before);
  habit.versions.push({ effectiveFrom: '2026-10-03', goal: 'New goal', weekdays: [2] });
  expect(lookup.pendingReactivationDate(habit)).toBe('2026-10-06');
  expect(lookup.agenda(data, '2026-10-05')).toEqual([]);
});
test('awaiting resumption projects current zero while retaining best, lifetime XP and aggregate runs', () => {
  const data = facts();
  for (const [month, day] of [
    [8, 28],
    [8, 30],
    [9, 2],
  ]) {
    const now = new Date(2026, month, day, 12);
    updateCompletion(
      data,
      'read',
      `${now.getFullYear()}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      true,
      now,
    );
  }
  data.habits[0].periods[0].end = '2026-10-02';
  data.habits[0].pendingReactivation = { periodId: 'resumed', requestedOn: '2026-10-02' };
  expect(calculateProgress(data, '2026-10-01')).toMatchObject({
    totalXp: 20,
    habits: { read: { current: 2, best: 2 } },
  });
  expect(calculateProgress(data, '2026-10-03')).toMatchObject({
    totalXp: 40,
    habits: { read: { current: 0, best: 3, xp: 40 } },
    pillars: { mind: { current: 3, best: 3 } },
  });
  delete data.habits[0].pendingReactivation;
  expect(calculateProgress(data, '2026-10-03')).toMatchObject({
    totalXp: 40,
    habits: { read: { current: 3, best: 3 } },
  });
});
