import { expect, test } from 'vitest';
import { Repository } from '../../src/data/database';
import { calculateProgress } from '../../src/domain/progress';
import { serializeBackup } from '../../src/data/backup';
import { archiveHabit, reactivateHabit } from '../../src/domain/lifecycle';
import { DatasetError } from '../../src/domain/errors';
import { stored } from './fixtures';

async function diary() {
  const name = `archive-review-${crypto.randomUUID()}`;
  const repo = new Repository(name);
  await repo.saveDraft({
    step: 5,
    goals: ['mind', 'body', 'nutrition', 'hygiene'].map((pillarId) => ({
      pillarId,
      goal: `Goal ${pillarId}`,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
    })),
  });
  const data = await repo.finalize('2026-09-27');
  return { repo, name, id: data.habits[0].id };
}

const friday = new Date(2026, 9, 2, 12);
const saturday = new Date(2026, 9, 3, 12);

test('archival on a revisited earlier date cannot orphan a future assigned completion', async () => {
  const { repo, id } = await diary();
  await repo.setDone(id, '2026-10-03', true, saturday);
  const before = await repo.load(saturday);
  expect(calculateProgress(before, '2026-10-03').totalXp).toBe(10);
  await expect(repo.archiveHabit(id, friday, before.revision)).rejects.toThrow(
    'Historical commitment conflict',
  );
  const after = await repo.load(saturday);
  expect(after).toEqual(before);
  expect(calculateProgress(after, '2026-10-03').totalXp).toBe(10);
  expect(() => serializeBackup(after, saturday)).not.toThrow();
  await repo.close();
});

test.each(['2026-10-03', '2026-10-05'])(
  'reactivation on a revisited earlier date cannot duplicate a future actual period supporting %s credit',
  async (date) => {
    const { repo, name, id } = await diary();
    await repo.archiveHabit(id, friday);
    await repo.reactivateHabit(id, friday);
    await repo.load(saturday);
    const completedOn = date === '2026-10-03' ? saturday : new Date(2026, 9, 5, 12);
    await repo.setDone(id, date, true, completedOn);
    const before = await repo.load(completedOn);
    await expect(repo.reactivateHabit(id, friday, before.revision)).rejects.toThrow(
      'Historical commitment conflict',
    );
    expect(await stored(name)).toEqual(before);
    const after = await repo.load(completedOn);
    expect(after).toEqual(before);
    expect(after.habits[0].periods).toHaveLength(2);
    expect(after.habits[0].pendingReactivation).toBeUndefined();
    expect(calculateProgress(after, date)).toEqual(calculateProgress(before, date));
    expect(calculateProgress(after, date).totalXp).toBe(10);
    expect(() => serializeBackup(after, completedOn)).not.toThrow();
    const reopened = new Repository(name);
    expect(await reopened.load(completedOn)).toEqual(before);
    await repo.close();
    await reopened.close();
  },
);

test('archival on a revisited earlier date cannot rewrite an already recorded later archive boundary', async () => {
  const { repo, id } = await diary();
  const later = new Date(2026, 9, 4, 12);
  await repo.archiveHabit(id, later);
  const before = await repo.load(later);
  await expect(repo.archiveHabit(id, friday, before.revision)).rejects.toThrow(
    'Historical commitment conflict',
  );
  expect(await repo.load(later)).toEqual(before);
  expect(() => serializeBackup(before, later)).not.toThrow();
  await repo.close();
});

test.each(['archive', 'reactivate'] as const)(
  'pure %s rejects future assigned history without changing caller-owned facts',
  async (action) => {
    const { repo, id } = await diary();
    if (action === 'reactivate') {
      await repo.archiveHabit(id, friday);
      await repo.reactivateHabit(id, friday);
    }
    await repo.setDone(id, '2026-10-03', true, saturday);
    const data = await repo.load(saturday);
    const before = structuredClone(data);
    expect(() => (action === 'archive' ? archiveHabit : reactivateHabit)(data, id, friday)).toThrow(
      DatasetError,
    );
    expect(() => (action === 'archive' ? archiveHabit : reactivateHabit)(data, id, friday)).toThrow(
      'Historical commitment conflict',
    );
    expect(data).toEqual(before);
    await repo.close();
  },
);

test('actual future resumption and off-schedule archive boundaries are protected even without future occurrence rows', async () => {
  const { repo, name, id } = await diary();
  // Make Saturday off schedule: a later Sunday archive has no supporting occurrence.
  await repo.editHabit(
    id,
    { pillarId: 'mind', goal: 'Goal mind', weekdays: [1, 3, 5] },
    new Date(2026, 8, 27, 12),
  );
  const sunday = new Date(2026, 9, 4, 12);
  await repo.archiveHabit(id, sunday);
  const archived = await repo.load(sunday);
  expect(archived.occurrences).toEqual([]);
  await expect(repo.archiveHabit(id, friday, archived.revision)).rejects.toThrow(
    'Historical commitment conflict',
  );
  expect(await stored(name)).toEqual(archived);
  await repo.reactivateHabit(id, sunday);
  const monday = new Date(2026, 9, 5, 12);
  const actual = await repo.load(monday);
  expect(actual.habits[0].periods).toHaveLength(2);
  expect(actual.occurrences).toEqual([]);
  await expect(repo.reactivateHabit(id, sunday, actual.revision)).rejects.toThrow(
    'Historical commitment conflict',
  );
  expect(await stored(name)).toEqual(actual);
  // An archive already recorded on its date remains an exact no-op despite the future period.
  expect(await repo.archiveHabit(id, sunday, actual.revision)).toEqual(actual);
  expect(await stored(name)).toEqual(actual);
  await repo.close();
});

test('ordinary awaiting retries and cancellation keep derived future intent distinct from actual history', async () => {
  const { repo, name, id } = await diary();
  await repo.editHabit(
    id,
    { pillarId: 'mind', goal: 'Goal mind', weekdays: [1, 3, 5] },
    new Date(2026, 8, 27, 12),
  );
  const archived = await repo.archiveHabit(id, friday);
  const pending = await repo.reactivateHabit(id, friday);
  expect(pending.habits[0].periods).toEqual(archived.habits[0].periods);
  expect(await repo.reactivateHabit(id, friday, pending.revision)).toEqual(pending);
  expect(await repo.reactivateHabit(id, saturday, pending.revision)).toEqual(pending);
  const cancelled = await repo.archiveHabit(id, saturday, pending.revision);
  expect({ ...cancelled, revision: archived.revision }).toEqual(archived);
  expect(await stored(name)).toEqual(cancelled);
  await repo.close();
});
