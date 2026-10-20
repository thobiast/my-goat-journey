import { expect, test } from 'vitest';
import * as lifecycle from '../../src/domain/lifecycle';
import { agenda, membershipAt, summarize } from '../../src/domain/agenda';
import { updateCompletion } from '../../src/domain/completion';
import { calculateProgress } from '../../src/domain/progress';
import { migrateDataset } from '../../src/data/migrations';
import { facts } from './fixtures';
import { legacyFixture } from '../data/fixtures';

const friday = new Date(2026, 9, 2, 12);
const move = { pillarId: 'body', goal: 'Read 10 pages', weekdays: [1, 3, 5] };

test.each([
  'credited',
  'ordinary-undo',
  'off-schedule',
  'legacy-unknown',
  'creation-optional',
] as const)(
  'move matrix %s preserves dated provenance and reports prospective consequences',
  (scenario) => {
    let data = facts();
    let now = friday;
    if (scenario === 'credited' || scenario === 'ordinary-undo') {
      updateCompletion(data, 'read', '2026-10-02', true, friday);
      if (scenario === 'ordinary-undo') updateCompletion(data, 'read', '2026-10-02', false, friday);
    }
    if (scenario === 'off-schedule') now = new Date(2026, 9, 3, 12);
    if (scenario === 'legacy-unknown') {
      data = migrateDataset(legacyFixture());
      data.habits[0].memberships = [{ effectiveFrom: '2026-09-27', pillarId: 'music' }];
    }
    if (scenario === 'creation-optional') now = new Date(2026, 8, 27, 12);
    const date =
      scenario === 'off-schedule'
        ? '2026-10-03'
        : scenario === 'creation-optional'
          ? '2026-09-27'
          : '2026-10-02';
    const before = structuredClone(data);
    const preview = lifecycle.previewHabitEdit(data, 'read', move, now);
    expect(preview).toMatchObject({
      effectiveFrom:
        scenario === 'creation-optional'
          ? '2026-09-28'
          : scenario === 'off-schedule'
            ? '2026-10-04'
            : '2026-10-03',
      moveDate: scenario === 'creation-optional' ? '2026-09-28' : '2026-10-05',
      moveMode: scenario === 'creation-optional' ? 'conditional' : 'preserved',
    });
    expect(data).toEqual(before);
    lifecycle.editHabit(data, 'read', move, now);
    expect(data.habits[0].id).toBe('read');
    if (scenario !== 'legacy-unknown')
      expect(data.habits[0].versions).toEqual(before.habits[0].versions);
    else expect(data.habits[0].versions.slice(0, -1)).toEqual(before.habits[0].versions);
    if (scenario === 'off-schedule') {
      expect(agenda(data, date)).toEqual([]);
      expect(data.occurrences).toEqual(before.occurrences);
    } else if (scenario === 'creation-optional') {
      expect(agenda(data, date)[0]).toMatchObject({
        kind: 'optional',
        pillarId: 'body',
        pillarParticipation: 'on-completion',
        done: false,
      });
      expect(summarize(agenda(data, date))).toMatchObject({ required: 0, status: 'neutral' });
      updateCompletion(data, 'read', date, true, now);
      expect(calculateProgress(data, date)).toMatchObject({
        totalXp: 10,
        pillars: { body: { current: 1 } },
      });
    } else {
      expect(data.occurrences).toEqual(before.occurrences);
      expect(calculateProgress(data, date)).toEqual(calculateProgress(before, date));
      updateCompletion(data, 'read', date, true, now);
      expect(data.occurrences.find((o) => o.date === date)?.pillarId).toBe(
        scenario === 'legacy-unknown' ? 'music' : 'mind',
      );
      updateCompletion(data, 'read', date, false, now);
      updateCompletion(data, 'read', date, true, now);
      expect(data.occurrences.filter((o) => o.date === date)).toHaveLength(1);
    }
    expect(membershipAt(data.habits[0], preview.moveDate!)?.pillarId).toBe('body');
  },
);

test('a pending credited move rebases to the edited effective schedule, then fixes membership at first due even if missed', () => {
  const data = facts();
  updateCompletion(data, 'read', '2026-10-02', true, friday);
  lifecycle.editHabit(data, 'read', move, friday);
  expect(data.habits[0].pendingMove).toEqual({ requestedOn: '2026-10-02', pillarId: 'body' });
  const saturday = new Date(2026, 9, 3, 12);
  const edited = { ...move, goal: 'Read 30 pages', weekdays: [2] };
  expect(lifecycle.previewHabitEdit(data, 'read', edited, saturday).moveDate).toBe('2026-10-06');
  lifecycle.editHabit(data, 'read', edited, saturday);
  expect(membershipAt(data.habits[0], '2026-10-05')?.pillarId).toBe('mind');
  expect(membershipAt(data.habits[0], '2026-10-06')?.pillarId).toBe('body');
  // Due-date membership is actual even if no occurrence was explicitly stored.
  lifecycle.editHabit(data, 'read', { ...edited, weekdays: [4] }, new Date(2026, 9, 6, 12));
  expect(data.habits[0].pendingMove).toBeUndefined();
  expect(membershipAt(data.habits[0], '2026-10-06')?.pillarId).toBe('body');
  expect(data.occurrences[0]).toMatchObject({ date: '2026-10-02', pillarId: 'mind', done: true });
});

