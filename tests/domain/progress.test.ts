import { describe, test, expect } from 'vitest';
import { calculateProgress, MILESTONES } from '../../src/domain/progress';
import type { LegacyDataset, LegacyHabit, OccurrenceSnapshot } from '../../src/domain/types';
import { civilDate, parseLocalDate } from '../../src/domain/calendar';
import { facts } from './fixtures';

describe('current-schema progression', () => {
  test('a pending scheduled day preserves the run before its first milestone across neutral days', () => {
    const data = facts();
    for (const date of ['2026-09-28', '2026-09-30']) {
      data.occurrences.push({
        habitId: 'read',
        date,
        goal: 'Read 10 pages',
        pillarId: 'mind',
        kind: 'required',
        done: true,
        activationId: 'initial',
        pillarParticipation: 'required',
        completionProvenance: 'credited',
        assignmentLocked: true,
        recordedAt: `${date}T12:00:00.000Z`,
        timezone: 'UTC',
        offsetMinutes: 0,
      });
    }
    const beforePending = structuredClone(data);
    expect(calculateProgress(data, '2026-10-02')).toMatchObject({
      habits: {
        read: {
          current: 2,
          best: 2,
          xp: 20,
          nextBonus: { threshold: 3, bonusXp: 10, remaining: 1 },
        },
      },
      pillars: { mind: { current: 2, best: 2 } },
      overall: { current: 2, best: 2 },
      totalXp: 20,
    });
    expect(data).toEqual(beforePending);

    data.occurrences.push({
      ...data.occurrences[0],
      date: '2026-10-02',
      recordedAt: '2026-10-02T12:00:00.000Z',
    });
    const beforeComplete = structuredClone(data);
    const complete = calculateProgress(data, '2026-10-02');
    expect(complete).toMatchObject({
      habits: {
        read: {
          current: 3,
          best: 3,
          xp: 40,
          nextBonus: { threshold: 7, bonusXp: 30, remaining: 4 },
        },
      },
      pillars: { mind: { current: 3, best: 3 } },
      overall: { current: 3, best: 3 },
      totalXp: 40,
    });
    expect(complete.awards).toEqual(
      ['2026-09-28', '2026-09-30', '2026-10-02'].map((date, index) => ({
        habitId: 'read',
        date,
        activationId: 'initial',
        sequenceId: 'initial:2026-09-28',
        streak: index + 1,
        baseXp: 10,
        bonusXp: index === 2 ? 10 : 0,
      })),
    );
    expect(calculateProgress(data, '2026-10-02')).toEqual(complete);
    expect(data).toEqual(beforeComplete);
  });
});

