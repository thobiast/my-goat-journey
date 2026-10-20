import { expect, test, vi } from 'vitest';
import { Repository } from '../../src/data/database';
import { parseBackup, serializeBackup, validateDataset } from '../../src/data/backup';
import { emptyOnboardingDraft } from '../../src/domain/onboarding';
import { DEFAULT_PILLARS, type Dataset, type OnboardingDraft } from '../../src/domain/types';
import { calculateProgress } from '../../src/domain/progress';
import { seed, stored } from './fixtures';

const today = '2026-10-07';
const now = new Date('2026-10-07T12:00:00Z');

function chosenDraft(): OnboardingDraft {
  const draft = emptyOnboardingDraft();
  draft.step = 5;
  draft.goals[1] = {
    pillarId: 'body',
    goal: '  Complete my walk 🎵  ',
    weekdays: [5, 1, 3],
    configured: true,
  };
  draft.goals[0] = {
    pillarId: 'mind',
    goal: 'Retained but skipped',
    weekdays: [],
    configured: false,
  };
  return draft;
}

test.each(DEFAULT_PILLARS)(
  'final confirmation can create one configured habit in %s with all defaults retained',
  async (pillarId) => {
    const repo = new Repository(crypto.randomUUID());
    const initial = await repo.load(now);
    const draft = chosenDraft();
    draft.goals[1].configured = false;
    const slot = draft.goals.find((g) => g.pillarId === pillarId)!;
    Object.assign(slot, { goal: '  Chosen habit  ', weekdays: [5, 1, 3], configured: true });
    const saved = await repo.saveDraft(draft, initial.revision);
    expect(saved.habits).toEqual([]);
    expect(saved.occurrences).toEqual([]);
    expect(calculateProgress(saved, today).totalXp).toBe(0);
    const completed = await repo.finalize(today, saved.revision);
    expect(completed.habits).toHaveLength(1);
    expect(completed.habits[0]).toMatchObject({
      createdOn: today,
      versions: [{ effectiveFrom: today, goal: '  Chosen habit  ', weekdays: [1, 3, 5] }],
      memberships: [{ effectiveFrom: today, pillarId }],
    });
    expect(completed).toMatchObject({
      onboardingComplete: true,
      draft: null,
      revision: saved.revision + 1,
      occurrences: [],
      permanentUnlocks: [],
    });
    expect(completed.pillars).toEqual(initial.pillars);
    expect(await new Repository(repo.name).load(now)).toEqual(completed);
    expect(await repo.finalize(today, completed.revision)).toEqual(completed);
  },
);

test('zero configured goals cannot finalize even with valid retained text', async () => {
  const repo = new Repository(crypto.randomUUID());
  const draft = chosenDraft();
  draft.goals[1].configured = false;
  const saved = await repo.saveDraft(draft);
  await expect(repo.finalize(today, saved.revision)).rejects.toThrow(
    'Configure at least one habit',
  );
  expect(await stored(repo.name)).toEqual(saved);
});

test.each([1, 2])(
  'schema %i backup roundtrip preserves explicit inclusion and review-edit intent',
  async (schemaVersion) => {
    const repo = new Repository(crypto.randomUUID());
    const data = await repo.load(now);
    const draft = { ...chosenDraft(), step: 2, editingReview: true };
    const raw = { ...data, draft, schemaVersion };
    if (schemaVersion === 1) delete (raw as Partial<Dataset>).revision;
    const parsed = validateDataset(raw);
    expect(parsed.draft).toEqual(draft);
    const restored = (await parseBackup(serializeBackup(parsed, now))).dataset;
    expect(restored.draft).toEqual(draft);
    expect(restored.habits).toEqual([]);
    expect(restored.occurrences).toEqual([]);
  },
);

