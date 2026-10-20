import { expect, test } from 'vitest';
import { parseBackup, serializeBackup, validateDataset } from '../../src/data/backup';
import { DEFAULT_PILLARS } from '../../src/domain/types';
import { facts } from '../domain/fixtures';
import {
  archiveHabit,
  editHabit,
  reactivateHabit,
  reconcileHabit,
} from '../../src/domain/lifecycle';
import { agenda } from '../../src/domain/agenda';
import { calculateProgress } from '../../src/domain/progress';
import { migrateDataset } from '../../src/data/migrations';
import { Repository } from '../../src/data/database';
import { seed, stored } from './fixtures';
import { legacyFixture } from './fixtures';

const friday = new Date(2026, 9, 2, 12);
test('optional pillar metadata round-trips exact names, retained defaults and historical progress without schema bump', async () => {
  const data = facts();
  data.pillars = DEFAULT_PILLARS.map((id) => ({ id, name: id, defaultKey: id }));
  archiveHabit(data, 'read', friday);
  data.pillars[0].nameOverride = '  Minha mente 🎵  ';
  data.pillars[0].removedOn = '2026-10-02';
  data.pillars.push({ id: 'custom', name: '  My exact name  ', removedOn: '2026-10-02' });
  const restored = (await parseBackup(serializeBackup(data, friday))).dataset;
  expect(restored).toEqual(data);
  expect(calculateProgress(restored, '2026-10-03')).toEqual(calculateProgress(data, '2026-10-03'));
  const old = facts();
  old.pillars = DEFAULT_PILLARS.map((id) => ({ id, name: id, defaultKey: id }));
  expect((await parseBackup(serializeBackup(old, friday))).dataset).toEqual(old);
  const legacy = legacyFixture();
  legacy.pillars[0].name = '  Legacy name  ';
  expect(migrateDataset(legacy).pillars).toEqual(legacy.pillars);
});

test('removed default and chosen-destination awaiting intent survive replacement and same-day corrections after actual export', async () => {
  const data = facts();
  data.pillars = DEFAULT_PILLARS.map((id) => ({ id, name: id, defaultKey: id }));
  const name = crypto.randomUUID();
  await seed(name, data);
  const repo = new Repository(name);
  await repo.setDone('read', '2026-10-02', true, friday);
  await repo.archiveHabit('read', friday);
  await repo.renamePillar('mind', '  User exact override  ');
  await repo.removePillar('mind', friday);
  const waiting = await repo.reactivateHabitInPillar('read', 'body', friday);
  const candidate = (await parseBackup(serializeBackup(waiting, friday))).dataset;
  expect(candidate).toEqual({ ...waiting, revision: 0 });
  const replaced = await repo.replaceDataset(candidate, waiting.revision, friday);
  expect({ ...replaced, revision: waiting.revision }).toEqual(waiting);
  const undo = await repo.setDone('read', '2026-10-02', false, friday, replaced.revision);
  const redo = await repo.setDone('read', '2026-10-02', true, friday, undo.revision);
  expect(calculateProgress(redo, '2026-10-02')).toEqual(calculateProgress(waiting, '2026-10-02'));
  expect(await stored(name)).toEqual(redo);
  await repo.close();
});

test('restore rejects removal metadata that strands an ongoing routine before replacement', async () => {
  const data = facts();
  data.pillars = DEFAULT_PILLARS.map((id) => ({ id, name: id, defaultKey: id }));
  data.pillars[0].removedOn = '2026-10-02';
  // Keep parsing independent of export validation: this is an untrusted file.
  const blob = new Blob([
    JSON.stringify({
      format: 'my-goat-journey-backup',
      formatVersion: 1,
      exportedAt: '2026-10-02T12:00:00.000Z',
      dataset: data,
    }),
  ]);
  await expect(parseBackup(blob)).rejects.toMatchObject({ code: 'invalid' });
});

