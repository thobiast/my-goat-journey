import { describe, expect, test } from 'vitest';
import { BackupError, validateDataset } from '../../src/data/backup';
import { agenda } from '../../src/domain/agenda';
import { civilDate, parseLocalDate } from '../../src/domain/calendar';
import { updateCompletion } from '../../src/domain/completion';
import {
  archiveHabit,
  editHabit,
  reactivateHabit,
  reconcileHabit,
} from '../../src/domain/lifecycle';
import { calculateProgress } from '../../src/domain/progress';
import type { CompatibleDataset, Dataset, LegacyDataset } from '../../src/domain/types';
import { hasEarlierHistory } from '../../src/features/progress/calendar';
import { trackingStart } from '../../src/features/progress/monthly';
import { calculateProgress as dailyReference } from '../helpers/daily-progress-reference';
import { projectionDates, projectionScenario } from '../helpers/projection-scenarios';
import { facts } from './fixtures';

// Compatibility guards, not optimization RED: these must pass before changing runtime.
// The frozen reducer is test-only; all fixtures intentionally span at most 400 dates.
function singleHabit(createdOn = '2026-09-27', weekdays = [1, 3, 5]): Dataset {
  const data = facts();
  data.pillars = ['mind', 'body', 'nutrition', 'hygiene'].map((id) => ({
    id,
    name: id,
    defaultKey: id as 'mind' | 'body' | 'nutrition' | 'hygiene',
  }));
  const habit = data.habits[0];
  habit.createdOn = createdOn;
  habit.versions[0].effectiveFrom = createdOn;
  habit.versions[0].weekdays = weekdays;
  habit.memberships[0].effectiveFrom = createdOn;
  habit.periods[0].start = createdOn;
  return data;
}

function now(date: string): Date {
  // Lifecycle commands use device-local Today; noon preserves the chosen civil date
  // in each separately launched timezone process without replacing instant semantics.
  return new Date(`${date}T12:00:00`);
}

function complete(data: Dataset, date: string, done = true, habitId = 'read'): void {
  updateCompletion(data, habitId, date, done, now(date));
}

function equivalent(data: CompatibleDataset, today: string) {
  const before = structuredClone(data);
  const expected = dailyReference(data, today);
  const actual = calculateProgress(data, today);
  expect(actual).toStrictEqual(expected);
  expect(data).toStrictEqual(before);
  return actual;
}

function validEquivalent(data: Dataset, today: string) {
  validateDataset(data);
  return equivalent(data, today);
}