const malformedMetadata = [undefined, null, 0, 1, 'false', [], {}];
test.each(malformedMetadata)(
  'saveDraft rejects nonboolean configured metadata %j without a write',
  async (configured) => {
    const repo = new Repository(crypto.randomUUID());
    const before = await repo.saveDraft(chosenDraft());
    const malformed = chosenDraft();
    Object.assign(malformed.goals[0], { configured });
    await expect(repo.saveDraft(malformed, before.revision)).rejects.toThrow();
    expect(await stored(repo.name)).toEqual(before);
  },
);
test.each(malformedMetadata)(
  'saveDraft rejects nonboolean review-edit metadata %j without a write',
  async (editingReview) => {
    const repo = new Repository(crypto.randomUUID());
    const before = await repo.saveDraft(chosenDraft());
    const malformed = Object.assign(chosenDraft(), { editingReview });
    await expect(repo.saveDraft(malformed, before.revision)).rejects.toThrow();
    expect(await stored(repo.name)).toEqual(before);
  },
);

test.each(malformedMetadata)(
  'strict backup reconstruction rejects nonboolean configured metadata %j',
  async (configured) => {
    const data = await new Repository(crypto.randomUUID()).load(now);
    const draft = chosenDraft();
    Object.assign(draft.goals[0], { configured });
    expect(() => validateDataset({ ...data, draft })).toThrow();
  },
);
test.each(malformedMetadata)(
  'strict backup reconstruction rejects nonboolean review-edit metadata %j',
  async (editingReview) => {
    const data = await new Repository(crypto.randomUUID()).load(now);
    expect(() =>
      validateDataset({ ...data, draft: Object.assign(chosenDraft(), { editingReview }) }),
    ).toThrow();
  },
);

test.each([
  'duplicate pillar',
  'unknown pillar',
  'invalid marker',
  'invalid review intent',
  'invalid step',
])('finalization rejects malformed stored draft: %s', async (kind) => {
  const repo = new Repository(crypto.randomUUID());
  const data = await repo.load(now);
  const draft = chosenDraft();
  if (kind === 'duplicate pillar') draft.goals.push({ ...draft.goals[1] });
  if (kind === 'unknown pillar') draft.goals[0].pillarId = 'unknown';
  if (kind === 'invalid marker') Object.assign(draft.goals[0], { configured: 'false' });
  if (kind === 'invalid review intent') Object.assign(draft, { editingReview: 'true' });
  if (kind === 'invalid step') draft.step = 6;
  const malformed = { ...data, draft };
  await seed(repo.name, malformed);
  await expect(repo.finalize(today, data.revision)).rejects.toThrow();
  expect(await stored(repo.name)).toEqual(malformed);
});

test('navigation, skipped partial edits and later explicit continuation persist only drafts', async () => {
  const repo = new Repository(crypto.randomUUID());
  let draft = emptyOnboardingDraft();
  for (const step of [1, 2, 3, 4, 5, 2]) {
    draft = { ...draft, step, editingReview: step === 2 };
    draft.goals[1] = {
      ...draft.goals[1],
      goal: '  Still editing 🎵  ',
      weekdays: [],
      configured: false,
    };
    const saved = await repo.saveDraft(draft);
    expect((await new Repository(repo.name).load(now)).draft).toEqual(draft);
    expect(saved.habits).toEqual([]);
    expect(saved.occurrences).toEqual([]);
    expect(saved.permanentUnlocks).toEqual([]);
    expect(calculateProgress(saved, today).totalXp).toBe(0);
  }
  draft.goals[1] = { ...draft.goals[1], weekdays: [2], configured: true };
  draft = { ...draft, step: 5, editingReview: false };
  const continued = await repo.saveDraft(draft);
  expect(await repo.saveDraft(draft, continued.revision)).toEqual(continued);
  const completed = await repo.finalize(today, continued.revision);
  expect(completed.habits).toHaveLength(1);
  expect(completed.habits[0].versions[0].goal).toBe('  Still editing 🎵  ');
});

test.each([
  { goal: '   ', weekdays: [1] },
  { goal: 'A goal', weekdays: [] },
])('a selected invalid goal rolls back every habit: %j', async (invalid) => {
  const repo = new Repository(crypto.randomUUID());
  const draft = chosenDraft();
  draft.goals[3] = { pillarId: 'hygiene', ...invalid, configured: true };
  const saved = await repo.saveDraft(draft);
  await expect(repo.finalize(today, saved.revision)).rejects.toThrow();
  expect(await stored(repo.name)).toEqual(saved);
});

