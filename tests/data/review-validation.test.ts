import { expect, test, vi } from 'vitest';
import { calculateProgress } from '../../src/domain/progress';
import { agenda } from '../../src/domain/agenda';
import { BackupError, parseBackup, serializeBackup, validateDataset } from '../../src/data/backup';
import { Repository } from '../../src/data/database';
import { DEFAULT_PILLARS, type Dataset } from '../../src/domain/types';
import { stored } from './fixtures';

const now = new Date(2026, 9, 2, 12);

function fresh(): Dataset {
  return {
    schemaVersion: 2,
    revision: 0,
    onboardingComplete: false,
    draft: null,
    settings: { language: 'en', reducedMotion: false },
    pillars: DEFAULT_PILLARS.map((id) => ({ id, name: id, defaultKey: id })),
    habits: [],
    occurrences: [],
    permanentUnlocks: [],
  };
}

async function diary() {
  const repo = new Repository(crypto.randomUUID());
  await repo.saveDraft({
    step: 5,
    goals: DEFAULT_PILLARS.map((pillarId) => ({
      pillarId,
      goal: `Exact ${pillarId}`,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
    })),
  });
  const created = await repo.finalize('2026-09-27');
  const data = await repo.setDone(created.habits[0].id, '2026-10-02', true, now);
  return { repo, data };
}

function file(raw: unknown): Blob {
  return new Blob([
    JSON.stringify({
      format: 'my-goat-journey-backup',
      formatVersion: 1,
      exportedAt: now.toISOString(),
      dataset: raw,
    }),
  ]);
}

test.each(['incomplete-history', 'incomplete-habits', 'completed-draft'] as const)(
  'contradictory onboarding %s fails before confirmation or replacement and retains exact diary',
  async (scenario) => {
    const { repo, data } = await diary();
    const candidate = structuredClone(data);
    if (scenario === 'completed-draft')
      candidate.draft = {
        step: 5,
        goals: DEFAULT_PILLARS.map((pillarId) => ({ pillarId, goal: '', weekdays: [] })),
      };
    else {
      candidate.onboardingComplete = false;
      candidate.draft = {
        step: 5,
        goals: DEFAULT_PILLARS.map((pillarId) => ({
          pillarId,
          goal: `New ${pillarId}`,
          weekdays: [1],
        })),
      };
      if (scenario === 'incomplete-habits') candidate.occurrences = [];
    }
    const tx = vi.spyOn(IDBDatabase.prototype, 'transaction');
    try {
      expect(() => validateDataset(candidate)).toThrow(BackupError);
      await expect(parseBackup(file(candidate))).rejects.toMatchObject({ code: 'invalid' });
      await expect(repo.replaceDataset(candidate, data.revision, now)).rejects.toThrow(BackupError);
      expect(tx).not.toHaveBeenCalled();
    } finally {
      tx.mockRestore();
    }
    expect(await stored(repo.name)).toEqual(data);
    await repo.close();
  },
);

test.each([1, 2])(
  'schema %i partial drafts normalize to ordered default slots, preserve blanks/masks and survive finalize without dangling IDs',
  async (schemaVersion) => {
    const partial = {
      ...fresh(),
      draft: {
        step: 2,
        goals: [
          { pillarId: 'body', goal: '  Body text 🎵  ', weekdays: [6, 0] },
          { pillarId: 'mind', goal: '', weekdays: [] },
        ],
      },
    };
    const { revision: _revision, ...portable } = partial;
    const raw = { ...portable, schemaVersion };
    const normalized = validateDataset(raw);
    expect(normalized.draft).toEqual({
      step: 2,
      goals: [
        { pillarId: 'mind', goal: '', weekdays: [] },
        { pillarId: 'body', goal: '  Body text 🎵  ', weekdays: [6, 0] },
        ...['nutrition', 'hygiene'].map((pillarId) => ({
          pillarId,
          goal: '',
          weekdays: [0, 1, 2, 3, 4, 5, 6],
        })),
      ],
    });
    expect(normalized.habits).toEqual([]);
    expect(normalized.occurrences).toEqual([]);
    expect(raw).toEqual({ ...portable, schemaVersion });
    expect((await parseBackup(file(raw))).dataset).toEqual(normalized);
    const repo = new Repository(crypto.randomUUID());
    const old = await repo.load(now);
    const restored = await repo.replaceDataset(normalized, old.revision, now);
    expect(await stored(repo.name)).toEqual(restored);
    const draft = {
      step: 5,
      goals: restored.draft!.goals.map((g) => ({
        ...g,
        goal: g.goal || `Finished ${g.pillarId}`,
        weekdays: g.weekdays.length ? g.weekdays : [1],
      })),
    };
    const saved = await repo.saveDraft(draft, restored.revision);
    const finalized = await repo.finalize('2026-10-02', saved.revision);
    expect(finalized.habits).toHaveLength(4);
    expect(new Set(finalized.habits.map((h) => h.id)).size).toBe(4);
    expect(finalized.occurrences).toEqual([]);
    expect(finalized.draft).toBeNull();
    expect(validateDataset(finalized)).toEqual(finalized);
    await repo.close();
  },
);