test.each([false, true])(
  'pure first-due archive Done=%s materializes valid actual period rather than cancelling',
  (done) => {
    const data = facts();
    lifecycle.archiveHabit(data, 'read', friday);
    lifecycle.reactivateHabit(data, 'read', friday);
    const id = data.habits[0].pendingReactivation!.periodId;
    if (done) updateCompletion(data, 'read', '2026-10-05', true, new Date(2026, 9, 5, 12));
    lifecycle.archiveHabit(data, 'read', new Date(2026, 9, 5, 12));
    expect(data.habits[0].pendingReactivation).toBeUndefined();
    expect(data.habits[0].periods.at(-1)).toEqual({
      id,
      start: '2026-10-05',
      end: '2026-10-05',
      reactivatedOn: '2026-10-02',
      archivedOn: '2026-10-05',
    });
    expect(data.occurrences.find((o) => o.date === '2026-10-05')).toMatchObject({
      done,
      exempt: true,
      kind: 'required',
      activationId: id,
    });
    expect(lifecycle.habitState(data.habits[0], '2026-10-05')).toEqual({ state: 'archived' });
  },
);

test('first conditional credit settles its move; later Undo/Redo cannot reconstruct membership or erase a subsequent prospective move', () => {
  const data = facts();
  data.pillars.push({ id: 'third', name: 'Third' });
  lifecycle.editHabit(data, 'read', move, friday);
  updateCompletion(data, 'read', '2026-10-02', true, friday);
  expect(data.habits[0].pendingMove).toBeUndefined();
  expect(data.habits[0].memberships).toEqual([
    { effectiveFrom: '2026-09-27', pillarId: 'mind' },
    { effectiveFrom: '2026-10-02', pillarId: 'body' },
  ]);
  updateCompletion(data, 'read', '2026-10-02', false, friday);
  lifecycle.editHabit(data, 'read', { ...move, pillarId: 'third' }, friday);
  const memberships = structuredClone(data.habits[0].memberships);
  const intent = structuredClone(data.habits[0].pendingMove);
  updateCompletion(data, 'read', '2026-10-02', true, friday);
  expect(data.habits[0].memberships).toEqual(memberships);
  expect(data.habits[0].pendingMove).toEqual(intent);
  expect(data.occurrences[0]).toMatchObject({
    pillarId: 'body',
    pillarParticipation: 'on-completion',
  });
});

test('legacy optional corrections preserve all original membership dates, even if the snapshot differs from the definition owner', () => {
  const data = migrateDataset(legacyFixture());
  data.habits[0].memberships[0].pillarId = 'body';
  const membership = structuredClone(data.habits[0].memberships);
  // This creation-day opportunity is previous eligible on Monday.
  updateCompletion(data, 'read', '2026-09-27', false, new Date(2026, 8, 28, 12));
  updateCompletion(data, 'read', '2026-09-27', true, new Date(2026, 8, 28, 12));
  expect(data.habits[0].memberships).toEqual(membership);
  expect(data.occurrences[0]).toMatchObject({ pillarId: 'music', kind: 'optional', done: true });
});

test('equal weekday sets from a supported unsorted history are semantic no-ops, not new pending versions', () => {
  const data = facts();
  data.habits[0].versions[0].weekdays = [5, 1, 3];
  const before = structuredClone(data);
  lifecycle.editHabit(
    data,
    'read',
    { pillarId: 'mind', goal: 'Read 10 pages', weekdays: [3, 5, 1] },
    friday,
  );
  expect(data).toEqual(before);
});