test.each([
  'future-created',
  'later-archive',
  'awaiting',
  'future-reactivation',
  'pending-target',
  'old-pending-target',
] as const)('backup rejects %s occupancy at the stored removal date', (scenario) => {
  const data = facts();
  data.pillars = DEFAULT_PILLARS.map((id) => ({ id, name: id, defaultKey: id }));
  const h = data.habits[0];
  let target = 'mind';
  if (scenario === 'future-created') {
    h.createdOn = '2026-10-05';
    h.versions[0].effectiveFrom = h.createdOn;
    h.memberships[0].effectiveFrom = h.createdOn;
    h.periods[0].start = h.createdOn;
  }
  if (scenario === 'later-archive') archiveHabit(data, 'read', new Date(2026, 9, 5, 12));
  if (scenario === 'awaiting') {
    archiveHabit(data, 'read', new Date(2026, 9, 1, 12));
    reactivateHabit(data, 'read', new Date(2026, 9, 1, 12));
  }
  if (scenario === 'future-reactivation') {
    archiveHabit(data, 'read', friday);
    reactivateHabit(data, 'read', new Date(2026, 9, 3, 12));
    reconcileHabit(data.habits[0], '2026-10-05');
    expect(data.habits[0].pendingReactivation).toBeUndefined();
    expect(data.habits[0].periods.at(-1)?.start).toBe('2026-10-05');
  }
  if (scenario === 'pending-target' || scenario === 'old-pending-target') {
    editHabit(
      data,
      'read',
      { pillarId: 'body', goal: 'Read 10 pages', weekdays: [1, 3, 5] },
      friday,
    );
    target = 'body';
    if (scenario === 'old-pending-target') {
      // The pending target is independently occupied even if the latest membership differs.
      data.habits[0].memberships.push({ effectiveFrom: '2026-10-07', pillarId: 'nutrition' });
    }
  }
  expect(validateDataset(data)).toEqual(data);
  data.pillars.find((p) => p.id === target)!.removedOn = '2026-10-02';
  expect(() => validateDataset(data)).toThrow('Invalid or unsupported backup');
  expect(() => serializeBackup(data, friday)).toThrow('Invalid or unsupported backup');
});

test.each([new Date(2026, 8, 30, 12), new Date(2026, 9, 9, 12)])(
  'archived removal remains portable on device date %s',
  async (now) => {
    const data = facts();
    data.pillars = DEFAULT_PILLARS.map((id) => ({ id, name: id, defaultKey: id }));
    archiveHabit(data, 'read', friday);
    data.pillars[0].removedOn = '2026-10-02';
    const candidate = (await parseBackup(serializeBackup(data, now))).dataset;
    const name = crypto.randomUUID();
    await seed(name, data);
    const repo = new Repository(name);
    try {
      const restored = await repo.replaceDataset(candidate, 0, now);
      expect(restored).toEqual({ ...data, revision: 1 });
      expect(await stored(name)).toEqual(restored);
      expect(await repo.load(now)).toEqual(restored);
      expect(agenda(restored, '2026-09-30')[0]).toMatchObject({
        pillarId: 'mind',
        kind: 'required',
      });
      expect(agenda(restored, '2026-10-05')).toEqual([]);
    } finally {
      await repo.close();
    }
  },
);

