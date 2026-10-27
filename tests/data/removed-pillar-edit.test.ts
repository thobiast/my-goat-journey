import { expect, test } from 'vitest';
import { Repository } from '../../src/data/database';
import { parseBackup, serializeBackup, validateDataset } from '../../src/data/backup';
import { agenda } from '../../src/domain/agenda';
import { editHabit, previewHabitEdit } from '../../src/domain/lifecycle';
import { stored } from './fixtures';

// Explicit device-local noon in each test process's timezone; civil dates stay strings.
const friday = new Date(2026, 9, 2, 12);
const saturday = new Date(2026, 9, 3, 12);
const nextMonday = new Date(2026, 9, 5, 12);
const goal = 'Read fictional field notes';
const weekdays = [1, 3, 5];
const daily = [0, 1, 2, 3, 4, 5, 6];

async function removedSource(removalDate = saturday) {
  const repo = new Repository(`removed-pillar-edit-${crypto.randomUUID()}`);
  await repo.saveDraft({ step: 5, goals: [{ pillarId: 'mind', goal, weekdays }] });
  const created = await repo.finalize('2026-09-28');
  const id = created.habits[0].id;
  await repo.editHabit(id, { pillarId: 'hygiene', goal, weekdays }, friday);
  await repo.editHabit(id, { pillarId: 'mind', goal, weekdays }, saturday);
  await repo.editHabit(id, { pillarId: 'body', goal, weekdays }, saturday);
  await repo.setDone(id, '2026-10-02', true, saturday);
  const before = await repo.removePillar('mind', removalDate);
  return { repo, id, before };
}

async function expectPortable(data: Awaited<ReturnType<Repository['load']>>) {
  expect(validateDataset(data)).toEqual(data);
  // Portable backups intentionally omit the device-local revision.
  const { dataset, exportedAt } = await parseBackup(serializeBackup(data, saturday));
  expect(exportedAt).toBe(saturday.toISOString());
  expect({ ...dataset, revision: data.revision }).toEqual(data);
}

test('historical schedule edit cannot recreate participation in a removed pillar', async () => {
  const { repo, id, before } = await removedSource();
  try {
    await expectPortable(before);
    expect(before.pillars.find((p) => p.id === 'mind')?.removedOn).toBe('2026-10-03');
    expect(agenda(before, '2026-10-03').filter((i) => i.habit.id === id)).toEqual([]);
    expect(agenda(before, '2026-10-02').find((i) => i.habit.id === id)).toMatchObject({
      pillarId: 'hygiene',
      done: true,
    });
    expect(agenda(before, '2026-10-05').find((i) => i.habit.id === id)).toMatchObject({
      pillarId: 'body',
      kind: 'required',
      done: false,
    });
    const input = { pillarId: 'body', goal, weekdays: daily };
    expect(() => previewHabitEdit(before, id, input, friday)).not.toThrow();
    const pure = structuredClone(before);
    await expect(repo.editHabit(id, input, friday, before.revision)).rejects.toMatchObject({
      name: 'DatasetError',
      code: 'historical-conflict',
    });
    expect(() => editHabit(pure, id, input, friday)).toThrow('Historical commitment conflict');
    expect(pure).toEqual(before);
    expect(await stored(repo.name)).toEqual(before);
    await repo.close();
    const reopened = new Repository(repo.name);
    try {
      expect(await reopened.load(friday)).toEqual(before);
      await expectPortable(await reopened.load(friday));
    } finally {
      await reopened.close();
    }
    expect(await stored(repo.name)).toEqual(before);
  } finally {
    await repo.close();
  }
});

test('a rejected edit rolls back unrelated due move and reactivation reconciliation', async () => {
  const { repo, id } = await removedSource();
  const thursday = new Date(2026, 9, 1, 12);
  try {
    const created = await repo.createHabit(
      { pillarId: 'hygiene', goal: 'Fictional stretching notes', weekdays },
      '2026-09-29',
    );
    const otherId = created.habits.at(-1)!.id;
    await repo.archiveHabit(otherId, new Date(2026, 8, 30, 12));
    const before = await repo.reactivateHabitInPillar(otherId, 'body', thursday);
    const other = before.habits.find((h) => h.id === otherId)!;
    expect(other.pendingMove).toBeDefined();
    expect(other.pendingReactivation).toBeDefined();
    expect(other.periods).toHaveLength(1);
    await expectPortable(before);
    await expect(
      repo.editHabit(id, { pillarId: 'body', goal, weekdays: daily }, friday, before.revision),
    ).rejects.toMatchObject({ code: 'historical-conflict' });
    expect(await stored(repo.name)).toEqual(before);
    await repo.close();
    const reopened = new Repository(repo.name);
    try {
      // This read must not itself reconcile the due Friday intents.
      expect(await reopened.load(thursday)).toEqual(before);
      await expectPortable(await reopened.load(thursday));
      expect(await stored(repo.name)).toEqual(before);
      // Positive evidence that the rejected transaction really had reconciliation due.
      const reconciled = await reopened.load(friday);
      expect(reconciled.revision).toBe(before.revision + 1);
      const resumed = reconciled.habits.find((h) => h.id === otherId)!;
      expect(resumed.pendingMove).toBeUndefined();
      expect(resumed.pendingReactivation).toBeUndefined();
      expect(resumed.periods.at(-1)?.start).toBe('2026-10-02');
      await expectPortable(reconciled);
    } finally {
      await reopened.close();
    }
  } finally {
    await repo.close();
  }
});

