import { expect, test, vi } from 'vitest';
import { Repository } from '../../src/data/database';
import { DatasetError } from '../../src/domain/errors';
import { calculateProgress } from '../../src/domain/progress';
import { stored } from './fixtures';

const now = new Date(2026, 9, 2, 12);

async function diary(goal = 'Original') {
  let fail = false;
  const repo = new Repository(crypto.randomUUID(), () => fail);
  await repo.saveDraft({
    step: 5,
    goals: ['mind', 'body', 'nutrition', 'hygiene'].map((pillarId) => ({
      pillarId,
      goal: `${goal} ${pillarId}`,
      weekdays: [1, 3, 5],
    })),
  });
  const initial = await repo.finalize('2026-09-27');
  await repo.setDone(initial.habits[0].id, '2026-10-02', true, now);
  await repo.grantPermanentUnlock(`${goal}-owned`, now);
  return {
    repo,
    data: await repo.load(now),
    fail: (value: boolean) => {
      fail = value;
    },
  };
}

test('validated replacement is exact B, never A+B; every identical reimport advances the replacement revision once', async () => {
  const a = await diary('A');
  const b = await diary('B');
  b.data.revision = 500;
  const imported = await a.repo.replaceDataset(b.data, a.data.revision, now);
  expect(imported).toEqual({ ...b.data, revision: a.data.revision + 1 });
  expect(await stored(a.repo.name)).toEqual(imported);
  expect(calculateProgress(imported, '2026-10-02')).toEqual(
    calculateProgress(b.data, '2026-10-02'),
  );
  a.fail(true);
  await expect(a.repo.replaceDataset(b.data, imported.revision, now)).rejects.toThrow(
    'Persistence failed',
  );
  expect(await stored(a.repo.name)).toEqual(imported);
  a.fail(false);
  const put = vi.spyOn(IDBObjectStore.prototype, 'put');
  let repeated;
  try {
    repeated = await a.repo.replaceDataset(b.data, imported.revision, now);
    expect(put).toHaveBeenCalledTimes(1);
  } finally {
    put.mockRestore();
  }
  expect(repeated).toEqual({ ...imported, revision: imported.revision + 1 });
  expect(calculateProgress(repeated!, '2026-10-02')).toEqual(
    calculateProgress(imported, '2026-10-02'),
  );
  await expect(a.repo.replaceDataset(b.data, imported.revision, now)).rejects.toThrow(
    'Stale dataset revision',
  );
  const peer = new Repository(a.repo.name);
  expect(await peer.load(now)).toEqual(repeated);
  expect(await stored(a.repo.name)).toEqual(repeated);
  await a.repo.close();
  await b.repo.close();
  await peer.close();
});

test('reset atomically restores English defaults with growing revision, no personal facts, and blocks old queued writes', async () => {
  const a = await diary();
  await a.repo.setSettings({ language: 'pt', reducedMotion: true }, a.data.revision);
  await a.repo.createPillar('Personal pillar');
  const before = await a.repo.load(now);
  a.fail(true);
  await expect(a.repo.resetDataset(before.revision, now)).rejects.toThrow('Persistence failed');
  expect(await stored(a.repo.name)).toEqual(before);
  a.fail(false);
  const reset = await a.repo.resetDataset(before.revision, now);
  const freshRepo = new Repository(crypto.randomUUID());
  const fresh = await freshRepo.load(now);
  expect(reset).toEqual({ ...fresh, revision: before.revision + 1 });
  expect(await stored(a.repo.name)).toEqual(reset);
  await expect(
    a.repo.setDone(before.habits[0].id, '2026-10-02', true, now, before.revision),
  ).rejects.toThrow('Stale dataset revision');
  await expect(a.repo.saveDraft({ step: 1, goals: [] }, before.revision)).rejects.toThrow(
    'Stale dataset revision',
  );
  a.fail(true);
  await expect(a.repo.resetDataset(reset.revision, now)).rejects.toThrow('Persistence failed');
  expect(await stored(a.repo.name)).toEqual(reset);
  a.fail(false);
  const resetAgain = await a.repo.resetDataset(reset.revision, now);
  expect(resetAgain).toEqual({ ...reset, revision: reset.revision + 1 });
  await expect(a.repo.saveDraft({ step: 1, goals: [] }, reset.revision)).rejects.toThrow(
    'Stale dataset revision',
  );
  const peer = new Repository(a.repo.name);
  expect(await peer.load(now)).toEqual(resetAgain);
  await a.repo.close();
  await freshRepo.close();
  await peer.close();
});

