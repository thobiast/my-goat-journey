import { expect, test } from 'vitest';
import { Repository } from '../../src/data/database';
import { validateDataset, serializeBackup } from '../../src/data/backup';
import { editHabit } from '../../src/domain/lifecycle';
import { DatasetError } from '../../src/domain/errors';
import { stored } from './fixtures';

async function diary() {
  const repo = new Repository(`period-edit-${crypto.randomUUID()}`);
  await repo.saveDraft({
    step: 5,
    goals: ['mind', 'body', 'nutrition', 'hygiene'].map((pillarId) => ({
      pillarId,
      goal: `Goal ${pillarId}`,
      weekdays: [1, 3, 5],
    })),
  });
  const data = await repo.finalize('2026-09-27');
  return { repo, id: data.habits[0].id };
}

const friday = new Date(2026, 9, 2, 12);
const sunday = new Date(2026, 9, 4, 12);
const monday = new Date(2026, 9, 5, 12);

test('revisited edit cannot change an established first-due period with no occurrence rows', async () => {
  const { repo, id } = await diary();
  await repo.archiveHabit(id, sunday);
  await repo.reactivateHabit(id, sunday);
  const before = await repo.load(monday);
  expect(before.occurrences).toEqual([]);
  expect(before.habits[0].periods.at(-1)?.start).toBe('2026-10-05');
  const input = { pillarId: 'mind', goal: 'Goal mind', weekdays: [3] };
  const pure = structuredClone(before);
  expect(() => editHabit(pure, id, input, friday)).toThrow('Historical commitment conflict');
  expect(pure).toEqual(before);
  await expect(repo.editHabit(id, input, friday, before.revision)).rejects.toThrow(
    'Historical commitment conflict',
  );
  const conflict = repo.editHabit(id, input, friday, before.revision);
  await expect(conflict).rejects.toBeInstanceOf(DatasetError);
  await expect(conflict).rejects.toMatchObject({
    name: 'DatasetError',
    code: 'historical-conflict',
    message: 'Historical commitment conflict',
  });
  expect(await stored(repo.name)).toEqual(before);
  expect(await new Repository(repo.name).load(monday)).toEqual(before);
  expect(validateDataset(before)).toEqual(before);
  expect(() => serializeBackup(before, monday)).not.toThrow();
  await repo.close();
});

test('revisited edit cannot invent obligations at a recorded off-schedule archive boundary without occurrence rows', async () => {
  const { repo, id } = await diary();
  const before = await repo.archiveHabit(id, sunday);
  expect(before.occurrences).toEqual([]);
  await expect(
    repo.editHabit(
      id,
      { pillarId: 'mind', goal: 'Goal mind', weekdays: [0] },
      friday,
      before.revision,
    ),
  ).rejects.toThrow('Historical commitment conflict');
  expect(await stored(repo.name)).toEqual(before);
  expect(validateDataset(before)).toEqual(before);
  expect(() => serializeBackup(before, sunday)).not.toThrow();
  await repo.close();
});