test.each(['injected failure', 'native abort'])(
  'finalization failure preserves the exact draft and revision: %s',
  async (mode) => {
    let fail = false;
    const repo = new Repository(crypto.randomUUID(), () => fail);
    const saved = await repo.saveDraft(chosenDraft());
    let put: ReturnType<typeof vi.spyOn> | undefined;
    if (mode === 'injected failure') fail = true;
    else {
      const nativePut = IDBObjectStore.prototype.put;
      put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
        this: IDBObjectStore,
        ...args: Parameters<IDBObjectStore['put']>
      ) {
        const request = nativePut.apply(this, args);
        this.transaction.abort();
        return request;
      });
    }
    try {
      await expect(repo.finalize(today, saved.revision)).rejects.toThrow();
    } finally {
      put?.mockRestore();
      fail = false;
    }
    expect(await stored(repo.name)).toEqual(saved);
    const retried = await repo.finalize(today, saved.revision);
    expect(retried.habits).toHaveLength(1);
    expect(retried.revision).toBe(saved.revision + 1);
  },
);

test('stale and concurrent final confirmations keep optimistic revisions and one habit identity', async () => {
  const repo = new Repository(crypto.randomUUID());
  const saved = await repo.saveDraft(chosenDraft());
  const changed = await repo.setSettings({ language: 'pt' }, saved.revision);
  await expect(repo.finalize(today, saved.revision)).rejects.toThrow('Stale dataset revision');
  expect(await stored(repo.name)).toEqual(changed);
  await Promise.all([repo.finalize(today), new Repository(repo.name).finalize(today)]);
  const completed = await repo.load(now);
  expect(completed.habits).toHaveLength(1);
  expect(completed.revision).toBe(changed.revision + 1);
  await expect(repo.finalize(today, changed.revision)).rejects.toThrow('Stale dataset revision');
  expect(await repo.finalize(today, completed.revision)).toEqual(completed);
});

test.each([1, 2])(
  'legacy schema %i sparse drafts keep missing metadata and partial text',
  async (schemaVersion) => {
    const data = await new Repository(crypto.randomUUID()).load(now);
    const draft = {
      step: 2,
      goals: [
        { pillarId: 'mind', goal: '  Read 🎵  ', weekdays: [3, 1] },
        { pillarId: 'body', goal: '   ', weekdays: [] },
      ],
    };
    const raw = { ...data, schemaVersion, draft };
    if (schemaVersion === 1) delete (raw as Partial<Dataset>).revision;
    const validated = validateDataset(raw);
    expect(validated.draft).toEqual({
      step: 2,
      goals: [
        ...draft.goals,
        ...DEFAULT_PILLARS.slice(2).map((pillarId) => ({
          pillarId,
          goal: '',
          weekdays: [0, 1, 2, 3, 4, 5, 6],
        })),
      ],
    });
    expect(validated.draft).not.toHaveProperty('editingReview');
    expect(validated.draft!.goals.every((g) => !Object.hasOwn(g, 'configured'))).toBe(true);
    const restored = (await parseBackup(serializeBackup(validated, now))).dataset;
    expect(restored.draft).toEqual(validated.draft);
  },
);

test.each([1, 2])(
  'schema %i stored legacy review creates the existing four goals without rewriting completed facts',
  async (schemaVersion) => {
    const repo = new Repository(crypto.randomUUID());
    const data = await repo.load(now);
    const draft = {
      step: 5,
      goals: DEFAULT_PILLARS.map((pillarId) => ({
        pillarId,
        goal: `Existing ${pillarId}`,
        weekdays: [1, 3, 5],
      })),
    };
    const raw = { ...data, schemaVersion, draft };
    if (schemaVersion === 1) delete (raw as Partial<Dataset>).revision;
    await seed(repo.name, raw);
    const loaded = await repo.load(now);
    expect(loaded.draft).toEqual(draft);
    const completed = await repo.finalize(today, loaded.revision);
    expect(completed.habits.map((h) => h.versions[0].goal)).toEqual(draft.goals.map((g) => g.goal));
    expect(await new Repository(repo.name).load(now)).toEqual(completed);
    expect(await repo.saveDraft(chosenDraft(), completed.revision)).toEqual(completed);
    expect(await repo.finalize(today, completed.revision)).toEqual(completed);
  },
);

