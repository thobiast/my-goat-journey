import { expect, test } from 'vitest';
import { Repository } from '../../src/data/database';
import { calculateProgress } from '../../src/domain/progress';

const created = '2026-09-28';
const grantedAt = new Date('2026-09-30T12:00:00.000Z');

// Conditions below belong only to tests, not to a production cosmetic catalog.
const testMilestoneId = 'test:habit-streak-3';
const testLevelId = 'test:level-2';

async function startedRepository(fail?: () => boolean) {
  const repository = new Repository(crypto.randomUUID(), fail);
  await repository.saveDraft({
    step: 5,
    goals: ['mind', 'body', 'nutrition', 'hygiene'].map((pillarId) => ({
      pillarId,
      goal: `My ${pillarId} goal`,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
    })),
  });
  const data = await repository.finalize(created);
  return { repository, id: data.habits.find((h) => h.memberships[0].pillarId === 'body')!.id };
}

function now(day: number) {
  return new Date(2026, 8, 28 + day, 12);
}

function date(day: number) {
  const value = now(day);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

async function grantTestConditions(repository: Repository, habitId: string, day: number) {
  const progress = calculateProgress(await repository.load(), date(day));
  if (progress.habits[habitId].current >= 3)
    await repository.grantPermanentUnlock(testMilestoneId, now(day));
  if (progress.level >= 2) await repository.grantPermanentUnlock(testLevelId, now(day));
  return repository.load();
}

test('rebuilding an achieved milestone grants repeat XP but never a second owned item or timestamp', async () => {
  const { repository, id } = await startedRepository();
  try {
    expect((await grantTestConditions(repository, id, 0)).permanentUnlocks).toEqual([]);
    for (let day = 0; day < 3; day++) await repository.setDone(id, date(day), true, now(day));
    const first = await grantTestConditions(repository, id, 2);
    expect(first.permanentUnlocks).toEqual([
      { id: testMilestoneId, unlockedAt: now(2).toISOString() },
    ]);
    for (let day = 4; day < 7; day++) await repository.setDone(id, date(day), true, now(day));
    const beforeRetry = await repository.load();
    const rebuilt = calculateProgress(beforeRetry, date(6));
    expect(rebuilt.habits[id].current).toBe(3);
    expect(rebuilt.totalXp).toBe(80);
    expect(rebuilt.awards.filter((a) => a.bonusXp === 10)).toHaveLength(2);
    expect(new Set(rebuilt.awards.map((a) => a.sequenceId)).size).toBe(2);
    const repeated = await grantTestConditions(repository, id, 6);
    expect(repeated.permanentUnlocks).toEqual(first.permanentUnlocks);
    expect(calculateProgress(repeated, date(6))).toEqual(rebuilt);
    expect(await repository.load()).toEqual(repeated);
  } finally {
    await repository.close();
  }
});

test('a corrected completion lowers achieved level and XP without revoking either granted test condition', async () => {
  const { repository, id } = await startedRepository();
  try {
    for (let day = 0; day < 7; day++) await repository.setDone(id, date(day), true, now(day));
    const beforeGrant = await repository.load();
    const achieved = calculateProgress(beforeGrant, date(6));
    expect(achieved).toMatchObject({
      totalXp: 110,
      level: 2,
      levelProgress: { earnedXp: 10, remainingXp: 90, nextLevel: 3 },
    });
    expect(beforeGrant.permanentUnlocks).toEqual([]);
    const granted = await grantTestConditions(repository, id, 6);
    expect(granted.permanentUnlocks.map((u) => u.id)).toEqual([testMilestoneId, testLevelId]);
    expect(calculateProgress(granted, date(6))).toEqual(achieved);
    const corrected = await repository.setDone(id, date(6), false, now(6));
    expect(calculateProgress(corrected, date(6))).toMatchObject({
      totalXp: 70,
      level: 1,
      levelProgress: { earnedXp: 70, requiredXp: 100, remainingXp: 30, nextLevel: 2 },
    });
    expect(corrected.permanentUnlocks).toEqual(granted.permanentUnlocks);
    expect(corrected.occurrences).toHaveLength(7);
    await repository.close();
    const reopened = new Repository(repository.name);
    try {
      expect(await reopened.load()).toEqual(corrected);
      expect((await grantTestConditions(reopened, id, 6)).permanentUnlocks).toEqual(
        granted.permanentUnlocks,
      );
      await reopened.setDone(id, date(6), true, now(6));
      const restored = await grantTestConditions(reopened, id, 6);
      expect(calculateProgress(restored, date(6))).toEqual(achieved);
      expect(restored.permanentUnlocks).toEqual(granted.permanentUnlocks);
      expect(restored.occurrences).toHaveLength(7);
    } finally {
      await reopened.close();
    }
  } finally {
    await repository.close();
  }
});

test('concurrent ownership and completion writes serialize across repositories without duplicate items or lost facts', async () => {
  const { repository, id } = await startedRepository();
  const peer = new Repository(repository.name);
  try {
    for (let day = 0; day < 7; day++) await repository.setDone(id, date(day), true, now(day));
    const before = await peer.load();
    expect(calculateProgress(before, date(6))).toMatchObject({
      totalXp: 110,
      level: 2,
      habits: { [id]: { current: 7 } },
    });
    const other = before.habits.find((h) => h.id !== id)!;
    const grants = await Promise.all([
      ...Array.from({ length: 12 }, (_, i) =>
        (i % 2 ? peer : repository).grantPermanentUnlock(
          testMilestoneId,
          new Date(now(6).getTime() + i),
        ),
      ),
      peer.grantPermanentUnlock(testLevelId, now(6)),
      repository.setDone(other.id, date(6), true, now(6)),
    ]);
    const persisted = await peer.load();
    const item = persisted.permanentUnlocks.find((u) => u.id === testMilestoneId);
    expect(item).toBeDefined();
    expect(
      grants
        .slice(0, 12)
        .every(
          (data) =>
            data.permanentUnlocks.find((u) => u.id === testMilestoneId)?.unlockedAt ===
            item!.unlockedAt,
        ),
    ).toBe(true);
    expect(persisted.permanentUnlocks).toHaveLength(2);
    expect(new Set(persisted.permanentUnlocks.map((u) => u.id))).toEqual(
      new Set([testMilestoneId, testLevelId]),
    );
    expect(persisted.occurrences).toHaveLength(8);
    expect(calculateProgress(persisted, date(6)).totalXp).toBe(120);
    expect(await repository.load()).toEqual(persisted);
  } finally {
    await Promise.all([repository.close(), peer.close()]);
  }
});

test('an aborted grant preserves the entire prior dataset and a retry commits ownership once', async () => {
  let fail = false;
  const { repository, id } = await startedRepository(() => fail);
  try {
    for (let day = 0; day < 7; day++) await repository.setDone(id, date(day), true, now(day));
    await repository.grantPermanentUnlock(testMilestoneId, now(2));
    const before = await repository.load();
    expect(calculateProgress(before, date(6)).level).toBe(2);
    fail = true;
    await expect(repository.grantPermanentUnlock(testLevelId, now(6))).rejects.toThrow(
      'Persistence failed',
    );
    expect(await repository.load()).toEqual(before);
    fail = false;
    await repository.close();
    const reopened = new Repository(repository.name);
    try {
      expect(await reopened.load()).toEqual(before);
      const successful = await reopened.grantPermanentUnlock(testLevelId, now(6));
      expect(successful.permanentUnlocks).toEqual([
        ...before.permanentUnlocks,
        { id: testLevelId, unlockedAt: now(6).toISOString() },
      ]);
      expect({
        ...successful,
        revision: before.revision,
        permanentUnlocks: before.permanentUnlocks,
      }).toEqual(before);
      expect(successful.revision).toBe(before.revision + 1);
      expect(await reopened.grantPermanentUnlock(testLevelId, now(7))).toEqual(successful);
      expect(await reopened.load()).toEqual(successful);
    } finally {
      await reopened.close();
    }
  } finally {
    await repository.close();
  }
});

test('invalid grants abort without corrupting existing ownership or the stored diary', async () => {
  const { repository, id } = await startedRepository();
  try {
    for (let day = 0; day < 3; day++) await repository.setDone(id, date(day), true, now(day));
    const before = await grantTestConditions(repository, id, 2);
    await expect(repository.grantPermanentUnlock('', now(2))).rejects.toThrow('Invalid unlock id');
    await expect(repository.grantPermanentUnlock('  ', now(2))).rejects.toThrow(
      'Invalid unlock id',
    );
    await expect(repository.grantPermanentUnlock(testMilestoneId, new Date(NaN))).rejects.toThrow(
      'Invalid unlock time',
    );
    await expect(repository.grantPermanentUnlock(testLevelId, new Date(NaN))).rejects.toThrow(
      'Invalid unlock time',
    );
    expect(await repository.load()).toEqual(before);
  } finally {
    await repository.close();
  }
});

test('ownership is scoped to one local dataset rather than global unlock identities', async () => {
  const first = new Repository(crypto.randomUUID());
  const second = new Repository(crypto.randomUUID());
  try {
    await first.grantPermanentUnlock('test:dataset-scope', now(0));
    expect((await second.load()).permanentUnlocks).toEqual([]);
    const independentlyOwned = await second.grantPermanentUnlock('test:dataset-scope', now(1));
    expect(independentlyOwned.permanentUnlocks).toEqual([
      { id: 'test:dataset-scope', unlockedAt: now(1).toISOString() },
    ]);
    expect((await first.load()).permanentUnlocks).toEqual([
      { id: 'test:dataset-scope', unlockedAt: now(0).toISOString() },
    ]);
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});

test('granting an actually achieved test-only milestone persists ownership without changing XP or other facts', async () => {
  const { repository, id } = await startedRepository();
  try {
    for (let day = 0; day < 3; day++) await repository.setDone(id, date(day), true, now(day));
    const before = await repository.load();
    const progress = calculateProgress(before, date(2));
    expect(progress.habits[id].current).toBe(3);
    expect(progress.totalXp).toBe(40);
    const granted = await repository.grantPermanentUnlock(testMilestoneId, grantedAt);
    expect(granted.permanentUnlocks).toEqual([
      { id: testMilestoneId, unlockedAt: grantedAt.toISOString() },
    ]);
    expect({ ...granted, revision: before.revision, permanentUnlocks: [] }).toEqual(before);
    expect(granted.revision).toBe(before.revision + 1);
    expect(calculateProgress(granted, date(2))).toEqual(progress);
    expect(await repository.load()).toEqual(granted);
    await repository.close();
    const reopened = new Repository(repository.name);
    try {
      expect(await reopened.load()).toEqual(granted);
    } finally {
      await reopened.close();
    }
  } finally {
    await repository.close();
  }
});
