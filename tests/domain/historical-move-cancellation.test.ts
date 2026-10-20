import { expect, test } from 'vitest';
import { agenda, membershipAt } from '../../src/domain/agenda';
import { updateCompletion } from '../../src/domain/completion';
import { editHabit, previewHabitEdit, reconcileHabit } from '../../src/domain/lifecycle';
import { calculateProgress } from '../../src/domain/progress';
import { DEFAULT_PILLARS } from '../../src/domain/types';
import { validateDataset } from '../../src/data/backup';
import { facts } from './fixtures';

const friday = new Date(2026, 9, 2, 12);
const saturday = new Date(2026, 9, 3, 12);
const input = { pillarId: 'body', goal: 'Read 10 pages', weekdays: [1, 3, 5] };

test.each([false, true])(
  'first historical credit preserves a later cancellation on a scheduled day=%s',
  (scheduled) => {
    const data = facts();
    data.pillars = DEFAULT_PILLARS.map((id) => ({ id, name: id, defaultKey: id }));
    const weekdays = scheduled ? [1, 3, 5, 6] : [1, 3, 5];
    data.habits[0].versions[0].weekdays = weekdays;
    editHabit(data, 'read', { ...input, weekdays }, friday);
    const cancel = { ...input, pillarId: 'mind', weekdays };
    expect(previewHabitEdit(data, 'read', cancel, saturday)).toMatchObject({
      moveMode: scheduled ? 'conditional' : 'none',
      targetPillarId: 'mind',
    });
    editHabit(data, 'read', cancel, saturday);
    // A scheduled Saturday has already made the first move due; returning is a new move.
    if (scheduled) expect(data.habits[0].pendingMove?.pillarId).toBe('mind');
    else expect(data.habits[0].pendingMove).toBeUndefined();
    expect(membershipAt(data.habits[0], '2026-10-05')?.pillarId).toBe('mind');
    updateCompletion(data, 'read', '2026-10-02', true, saturday);
    expect(membershipAt(data.habits[0], '2026-10-05')?.pillarId).toBe('mind');
    expect(agenda(data, '2026-10-02')[0]).toMatchObject({ pillarId: 'body', done: true });
    if (scheduled)
      expect(agenda(data, '2026-10-03')[0]).toMatchObject({ pillarId: 'mind', done: false });
    const memberships = structuredClone(data.habits[0].memberships);
    updateCompletion(data, 'read', '2026-10-02', false, saturday);
    updateCompletion(data, 'read', '2026-10-02', true, saturday);
    expect(data.habits[0].memberships).toEqual(memberships);
    expect(data.occurrences.filter((o) => o.date === '2026-10-02')).toHaveLength(1);
    expect(calculateProgress(data, '2026-10-03')).toMatchObject({ totalXp: 10 });
    expect(validateDataset(data)).toEqual(data);
  },
);

test.each(['before-cancel', 'after-cancel', 'third-destination'] as const)(
  'historical first credit with rebased schedule keeps management intent: %s',
  (order) => {
    const data = facts();
    data.pillars = DEFAULT_PILLARS.map((id) => ({ id, name: id, defaultKey: id }));
    editHabit(data, 'read', input, friday);
    if (order === 'before-cancel') updateCompletion(data, 'read', '2026-10-02', true, saturday);
    const cancel = { ...input, pillarId: 'mind', weekdays: [2] };
    editHabit(data, 'read', cancel, saturday);
    if (order === 'third-destination')
      editHabit(data, 'read', { ...cancel, pillarId: 'nutrition' }, saturday);
    if (order !== 'before-cancel') updateCompletion(data, 'read', '2026-10-02', true, saturday);
    expect(agenda(data, '2026-10-05')).toEqual([]);
    expect(agenda(data, '2026-10-06')[0]).toMatchObject({
      pillarId: order === 'third-destination' ? 'nutrition' : 'mind',
      kind: 'required',
      done: false,
    });
    expect(agenda(data, '2026-10-02')[0]).toMatchObject({ pillarId: 'body', done: true });
    const memberships = structuredClone(data.habits[0].memberships);
    reconcileHabit(data.habits[0], '2026-10-06');
    expect(data.habits[0].pendingMove).toBeUndefined();
    expect(data.habits[0].memberships).toEqual(memberships);
    expect(validateDataset(data)).toEqual(data);
    expect(calculateProgress(data, '2026-10-06').totalXp).toBe(10);
  },
);

test('same-day cancellation replaces the uncredited destination without anticipating the cancelled move', () => {
  const data = facts();
  data.pillars = DEFAULT_PILLARS.map((id) => ({ id, name: id, defaultKey: id }));
  editHabit(data, 'read', input, friday);
  editHabit(data, 'read', { ...input, pillarId: 'mind' }, friday);
  updateCompletion(data, 'read', '2026-10-02', true, saturday);
  expect(agenda(data, '2026-10-02')[0]).toMatchObject({ pillarId: 'mind', done: true });
  expect(membershipAt(data.habits[0], '2026-10-05')?.pillarId).toBe('mind');
  expect(data.habits[0].pendingMove).toBeUndefined();
  expect(calculateProgress(data, '2026-10-03').totalXp).toBe(10);
});
