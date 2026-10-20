import { expect, test } from 'vitest';
import { committedCompletionXp } from '../../src/features/today/committedCompletionXp';
import { updateCompletion } from '../../src/domain/completion';
import { facts } from '../domain/fixtures';

test('creation-day optional completion uses committed base XP, not a required-day assumption', () => {
  const before = facts();
  const after = structuredClone(before);
  updateCompletion(after, 'read', '2026-09-27', true, new Date('2026-09-27T12:00:00'));
  expect(committedCompletionXp(before, after, 'read', '2026-09-27', '2026-09-27')).toBe(10);
});

test('uncheck and an unchanged committed repeat never report a reward', () => {
  const before = facts();
  updateCompletion(before, 'read', '2026-09-28', true, new Date('2026-09-28T12:00:00'));
  const after = structuredClone(before);
  updateCompletion(after, 'read', '2026-09-28', false, new Date('2026-09-28T12:00:00'));
  expect(committedCompletionXp(before, after, 'read', '2026-09-28', '2026-09-28')).toBeUndefined();
  expect(committedCompletionXp(before, before, 'read', '2026-09-28', '2026-09-28')).toBeUndefined();
});

test('a successful correction to a historical date never becomes Today feedback', () => {
  const before = facts();
  const after = structuredClone(before);
  updateCompletion(after, 'read', '2026-09-28', true, new Date('2026-09-30T12:00:00'));
  expect(committedCompletionXp(before, after, 'read', '2026-09-28', '2026-09-30')).toBeUndefined();
});

test('an unrelated committed reward change cannot contaminate this action amount', () => {
  const before = facts();
  const other = structuredClone(before.habits[0]);
  other.id = 'other';
  before.habits.push(other);
  const after = structuredClone(before);
  for (const date of ['2026-09-28', '2026-09-30', '2026-10-02'])
    updateCompletion(after, 'other', date, true, new Date(`${date}T12:00:00`));
  updateCompletion(after, 'read', '2026-10-02', true, new Date('2026-10-02T12:00:00'));
  expect(committedCompletionXp(before, after, 'read', '2026-10-02', '2026-10-02')).toBe(10);
});

test('committed completion feedback resolves the exact habit/date base plus milestone award without mutating facts', () => {
  const before = facts();
  for (const date of ['2026-09-28', '2026-09-30'])
    updateCompletion(before, 'read', date, true, new Date(`${date}T12:00:00`));
  const after = structuredClone(before);
  updateCompletion(after, 'read', '2026-10-02', true, new Date('2026-10-02T12:00:00'));
  const original = structuredClone(after);
  expect(committedCompletionXp(before, after, 'read', '2026-10-02', '2026-10-02')).toBe(20);
  expect(committedCompletionXp(before, before, 'read', '2026-10-02', '2026-10-02')).toBeUndefined();
  expect(committedCompletionXp(after, after, 'read', '2026-10-02', '2026-10-02')).toBeUndefined();
  expect(committedCompletionXp(before, after, 'other', '2026-10-02', '2026-10-02')).toBeUndefined();
  expect(committedCompletionXp(before, after, 'read', '2026-09-30', '2026-10-02')).toBeUndefined();
  expect(after).toEqual(original);
});
