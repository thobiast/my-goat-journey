import { expect, test, vi } from 'vitest';
import { Repository } from '../../src/data/database';
import { parseBackup, serializeBackup, validateDataset } from '../../src/data/backup';
import { agenda, membershipAt } from '../../src/domain/agenda';
import { calculateProgress } from '../../src/domain/progress';
import { DEFAULT_PILLARS } from '../../src/domain/types';
import { facts } from '../domain/fixtures';
import { seed, stored } from './fixtures';

const friday = new Date(2026, 9, 2, 12);
const saturday = new Date(2026, 9, 3, 12);
const move = { pillarId: 'body', goal: 'Read 10 pages', weekdays: [1, 3, 5] };

test('Repository preserves Saturday cancellation after Friday first credit, reload and portable replacement', async () => {
  const data = facts();
  data.pillars = DEFAULT_PILLARS.map((id) => ({ id, name: id, defaultKey: id }));
  data.permanentUnlocks.push({ id: 'retained', unlockedAt: friday.toISOString() });
  expect(validateDataset(data)).toEqual(data);
  const name = crypto.randomUUID();
  await seed(name, data);
  const repo = new Repository(name);
  try {
    const moved = await repo.editHabit('read', move, friday, 0);
    const cancelled = await repo.editHabit(
      'read',
      { ...move, pillarId: 'mind' },
      saturday,
      moved.revision,
    );
    const credited = await repo.setDone('read', '2026-10-02', true, saturday, cancelled.revision);
    expect(membershipAt(credited.habits[0], '2026-10-05')?.pillarId).toBe('mind');
    expect(agenda(credited, '2026-10-02')[0]).toMatchObject({ pillarId: 'body', done: true });
    expect(credited.occurrences).toHaveLength(1);
    expect(calculateProgress(credited, '2026-10-03').totalXp).toBe(10);
    expect(credited.permanentUnlocks).toEqual(data.permanentUnlocks);
    expect(await stored(name)).toEqual(credited);
    expect(await repo.load(saturday)).toEqual(credited);
    const undo = await repo.setDone('read', '2026-10-02', false, saturday, credited.revision);
    const redo = await repo.setDone('read', '2026-10-02', true, saturday, undo.revision);
    expect(redo.habits).toEqual(credited.habits);
    expect(calculateProgress(redo, '2026-10-03')).toEqual(
      calculateProgress(credited, '2026-10-03'),
    );
    for (const exportDate of [new Date(2026, 8, 30, 12), new Date(2026, 9, 9, 12)]) {
      const candidate = (await parseBackup(serializeBackup(redo, exportDate))).dataset;
      expect(candidate).toEqual({ ...redo, revision: 0 });
      const restored = await repo.replaceDataset(
        candidate,
        (await repo.load(saturday)).revision,
        exportDate,
      );
      expect(restored).toEqual({ ...redo, revision: restored.revision });
      expect(await stored(name)).toEqual(restored);
    }
  } finally {
    await repo.close();
  }
});

test.each(['abort', 'quota'] as const)(
  'cancellation and first-credit %s preserve exact committed facts and stale revisions',
  async (failure) => {
    const data = facts();
    data.pillars = DEFAULT_PILLARS.map((id) => ({ id, name: id, defaultKey: id }));
    const name = crypto.randomUUID();
    await seed(name, data);
    const repo = new Repository(name);
    try {
      let state = await repo.editHabit('read', move, friday, 0);
      for (const action of ['cancel', 'credit'] as const) {
        const before = structuredClone(state);

        const operation = (revision = before.revision) =>
          action === 'cancel'
            ? repo.editHabit('read', { ...move, pillarId: 'mind' }, saturday, revision)
            : repo.setDone('read', '2026-10-02', true, saturday, revision);

        const nativePut = IDBObjectStore.prototype.put;
        const fail = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
          this: IDBObjectStore,
          value: unknown,
          key?: IDBValidKey,
        ) {
          if (failure === 'quota') throw new DOMException('No space', 'QuotaExceededError');
          const request = nativePut.call(this, value, key);
          this.transaction.abort();
          return request;
        });
        try {
          await expect(operation()).rejects.toThrow();
        } finally {
          fail.mockRestore();
        }
        expect(await stored(name)).toEqual(before);
        expect(await repo.load(saturday)).toEqual(before);
        state = await operation();
        expect(state.revision).toBe(before.revision + 1);
        expect(await stored(name)).toEqual(state);
        await expect(operation(before.revision)).rejects.toThrow('Stale dataset revision');
        expect(await stored(name)).toEqual(state);
        const writes = vi.spyOn(IDBObjectStore.prototype, 'put');
        try {
          expect(await operation(state.revision)).toEqual(state);
          expect(writes).not.toHaveBeenCalled();
        } finally {
          writes.mockRestore();
        }
      }
      expect(membershipAt(state.habits[0], '2026-10-05')?.pillarId).toBe('mind');
      expect(calculateProgress(state, '2026-10-03').totalXp).toBe(10);
    } finally {
      await repo.close();
    }
  },
);
