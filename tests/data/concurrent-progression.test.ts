import { expect, test } from 'vitest';
import { Repository } from '../../src/data/database';
import { calculateProgress } from '../../src/domain/progress';

const dates = ['2026-09-28', '2026-09-29', '2026-09-30'];

const now = (day: number) => new Date(2026, 8, 28 + day, 12);

async function twoBodyHabits() {
  const repository = new Repository(`concurrent-progression-${crypto.randomUUID()}`);
  const peer = new Repository(repository.name);
  await repository.saveDraft({
    step: 5,
    goals: ['mind', 'body', 'nutrition', 'hygiene'].map((pillarId) => ({
      pillarId,
      goal: 'Complete my chosen goal',
      weekdays: [1, 2, 3],
    })),
  });
  await repository.finalize(dates[0]);
  const created = await repository.createHabit(
    {
      pillarId: 'body',
      goal: 'Complete my chosen goal',
      weekdays: [1, 2, 3],
    },
    dates[0],
  );
  const ids = created.habits.filter((h) => h.memberships[0].pillarId === 'body').map((h) => h.id);
  for (let day = 0; day < 2; day++) {
    for (const id of ids) await repository.setDone(id, dates[day], true, now(day));
  }
  // Open both connections before the concurrent writes; use no shared browser DB.
  await peer.load();
  return { repository, peer, ids };
}

test('concurrent same-date retries credit identical-goal habits independently once and survive reopening', async () => {
  const { repository, peer, ids } = await twoBodyHabits();
  try {
    await Promise.all(
      ids.flatMap((id) =>
        Array.from({ length: 12 }, (_, retry) =>
          (retry % 2 ? peer : repository).setDone(id, dates[2], true, now(2)),
        ),
      ),
    );
    const persisted = await repository.load();
    expect(persisted.occurrences).toHaveLength(6);
    expect(new Set(persisted.occurrences.map((o) => `${o.habitId}:${o.date}`)).size).toBe(6);
    const progress = calculateProgress(persisted, dates[2]);
    expect(progress).toMatchObject({
      totalXp: 80,
      level: 1,
      pillars: { body: { current: 3, best: 3 } },
    });
    for (const id of ids)
      expect(progress.habits[id]).toMatchObject({ current: 3, best: 3, xp: 40 });
    expect(progress.awards).toHaveLength(6);
    expect(progress.awards.filter((award) => award.bonusXp === 10)).toHaveLength(2);
    await Promise.all([repository.close(), peer.close()]);
    const reopened = new Repository(repository.name);
    try {
      expect(await reopened.load()).toEqual(persisted);
      await Promise.all(ids.map((id) => reopened.setDone(id, dates[2], true, now(2))));
      expect(await reopened.load()).toEqual(persisted);
      expect(calculateProgress(await reopened.load(), dates[2])).toEqual(progress);
    } finally {
      await reopened.close();
    }
  } finally {
    await Promise.all([repository.close(), peer.close()]);
  }
});

test('competing Done and Undo transactions reconcile each committed snapshot without losing the other habit', async () => {
  const { repository, peer, ids } = await twoBodyHabits();
  try {
    for (const id of ids) await repository.setDone(id, dates[2], true, now(2));
    const before = await repository.load();
    const snapshots = await Promise.all([
      repository.setDone(ids[0], dates[2], false, now(2)),
      peer.setDone(ids[0], dates[2], true, now(2)),
      repository.setDone(ids[0], dates[2], false, now(2)),
    ]);
    expect(snapshots.map((data) => calculateProgress(data, dates[2]).totalXp)).toEqual([
      60, 80, 60,
    ]);
    const persisted = await peer.load();
    expect(persisted).toEqual(snapshots[2]);
    expect(persisted.occurrences).toHaveLength(6);
    expect(persisted.occurrences.filter((o) => o.habitId === ids[1])).toEqual(
      before.occurrences.filter((o) => o.habitId === ids[1]),
    );
    const corrected = calculateProgress(persisted, dates[2]);
    expect(corrected.habits[ids[0]]).toMatchObject({ current: 2, best: 2, xp: 20 });
    expect(corrected.habits[ids[1]]).toMatchObject({ current: 3, best: 3, xp: 40 });
    expect(corrected.pillars.body).toEqual({ current: 2, best: 2 });
    expect(corrected.awards.filter((award) => award.bonusXp === 10)).toHaveLength(1);
    await Promise.all([repository.close(), peer.close()]);
    const reopened = new Repository(repository.name);
    try {
      expect(await reopened.load()).toEqual(persisted);
      const restored = await reopened.setDone(ids[0], dates[2], true, now(2));
      expect({ ...restored, revision: before.revision }).toEqual(before);
      expect(restored.revision).toBeGreaterThan(before.revision);
      expect(calculateProgress(await reopened.load(), dates[2]).totalXp).toBe(80);
    } finally {
      await reopened.close();
    }
  } finally {
    await Promise.all([repository.close(), peer.close()]);
  }
});
