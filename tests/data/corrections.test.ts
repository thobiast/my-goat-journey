import { expect, test } from 'vitest';
import { Repository } from '../../src/data/database';
import { calculateProgress } from '../../src/domain/progress';
import { seed } from './fixtures';
import { facts } from '../domain/fixtures';

async function setup() {
  let fail = false;
  const repo = new Repository(crypto.randomUUID(), () => fail);
  await repo.saveDraft({
    step: 5,
    goals: ['mind', 'body', 'nutrition', 'hygiene'].map((pillarId) => ({
      pillarId,
      goal: `My ${pillarId} goal`,
      weekdays: [1, 3, 5],
    })),
  });
  const data = await repo.finalize('2026-09-27');
  return {
    repo,
    id: data.habits[0].id,
    setFail: (value: boolean) => {
      fail = value;
    },
  };
}

const friday = new Date(2026, 9, 2, 18, 30);
test('previous-date correction recomputes exact 40 -> 20 -> 40 with one stable row and retained ownership', async () => {
  const { repo, id, setFail } = await setup();
  await repo.grantPermanentUnlock('owned', friday);
  await repo.setDone(id, '2026-09-28', true, new Date(2026, 8, 28, 12));
  await repo.setDone(id, '2026-09-30', true, new Date(2026, 8, 30, 12));
  const before = await repo.setDone(id, '2026-10-02', true, friday);
  const initial = calculateProgress(before, '2026-10-02');
  expect(initial).toMatchObject({ totalXp: 40, habits: { [id]: { current: 3, best: 3 } } });
  setFail(true);
  await expect(repo.setDone(id, '2026-09-30', false, friday, before.revision)).rejects.toThrow(
    'Persistence failed',
  );
  expect(await repo.load()).toEqual(before);
  setFail(false);
  const undone = await repo.setDone(id, '2026-09-30', false, friday, before.revision);
  expect(calculateProgress(undone, '2026-10-02')).toMatchObject({
    totalXp: 20,
    habits: { [id]: { current: 1, best: 1 } },
    pillars: { mind: { current: 1, best: 1 } },
  });
  expect(undone.occurrences.find((o) => o.date === '2026-09-30')).toMatchObject({
    completionProvenance: 'credited',
    assignmentLocked: true,
    activationId: before.habits[0].periods[0].id,
  });
  const redone = await repo.setDone(id, '2026-09-30', true, friday, undone.revision);
  expect(calculateProgress(redone, '2026-10-02')).toEqual(initial);
  expect(redone.occurrences).toHaveLength(3);
  expect(redone.permanentUnlocks).toEqual(before.permanentUnlocks);
  expect(await new Repository(repo.name).load()).toEqual(redone);
});
test('independent 70 XP remains exact during 110 -> 90 -> 110 level corrections', async () => {
  const { repo, id } = await setup();
  await repo.setDone(id, '2026-09-28', true, new Date(2026, 8, 28, 12));
  await repo.setDone(id, '2026-09-30', true, new Date(2026, 8, 30, 12));
  await repo.setDone(id, '2026-10-02', true, friday);
  for (let i = 0; i < 7; i++) {
    const created = await repo.createHabit(
      { pillarId: 'body', goal: `Independent ${i}`, weekdays: [1] },
      '2026-10-02',
    );
    await repo.setDone(created.habits.at(-1)!.id, '2026-10-02', true, friday);
  }
  const before = await repo.load();
  expect(calculateProgress(before, '2026-10-02')).toMatchObject({ totalXp: 110, level: 2 });
  const undone = await repo.setDone(id, '2026-09-30', false, friday, before.revision);
  expect(calculateProgress(undone, '2026-10-02')).toMatchObject({ totalXp: 90, level: 1 });
  expect(undone.occurrences.filter((o) => o.habitId !== id)).toEqual(
    before.occurrences.filter((o) => o.habitId !== id),
  );
  const restored = await repo.setDone(id, '2026-09-30', true, friday, undone.revision);
  expect(calculateProgress(restored, '2026-10-02')).toEqual(
    calculateProgress(before, '2026-10-02'),
  );
});
test('a first previous correction uses its recorded conditional destination, locks it through Undo/Redo and concurrent retries', async () => {
  const data = facts();
  data.habits[0].memberships.push({ effectiveFrom: '2026-10-02', pillarId: 'body' });
  data.habits[0].versions.push({
    effectiveFrom: '2026-10-02',
    goal: 'Read 20 pages',
    weekdays: [1, 3, 5],
  });
  data.occurrences.push({
    habitId: 'read',
    date: '2026-09-30',
    pillarId: 'body',
    goal: 'Dated goal',
    kind: 'required',
    done: false,
    activationId: 'initial',
    pillarParticipation: 'on-completion',
    completionProvenance: 'never-credited',
    assignmentLocked: false,
    recordedAt: '2026-09-30T12:00:00Z',
    timezone: 'UTC',
    offsetMinutes: 0,
  });
  const name = crypto.randomUUID();
  await seed(name, data);
  const repo = new Repository(name);
  const peer = new Repository(name);
  const first = await repo.setDone('read', '2026-09-30', true, friday, 0);
  expect(first.occurrences[0]).toMatchObject({
    goal: 'Dated goal',
    pillarId: 'body',
    pillarParticipation: 'on-completion',
    completionProvenance: 'credited',
    assignmentLocked: true,
  });
  const undone = await repo.setDone('read', '2026-09-30', false, friday, first.revision);
  expect(undone.occurrences[0]).toMatchObject({
    pillarId: 'body',
    assignmentLocked: true,
    completionProvenance: 'credited',
    done: false,
  });
  await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      (i % 2 ? peer : repo).setDone('read', '2026-09-30', true, friday),
    ),
  );
  const result = await peer.load();
  expect(result.occurrences).toHaveLength(1);
  expect(calculateProgress(result, '2026-10-02').totalXp).toBe(10);
  const before = structuredClone(result);
  for (const date of ['2026-09-28', '2026-10-01', '2026-10-03'])
    await expect(repo.setDone('read', date, true, friday)).rejects.toThrow('No eligible');
  expect(await repo.load()).toEqual(before);
  const saturday = await repo.setDone('read', '2026-10-02', true, new Date(2026, 9, 3, 12));
  expect(saturday.occurrences[1]).toMatchObject({ goal: 'Read 20 pages', pillarId: 'body' });
  await expect(repo.setDone('read', '2026-09-30', true, new Date(2026, 9, 3, 12))).rejects.toThrow(
    'No eligible',
  );
});
