import { test, expect } from 'vitest';
import { Repository } from '../../src/data/database';
import { calculateProgress } from '../../src/domain/progress';

const dates = ['2026-09-28', '2026-09-29', '2026-09-30'];

function now(index: number) {
  return new Date(2026, 8, 28 + index, 12);
}

async function startedRepository(fail?: () => boolean) {
  const repository = new Repository(crypto.randomUUID(), fail);
  await repository.saveDraft({
    step: 5,
    goals: ['mind', 'body', 'nutrition', 'hygiene'].map((pillarId) => ({
      pillarId,
      goal: `My ${pillarId} goal`,
      weekdays: [1, 2, 3],
    })),
  });
  const data = await repository.finalize(dates[0]);
  return { repository, id: data.habits.find((h) => h.memberships[0].pillarId === 'body')!.id };
}

test('stored Today Done/Undo/reload reconciles a milestone rather than appending another XP award', async () => {
  const { repository, id } = await startedRepository();
  for (let i = 0; i < dates.length; i++) await repository.setDone(id, dates[i], true, now(i));
  const before = calculateProgress(await repository.load(), dates[2]);
  expect(before.totalXp).toBe(40);
  expect(before.habits[id]).toMatchObject({
    current: 3,
    best: 3,
    xp: 40,
    nextBonus: { threshold: 7, bonusXp: 30, remaining: 4 },
  });
  await repository.close();
  const reopened = new Repository(repository.name);
  expect(calculateProgress(await reopened.load(), dates[2])).toEqual(before);
  const undone = await reopened.setDone(id, dates[2], false, now(2));
  expect(undone.occurrences).toHaveLength(3);
  expect(calculateProgress(undone, dates[2])).toMatchObject({
    totalXp: 20,
    habits: { [id]: { current: 2, best: 2 } },
  });
  for (let retry = 0; retry < 5; retry++) await reopened.setDone(id, dates[2], true, now(2));
  const restored = await reopened.load();
  expect(restored.occurrences).toHaveLength(3);
  expect(calculateProgress(restored, dates[2])).toEqual(before);
  expect(restored.permanentUnlocks).toEqual([]);
  await reopened.close();
});

test('overall progression reconstructs all required pillars after reload and a Today correction', async () => {
  const { repository, id } = await startedRepository();
  try {
    const initial = await repository.load();
    for (let day = 0; day < dates.length; day++) {
      for (const habit of initial.habits)
        await repository.setDone(habit.id, dates[day], true, now(day));
    }
    const completed = await repository.load();
    const before = calculateProgress(completed, dates[2]);
    expect(before).toMatchObject({
      overall: { current: 3, best: 3 },
      totalXp: 160,
      level: 2,
      levelProgress: { earnedXp: 60, requiredXp: 100, remainingXp: 40, nextLevel: 3 },
    });
    expect(before.awards).toHaveLength(12);
    await repository.close();
    const reopened = new Repository(repository.name);
    try {
      expect(calculateProgress(await reopened.load(), dates[2])).toEqual(before);
      const corrected = await reopened.setDone(id, dates[2], false, now(2));
      const pending = calculateProgress(corrected, dates[2]);
      expect(pending).toMatchObject({ overall: { current: 2, best: 2 }, totalXp: 140, level: 2 });
      expect(pending.habits[id].current).toBe(2);
      expect(pending.pillars.mind).toEqual({ current: 3, best: 3 });
      expect(calculateProgress(await reopened.load(), '2026-10-01').overall).toEqual({
        current: 0,
        best: 2,
      });
      expect(corrected.occurrences).toHaveLength(12);
      const restored = await reopened.setDone(id, dates[2], true, now(2));
      expect(calculateProgress(restored, dates[2])).toEqual(before);
      expect(await reopened.load()).toEqual(restored);
    } finally {
      await reopened.close();
    }
  } finally {
    await repository.close();
  }
});

test('aborted persistence never publishes recalculated completion or XP facts', async () => {
  let fail = false;
  const { repository, id } = await startedRepository(() => fail);
  await repository.setDone(id, dates[0], true, now(0));
  await repository.setDone(id, dates[1], true, now(1));
  const before = calculateProgress(await repository.load(), dates[2]);
  fail = true;
  await expect(repository.setDone(id, dates[2], true, now(2))).rejects.toThrow(
    'Persistence failed',
  );
  expect(calculateProgress(await repository.load(), dates[2])).toEqual(before);
  fail = false;
  const successful = await repository.setDone(id, dates[2], true, now(2));
  expect(calculateProgress(successful, dates[2]).totalXp).toBe(40);
  expect(successful.occurrences).toHaveLength(3);
  await repository.close();
});
