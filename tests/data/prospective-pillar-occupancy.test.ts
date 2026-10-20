import { expect, test, vi } from 'vitest';
import { Repository } from '../../src/data/database';
import { parseBackup, serializeBackup, validateDataset } from '../../src/data/backup';
import { agenda } from '../../src/domain/agenda';
import { DEFAULT_PILLARS } from '../../src/domain/types';
import { facts } from '../domain/fixtures';
import { seed, stored } from './fixtures';

const date = (day: number) => new Date(2026, 9, day, 12);

const input = (pillarId: string) => ({ pillarId, goal: 'Read 10 pages', weekdays: [1, 3, 5] });

function portableFacts() {
  const data = facts();
  data.pillars = DEFAULT_PILLARS.map((id) => ({ id, name: id, defaultKey: id }));
  return data;
}

test('Repository rejects intermediate future destination removal after exact revisited three-boundary sequence', async () => {
  const data = portableFacts();
  expect(validateDataset(data)).toEqual(data);
  const name = crypto.randomUUID();
  await seed(name, data);
  const repo = new Repository(name);
  try {
    let state = await repo.load(date(3));
    state = await repo.editHabit('read', input('body'), date(3), state.revision);
    state = await repo.load(date(5));
    state = await repo.editHabit('read', input('nutrition'), date(1), state.revision);
    state = await repo.load(date(2));
    expect(state.habits[0].pendingMove).toBeUndefined();
    expect(state.habits[0].memberships).toEqual([
      { effectiveFrom: '2026-09-27', pillarId: 'mind' },
      { effectiveFrom: '2026-10-02', pillarId: 'nutrition' },
      { effectiveFrom: '2026-10-05', pillarId: 'body' },
    ]);
    expect(agenda(state, '2026-10-02')[0]).toMatchObject({
      pillarId: 'nutrition',
      kind: 'required',
      done: false,
    });
    const writes = vi.spyOn(IDBObjectStore.prototype, 'put');
    try {
      await expect(repo.removePillar('nutrition', date(1), state.revision)).rejects.toThrow(
        'Move or archive all habits first',
      );
      expect(writes).not.toHaveBeenCalled();
    } finally {
      writes.mockRestore();
    }
    expect(await stored(name)).toEqual(state);
    expect(await repo.load(date(1))).toEqual(state);
  } finally {
    await repo.close();
  }
});

test.each([date(-1), date(9)])(
  'portable validation rejects intermediate occupancy at stored removedOn, export/import clock %s',
  async (now) => {
    const data = portableFacts();
    data.habits[0].memberships.push(
      { effectiveFrom: '2026-10-02', pillarId: 'nutrition' },
      { effectiveFrom: '2026-10-05', pillarId: 'body' },
    );
    expect(validateDataset(data)).toEqual(data);
    data.pillars.find((p) => p.id === 'nutrition')!.removedOn = '2026-10-01';
    const original = structuredClone(data);
    // Untrusted files must not be constructed through the validating serializer.
    const blob = new Blob([
      JSON.stringify({
        format: 'my-goat-journey-backup',
        formatVersion: 1,
        exportedAt: now.toISOString(),
        dataset: data,
      }),
    ]);
    expect(() => validateDataset(data)).toThrow('Invalid or unsupported backup');
    expect(() => serializeBackup(data, now)).toThrow('Invalid or unsupported backup');
    await expect(parseBackup(blob)).rejects.toMatchObject({ code: 'invalid' });
    const target = portableFacts();
    const name = crypto.randomUUID();
    await seed(name, target);
    const repo = new Repository(name);
    try {
      await expect(repo.replaceDataset(data, 0, now)).rejects.toMatchObject({ code: 'invalid' });
      expect(await stored(name)).toEqual(target);
    } finally {
      await repo.close();
    }
    // Existing invalid local data remains readable and unchanged. This pre-public
    // release intentionally does not migrate it; strict export validation rejects it.
    const legacyName = crypto.randomUUID();
    await seed(legacyName, data);
    const legacyRepo = new Repository(legacyName);
    try {
      const loaded = await legacyRepo.load(now);
      expect(loaded).toEqual(original);
      expect(() => serializeBackup(loaded, now)).toThrow('Invalid or unsupported backup');
      expect(await stored(legacyName)).toEqual(original);
    } finally {
      await legacyRepo.close();
    }
    expect(data).toEqual(original);
  },
);