test.each([
  ['Saturday schedule', { pillarId: 'body', goal, weekdays: [1, 3, 5, 6] }],
  ['membership only', { pillarId: 'hygiene', goal, weekdays }],
])('%s cannot introduce prospective removed-source participation', async (_label, input) => {
  const { repo, id, before } = await removedSource();
  try {
    await expect(repo.editHabit(id, input, friday, before.revision)).rejects.toMatchObject({
      code: 'historical-conflict',
    });
    expect(await stored(repo.name)).toEqual(before);
    await expectPortable(before);
  } finally {
    await repo.close();
  }
});

test.each([
  ['literal goal only', 'body', '  Fictional $& $$ $1 notes  ', weekdays],
  ['Sunday schedule without Saturday', 'body', goal, [0, 1, 3, 5]],
  ['active destination change', 'nutrition', goal, weekdays],
])(
  'permits %s without disturbing Hygiene credit or removed Mind',
  async (_label, pillarId, title, mask) => {
    const { repo, id, before } = await removedSource();
    try {
      const saved = await repo.editHabit(
        id,
        { pillarId, goal: title, weekdays: mask },
        friday,
        before.revision,
      );
      expect(saved.revision).toBe(before.revision + 1);
      expect(saved.occurrences).toEqual(before.occurrences);
      expect(saved.pillars).toEqual(before.pillars);
      expect(agenda(saved, '2026-10-03').filter((i) => i.habit.id === id)).toEqual([]);
      expect(agenda(saved, '2026-10-05').find((i) => i.habit.id === id)?.pillarId).toBe(pillarId);
      expect(saved.habits[0].versions.at(-1)?.goal).toBe(title);
      await expectPortable(saved);
    } finally {
      await repo.close();
    }
  },
);

test.each(['2026-10-04'])(
  'permits participation strictly before the retained %s removal boundary',
  async (removedOn) => {
    const { repo, id, before } = await removedSource(new Date(`${removedOn}T12:00:00`));
    try {
      await expectPortable(before);
      const saved = await repo.editHabit(
        id,
        { pillarId: 'body', goal, weekdays: daily },
        friday,
        before.revision,
      );
      expect(agenda(saved, '2026-10-03').find((i) => i.habit.id === id)).toMatchObject({
        pillarId: 'mind',
        kind: 'required',
        done: false,
      });
      expect(agenda(saved, removedOn).filter((i) => i.pillarId === 'mind')).toEqual([]);
      expect(saved.occurrences).toEqual(before.occurrences);
      await expectPortable(saved);
    } finally {
      await repo.close();
    }
  },
);

test('participation after a revisited Friday removal boundary is still prohibited', async () => {
  const { repo, id, before } = await removedSource(friday);
  try {
    await expectPortable(before);
    await expect(
      repo.editHabit(id, { pillarId: 'body', goal, weekdays: daily }, friday, before.revision),
    ).rejects.toMatchObject({ code: 'historical-conflict' });
    expect(await stored(repo.name)).toEqual(before);
  } finally {
    await repo.close();
  }
});

test('a goal-only edit preserves same-day credit in a removed Hygiene pillar', async () => {
  const { repo, id } = await removedSource();
  try {
    const before = await repo.removePillar('hygiene', friday);
    await expectPortable(before);
    const saved = await repo.editHabit(
      id,
      { pillarId: 'body', goal: '  Revised fictional reading $&  ', weekdays },
      friday,
      before.revision,
    );
    expect(saved.pillars).toEqual(before.pillars);
    expect(saved.occurrences).toEqual(before.occurrences);
    expect(agenda(saved, '2026-10-02').find((i) => i.habit.id === id)).toMatchObject({
      pillarId: 'hygiene',
      done: true,
    });
    await expectPortable(saved);
  } finally {
    await repo.close();
  }
});

test('a current edit after the move is due preserves valid Body participation', async () => {
  const { repo, id, before } = await removedSource();
  try {
    const reconciled = await repo.load(nextMonday);
    const saved = await repo.editHabit(
      id,
      { pillarId: 'body', goal, weekdays: daily },
      nextMonday,
      reconciled.revision,
    );
    expect(saved.occurrences).toEqual(before.occurrences);
    expect(agenda(saved, '2026-10-06').find((i) => i.habit.id === id)).toMatchObject({
      pillarId: 'body',
      kind: 'required',
      done: false,
    });
    await expectPortable(saved);
  } finally {
    await repo.close();
  }
});
