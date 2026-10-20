import { test, expect } from 'vitest';
import { Repository } from '../../src/data/database';
import { DatasetError } from '../../src/domain/errors';
import { facts } from '../domain/fixtures';
import { seed, stored } from './fixtures';

test('a guarded refresh rejects an identical external replacement instead of calling it local reconciliation', async () => {
  const data = facts();
  data.pillars = ['mind', 'body', 'nutrition', 'hygiene'].map((id) => ({
    id,
    name: id,
    defaultKey: id as 'mind' | 'body' | 'nutrition' | 'hygiene',
  }));
  const name = `fictional-refresh-${crypto.randomUUID()}`;
  await seed(name, data);
  const repository = new Repository(name);
  const now = new Date('2026-10-02T12:00:00');
  try {
    const before = await repository.load(now);
    const replaced = await repository.replaceDataset(before, before.revision, now);
    expect(replaced.revision).toBe(before.revision + 1);
    await expect(repository.load(now, before.revision)).rejects.toThrow('Stale dataset revision');
    await expect(repository.load(now, before.revision)).rejects.toEqual(
      new DatasetError('stale-revision'),
    );
    expect(await stored(name)).toEqual(replaced);
    expect(await repository.load(now)).toEqual(replaced);
  } finally {
    await repository.close();
  }
});

test('a guarded refresh commits only the due lifecycle transition once', async () => {
  const name = `fictional-refresh-${crypto.randomUUID()}`;
  await seed(name, facts());
  const repository = new Repository(name);
  try {
    await repository.archiveHabit('read', new Date('2026-10-02T12:00:00'));
    await repository.reactivateHabit('read', new Date('2026-10-03T12:00:00'));
    const before = await repository.load(new Date('2026-10-04T12:00:00'));
    const due = new Date('2026-10-05T12:00:00');
    const after = await repository.load(due, before.revision);
    expect(after.revision).toBe(before.revision + 1);
    expect(after.habits[0].periods.at(-1)?.start).toBe('2026-10-05');
    expect(after.habits[0].pendingReactivation).toBeUndefined();
    expect(after.occurrences).toEqual(before.occurrences);
    expect(await repository.load(due, after.revision)).toEqual(after);
    await expect(repository.load(due, before.revision)).rejects.toThrow('Stale dataset revision');
    expect(await stored(name)).toEqual(after);
  } finally {
    await repository.close();
  }
});