test('identical replacement rejects every pre-replacement API revision while ordinary idempotent mutations still do not write', async () => {
  const a = await diary();
  const old = a.data.revision;
  const id = a.data.habits[0].id;
  const replaced = await a.repo.replaceDataset(a.data, old, now);
  expect(replaced).toEqual({ ...a.data, revision: old + 1 });
  const put = vi.spyOn(IDBObjectStore.prototype, 'put');
  const input = { pillarId: 'mind', goal: a.data.habits[0].versions[0].goal, weekdays: [1, 3, 5] };
  const oldOperations = [
    () => a.repo.replaceDataset(a.data, old, now),
    () => a.repo.resetDataset(old, now),
    () => a.repo.saveDraft({ step: 1, goals: [] }, old),
    () => a.repo.finalize('2026-10-02', old),
    () => a.repo.createHabit(input, '2026-10-02', old),
    () => a.repo.createPillar('New', old),
    () => a.repo.setSettings({ language: 'pt' }, old),
    () => a.repo.setDone(id, '2026-10-02', true, now, old),
    () => a.repo.editHabit(id, input, now, old),
    () => a.repo.archiveHabit(id, now, old),
    () => a.repo.reactivateHabit(id, now, old),
    () => a.repo.grantPermanentUnlock('Original-owned', now, old),
  ];
  try {
    for (const operation of oldOperations) {
      const failure = operation();
      await expect(failure).rejects.toThrow('Stale dataset revision');
      await expect(failure).rejects.toMatchObject({ code: 'stale-revision' });
      await expect(failure).rejects.toBeInstanceOf(DatasetError);
    }
    const idempotent = [
      () => a.repo.setSettings({ language: 'en' }, replaced.revision),
      () => a.repo.setDone(id, '2026-10-02', true, now, replaced.revision),
      () => a.repo.editHabit(id, input, now, replaced.revision),
      () => a.repo.reactivateHabit(id, now, replaced.revision),
      () => a.repo.grantPermanentUnlock('Original-owned', now, replaced.revision),
    ];
    for (const operation of idempotent) expect(await operation()).toEqual(replaced);
    expect(put).not.toHaveBeenCalled();
  } finally {
    put.mockRestore();
  }
  expect(await stored(a.repo.name)).toEqual(replaced);
  await a.repo.close();
});

test.each(['replace', 'reset'] as const)(
  'identical %s native abort and quota keep exact old facts and revision',
  async (action) => {
    const a = await diary();
    const before = action === 'reset' ? await a.repo.resetDataset(a.data.revision, now) : a.data;
    const originalPut = IDBObjectStore.prototype.put;
    for (const failure of ['abort', 'quota'] as const) {
      const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ) {
        if (failure === 'quota') throw new DOMException('Quota', 'QuotaExceededError');
        const request = originalPut.call(this, value, key);
        this.transaction.abort();
        return request;
      });
      try {
        await expect(
          action === 'replace'
            ? a.repo.replaceDataset(before, before.revision, now)
            : a.repo.resetDataset(before.revision, now),
        ).rejects.toThrow();
        expect(put).toHaveBeenCalledTimes(1);
      } finally {
        put.mockRestore();
      }
      expect(await stored(a.repo.name)).toEqual(before);
    }
    await a.repo.close();
  },
);

test('replacement validates before opening a write transaction and again inside it; caller mutation cannot alter the captured candidate', async () => {
  const a = await diary('A');
  const b = await diary('B');
  const backup = await import('../../src/data/backup');
  const validation = vi.spyOn(backup, 'validateDataset');
  const tx = vi.spyOn(IDBDatabase.prototype, 'transaction');
  try {
    const invalid = structuredClone(b.data);
    invalid.habits[0].versions[0].weekdays = [];
    await expect(a.repo.replaceDataset(invalid, a.data.revision, now)).rejects.toThrow('Invalid');
    expect(tx).not.toHaveBeenCalled();
    expect(validation).toHaveBeenCalledTimes(1);
    validation.mockClear();
    tx.mockClear();
    const expected = structuredClone(b.data);
    const promise = a.repo.replaceDataset(b.data, a.data.revision, now);
    b.data.habits[0].versions[0].goal = 'Unsaved mutation';
    const result = await promise;
    expect(validation).toHaveBeenCalledTimes(2);
    expect(tx).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ...expected, revision: a.data.revision + 1 });
    expect(await stored(a.repo.name)).toEqual(result);
  } finally {
    validation.mockRestore();
    tx.mockRestore();
    await a.repo.close();
    await b.repo.close();
  }
});

