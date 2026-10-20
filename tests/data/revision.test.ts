import { expect, test, vi } from 'vitest';
import { Repository } from '../../src/data/database';
import { DatasetError } from '../../src/domain/errors';
import { calculateProgress } from '../../src/domain/progress';
import { facts } from '../domain/fixtures';
import { seed, stored } from './fixtures';

test('mutations advance local revision and stale expectedRevision rejects transactionally', async () => {
  const repo = new Repository(crypto.randomUUID());
  const start = await repo.load();
  expect(start.revision).toBe(0);
  const first = await repo.setSettings({ language: 'pt' }, start.revision);
  expect(first.revision).toBe(1);
  await expect(
    new Repository(repo.name).createPillar('Stale pillar', start.revision),
  ).rejects.toThrow('Stale dataset revision');
  expect(await repo.load()).toEqual(first);
  const second = await repo.createPillar('Music', first.revision);
  expect(second.revision).toBe(2);
  expect(await repo.setSettings({ language: 'pt' }, second.revision)).toEqual(second);
  await expect(repo.setSettings({ language: 'pt' }, first.revision)).rejects.toThrow(
    'Stale dataset revision',
  );
  const stale = repo.createPillar('Stale contract', first.revision);
  await expect(stale).rejects.toBeInstanceOf(DatasetError);
  await expect(stale).rejects.toMatchObject({
    name: 'DatasetError',
    code: 'stale-revision',
    message: 'Stale dataset revision',
  });
  const tx = vi.spyOn(IDBDatabase.prototype, 'transaction');
  const put = vi.spyOn(IDBObjectStore.prototype, 'put');
  expect(await repo.load()).toEqual(second);
  expect(tx.mock.calls.every((call) => call[1] === 'readonly')).toBe(true);
  expect(put).not.toHaveBeenCalled();
  tx.mockRestore();
  put.mockRestore();
});
test('load materializes a due pending intent atomically, even on late reopening, with replay equivalence', async () => {
  const name = crypto.randomUUID();
  const data = facts();
  data.habits[0].periods[0].end = '2026-10-02';
  data.habits[0].pendingReactivation = { periodId: 'resumed', requestedOn: '2026-10-02' };
  await seed(name, data);
  let fail = false;
  const repo = new Repository(name, () => fail);
  expect(await repo.load(new Date(2026, 9, 3, 12))).toEqual(data);
  const before = calculateProgress(data, '2026-10-07');
  fail = true;
  await expect(repo.load(new Date(2026, 9, 7, 12))).rejects.toThrow('Persistence failed');
  expect(await stored(name)).toEqual(data);
  fail = false;
  const result = await repo.load(new Date(2026, 9, 7, 12));
  expect(result.habits[0].periods).toEqual([
    ...data.habits[0].periods,
    { id: 'resumed', start: '2026-10-05', reactivatedOn: '2026-10-02' },
  ]);
  expect(result.habits[0].pendingReactivation).toBeUndefined();
  expect(result.revision).toBe(1);
  expect(result.occurrences).toEqual([]);
  expect(calculateProgress(result, '2026-10-07')).toEqual(before);
  expect(await new Repository(name).load(new Date(2026, 9, 7, 12))).toEqual(result);
});

test.each(['Stale dataset revision', 'Historical commitment conflict'])(
  'unexpected persistence failure with diagnostic %s propagates unchanged and aborts',
  async (message) => {
    const repo = new Repository(crypto.randomUUID());
    const before = await repo.load();
    const failure = new Error(message);
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw failure;
    });
    try {
      await expect(repo.createPillar('Not committed', before.revision)).rejects.toBe(failure);
      expect(failure).not.toBeInstanceOf(DatasetError);
      expect(await stored(repo.name)).toEqual(before);
    } finally {
      put.mockRestore();
      await repo.close();
    }
  },
);
