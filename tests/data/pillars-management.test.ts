import { expect, test, vi } from 'vitest';
import { Repository } from '../../src/data/database';
import { facts } from '../domain/fixtures';
import { seed, stored } from './fixtures';
import { calculateProgress } from '../../src/domain/progress';
import { DEFAULT_PILLARS } from '../../src/domain/types';
import { agenda, summarize } from '../../src/domain/agenda';

const friday = new Date(2026, 9, 2, 12);

async function setup(data = facts()) {
  const name = crypto.randomUUID();
  await seed(name, data);
  const repo = new Repository(name);
  return { repo, name };
}

test('replacement rejects stranded removal before any write on earlier or later device dates', async () => {
  const data = facts();
  data.pillars = DEFAULT_PILLARS.map((id) => ({ id, name: id, defaultKey: id }));
  const { repo, name } = await setup(data);
  const candidate = structuredClone(data);
  candidate.pillars[0].removedOn = '2026-10-02';
  const writes = vi.spyOn(IDBObjectStore.prototype, 'put');
  try {
    for (const now of [new Date(2026, 8, 30, 12), new Date(2026, 9, 9, 12)]) {
      await expect(repo.replaceDataset(candidate, data.revision, now)).rejects.toMatchObject({
        code: 'invalid',
      });
      expect(await stored(name)).toEqual(data);
    }
    expect(writes).not.toHaveBeenCalled();
  } finally {
    writes.mockRestore();
    await repo.close();
  }
});

test('rename preserves stable identity and every fact outside exact custom name or default override', async () => {
  const data = facts();
  data.pillars[0].defaultKey = 'mind';
  const { repo, name } = await setup(data);
  const renamed = await repo.renamePillar('mind', '  Minha mente 🎵  ', 0);
  expect(renamed).toEqual({
    ...data,
    revision: 1,
    pillars: [{ ...data.pillars[0], nameOverride: '  Minha mente 🎵  ' }, data.pillars[1]],
  });
  expect(calculateProgress(renamed, '2026-10-02')).toEqual(calculateProgress(data, '2026-10-02'));
  const custom = await repo.renamePillar('body', '  Movement  ', renamed.revision);
  expect(custom.pillars[1]).toEqual({ id: 'body', name: '  Movement  ' });
  expect(await stored(name)).toEqual(custom);
  expect(await repo.renamePillar('body', '  Movement  ', custom.revision)).toEqual(custom);
  await expect(repo.renamePillar('body', 'Stale', 0)).rejects.toThrow('Stale dataset revision');
  await expect(repo.renamePillar('body', '  ', custom.revision)).rejects.toThrow(
    'Enter a pillar name',
  );
  await expect(repo.renamePillar('missing', 'Name', custom.revision)).rejects.toThrow(
    'Unknown pillar',
  );
  expect(await stored(name)).toEqual(custom);
  await repo.close();
});

test('removal retains archived failures, rewards and same-day source credit through correction Undo/Redo', async () => {
  const { repo, name } = await setup();
  await repo.setDone('read', '2026-09-30', true, new Date(2026, 8, 30, 12));
  await repo.setDone('read', '2026-10-02', true, friday);
  await repo.grantPermanentUnlock('owned', friday);
  const archived = await repo.archiveHabit('read', friday);
  const progress = calculateProgress(archived, '2026-10-02');
  const historicalAgenda = agenda(archived, '2026-09-28');
  const removed = await repo.removePillar('mind', friday, archived.revision);
  expect(removed).toEqual({
    ...archived,
    revision: archived.revision + 1,
    pillars: [{ ...archived.pillars[0], removedOn: '2026-10-02' }, archived.pillars[1]],
  });
  expect(calculateProgress(removed, '2026-10-02')).toEqual(progress);
  expect(agenda(removed, '2026-09-28')).toEqual(historicalAgenda);
  expect(summarize(agenda(removed, '2026-10-02'), 'pillar')).toMatchObject({
    required: 1,
    requiredDone: 1,
    status: 'complete',
  });
  expect(await repo.removePillar('mind', new Date(2026, 9, 3, 12), removed.revision)).toEqual(
    removed,
  );
  const undo = await repo.setDone('read', '2026-10-02', false, friday, removed.revision);
  expect(summarize(agenda(undo, '2026-10-02'), 'pillar').status).toBe('neutral');
  const redo = await repo.setDone('read', '2026-10-02', true, friday, undo.revision);
  expect(calculateProgress(redo, '2026-10-02')).toEqual(progress);
  expect(redo.occurrences.find((o) => o.date === '2026-10-02')).toMatchObject({
    pillarId: 'mind',
    exempt: true,
    done: true,
  });
  expect(await stored(name)).toEqual(redo);
  const peer = new Repository(name);
  expect(await peer.load(friday)).toEqual(redo);
  await repo.close();
  await peer.close();
});