describe('legacy schema-1 progression compatibility', () => {
  const created = '2026-09-28';

  function legacyHabit(
    id = 'walk',
    pillarId = 'body',
    weekdays = [0, 1, 2, 3, 4, 5, 6],
  ): LegacyHabit {
    return {
      id,
      createdOn: created,
      versions: [{ effectiveFrom: created, goal: 'Complete my walk', pillarId, weekdays }],
      periods: [{ id: `${id}-activation`, start: created }],
    };
  }

  function legacyCompletion(
    habitId: string,
    date: string,
    pillarId = 'body',
    done = true,
  ): OccurrenceSnapshot {
    return {
      habitId,
      date,
      pillarId,
      goal: 'Complete my walk',
      kind: date === created ? 'optional' : 'required',
      done,
      recordedAt: `${date}T12:00:00.000Z`,
      timezone: 'UTC',
      offsetMinutes: 0,
    };
  }

  function legacyDataset(
    habits = [legacyHabit()],
    occurrences: OccurrenceSnapshot[] = [],
  ): LegacyDataset {
    return {
      schemaVersion: 1,
      onboardingComplete: true,
      draft: null,
      settings: { language: 'en', reducedMotion: false },
      pillars: [
        { id: 'body', name: 'Body', defaultKey: 'body' },
        { id: 'mind', name: 'Mind', defaultKey: 'mind' },
        { id: 'music', name: 'Music' },
      ],
      habits,
      occurrences,
      permanentUnlocks: [],
    };
  }

  function dateAfter(days: number): string {
    const date = parseLocalDate(created);
    date.setUTCDate(date.getUTCDate() + days);
    return civilDate(date);
  }

  test('a closed required miss breaks the run without revoking past XP; today pending preserves it', () => {
    const data = legacyDataset(
      [legacyHabit()],
      [legacyCompletion('walk', created), legacyCompletion('walk', dateAfter(2))],
    );
    const pending = calculateProgress(
      legacyDataset([legacyHabit()], [legacyCompletion('walk', created)]),
      dateAfter(1),
    );
    expect(pending.habits.walk.current).toBe(1);
    expect(pending.pillars.body.current).toBe(1);
    const afterMiss = calculateProgress(data, dateAfter(2));
    expect(afterMiss.habits.walk.current).toBe(1);
    expect(afterMiss.habits.walk.best).toBe(1);
    expect(afterMiss.habits.walk.xp).toBe(2 * 10);
    expect(afterMiss.pillars.body.current).toBe(1);
    expect(afterMiss.awards.map((a) => a.streak)).toEqual([1, 1]);
    expect(new Set(afterMiss.awards.map((a) => a.sequenceId)).size).toBe(2);
  });

  test('separate activation periods start new habit sequences while preserving best, XP and pillar continuity', () => {
    const restored = legacyHabit();
    restored.periods = [
      { id: 'first-period', start: created, end: dateAfter(2) },
      { id: 'second-period', start: dateAfter(5) },
    ];
    const data = legacyDataset(
      [restored],
      [0, 1, 2, 5, 6, 7].map((i) => legacyCompletion('walk', dateAfter(i))),
    );
    const result = calculateProgress(data, dateAfter(7));
    expect(result.habits.walk.current).toBe(3);
    expect(result.habits.walk.best).toBe(3);
    expect(result.totalXp).toBe(6 * 10 + 2 * 10);
    expect(result.awards.filter((a) => a.bonusXp === 10)).toHaveLength(2);
    expect(new Set(result.awards.map((a) => a.sequenceId)).size).toBe(2);
    expect(result.pillars.body.current).toBe(6);
  });

  test('all required habits control one pillar step; optional additions do not block or inflate required credit', () => {
    const second = legacyHabit('workout');
    const added = legacyHabit('stretch');
    added.createdOn = dateAfter(1);
    added.versions[0].effectiveFrom = dateAfter(1);
    added.periods[0].start = dateAfter(1);
    const data = legacyDataset(
      [legacyHabit(), second, added],
      [
        legacyCompletion('walk', created),
        legacyCompletion('workout', created),
        legacyCompletion('walk', dateAfter(1)),
      ],
    );
    const partial = calculateProgress(data, dateAfter(1));
    expect(partial.pillars.body).toEqual({ current: 1, best: 1 });
    expect(partial.habits.walk.current).toBe(2);
    expect(partial.habits.workout.current).toBe(1);
    const complete = structuredClone(data);
    complete.occurrences.push(legacyCompletion('workout', dateAfter(1)));
    expect(calculateProgress(complete, dateAfter(1)).pillars.body.current).toBe(2);
    const withOptional = structuredClone(complete);
    withOptional.occurrences.push({
      ...legacyCompletion('stretch', dateAfter(1)),
      kind: 'optional',
    });
    expect(calculateProgress(withOptional, dateAfter(1)).pillars.body.current).toBe(2);
    expect(calculateProgress(data, dateAfter(2)).pillars.body).toEqual({ current: 0, best: 1 });
  });

  test('unscheduled days preserve actual records and streaks without advancing them across the week boundary', () => {
    const sparse = legacyHabit('walk', 'body', [1, 2, 3]);
    const data = legacyDataset(
      [sparse],
      [0, 1, 2].map((i) => legacyCompletion('walk', dateAfter(i))),
    );
    expect(calculateProgress(data, dateAfter(6)).habits.walk.current).toBe(3);
    expect(calculateProgress(data, dateAfter(6)).pillars.body).toEqual({ current: 3, best: 3 });
    data.occurrences.push(legacyCompletion('walk', dateAfter(7)));
    expect(calculateProgress(data, dateAfter(7)).habits.walk.current).toBe(4);
    expect(calculateProgress(data, dateAfter(8)).habits.walk.current).toBe(4);
    expect(calculateProgress(data, dateAfter(9)).habits.walk).toMatchObject({
      current: 0,
      best: 4,
    });
    expect(calculateProgress(data, dateAfter(9)).totalXp).toBe(4 * 10 + 10);
  });

  test('historical fact correction reconciles XP 40 to 20 to 40 without minting another milestone or revoking cosmetics', () => {
    const data = legacyDataset(
      [legacyHabit('walk', 'body', [1, 3, 5])],
      [0, 2, 4].map((i) => legacyCompletion('walk', dateAfter(i))),
    );
    data.permanentUnlocks.push({ id: 'previously-owned-item', unlockedAt: '2026-09-30T12:00:00Z' });
    const before = structuredClone(data);
    const first = calculateProgress(data, dateAfter(4));
    expect(first.totalXp).toBe(40);
    expect(first.habits.walk).toMatchObject({
      current: 3,
      best: 3,
      nextBonus: { threshold: 7, bonusXp: 30, remaining: 4 },
    });
    data.occurrences[1].done = false;
    expect(calculateProgress(data, dateAfter(4))).toMatchObject({
      totalXp: 20,
      habits: { walk: { current: 1, best: 1 } },
    });
    data.occurrences[1].done = true;
    for (let repeat = 0; repeat < 10; repeat++)
      expect(calculateProgress(data, dateAfter(4))).toEqual(first);
    expect(data).toEqual(before);
  });

  test('the exact published bonus table applies through 365 and base XP continues beyond it with no invented next target', () => {
    expect(MILESTONES.map((m) => [m.threshold, m.bonusXp])).toEqual([
      [3, 10],
      [7, 30],
      [14, 60],
      [30, 100],
      [45, 150],
      [60, 200],
      [70, 250],
      [80, 300],
      [90, 350],
      [100, 400],
      [125, 500],
      [150, 600],
      [175, 700],
      [200, 800],
      [250, 1000],
      [300, 1200],
      [365, 1500],
    ]);
    const data = legacyDataset(
      [legacyHabit()],
      Array.from({ length: 400 }, (_, i) => legacyCompletion('walk', dateAfter(i))),
    );
    const result = calculateProgress(data, dateAfter(399));
    expect(result.habits.walk).toMatchObject({ current: 400, best: 400, nextBonus: null });
    expect(result.totalXp).toBe(400 * 10 + MILESTONES.reduce((sum, m) => sum + m.bonusXp, 0));
    expect(result.awards.filter((a) => a.bonusXp)).toHaveLength(MILESTONES.length);
    expect(result.awards.filter((a) => a.streak > 365).every((a) => a.bonusXp === 0)).toBe(true);
  });

  test('unchecked optional creation is neutral and extra unscheduled completion facts never add XP', () => {
    const data = legacyDataset(
      [legacyHabit('walk', 'body', [1])],
      [legacyCompletion('walk', dateAfter(1))],
    );
    const result = calculateProgress(data, dateAfter(1));
    expect(result.totalXp).toBe(0);
    expect(result.habits.walk).toMatchObject({ current: 0, best: 0 });
    expect(result.pillars.body).toEqual({ current: 0, best: 0 });
  });

  test('effective dated schedules and original credited membership are used, not just the current version', () => {
    const changed = legacyHabit('walk', 'body', [1]);
    changed.versions.push({
      effectiveFrom: dateAfter(2),
      goal: 'Updated goal',
      pillarId: 'music',
      weekdays: [3, 5],
    });
    const data = legacyDataset(
      [changed],
      [
        legacyCompletion('walk', created),
        legacyCompletion('walk', dateAfter(2), 'body'),
        legacyCompletion('walk', dateAfter(4), 'music'),
      ],
    );
    const result = calculateProgress(data, dateAfter(4));
    expect(result.totalXp).toBe(40);
    expect(result.habits.walk.current).toBe(3);
    expect(result.pillars.body).toEqual({ current: 2, best: 2 });
    expect(result.pillars.music).toEqual({ current: 1, best: 1 });
  });

  test('a genuine missed commitment permits the same milestone bonus in a later run but retries do not', () => {
    const data = legacyDataset(
      [legacyHabit()],
      [0, 1, 2, 4, 5, 6].map((i) => legacyCompletion('walk', dateAfter(i))),
    );
    const result = calculateProgress(data, dateAfter(6));
    expect(result.habits.walk).toMatchObject({ current: 3, best: 3, xp: 6 * 10 + 2 * 10 });
    expect(result.awards.filter((a) => a.bonusXp === 10)).toHaveLength(2);
    expect(new Set(result.awards.map((a) => a.sequenceId)).size).toBe(2);
    expect(new Set(result.awards.map((a) => `${a.habitId}:${a.date}`)).size).toBe(6);
    expect(calculateProgress(structuredClone(data), dateAfter(6))).toEqual(result);
  });

  test('a closed incomplete overall agenda resets only overall and the unsuccessful pillar, not successful habits', () => {
    const data = legacyDataset(
      [legacyHabit(), legacyHabit('play', 'music')],
      [
        legacyCompletion('walk', created),
        legacyCompletion('play', created, 'music'),
        legacyCompletion('walk', dateAfter(1)),
      ],
    );
    expect(calculateProgress(data, dateAfter(1)).overall).toEqual({ current: 1, best: 1 });
    const closed = calculateProgress(data, dateAfter(2));
    expect(closed.overall).toEqual({ current: 0, best: 1 });
    expect(closed.pillars.body).toEqual({ current: 2, best: 2 });
    expect(closed.habits.walk).toMatchObject({ current: 2, best: 2 });
    expect(closed.pillars.music).toEqual({ current: 0, best: 1 });
    expect(closed.totalXp).toBe(30);
  });

  test('overall neutral days preserve the run across a week boundary without granting credit', () => {
    expect(calculateProgress(legacyDataset([]), created).overall).toEqual({ current: 0, best: 0 });
    const data = legacyDataset(
      [legacyHabit('walk', 'body', [1, 2, 3])],
      [0, 1, 2].map((i) => legacyCompletion('walk', dateAfter(i))),
    );
    expect(calculateProgress(data, dateAfter(6)).overall).toEqual({ current: 3, best: 3 });
    data.occurrences.push(legacyCompletion('walk', dateAfter(7)));
    expect(calculateProgress(data, dateAfter(7)).overall).toEqual({ current: 4, best: 4 });
  });

  test('optional-only overall participation is neutral unchecked and advances once when completed', () => {
    const data = legacyDataset([
      legacyHabit('walk', 'body', [5]),
      legacyHabit('play', 'music', [5]),
    ]);
    expect(calculateProgress(data, dateAfter(1)).overall).toEqual({ current: 0, best: 0 });
    data.occurrences.push(legacyCompletion('walk', created));
    expect(calculateProgress(data, dateAfter(1)).overall).toEqual({ current: 1, best: 1 });
    data.occurrences.push(legacyCompletion('play', created, 'music'));
    expect(calculateProgress(data, dateAfter(1)).overall).toEqual({ current: 1, best: 1 });
    data.occurrences[0].done = false;
    data.occurrences[1].done = false;
    expect(calculateProgress(data, dateAfter(1)).overall).toEqual({ current: 0, best: 0 });
  });

  test('an unchecked optional addition cannot block overall required credit and a correction reconciles best', () => {
    const added = legacyHabit('play', 'music');
    added.createdOn = dateAfter(2);
    added.versions[0].effectiveFrom = dateAfter(2);
    added.periods[0].start = dateAfter(2);
    const data = legacyDataset(
      [legacyHabit(), added],
      [0, 1, 2].map((i) => legacyCompletion('walk', dateAfter(i))),
    );
    const before = structuredClone(data);
    expect(calculateProgress(data, dateAfter(2)).overall).toEqual({ current: 3, best: 3 });
    expect(data).toEqual(before);
    data.occurrences[1].done = false;
    expect(calculateProgress(data, dateAfter(2)).overall).toEqual({ current: 1, best: 1 });
    data.occurrences[1].done = true;
    expect(calculateProgress(data, dateAfter(2)).overall).toEqual({ current: 3, best: 3 });
  });

  test('overall uses effective schedules and preserves continuity across archived activation gaps', () => {
    const changed = legacyHabit('walk', 'body', [1]);
    changed.versions.push({
      effectiveFrom: dateAfter(2),
      goal: 'Updated goal',
      pillarId: 'music',
      weekdays: [3, 5],
    });
    changed.periods = [
      { id: 'first', start: created, end: dateAfter(2) },
      { id: 'second', start: dateAfter(9) },
    ];
    const data = legacyDataset(
      [changed],
      [0, 2, 9].map((i) => legacyCompletion('walk', dateAfter(i), i ? 'music' : 'body')),
    );
    expect(calculateProgress(data, dateAfter(9)).overall).toEqual({ current: 3, best: 3 });
    expect(calculateProgress(data, dateAfter(9)).habits.walk.current).toBe(1);
  });

  test.each([0, 1, 9, 10, 11, 20])(
    'level and next-level progress derive from %i existing base awards',
    (count) => {
      const habits = Array.from({ length: count }, (_, i) => legacyHabit(`goal-${i}`));
      const data = legacyDataset(
        habits,
        habits.map((h) => legacyCompletion(h.id, created)),
      );
      const result = calculateProgress(data, created);
      const total = count * 10;
      expect(result.totalXp).toBe(total);
      expect(result.level).toBe(1 + Math.floor(total / 100));
      expect(result.levelProgress).toEqual({
        earnedXp: total % 100,
        requiredXp: 100,
        remainingXp: 100 - (total % 100),
        nextLevel: 2 + Math.floor(total / 100),
      });
    },
  );

  test('late milestone bonuses can cross several levels using reconciled XP rather than one level per completion', () => {
    const data = legacyDataset(
      [legacyHabit()],
      Array.from({ length: 365 }, (_, i) => legacyCompletion('walk', dateAfter(i))),
    );
    expect(calculateProgress(data, dateAfter(363))).toMatchObject({
      totalXp: 10290,
      level: 103,
      levelProgress: { earnedXp: 90, requiredXp: 100, remainingXp: 10, nextLevel: 104 },
    });
    expect(calculateProgress(data, dateAfter(364))).toMatchObject({
      totalXp: 11800,
      level: 119,
      levelProgress: { earnedXp: 0, requiredXp: 100, remainingXp: 100, nextLevel: 120 },
    });
    const archived = structuredClone(data);
    archived.habits[0].periods[0].end = dateAfter(364);
    expect(calculateProgress(archived, dateAfter(367))).toEqual(
      calculateProgress(data, dateAfter(364)),
    );
  });

  test('overall streak counts one complete agenda day across default and custom pillars without extra XP', () => {
    const data = legacyDataset(
      [legacyHabit(), legacyHabit('read', 'mind'), legacyHabit('play', 'music')],
      ['walk', 'read', 'play'].flatMap((id, index) =>
        [0, 1].map((i) => legacyCompletion(id, dateAfter(i), ['body', 'mind', 'music'][index])),
      ),
    );
    const result = calculateProgress(data, dateAfter(1));
    expect(result.overall).toEqual({ current: 2, best: 2 });
    expect(result.totalXp).toBe(60);
    expect(result.awards).toHaveLength(6);
  });

  test('completed optional creation day derives immediate real habit/pillar credit and base XP', () => {
    const data = legacyDataset([legacyHabit()], [legacyCompletion('walk', created)]);
    const result = calculateProgress(data, created);
    expect(result.habits.walk).toEqual({
      current: 1,
      best: 1,
      xp: 10,
      nextBonus: { threshold: 3, bonusXp: 10, remaining: 2 },
    });
    expect(result.pillars.body).toEqual({ current: 1, best: 1 });
    expect(result.pillars.music).toEqual({ current: 0, best: 0 });
    expect(result.totalXp).toBe(10);
    expect(result.awards).toHaveLength(1);
  });
});
