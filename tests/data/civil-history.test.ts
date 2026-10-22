import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { calculateProgress } from '../../src/domain/progress';
import { parseBackup, serializeBackup, validateDataset } from '../../src/data/backup';
import { Repository } from '../../src/data/database';
import { migrateDataset } from '../../src/data/migrations';
import { agenda } from '../../src/domain/agenda';
import { editableOccurrences, habitHistory, pillarHistory } from '../../src/domain/history';
import type { LegacyDataset } from '../../src/domain/types';
import { civilHistory } from '../helpers/civil-history';
import { seed } from './fixtures';

// Run this file in separate processes with explicit TZ, never mutate process.env.TZ here.
test('a stored Apia-skipped civil date retains its complete derived progress', () => {
  const data = civilHistory();
  expect(calculateProgress(data, '2011-12-31')).toEqual({
    habits: {
      read: { current: 1, best: 1, xp: 10, nextBonus: { threshold: 3, bonusXp: 10, remaining: 2 } },
    },
    pillars: {
      mind: { current: 1, best: 1 },
      body: { current: 0, best: 0 },
      nutrition: { current: 0, best: 0 },
      hygiene: { current: 0, best: 0 },
    },
    overall: { current: 1, best: 1 },
    totalXp: 10,
    level: 1,
    levelProgress: { earnedXp: 10, requiredXp: 100, remainingXp: 90, nextLevel: 2 },
    awards: [
      {
        habitId: 'read',
        date: '2011-12-30',
        activationId: 'initial',
        sequenceId: 'initial:2011-12-30',
        streak: 1,
        baseXp: 10,
        bonusXp: 0,
      },
    ],
  });
});

test('the same historical facts remain exportable and parse without date or timestamp shifts', async () => {
  const data = civilHistory();
  const instant = new Date('2012-01-01T00:30:00.000Z');
  const restored = await parseBackup(serializeBackup(data, instant));
  expect(restored).toEqual({ dataset: data, exportedAt: instant.toISOString() });
  const repository = new Repository(`civil-history-${crypto.randomUUID()}`);
  try {
    const initial = await repository.load(instant);
    const replaced = await repository.replaceDataset(restored.dataset, initial.revision, instant);
    expect(replaced).toEqual({ ...data, revision: replaced.revision });
    await repository.close();
    expect(await repository.load(instant)).toEqual(replaced);
    expect(calculateProgress(replaced, '2011-12-31')).toEqual(
      calculateProgress(data, '2011-12-31'),
    );
  } finally {
    await repository.close();
  }
});

test('habit and pillar histories retain all original facts and the previous correction opportunity', () => {
  const data = civilHistory();
  const before = structuredClone(data);
  const dates = ['2011-12-31', '2011-12-30', '2011-12-29'];
  const items = dates.map((date) => agenda(data, date)[0]);
  const history = items.map((item, index) => ({
    ...item,
    status: ['pending', 'completed', 'optional-uncompleted'][index],
    editable: index < 2,
  }));
  expect(habitHistory(data, 'read', '2011-12-31')).toEqual(history);
  expect(pillarHistory(data, 'mind', '2011-12-31')).toEqual(
    history.map((item) => ({ date: item.date, items: [item] })),
  );
  expect(editableOccurrences(data, 'read', '2011-12-31')).toEqual(items.slice(0, 2));
  expect(data).toEqual(before);
});

test('supported legacy storage and portable migration preserve the skipped-date facts', async () => {
  const current = civilHistory();
  const { revision: _revision, ...facts } = current;
  const legacy: LegacyDataset = {
    ...facts,
    schemaVersion: 1,
    habits: current.habits.map(({ memberships, ...habit }) => ({
      ...habit,
      versions: habit.versions.map((version) => ({
        ...version,
        pillarId: memberships[0].pillarId,
      })),
    })),
    occurrences: current.occurrences.map(
      ({
        activationId: _activation,
        pillarParticipation: _participation,
        completionProvenance: _provenance,
        assignmentLocked: _locked,
        ...occurrence
      }) => occurrence,
    ),
  };
  const before = structuredClone(legacy);
  const expected = { ...current, revision: 1 };
  expect(migrateDataset(legacy)).toEqual(expected);
  expect(validateDataset(legacy)).toEqual(expected);
  const restored = await parseBackup(
    new Blob([
      JSON.stringify({
        format: 'my-goat-journey-backup',
        formatVersion: 1,
        exportedAt: '2012-01-01T00:30:00.000Z',
        dataset: legacy,
      }),
    ]),
  );
  expect(restored.dataset).toEqual(expected);
  const repository = new Repository(`civil-legacy-${crypto.randomUUID()}`);
  try {
    await seed(repository.name, legacy);
    expect(await repository.load(new Date('2012-01-01T00:30:00.000Z'))).toEqual(expected);
    await repository.close();
    expect(await repository.load(new Date('2012-01-01T00:30:00.000Z'))).toEqual(expected);
    expect(
      (await parseBackup(serializeBackup(expected, new Date('2012-01-01T00:30:00.000Z')))).dataset,
    ).toEqual({
      ...expected,
      revision: 0,
    });
  } finally {
    await repository.close();
  }
  expect(calculateProgress(legacy, '2011-12-31')).toEqual(calculateProgress(current, '2011-12-31'));
  expect(legacy).toEqual(before);
});

test.each(['2011-02-29', '1900-02-29', '2011-12-32', '0099-12-30', '10000-12-30'])(
  'portable validation and serialization still reject invalid civil date %s',
  (date) => {
    const data = civilHistory();
    data.occurrences[0].date = date;
    expect(() => validateDataset(data)).toThrow('Invalid or unsupported backup');
    expect(() => serializeBackup(data)).toThrow('Invalid or unsupported backup');
  },
);