test.each([false, true])(
  'credited removed source accepts future active destination with reconciled intent %s',
  async (reconcile) => {
    const data = facts();
    data.pillars = DEFAULT_PILLARS.map((id) => ({ id, name: id, defaultKey: id }));
    const name = crypto.randomUUID();
    await seed(name, data);
    const repo = new Repository(name);
    try {
      await repo.setDone('read', '2026-10-02', true, friday);
      await repo.editHabit(
        'read',
        { pillarId: 'body', goal: 'Read 10 pages', weekdays: [1, 3, 5] },
        friday,
      );
      const removed = await repo.removePillar('mind', friday);
      const exported = reconcile ? await repo.load(new Date(2026, 9, 5, 12)) : removed;
      expect(Boolean(exported.habits[0].pendingMove)).toBe(!reconcile);
      expect(exported.habits[0].memberships.at(-1)).toEqual({
        effectiveFrom: '2026-10-05',
        pillarId: 'body',
      });
      const restored = (await parseBackup(serializeBackup(exported, new Date(2026, 8, 30, 12))))
        .dataset;
      expect(restored).toEqual({ ...exported, revision: 0 });
      expect(agenda(restored, '2026-10-02')[0]).toMatchObject({ pillarId: 'mind', done: true });
      expect(agenda(restored, '2026-10-05')[0]).toMatchObject({
        pillarId: 'body',
        kind: 'required',
      });
      expect(calculateProgress(restored, '2026-10-02')).toEqual(
        calculateProgress(removed, '2026-10-02'),
      );
    } finally {
      await repo.close();
    }
  },
);

test.each(['archive-move', 'cancel-reactivation', 'closed-reactivation'] as const)(
  'valid %s export keeps removed references and activation periods',
  async (scenario) => {
    const data = facts();
    data.pillars = DEFAULT_PILLARS.map((id) => ({ id, name: id, defaultKey: id }));
    const name = crypto.randomUUID();
    await seed(name, data);
    const repo = new Repository(name);
    try {
      if (scenario === 'archive-move') {
        await repo.editHabit(
          'read',
          { pillarId: 'body', goal: 'Read 10 pages', weekdays: [1, 3, 5] },
          friday,
        );
        await repo.archiveHabit('read', friday);
        await repo.removePillar('mind', friday);
      } else {
        await repo.archiveHabit('read', friday);
        await repo.removePillar('mind', friday);
        await repo.reactivateHabitInPillar('read', 'body', friday);
        if (scenario === 'closed-reactivation') await repo.load(new Date(2026, 9, 5, 12));
        await repo.archiveHabit(
          'read',
          scenario === 'cancel-reactivation' ? new Date(2026, 9, 3, 12) : new Date(2026, 9, 7, 12),
        );
      }
      const now =
        scenario === 'closed-reactivation' ? new Date(2026, 9, 7, 12) : new Date(2026, 9, 3, 12);
      const removed = await repo.removePillar('body', now);
      expect(removed.habits[0].periods).toHaveLength(scenario === 'closed-reactivation' ? 2 : 1);
      expect(removed.habits[0].pendingReactivation).toBeUndefined();
      if (scenario !== 'closed-reactivation')
        expect(removed.habits[0].pendingMove?.pillarId).toBe('body');
      const restored = (await parseBackup(serializeBackup(removed, now))).dataset;
      expect(restored).toEqual({ ...removed, revision: 0 });
      expect(calculateProgress(restored, '2026-10-09')).toEqual(
        calculateProgress(removed, '2026-10-09'),
      );
      expect(await stored(name)).toEqual(removed);
    } finally {
      await repo.close();
    }
  },
);

test.each([undefined, null, 42, '', '  '])(
  'backup rejects malformed default override %j',
  (nameOverride) => {
    const data = facts();
    data.pillars = DEFAULT_PILLARS.map((id) => ({ id, name: id, defaultKey: id }));
    expect(() =>
      validateDataset({
        ...data,
        pillars: [{ ...data.pillars[0], nameOverride }, ...data.pillars.slice(1)],
      }),
    ).toThrow();
  },
);
test.each([undefined, null, '2026-02-30', '2026-9-2', 42])(
  'backup rejects malformed removal date %j',
  (removedOn) => {
    const data = facts();
    data.pillars = DEFAULT_PILLARS.map((id) => ({ id, name: id, defaultKey: id }));
    expect(() =>
      validateDataset({
        ...data,
        pillars: [{ ...data.pillars[0], removedOn }, ...data.pillars.slice(1)],
      }),
    ).toThrow();
  },
);
