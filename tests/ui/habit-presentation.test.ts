import { expect, test } from 'vitest';
import { agenda, definitionAt, membershipAt } from '../../src/domain/agenda';
import {
  beforeCreation,
  displayDefinition,
  displayMembership,
  stateAt,
} from '../../src/features/habits/habitPresentation';
import { facts } from '../domain/fixtures';

function timeline() {
  const data = facts();
  const habit = data.habits[0];
  habit.versions.push({ effectiveFrom: '2026-10-01', goal: 'Read a chapter', weekdays: [5] });
  habit.memberships.push({ effectiveFrom: '2026-10-02', pillarId: 'body' });
  return { data, habit };
}

test('future-created identity is readable without making it an applicable commitment', () => {
  const { data, habit } = timeline();
  const before = structuredClone(data);
  expect(beforeCreation(habit, '2026-09-26')).toBe(true);
  expect(displayDefinition(habit, '2026-09-26')).toBe(habit.versions[0]);
  expect(displayMembership(habit, '2026-09-26')).toBe(habit.memberships[0]);
  expect(stateAt(habit, '2026-09-26')).toBe('waitingToStart');
  expect(definitionAt(habit, '2026-09-26')).toBeUndefined();
  expect(membershipAt(habit, '2026-09-26')).toBeUndefined();
  expect(agenda(data, '2026-09-26')).toEqual([]);
  expect(beforeCreation(habit, habit.createdOn)).toBe(false);
  expect(stateAt(habit, habit.createdOn)).toBe('active');
  expect(data).toEqual(before);
});

test('display definitions and memberships follow their independent historical boundaries', () => {
  const { data, habit } = timeline();
  const before = structuredClone(data);
  expect(displayDefinition(habit, '2026-09-30')).toBe(habit.versions[0]);
  expect(displayMembership(habit, '2026-09-30')).toBe(habit.memberships[0]);
  expect(displayDefinition(habit, '2026-10-01')).toBe(habit.versions[1]);
  expect(displayMembership(habit, '2026-10-01')).toBe(habit.memberships[0]);
  expect(displayMembership(habit, '2026-10-02')).toBe(habit.memberships[1]);
  expect(data).toEqual(before);
});

test('archival and pending reactivation retain readable identity and dated display state', () => {
  const { data, habit } = timeline();
  habit.periods[0].end = '2026-09-30';
  habit.periods[0].archivedOn = '2026-09-30';
  habit.pendingReactivation = { periodId: 'return', requestedOn: '2026-10-02' };
  const before = structuredClone(data);
  expect(stateAt(habit, '2026-09-29')).toBe('active');
  expect(stateAt(habit, '2026-09-30')).toBe('archived');
  expect(displayDefinition(habit, '2026-09-30')).toBe(habit.versions[0]);
  expect(stateAt(habit, '2026-10-02')).toBe('awaiting');
  expect(displayDefinition(habit, '2026-10-02')).toBe(habit.versions[1]);
  expect(displayMembership(habit, '2026-10-02')).toBe(habit.memberships[1]);
  expect(stateAt(habit, '2026-10-09')).toBe('active');
  expect(stateAt(habit, '2026-09-26')).toBe('waitingToStart');
  expect(data).toEqual(before);
});