describe('complete daily baseline snapshot equivalence', () => {
  test.each(['2026-09-26', '2026-09-27', '2026-09-30', '2026-10-05', '2026-10-20'])(
    'mixed validated facts, future records and activation boundaries through %s',
    (today) => {
      equivalent(projectionScenario(), today);
    },
  );

  test.each(['2026-09-27', '2026-10-02', '2026-10-10', '2026-12-31'])(
    'no completions, optional creation, Today pending and trailing implicit misses through %s',
    (today) => {
      const result = validEquivalent(singleHabit(), today);
      expect(result.totalXp).toBe(0);
      expect(result.awards).toStrictEqual([]);
    },
  );

  test('seven witnesses strictly after creation retain the first weekly required miss', () => {
    const data = singleHabit('2026-09-28', [1]);
    complete(data, '2026-09-28');
    complete(data, '2026-10-12');
    expect(validEquivalent(data, '2026-10-04').habits.read.current).toBe(1);
    expect(validEquivalent(data, '2026-10-05').habits.read.current).toBe(1);
    expect(validEquivalent(data, '2026-10-06').habits.read.current).toBe(0);
    const result = validEquivalent(data, '2026-10-12');
    expect(result.awards.map(({ streak }) => streak)).toStrictEqual([1, 1]);
    expect(result.awards.map(({ sequenceId }) => sequenceId)).toStrictEqual([
      'initial:2026-09-28',
      'initial:2026-10-12',
    ]);
  });

  test('required awards precede optional awards despite opposite source and fact order', () => {
    const data = singleHabit('2026-09-28', [0, 1, 2, 3, 4, 5, 6]);
    const optional = structuredClone(data.habits[0]);
    optional.id = 'optional-first';
    optional.createdOn = '2026-09-30';
    optional.versions[0].effectiveFrom = optional.createdOn;
    optional.memberships[0].effectiveFrom = optional.createdOn;
    optional.periods[0] = { id: 'new-initial', start: optional.createdOn };
    data.habits.unshift(optional);
    complete(data, '2026-09-30', true, optional.id);
    complete(data, '2026-09-30');
    const result = validEquivalent(data, '2026-09-30');
    expect(result.awards.map(({ habitId }) => habitId)).toStrictEqual(['read', 'optional-first']);
  });

  test('dense 400-completion history preserves every milestone, award and final field', () => {
    const data = singleHabit('2025-01-01', [0, 1, 2, 3, 4, 5, 6]);
    for (const date of projectionDates('2025-01-01', '2026-02-04')) complete(data, date);
    const result = validEquivalent(data, '2026-02-04');
    expect(result.awards).toHaveLength(400);
    expect(result.awards.filter(({ bonusXp }) => bonusXp > 0)).toHaveLength(17);
    expect(result.awards.filter(({ streak }) => streak > 365).every((a) => a.bonusXp === 0)).toBe(
      true,
    );
    expect(result.habits.read).toStrictEqual({
      current: 400,
      best: 400,
      xp: 12150,
      nextBonus: null,
    });
  });

  test('a real gap repeats milestone bonuses without duplicating sequence or award identity', () => {
    const data = singleHabit('2026-09-28', [0, 1, 2, 3, 4, 5, 6]);
    for (const date of [
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]) {
      complete(data, date);
    }
    const result = validEquivalent(data, '2026-10-04');
    expect(result.awards.filter(({ bonusXp }) => bonusXp === 10)).toHaveLength(2);
    expect(new Set(result.awards.map(({ sequenceId }) => sequenceId)).size).toBe(2);
    expect(result.totalXp).toBe(80);
  });

  test('current-schema previous-occurrence undo and recheck restores the entire snapshot', () => {
    const data = singleHabit('2026-09-28');
    for (const date of ['2026-09-28', '2026-09-30', '2026-10-02']) complete(data, date);
    const original = validEquivalent(data, '2026-10-02');
    expect(original.totalXp).toBe(40);
    updateCompletion(data, 'read', '2026-09-30', false, now('2026-10-02'));
    expect(validEquivalent(data, '2026-10-02').totalXp).toBe(20);
    updateCompletion(data, 'read', '2026-09-30', true, now('2026-10-02'));
    expect(validEquivalent(data, '2026-10-02')).toStrictEqual(original);
  });

  test.each([false, true])(
    'move before/after credit keeps source locks (credited first: %s)',
    (creditedFirst) => {
      const data = singleHabit('2026-09-28');
      complete(data, '2026-09-28');
      if (creditedFirst) complete(data, '2026-09-30');
      editHabit(
        data,
        'read',
        { goal: 'Revised goal', pillarId: 'body', weekdays: [1, 3, 5] },
        now('2026-09-30'),
      );
      validEquivalent(data, '2026-09-30');
      expect(agenda(data, '2026-09-30')[0]).toMatchObject({
        pillarId: creditedFirst ? 'mind' : 'body',
        pillarParticipation: creditedFirst ? 'required' : 'on-completion',
      });
      complete(data, '2026-09-30');
      const credited = validEquivalent(data, '2026-09-30');
      complete(data, '2026-09-30', false);
      expect(validEquivalent(data, '2026-09-30').totalXp).toBe(10);
      expect(data.occurrences.find((o) => o.date === '2026-09-30')).toMatchObject({
        assignmentLocked: true,
        completionProvenance: 'credited',
        pillarId: creditedFirst ? 'mind' : 'body',
      });
      complete(data, '2026-09-30');
      expect(validEquivalent(data, '2026-09-30')).toStrictEqual(credited);
      complete(data, '2026-10-02');
      expect(validEquivalent(data, '2026-10-02').awards).toHaveLength(3);
    },
  );

  test.each([false, true])(
    'archive-day unfinished exemption or Done preserves credit (Done: %s)',
    (done) => {
      const data = singleHabit('2026-09-28');
      complete(data, '2026-09-28');
      if (done) complete(data, '2026-09-30');
      archiveHabit(data, 'read', now('2026-09-30'));
      const archived = validEquivalent(data, '2026-10-20');
      expect(archived.totalXp).toBe(done ? 20 : 10);
      expect(archived.habits.read.current).toBe(done ? 2 : 1);
      reactivateHabit(data, 'read', now('2026-10-20'));
      expect(validEquivalent(data, '2026-10-20').habits.read.current).toBe(0);
      // The unmaterialized intent is already due; replay must retain synthetic activation behavior.
      validEquivalent(data, '2026-10-21');
      validEquivalent(data, '2026-10-26');
      reconcileHabit(data.habits[0], '2026-10-26');
      complete(data, '2026-10-26');
      const resumed = validEquivalent(data, '2026-10-26');
      expect(resumed.habits.read.current).toBe(1);
      expect(resumed.awards.at(-1)?.activationId).toBe(data.habits[0].periods.at(-1)?.id);
      expect(resumed.awards.at(-1)?.activationId).not.toBe('initial');
    },
  );

  test('successive valid definition changes can repeatedly postpone the next weekly opportunity', () => {
    const data = singleHabit('2026-09-28', [1]);
    complete(data, '2026-09-28');
    for (const date of projectionDates('2026-09-28', '2026-10-08')) {
      const day = parseLocalDate(date).getUTCDay();
      editHabit(
        data,
        'read',
        { goal: `Definition ${date}`, pillarId: 'mind', weekdays: [(day + 2) % 7] },
        now(date),
      );
    }
    validEquivalent(data, '2026-10-09');
    validEquivalent(data, '2026-10-20');
  });

  test.each(['2011-12-28', '2024-02-27', '2025-12-29'])(
    'civil boundaries remain exact from %s',
    (start) => {
      const data = singleHabit(start, [0, 1, 2, 3, 4, 5, 6]);
      const cursor = parseLocalDate(start);
      cursor.setUTCDate(cursor.getUTCDate() + 12);
      const end = civilDate(cursor);
      for (const date of projectionDates(start, end)) complete(data, date);
      expect(validEquivalent(data, end).awards.map(({ date }) => date)).toStrictEqual(
        projectionDates(start, end),
      );
    },
  );

  test.each([0, 1, 2, 3, 4, 5, 6])(
    'bounded sparse mask phase %s retains mixed unchecked facts and implicit misses',
    (phase) => {
      const data = singleHabit('2026-09-28', [phase, (phase + 2) % 7]);
      for (const [index, date] of projectionDates('2026-09-28', '2026-11-30').entries()) {
        if (agenda(data, date).length && index % 5 < 2) complete(data, date, index % 3 !== 0);
      }
      validEquivalent(data, '2026-11-30');
      validEquivalent(data, '2026-12-15');
    },
  );

  test('empty identities and cancelled reactivation preserve complete neutral results', () => {
    const empty = singleHabit();
    empty.habits = [];
    expect(validEquivalent(empty, '2026-10-20').awards).toStrictEqual([]);
    const data = singleHabit('2026-09-28');
    complete(data, '2026-09-28');
    archiveHabit(data, 'read', now('2026-09-30'));
    const archived = validEquivalent(data, '2026-10-20');
    reactivateHabit(data, 'read', now('2026-10-03'));
    validEquivalent(data, '2026-10-03');
    archiveHabit(data, 'read', now('2026-10-04'));
    expect(validEquivalent(data, '2026-10-20')).toStrictEqual(archived);
  });

  test('all-future creations and stored completions retain zero-valued identities without early XP', () => {
    const data = singleHabit('2026-10-20');
    complete(data, '2026-10-20');
    const result = validEquivalent(data, '2026-09-28');
    expect(result.totalXp).toBe(0);
    expect(Object.keys(result.habits)).toStrictEqual(['read']);
    expect(Object.keys(result.pillars)).toStrictEqual(['mind', 'body', 'nutrition', 'hygiene']);
    expect(result.awards).toStrictEqual([]);
  });

  test.each([false, true])(
    'current first-match duplicates and legacy rejection remain distinct (first Done: %s)',
    (done) => {
      const data = singleHabit('2026-09-28');
      complete(data, '2026-09-28', done);
      const original = data.occurrences[0];
      const legacy: LegacyDataset = {
        schemaVersion: 1,
        onboardingComplete: data.onboardingComplete,
        draft: null,
        settings: data.settings,
        pillars: data.pillars,
        permanentUnlocks: data.permanentUnlocks,
        habits: data.habits.map((habit) => ({
          id: habit.id,
          createdOn: habit.createdOn,
          versions: habit.versions.map((version) => ({ ...version, pillarId: 'mind' })),
          periods: habit.periods,
        })),
        occurrences: [original, { ...original, done: !done }],
      };
      data.occurrences.push({ ...original, done: !done });
      expect(equivalent(data, '2026-09-28').totalXp).toBe(done ? 10 : 0);
      // Schema 1 migration rejects duplicates before either reducer, unlike schema 2.
      expect(() => dailyReference(legacy, '2026-09-28')).toThrow('Duplicate habit/date occurrence');
      expect(() => calculateProgress(legacy, '2026-09-28')).toThrow(
        'Duplicate habit/date occurrence',
      );
      expect(() => validateDataset(data)).toThrow(BackupError);
      expect(() => validateDataset(legacy)).toThrow(BackupError);
      legacy.occurrences.pop();
      expect(equivalent(legacy, '2026-09-28').totalXp).toBe(done ? 10 : 0);
    },
  );

  test('the current maximum-date creation rejection is characterized, not repaired', () => {
    const accepted = singleHabit('9999-12-30', [0, 1, 2, 3, 4, 5, 6]);
    validEquivalent(accepted, '9999-12-31');
    const rejected = singleHabit('9999-12-31', [0, 1, 2, 3, 4, 5, 6]);
    expect(() => dailyReference(rejected, '9999-12-31')).toThrow('No valid resumption schedule');
    expect(() => calculateProgress(rejected, '9999-12-31')).toThrow('No valid resumption schedule');
    expect(() => validateDataset(rejected)).toThrow(BackupError);
    try {
      validateDataset(rejected);
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid' });
    }
  });
});

