import { expect, test } from 'vitest';
import { makeHabit } from '../../src/domain/creation';
import {
  archiveHabit,
  editHabit,
  previewHabitEdit,
  reactivateHabit,
  reactivateHabitInPillar,
  reconcileHabit,
} from '../../src/domain/lifecycle';
import { agenda } from '../../src/domain/agenda';
import { facts } from './fixtures';

const friday = new Date(2026, 9, 2, 12);
test.each(['create', 'edit', 'preview', 'reactivate'] as const)(
  '%s rejects a removed destination without changing any facts',
  (action) => {
    const data = facts();
    if (action === 'reactivate') archiveHabit(data, 'read', friday);
    data.pillars[0].removedOn = '2026-10-02';
    const before = structuredClone(data);
    const input = { pillarId: 'mind', goal: 'Changed', weekdays: [1, 3, 5] };

    const operation = () =>
      action === 'create'
        ? makeHabit(input, '2026-10-02', data)
        : action === 'edit'
          ? editHabit(data, 'read', input, friday)
          : action === 'preview'
            ? previewHabitEdit(data, 'read', input, friday)
            : reactivateHabit(data, 'read', friday);

    expect(operation).toThrow('active pillar');
    expect(data).toEqual(before);
  },
);

test('legacy reactivation rejects missing membership destination instead of inventing a dangling activation', () => {
  const data = facts();
  archiveHabit(data, 'read', friday);
  data.pillars.shift();
  const before = structuredClone(data);
  expect(() => reactivateHabit(data, 'read', friday)).toThrow('active pillar');
  expect(data).toEqual(before);
});

test('destination intent follows an awaiting schedule edit while preserving every prior membership and occurrence', () => {
  const data = facts();
  archiveHabit(data, 'read', friday);
  data.pillars[0].removedOn = '2026-10-02';
  const oldMembership = structuredClone(data.habits[0].memberships);
  const oldOccurrences = structuredClone(data.occurrences);
  reactivateHabitInPillar(data, 'read', 'body', friday);
  editHabit(
    data,
    'read',
    { pillarId: 'body', goal: 'Tuesday goal', weekdays: [2] },
    new Date(2026, 9, 3, 12),
  );
  expect(data.habits[0].memberships).toEqual([
    ...oldMembership,
    { effectiveFrom: '2026-10-06', pillarId: 'body' },
  ]);
  expect(data.occurrences).toEqual(oldOccurrences);
  expect(agenda(data, '2026-10-05')).toEqual([]);
  expect(agenda(data, '2026-10-06')[0]).toMatchObject({
    kind: 'required',
    pillarId: 'body',
    goal: 'Tuesday goal',
  });
});

test('revisiting a date cannot reassign an archived activation with later actual history', () => {
  const data = facts();
  archiveHabit(data, 'read', friday);
  reactivateHabitInPillar(data, 'read', 'body', friday);
  reconcileHabit(data.habits[0], '2026-10-05');
  archiveHabit(data, 'read', new Date(2026, 9, 5, 12));
  const before = structuredClone(data);
  expect(() => reactivateHabitInPillar(data, 'read', 'mind', friday)).toThrow(
    'Historical commitment conflict',
  );
  expect(data).toEqual(before);
});

test.each(['active', 'awaiting'] as const)(
  'reactivation cannot secretly move an %s habit to a different active destination',
  (state) => {
    const data = facts();
    if (state === 'awaiting') {
      archiveHabit(data, 'read', friday);
      reactivateHabit(data, 'read', friday);
    }
    const before = structuredClone(data);
    expect(() => reactivateHabitInPillar(data, 'read', 'body', friday)).toThrow(
      'Archive habit before reactivation',
    );
    expect(data).toEqual(before);
  },
);