test.each(['active', 'awaiting', 'future-created', 'pending-move', 'revisited-archive'] as const)(
  'removal blocks %s prospective membership without altering stored facts',
  async (scenario) => {
    const data = facts();
    let target = 'mind';
    if (scenario === 'future-created') {
      const h = data.habits[0];
      h.createdOn = '2026-10-05';
      h.versions[0].effectiveFrom = h.createdOn;
      h.memberships[0].effectiveFrom = h.createdOn;
      h.periods[0].start = h.createdOn;
    }
    const { repo, name } = await setup(data);
    if (scenario === 'awaiting') {
      await repo.archiveHabit('read', friday);
      await repo.reactivateHabit('read', friday);
    }
    if (scenario === 'pending-move') {
      await repo.editHabit(
        'read',
        { pillarId: 'body', goal: 'Read 10 pages', weekdays: [1, 3, 5] },
        friday,
      );
      target = 'body';
    }
    if (scenario === 'revisited-archive') await repo.archiveHabit('read', new Date(2026, 9, 5, 12));
    const before = await stored(name);
    const revision = (before as ReturnType<typeof facts>).revision;
    await expect(repo.removePillar(target, friday, revision)).rejects.toThrow(
      'Move or archive all habits first',
    );
    expect(await stored(name)).toEqual(before);
    await repo.close();
  },
);

test('a credited prospective move permits source removal but never moves todays credited assignment', async () => {
  const { repo, name } = await setup();
  await repo.setDone('read', '2026-10-02', true, friday);
  const moved = await repo.editHabit(
    'read',
    { pillarId: 'body', goal: 'Read 10 pages', weekdays: [1, 3, 5] },
    friday,
  );
  const removed = await repo.removePillar('mind', friday, moved.revision);
  expect(agenda(removed, '2026-10-02')[0]).toMatchObject({ pillarId: 'mind', done: true });
  expect(agenda(removed, '2026-10-05')[0]).toMatchObject({ pillarId: 'body', kind: 'required' });
  expect(calculateProgress(removed, '2026-10-02')).toEqual(calculateProgress(moved, '2026-10-02'));
  const membership = structuredClone(removed.habits[0].memberships);
  const undo = await repo.setDone('read', '2026-10-02', false, friday, removed.revision);
  expect(agenda(undo, '2026-10-02')[0]).toMatchObject({
    pillarId: 'mind',
    done: false,
    kind: 'required',
  });
  expect(summarize(agenda(undo, '2026-10-02'), 'pillar').status).toBe('pending');
  const redo = await repo.setDone('read', '2026-10-02', true, friday, undo.revision);
  expect(redo.habits[0].memberships).toEqual(membership);
  expect(redo.occurrences.filter((o) => o.date === '2026-10-02')).toHaveLength(1);
  expect(calculateProgress(redo, '2026-10-02')).toEqual(calculateProgress(moved, '2026-10-02'));
  expect(await stored(name)).toEqual(redo);
  await repo.close();
});

test('atomic reactivation into an active destination preserves old membership and starts strictly next weekday without another first day', async () => {
  const { repo, name } = await setup();
  for (const [month, day, date] of [
    [8, 28, '2026-09-28'],
    [8, 30, '2026-09-30'],
    [9, 2, '2026-10-02'],
  ] as const)
    await repo.setDone('read', date, true, new Date(2026, month, day, 12));
  await repo.grantPermanentUnlock('owned', friday);
  const archived = await repo.archiveHabit('read', friday);
  const removed = await repo.removePillar('mind', friday, archived.revision);
  const waiting = await repo.reactivateHabitInPillar('read', 'body', friday, removed.revision);
  expect(waiting.revision).toBe(removed.revision + 1);
  expect(waiting.habits[0].periods).toEqual(archived.habits[0].periods);
  expect(waiting.occurrences).toEqual(archived.occurrences);
  expect(waiting.permanentUnlocks).toEqual(archived.permanentUnlocks);
  expect(waiting.habits[0].memberships).toEqual([
    { effectiveFrom: '2026-09-27', pillarId: 'mind' },
    { effectiveFrom: '2026-10-05', pillarId: 'body' },
  ]);
  expect(agenda(waiting, '2026-10-02')[0]).toMatchObject({
    pillarId: 'mind',
    kind: 'required',
    done: true,
  });
  expect(agenda(waiting, '2026-10-03')).toEqual([]);
  expect(agenda(waiting, '2026-10-05')[0]).toMatchObject({
    pillarId: 'body',
    kind: 'required',
    done: false,
  });
  expect(calculateProgress(waiting, '2026-10-02')).toMatchObject({
    totalXp: 40,
    habits: { read: { current: 0, best: 3, xp: 40 } },
    pillars: { mind: { current: 3 } },
  });
  expect(await repo.reactivateHabitInPillar('read', 'body', friday, waiting.revision)).toEqual(
    waiting,
  );
  await expect(
    repo.reactivateHabitInPillar('read', 'mind', friday, waiting.revision),
  ).rejects.toThrow('active pillar');
  await expect(
    repo.reactivateHabitInPillar('read', 'missing', friday, waiting.revision),
  ).rejects.toThrow('active pillar');
  await expect(
    repo.reactivateHabitInPillar('missing', 'body', friday, waiting.revision),
  ).rejects.toThrow('Unknown habit');
  await expect(
    repo.reactivateHabitInPillar('read', 'body', friday, removed.revision),
  ).rejects.toThrow('Stale dataset revision');
  expect(await stored(name)).toEqual(waiting);
  const due = await repo.setDone(
    'read',
    '2026-10-05',
    true,
    new Date(2026, 9, 5, 12),
    waiting.revision,
  );
  expect(calculateProgress(due, '2026-10-05')).toMatchObject({
    totalXp: 50,
    habits: { read: { current: 1, best: 3 } },
    pillars: { mind: { current: 3 }, body: { current: 1 } },
    overall: { current: 4 },
  });
  expect(await stored(name)).toEqual(due);
  await repo.close();
});