describe('public participation and lazy exception characterization', () => {
  test('malformed in-range public boundaries retain old projections without broadening backup validity', () => {
    const data = singleHabit('2026-09-28');
    complete(data, '2026-09-28');
    data.habits[0].memberships.push({ effectiveFrom: '2026-10-00', pillarId: 'body' });
    equivalent(data, '2026-10-20');
    expect(() => validateDataset(data)).toThrow(BackupError);
  });

  test('unchecked creation and active off-days participate without a completion or requirement', () => {
    const data = singleHabit('2026-09-28', [5]);
    validateDataset(data);
    expect(agenda(data, '2026-09-29')).toStrictEqual([]);
    expect(trackingStart(data, { kind: 'all' })).toBe('2026-09-28');
    expect(trackingStart(data, { kind: 'pillar', id: 'mind' })).toBe('2026-09-28');
    expect(trackingStart(data, { kind: 'pillar', id: 'body' })).toBeUndefined();
    expect(hasEarlierHistory(data, { kind: 'all' }, '2026-09-29')).toBe(true);
    expect(hasEarlierHistory(data, { kind: 'habit', id: 'read' }, '2026-09-29')).toBe(true);
    expect(hasEarlierHistory(data, { kind: 'pillar', id: 'body' }, '2026-10-20')).toBe(false);
    expect(hasEarlierHistory(data, { kind: 'habit', id: 'missing' }, '2026-10-20')).toBe(false);
    expect(hasEarlierHistory(data, { kind: 'all' }, '2026-09-28')).toBe(false);
  });

  test('dated and occurrence-assigned membership preserves both historical starts', () => {
    const data = singleHabit('2026-09-28');
    editHabit(
      data,
      'read',
      { goal: 'Read 10 pages', pillarId: 'body', weekdays: [1, 3, 5] },
      now('2026-09-30'),
    );
    validateDataset(data);
    expect(trackingStart(data, { kind: 'pillar', id: 'mind' })).toBe('2026-09-28');
    expect(trackingStart(data, { kind: 'pillar', id: 'body' })).toBe('2026-09-30');
    expect(hasEarlierHistory(data, { kind: 'pillar', id: 'body' }, '2026-09-30')).toBe(false);
    expect(hasEarlierHistory(data, { kind: 'pillar', id: 'body' }, '2026-10-01')).toBe(true);
  });

  test('invalid future creation is not projected before the requested horizon or early participation', () => {
    const data = singleHabit('2026-09-28');
    const future = singleHabit('9999-12-31', [0, 1, 2, 3, 4, 5, 6]).habits[0];
    future.id = 'future';
    future.periods[0].id = 'future-initial';
    data.habits.push(future);
    // Deliberately unvalidated public input: creation-day schedule lookup throws only if reached.
    equivalent(data, '2026-10-20');
    expect(hasEarlierHistory(data, { kind: 'all' }, '2026-10-20')).toBe(true);
    expect(trackingStart(data, { kind: 'all' })).toBe('2026-09-28');
    expect(trackingStart(data, { kind: 'habit', id: 'future' })).toBe('9999-12-31');
  });

  test('removed historical and late destination pillars keep independent participation starts', () => {
    const data = singleHabit('2026-09-28');
    complete(data, '2026-09-28');
    archiveHabit(data, 'read', now('2026-09-30'));
    data.pillars.find((pillar) => pillar.id === 'mind')!.removedOn = '2026-10-01';
    validateDataset(data);
    expect(trackingStart(data, { kind: 'pillar', id: 'mind' })).toBe('2026-09-28');
    expect(hasEarlierHistory(data, { kind: 'pillar', id: 'mind' }, '2026-10-20')).toBe(true);
    expect(trackingStart(data, { kind: 'habit', id: 'read' })).toBe('2026-09-28');
    validEquivalent(data, '2026-10-20');
    // A distinct future-created identity establishes the previously empty pillar.
    const late = singleHabit('2026-10-20').habits[0];
    late.id = 'late';
    late.periods[0].id = 'late-initial';
    late.memberships[0].pillarId = 'body';
    data.habits.push(late);
    validateDataset(data);
    expect(trackingStart(data, { kind: 'pillar', id: 'body' })).toBe('2026-10-20');
    expect(hasEarlierHistory(data, { kind: 'pillar', id: 'body' }, '2026-10-20')).toBe(false);
    expect(hasEarlierHistory(data, { kind: 'pillar', id: 'body' }, '2026-10-21')).toBe(true);
  });

  test('irrelevant malformed pending move is not newly resolved by public replay or participation', () => {
    const data = singleHabit('2026-09-28');
    data.habits[0].pendingMove = { requestedOn: 'not-a-date', pillarId: 'body' };
    equivalent(data, '2026-10-20');
    expect(hasEarlierHistory(data, { kind: 'all' }, '2026-09-29')).toBe(true);
    expect(trackingStart(data, { kind: 'all' })).toBe('2026-09-28');
  });

  test('malformed tracking horizon still rejects before participation but habit scope stays lazy', () => {
    const data = singleHabit('2026-09-28');
    data.habits[0].pendingReactivation = { periodId: 'invalid', requestedOn: 'not-a-date' };
    expect(() => trackingStart(data, { kind: 'all' })).toThrow('Invalid local date');
    expect(trackingStart(data, { kind: 'habit', id: 'read' })).toBe('2026-09-28');
    expect(hasEarlierHistory(data, { kind: 'all' }, '2026-09-29')).toBe(true);
  });

  test('short-circuited participation does not resolve unreachable malformed later reactivation', () => {
    const data = singleHabit('2026-09-28');
    const habit = data.habits[0];
    habit.periods[0].end = '2026-10-02';
    habit.pendingReactivation = { periodId: 'unreachable', requestedOn: '9999-12-31' };
    expect(hasEarlierHistory(data, { kind: 'all' }, '2026-09-29')).toBe(true);
    expect(trackingStart(data, { kind: 'all' })).toBe('2026-09-28');
    expect(trackingStart(data, { kind: 'habit', id: 'read' })).toBe('2026-09-28');
    expect(hasEarlierHistory(data, { kind: 'all' }, '2026-09-28')).toBe(false);
    // Progress finalization always resolves pending intent, unlike participation's early exit.
    expect(() => dailyReference(data, '2026-09-28')).toThrow();
    expect(() => calculateProgress(data, '2026-09-28')).toThrow();
    expect(() => hasEarlierHistory(data, { kind: 'pillar', id: 'body' }, '2026-10-04')).toThrow();
  });
});