test.each([0, 1, 2, 3, 4, 5])(
  'empty partial draft step %i supplies only blank default slots',
  (step) => {
    const data = fresh();
    data.draft = { step, goals: [] };
    expect(validateDataset(data).draft).toEqual({
      step,
      goals: DEFAULT_PILLARS.map((pillarId) => ({
        pillarId,
        goal: '',
        weekdays: [0, 1, 2, 3, 4, 5, 6],
      })),
    });
  },
);

test.each([
  { step: 2, goals: [{ pillarId: 'custom', goal: 'Valid text', weekdays: [1] }] },
  {
    step: 2,
    goals: [
      { pillarId: 'mind', goal: '', weekdays: [] },
      { pillarId: 'mind', goal: 'different', weekdays: [1] },
    ],
  },
  { step: 6, goals: [] },
  { step: -1, goals: [] },
  { step: 2.5, goals: [] },
  { step: '2', goals: [] },
  { step: 2, goals: [{ pillarId: 'mind', goal: 0, weekdays: [] }] },
  { step: 2, goals: [{ pillarId: 'mind', goal: '', weekdays: [7] }] },
])('impossible partial draft is rejected: %j', (draft) => {
  const data = fresh();
  data.pillars.push({ id: 'custom', name: 'Custom' });
  expect(() => validateDataset({ ...data, draft })).toThrow(BackupError);
});

test.each([true, false])(
  'Friday revisit protects recorded Saturday Done=%s transactionally, identical edit remains no-op, reopen and export retain 10 XP when Done',
  async (done) => {
    const { repo, data } = await diary();
    const id = data.habits[1].id;
    const saturday = new Date(2026, 9, 3, 12);
    const pending = await repo.editHabit(
      id,
      { pillarId: 'body', goal: 'Saturday preserved goal', weekdays: [0, 1, 2, 3, 4, 5, 6] },
      now,
      data.revision,
    );
    const completed = await repo.setDone(id, '2026-10-03', done, saturday, pending.revision);
    const progress = calculateProgress(completed, '2026-10-03');
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    try {
      await expect(
        repo.editHabit(
          id,
          { pillarId: 'body', goal: 'Saturday preserved goal', weekdays: [1] },
          now,
          completed.revision,
        ),
      ).rejects.toThrow('Historical commitment conflict');
      expect(put).not.toHaveBeenCalled();
      const identical = await repo.editHabit(
        id,
        { pillarId: 'body', goal: 'Saturday preserved goal', weekdays: [6, 5, 4, 3, 2, 1, 0] },
        now,
        completed.revision,
      );
      expect(identical).toEqual(completed);
      expect(put).not.toHaveBeenCalled();
    } finally {
      put.mockRestore();
    }
    expect(await stored(repo.name)).toEqual(completed);
    await repo.close();
    const reopened = new Repository(repo.name);
    expect(await reopened.load(saturday)).toEqual(completed);
    expect(agenda(completed, '2026-10-03').find((i) => i.habit.id === id)).toMatchObject({
      date: '2026-10-03',
      goal: 'Saturday preserved goal',
      pillarId: 'body',
      done,
      activationId: completed.habits[1].periods[0].id,
    });
    const exported = (await parseBackup(serializeBackup(await reopened.load(saturday), saturday)))
      .dataset;
    expect(exported).toEqual({ ...completed, revision: 0 });
    expect(calculateProgress(exported, '2026-10-03')).toEqual(progress);
    expect(progress.habits[id].xp).toBe(done ? 10 : 0);
    await reopened.close();
  },
);

test('legitimate incomplete blank review and completed all-archived diary remain supported', async () => {
  const blank = fresh();
  blank.draft = {
    step: 5,
    goals: DEFAULT_PILLARS.map((pillarId) => ({ pillarId, goal: '  ', weekdays: [] })),
  };
  expect(validateDataset(blank)).toEqual(blank);
  expect(validateDataset(fresh())).toEqual(fresh());
  const { repo, data } = await diary();
  for (const h of data.habits) await repo.archiveHabit(h.id, now);
  const archived = await repo.load(now);
  expect(validateDataset(archived)).toEqual(archived);
  expect((await parseBackup(serializeBackup(archived, now))).dataset).toEqual({
    ...archived,
    revision: 0,
  });
  await repo.close();
});
