import { expect, test, vi } from 'vitest';
import { Repository } from '../../src/data/database';
import { agenda } from '../../src/domain/agenda';
import { calculateProgress } from '../../src/domain/progress';

import { legacyFixture, seed, stored } from './fixtures';

test('load migrates legacy snapshots without inventing credit or changing dated progress', async () => {
  const name = crypto.randomUUID();
  const legacy = legacyFixture();
  await seed(name, legacy);
  const before = calculateProgress(legacy, '2026-10-02');
  const oldAgenda = agenda(legacy, '2026-10-02');
  const repo = new Repository(name);
  const migrated = await repo.load();
  expect(migrated.schemaVersion).toBe(2);
  expect(migrated).toMatchObject({
    revision: 1,
    draft: legacy.draft,
    settings: legacy.settings,
    permanentUnlocks: legacy.permanentUnlocks,
  });
  expect(migrated.habits[0]).toMatchObject({
    memberships: [
      { effectiveFrom: '2026-09-27', pillarId: 'music' },
      { effectiveFrom: '2026-10-01', pillarId: 'body' },
    ],
    periods: legacy.habits[0].periods,
  });
  expect(migrated.habits[0].versions.every((v) => !('pillarId' in v))).toBe(true);
  expect(migrated.occurrences[0]).toMatchObject({
    activationId: 'first',
    completionProvenance: 'credited',
    assignmentLocked: true,
    pillarParticipation: 'on-completion',
  });
  expect(migrated.occurrences[2]).toMatchObject({
    done: false,
    completionProvenance: 'legacy-unknown',
    assignmentLocked: true,
    pillarParticipation: 'required',
    activationId: 'first',
  });
  for (let i = 0; i < legacy.occurrences.length; i++)
    expect(migrated.occurrences[i]).toMatchObject(legacy.occurrences[i]);
  expect(calculateProgress(migrated, '2026-10-02')).toEqual(before);
  for (const date of ['2026-09-27', '2026-09-28', '2026-09-30', '2026-10-01', '2026-10-02']) {
    expect(calculateProgress(migrated, date)).toEqual(calculateProgress(legacy, date));

    const project = (data: Parameters<typeof agenda>[0]) =>
      agenda(data, date).map(({ goal, pillarId, date, kind, done }) => ({
        goal,
        pillarId,
        date,
        kind,
        done,
      }));

    expect(project(migrated)).toEqual(project(legacy));
  }
  expect(
    agenda(migrated, '2026-10-02').map(({ goal, pillarId, date, kind, done }) => ({
      goal,
      pillarId,
      date,
      kind,
      done,
    })),
  ).toEqual(
    oldAgenda.map(({ goal, pillarId, date, kind, done }) => ({ goal, pillarId, date, kind, done })),
  );
  expect(await stored(name)).toEqual(migrated);
  const put = vi.spyOn(IDBObjectStore.prototype, 'put');
  expect(await repo.load()).toEqual(migrated);
  expect(await new Repository(name).load()).toEqual(migrated);
  expect(put).not.toHaveBeenCalled();
  put.mockRestore();
  await repo.close();
});
test('migration failure and a native put abort retain schema 1 exactly; retry commits once', async () => {
  const name = crypto.randomUUID();
  const legacy = legacyFixture();
  await seed(name, legacy);
  let fail = true;
  const repo = new Repository(name, () => fail);
  await expect(repo.load()).rejects.toThrow('Persistence failed');
  expect(await stored(name)).toEqual(legacy);
  fail = false;
  const nativePut = IDBObjectStore.prototype.put;
  const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    ...args: Parameters<IDBObjectStore['put']>
  ) {
    const request = nativePut.apply(this, args);
    this.transaction.abort();
    return request;
  });
  await expect(repo.load()).rejects.toThrow();
  put.mockRestore();
  expect(await stored(name)).toEqual(legacy);
  const result = await repo.load();
  expect(result.schemaVersion).toBe(2);
  expect(await new Repository(name).load()).toEqual(result);
});
test('unsupported schemas and duplicate stable habit/date facts are rejected without writes', async () => {
  for (const invalid of [
    { ...legacyFixture(), schemaVersion: 99 },
    {
      ...legacyFixture(),
      occurrences: [...legacyFixture().occurrences, legacyFixture().occurrences[0]],
    },
  ]) {
    const name = crypto.randomUUID();
    await seed(name, invalid);
    await expect(new Repository(name).load()).rejects.toThrow();
    expect(await stored(name)).toEqual(invalid);
  }
});
test('legacy-unknown false facts are not credit, and later checking, Undo and Redo retain the preserved source snapshot', async () => {
  const name = crypto.randomUUID();
  await seed(name, legacyFixture());
  const repo = new Repository(name);
  const migrated = await repo.load();
  const initial = calculateProgress(migrated, '2026-10-02');
  expect(initial.totalXp).toBe(20);
  expect(migrated.occurrences[2].completionProvenance).toBe('legacy-unknown');
  const now = new Date(2026, 9, 2, 12);
  const checked = await repo.setDone('read', '2026-10-02', true, now, migrated.revision);
  expect(checked.occurrences[2]).toMatchObject({
    goal: 'False frozen snapshot',
    pillarId: 'music',
    done: true,
    completionProvenance: 'credited',
    assignmentLocked: true,
  });
  expect(calculateProgress(checked, '2026-10-02').totalXp).toBe(30);
  const undone = await repo.setDone('read', '2026-10-02', false, now, checked.revision);
  expect(calculateProgress(undone, '2026-10-02')).toEqual(initial);
  const redone = await repo.setDone('read', '2026-10-02', true, now, undone.revision);
  expect(calculateProgress(redone, '2026-10-02')).toEqual(calculateProgress(checked, '2026-10-02'));
  expect(redone.occurrences).toHaveLength(3);
  expect(await new Repository(name).load()).toEqual(redone);
});