test.each(['rename', 'remove', 'reactivate'] as const)(
  '%s native abort after put rolls back all facts, then retry commits once and exact repeats do not write',
  async (action) => {
    const { repo, name } = await setup();
    if (action === 'reactivate') {
      await repo.archiveHabit('read', friday);
      await repo.removePillar('mind', friday);
    }
    const before = await repo.load(friday);

    const operation = (revision = before.revision) =>
      action === 'rename'
        ? repo.renamePillar('mind', 'Exact name', revision)
        : action === 'remove'
          ? repo.removePillar('body', friday, revision)
          : repo.reactivateHabitInPillar('read', 'body', friday, revision);

    const nativePut = IDBObjectStore.prototype.put;
    const abort = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      const request = nativePut.call(this, value, key);
      this.transaction.abort();
      return request;
    });
    try {
      await expect(operation()).rejects.toThrow();
    } finally {
      abort.mockRestore();
    }
    expect(await stored(name)).toEqual(before);
    const peer = new Repository(name);
    expect(await peer.load(friday)).toEqual(before);
    const committed = await operation();
    expect(committed.revision).toBe(before.revision + 1);
    expect(await stored(name)).toEqual(committed);
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put');
    try {
      expect(await operation(committed.revision)).toEqual(committed);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    await expect(operation(before.revision)).rejects.toThrow('Stale dataset revision');
    expect(await stored(name)).toEqual(committed);
    expect(await peer.load(friday)).toEqual(committed);
    await repo.close();
    await peer.close();
  },
);

test.each(['create', 'edit', 'reactivate'] as const)(
  'repository %s cannot use an inactive destination',
  async (action) => {
    const { repo, name } = await setup();
    if (action === 'reactivate') await repo.archiveHabit('read', friday);
    const removed = await repo.removePillar('body', friday);
    const input = { pillarId: 'body', goal: 'Another goal', weekdays: [1, 3, 5] };
    await expect(
      action === 'create'
        ? repo.createHabit(input, '2026-10-02', removed.revision)
        : action === 'edit'
          ? repo.editHabit('read', input, friday, removed.revision)
          : repo.reactivateHabitInPillar('read', 'body', friday, removed.revision),
    ).rejects.toThrow('active pillar');
    expect(await stored(name)).toEqual(removed);
    await repo.close();
  },
);

test('cancelling a destination reactivation before due invents no occurrence, period or reward and permits a later valid destination', async () => {
  const { repo, name } = await setup();
  await repo.setDone('read', '2026-09-30', true, new Date(2026, 8, 30, 12));
  const archived = await repo.archiveHabit('read', friday);
  await repo.removePillar('mind', friday);
  const requested = await repo.reactivateHabitInPillar('read', 'body', friday);
  const saturday = new Date(2026, 9, 3, 12);
  const cancelled = await repo.archiveHabit('read', saturday, requested.revision);
  expect(cancelled.habits[0].periods).toEqual(archived.habits[0].periods);
  expect(cancelled.habits[0].pendingReactivation).toBeUndefined();
  expect(cancelled.occurrences).toEqual(archived.occurrences);
  expect(agenda(cancelled, '2026-10-05')).toEqual([]);
  expect(calculateProgress(cancelled, '2026-10-05')).toEqual(
    calculateProgress(archived, '2026-10-05'),
  );
  const removed = await repo.removePillar('body', saturday, cancelled.revision);
  await expect(repo.reactivateHabit('read', saturday, removed.revision)).rejects.toThrow(
    'active pillar',
  );
  const custom = await repo.createPillar('New active destination', removed.revision);
  const target = custom.pillars.at(-1)!.id;
  const waiting = await repo.reactivateHabitInPillar('read', target, saturday, custom.revision);
  expect(agenda(waiting, '2026-10-05')[0]).toMatchObject({ pillarId: target, kind: 'required' });
  expect(await stored(name)).toEqual(waiting);
  await repo.close();
});