test.each(['weekdays', 'goal', 'membership'] as const)(
  'revisiting Friday rejects a %s collision supporting recorded Saturday facts without mutating anything',
  (change) => {
    const data = facts();
    data.habits[0].versions[0].weekdays = [0, 1, 2, 3, 4, 5, 6];
    lifecycle.editHabit(
      data,
      'read',
      { pillarId: 'mind', goal: 'Saturday exact goal', weekdays: [0, 1, 2, 3, 4, 5, 6] },
      friday,
    );
    updateCompletion(data, 'read', '2026-10-03', true, new Date(2026, 9, 3, 12));
    data.permanentUnlocks.push({ id: 'owned', unlockedAt: friday.toISOString() });
    const before = structuredClone(data);
    const progress = calculateProgress(data, '2026-10-03');
    const input = {
      pillarId: change === 'membership' ? 'body' : 'mind',
      goal: change === 'goal' ? 'Overwritten goal' : 'Saturday exact goal',
      weekdays: change === 'weekdays' ? [1] : [0, 1, 2, 3, 4, 5, 6],
    };
    expect(() => lifecycle.previewHabitEdit(data, 'read', input, friday)).not.toThrow();
    expect(() => lifecycle.editHabit(data, 'read', input, friday)).toThrow(
      'Historical commitment conflict',
    );
    expect(data).toEqual(before);
    expect(calculateProgress(data, '2026-10-03')).toEqual(progress);
    expect(progress.totalXp).toBe(10);
    expect(agenda(data, '2026-10-03')[0]).toMatchObject({
      goal: 'Saturday exact goal',
      pillarId: 'mind',
      done: true,
      activationId: 'initial',
    });
  },
);

test('revisiting Friday accepts identical semantic pending definition as an exact no-op', () => {
  const data = facts();
  data.habits[0].versions[0].weekdays = [0, 1, 2, 3, 4, 5, 6];
  lifecycle.editHabit(
    data,
    'read',
    { pillarId: 'mind', goal: 'Saturday goal', weekdays: [0, 1, 2, 3, 4, 5, 6] },
    friday,
  );
  updateCompletion(data, 'read', '2026-10-03', true, new Date(2026, 9, 3, 12));
  const before = structuredClone(data);
  lifecycle.editHabit(
    data,
    'read',
    { pillarId: 'mind', goal: 'Saturday goal', weekdays: [6, 5, 4, 3, 2, 1, 0] },
    friday,
  );
  expect(data).toEqual(before);
});

test('identical supported unsorted pending definition preserves exact facts on a calendar revisit', () => {
  const data = facts();
  data.habits[0].versions[0].weekdays = [0, 1, 2, 3, 4, 5, 6];
  lifecycle.editHabit(
    data,
    'read',
    { pillarId: 'mind', goal: 'Saturday exact goal', weekdays: [0, 1, 2, 3, 4, 5, 6] },
    friday,
  );
  data.habits[0].versions[1].weekdays = [6, 5, 4, 3, 2, 1, 0];
  updateCompletion(data, 'read', '2026-10-03', true, new Date(2026, 9, 3, 12));
  const before = structuredClone(data);
  lifecycle.editHabit(
    data,
    'read',
    { pillarId: 'mind', goal: 'Saturday exact goal', weekdays: [0, 1, 2, 3, 4, 5, 6] },
    friday,
  );
  expect(data).toEqual(before);
});

test('revisited collision cannot erase an intervening miss and manufacture a bonus for a later recorded completion', () => {
  const data = facts();
  data.habits[0].versions[0].weekdays = [0, 1, 2, 3, 4, 5, 6];
  updateCompletion(data, 'read', '2026-10-01', true, new Date(2026, 9, 1, 12));
  updateCompletion(data, 'read', '2026-10-02', true, friday);
  lifecycle.editHabit(
    data,
    'read',
    { pillarId: 'mind', goal: 'Saturday scheduled goal', weekdays: [0, 1, 2, 3, 4, 5, 6] },
    friday,
  );
  lifecycle.editHabit(
    data,
    'read',
    { pillarId: 'mind', goal: 'Sunday saved goal', weekdays: [0, 1, 2, 3, 4, 5, 6] },
    new Date(2026, 9, 3, 12),
  );
  updateCompletion(data, 'read', '2026-10-04', true, new Date(2026, 9, 4, 12));
  const before = structuredClone(data);
  const progress = calculateProgress(data, '2026-10-04');
  expect(progress.totalXp).toBe(30);
  expect(() =>
    lifecycle.editHabit(
      data,
      'read',
      { pillarId: 'mind', goal: 'Saturday scheduled goal', weekdays: [1] },
      friday,
    ),
  ).toThrow('Historical commitment conflict');
  expect(data).toEqual(before);
  expect(calculateProgress(data, '2026-10-04')).toEqual(progress);
});

test('revisited edit cannot move the first required date of a recorded reactivation period', () => {
  const data = facts();
  lifecycle.archiveHabit(data, 'read', friday);
  lifecycle.reactivateHabit(data, 'read', friday);
  lifecycle.reconcileHabit(data.habits[0], '2026-10-05');
  updateCompletion(data, 'read', '2026-10-07', true, new Date(2026, 9, 7, 12));
  const before = structuredClone(data);
  expect(() =>
    lifecycle.editHabit(
      data,
      'read',
      { pillarId: 'mind', goal: 'Read 10 pages', weekdays: [3] },
      new Date(2026, 9, 1, 12),
    ),
  ).toThrow('Historical commitment conflict');
  expect(data).toEqual(before);
});