test('established users can archive the last active habit without losing history or imposing an import minimum', async () => {
  const repo = new Repository(crypto.randomUUID());
  await repo.saveDraft(chosenDraft());
  const completed = await repo.finalize(today);
  const id = completed.habits[0].id;
  const credited = await repo.setDone(id, today, true, now, completed.revision);
  const before = calculateProgress(credited, today);
  const archived = await repo.archiveHabit(id, now, credited.revision);
  expect(archived.habits).toHaveLength(1);
  expect(archived.habits[0].periods[0]).toMatchObject({ end: today, archivedOn: today });
  expect(archived.occurrences[0]).toMatchObject({ habitId: id, done: true });
  expect(calculateProgress(archived, today).totalXp).toBe(before.totalXp);
  expect(validateDataset(archived)).toEqual(archived);
  expect((await parseBackup(serializeBackup(archived, now))).dataset).toEqual({
    ...archived,
    revision: 0,
  });
  expect(validateDataset({ ...completed, habits: [], occurrences: [] })).toEqual({
    ...completed,
    habits: [],
    occurrences: [],
  });
});

test.each([0, 1, 2, 3, 4, 5])(
  'legacy draft at saved step %i only finalizes clearly progressed valid goals',
  async (step) => {
    const repo = new Repository(crypto.randomUUID());
    const draft = {
      step,
      goals: DEFAULT_PILLARS.map((pillarId) => ({
        pillarId,
        goal: `Text ${pillarId}`,
        weekdays: [1],
      })),
    };
    const saved = await repo.saveDraft(draft);
    if (step <= 1) {
      await expect(repo.finalize(today, saved.revision)).rejects.toThrow(
        'Configure at least one habit',
      );
      expect(await stored(repo.name)).toEqual(saved);
    } else {
      const completed = await repo.finalize(today, saved.revision);
      expect(completed.habits.map((h) => h.memberships[0].pillarId)).toEqual(
        DEFAULT_PILLARS.slice(0, step - 1),
      );
    }
  },
);

test('sparse legacy drafts save exactly without eagerly normalizing or setting selection metadata', async () => {
  const repo = new Repository(crypto.randomUUID());
  const draft = { step: 1, goals: [{ pillarId: 'mind', goal: '  In progress  ', weekdays: [] }] };
  const saved = await repo.saveDraft(draft);
  expect(saved.draft).toEqual(draft);
  expect((await new Repository(repo.name).load(now)).draft).toEqual(draft);
  expect(saved.habits).toEqual([]);
});

test.each([2, 3, 4])('all %i explicitly configured goals are created together', async (count) => {
  const repo = new Repository(crypto.randomUUID());
  const draft = emptyOnboardingDraft();
  draft.step = 5;
  draft.goals.forEach((goal, index) =>
    Object.assign(goal, { goal: `Choice ${index}`, configured: index < count }),
  );
  const saved = await repo.saveDraft(draft);
  const completed = await repo.finalize(today, saved.revision);
  expect(completed.habits.map((h) => h.memberships[0].pillarId)).toEqual(
    DEFAULT_PILLARS.slice(0, count),
  );
  expect(completed.revision).toBe(saved.revision + 1);
  expect(completed.occurrences).toEqual([]);
});

test.each(['draft key', 'goal key'])(
  'new metadata does not make backup parsing permissive: %s',
  async (key) => {
    const data = await new Repository(crypto.randomUUID()).load(now);
    const draft = chosenDraft();
    if (key === 'draft key') Object.assign(draft, { unexpected: true });
    else Object.assign(draft.goals[0], { unexpected: true });
    expect(() => validateDataset({ ...data, draft })).toThrow();
  },
);

test('absent saved draft cannot finalize setup', async () => {
  const repo = new Repository(crypto.randomUUID());
  const initial = await repo.load(now);
  await expect(repo.finalize(today, initial.revision)).rejects.toThrow(
    'Configure at least one habit',
  );
  expect(await stored(repo.name)).toEqual(initial);
});