test.each(['replace', 'reset'] as const)(
  '%s native abort after put and quota-style exception preserve the entire old diary',
  async (action) => {
    const a = await diary('A');
    const b = await diary('B');
    const put = IDBObjectStore.prototype.put;
    for (const failure of ['abort', 'quota', 'failWrite'] as const) {
      let writes = 0;
      const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ) {
        writes++;
        if (failure === 'quota')
          throw new DOMException('Injected quota exhaustion', 'QuotaExceededError');
        const request = put.call(this, value, key);
        if (failure === 'abort') this.transaction.abort();
        return request;
      });
      a.fail(failure === 'failWrite');
      try {
        await expect(
          action === 'replace'
            ? a.repo.replaceDataset(b.data, a.data.revision, now)
            : a.repo.resetDataset(a.data.revision, now),
        ).rejects.toThrow();
        expect(writes).toBe(failure === 'failWrite' ? 0 : 1);
      } finally {
        spy.mockRestore();
        a.fail(false);
      }
      expect(await stored(a.repo.name)).toEqual(a.data);
      const peer = new Repository(a.repo.name);
      expect(await peer.load(now)).toEqual(a.data);
      await peer.close();
    }
    const write = vi.spyOn(IDBObjectStore.prototype, 'put');
    const clear = vi.spyOn(IDBObjectStore.prototype, 'clear');
    try {
      const result =
        action === 'replace'
          ? await a.repo.replaceDataset(b.data, a.data.revision, now)
          : await a.repo.resetDataset(a.data.revision, now);
      expect(write).toHaveBeenCalledTimes(1);
      expect(clear).not.toHaveBeenCalled();
      expect(await stored(a.repo.name)).toEqual(result);
    } finally {
      write.mockRestore();
      clear.mockRestore();
      await a.repo.close();
      await b.repo.close();
    }
  },
);

test('stale replacement, deletion and every old mutation reject before resurrecting old identities or ownership', async () => {
  const a = await diary('A');
  const b = await diary('B');
  const old = a.data.revision;
  const oldId = a.data.habits[0].id;
  const replaced = await a.repo.replaceDataset(b.data, old, now);
  const operations = [
    () => a.repo.replaceDataset(a.data, old, now),
    () => a.repo.resetDataset(old, now),
    () => a.repo.setDone(oldId, '2026-10-02', true, now, old),
    () => a.repo.editHabit(oldId, { pillarId: 'mind', goal: 'Old goal', weekdays: [1] }, now, old),
    () => a.repo.archiveHabit(oldId, now, old),
    () => a.repo.reactivateHabit(oldId, now, old),
    () => a.repo.saveDraft({ step: 1, goals: [] }, old),
    () => a.repo.finalize('2026-10-02', old),
    () =>
      a.repo.createHabit({ pillarId: 'mind', goal: 'Old goal', weekdays: [1] }, '2026-10-02', old),
    () => a.repo.createPillar('Old pillar', old),
    () => a.repo.setSettings({ language: 'pt' }, old),
    () => a.repo.grantPermanentUnlock('Old ownership', now, old),
  ];
  for (const operation of operations)
    await expect(operation()).rejects.toThrow('Stale dataset revision');
  expect(await stored(a.repo.name)).toEqual(replaced);
  const reset = await a.repo.resetDataset(replaced.revision, now);
  for (const operation of operations)
    await expect(operation()).rejects.toThrow('Stale dataset revision');
  expect(await stored(a.repo.name)).toEqual(reset);
  await a.repo.close();
  await b.repo.close();
});

test('replacement cannot exhaust safe local revision ordering; the old diary remains intact', async () => {
  const { seed } = await import('./fixtures');
  const a = await diary('A');
  const b = await diary('B');
  a.data.revision = Number.MAX_SAFE_INTEGER;
  await seed(a.repo.name, a.data);
  await expect(a.repo.replaceDataset(b.data, a.data.revision, now)).rejects.toThrow(
    'Dataset revision exhausted',
  );
  expect(await stored(a.repo.name)).toEqual(a.data);
  await a.repo.close();
  await b.repo.close();
});

test('replacement preserves pending lifecycle facts exactly without implicit reconciliation, then due load materializes once', async () => {
  const a = await diary('A');
  const b = await diary('B');
  const archivedId = b.data.habits[1].id;
  await b.repo.archiveHabit(archivedId, now);
  await b.repo.reactivateHabit(archivedId, now);
  const movedId = b.data.habits[2].id;
  await b.repo.editHabit(
    movedId,
    { pillarId: 'body', goal: 'A prospective target', weekdays: [1, 3, 5] },
    now,
  );
  const candidate = await b.repo.load(now);
  const backup = await import('../../src/data/backup');
  expect(backup.validateDataset(candidate)).toEqual(candidate);
  const late = new Date(2026, 9, 6, 12);
  const replaced = await a.repo.replaceDataset(candidate, a.data.revision, late);
  expect(replaced).toEqual({ ...candidate, revision: a.data.revision + 1 });
  expect(await stored(a.repo.name)).toEqual(replaced);
  const reconciled = await a.repo.load(late);
  expect(reconciled.revision).toBe(replaced.revision + 1);
  expect(reconciled.habits.find((h) => h.id === archivedId)!.pendingReactivation).toBeUndefined();
  expect(reconciled.habits.find((h) => h.id === archivedId)!.periods.at(-1)?.start).toBe(
    '2026-10-05',
  );
  expect(reconciled.habits.find((h) => h.id === movedId)!.pendingMove).toBeUndefined();
  expect(reconciled.occurrences).toEqual(candidate.occurrences);
  expect(backup.validateDataset(reconciled)).toEqual(reconciled);
  expect(await a.repo.load(late)).toEqual(reconciled);
  await a.repo.close();
  await b.repo.close();
});
