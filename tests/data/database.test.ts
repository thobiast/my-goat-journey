import { expect, test, vi } from 'vitest';
import { Repository } from '../../src/data/database';
import type { OnboardingDraft } from '../../src/domain/types';

const draft: OnboardingDraft = {
  step: 5,
  goals: ['mind', 'body', 'nutrition', 'hygiene'].map((pillarId) => ({
    pillarId,
    goal: `My ${pillarId} goal`,
    weekdays: [1, 3, 5],
  })),
};

const repository = (fail?: () => boolean) => new Repository(crypto.randomUUID(), fail);

test('resumes a persisted draft without creating habits before confirmation', async () => {
  const repo = repository();
  await repo.saveDraft(draft);
  const reopened = new Repository(repo.name);
  expect((await reopened.load()).draft).toEqual(draft);
  expect((await reopened.load()).habits).toHaveLength(0);
});
test('confirmation creates four habits together on the current day and is idempotent', async () => {
  const repo = repository();
  await repo.saveDraft(draft);
  const data = await repo.finalize('2026-10-02');
  expect(data.onboardingComplete).toBe(true);
  expect(data.draft).toBeNull();
  expect(data.habits).toHaveLength(4);
  expect(data.habits.every((h) => h.createdOn === '2026-10-02')).toBe(true);
  expect(new Set(data.habits.map((h) => h.id)).size).toBe(4);
  const retried = await repo.finalize('2026-10-03');
  expect(retried.habits).toEqual(data.habits);
});
test.each([
  { goal: '', weekdays: [1] },
  { goal: 'A goal', weekdays: [] },
])(
  'rejects explicitly configured invalid commitments without partially finalizing setup: %j',
  async (invalid) => {
    const repo = repository();
    const invalidDraft = structuredClone(draft);
    invalidDraft.goals.forEach((goal) => {
      goal.configured = true;
    });
    Object.assign(invalidDraft.goals[2], invalid);
    await repo.saveDraft(invalidDraft);
    await expect(repo.finalize('2026-10-02')).rejects.toThrow();
    const data = await repo.load();
    expect(data.habits).toHaveLength(0);
    expect(data.onboardingComplete).toBe(false);
    expect(data.draft).toEqual(invalidDraft);
  },
);
test('rejects malformed draft weekdays at save without changing committed state', async () => {
  const repo = repository();
  await repo.saveDraft(draft);
  const before = await repo.load();
  const invalidDraft = structuredClone(draft);
  invalidDraft.goals[2].weekdays = [7];
  await expect(repo.saveDraft(invalidDraft)).rejects.toThrow();
  expect(await repo.load()).toEqual(before);
});
test('creates another habit in the same pillar with its own stable identity', async () => {
  const repo = repository();
  await repo.saveDraft(draft);
  await repo.finalize('2026-09-30');
  const data = await repo.createHabit(
    { pillarId: 'body', goal: 'Complete my walk', weekdays: [1, 3, 5] },
    '2026-09-30',
  );
  expect(data.habits.filter((h) => h.memberships[0].pillarId === 'body')).toHaveLength(2);
  expect(new Set(data.habits.map((h) => h.id)).size).toBe(5);
  expect(data.habits[4].versions[0].goal).toBe('Complete my walk');
});
test('today Done and Undo update a single persisted habit/date fact', async () => {
  const repo = repository();
  await repo.saveDraft(draft);
  const data = await repo.finalize('2026-09-30');
  const id = data.habits[1].id;
  const now = new Date(2026, 8, 30, 23, 59);
  await repo.setDone(id, '2026-09-30', true, now);
  await repo.setDone(id, '2026-09-30', true, now);
  expect((await repo.load()).occurrences).toHaveLength(1);
  expect((await repo.load()).occurrences[0]).toMatchObject({
    habitId: id,
    date: '2026-09-30',
    kind: 'optional',
    done: true,
    pillarId: 'body',
    goal: 'My body goal',
  });
  const undone = await repo.setDone(id, '2026-09-30', false, now);
  expect(undone.occurrences).toHaveLength(1);
  expect(undone.occurrences[0].done).toBe(false);
  expect((await new Repository(repo.name).load()).occurrences).toEqual(undone.occurrences);
});
test('Portuguese preference persists without modifying user facts', async () => {
  const repo = repository();
  await repo.saveDraft(draft);
  const before = await repo.finalize('2026-09-30');
  await repo.setSettings({ language: 'pt', reducedMotion: true });
  const after = await new Repository(repo.name).load();
  expect(after.settings).toEqual({ language: 'pt', reducedMotion: true });
  expect(after.habits).toEqual(before.habits);
  expect(after.occurrences).toEqual(before.occurrences);
  expect(after.pillars).toEqual(before.pillars);
});
test('custom pillars have stable identities independent of their entered name', async () => {
  const repo = repository();
  const data = await repo.createPillar('Music');
  expect(data.pillars).toHaveLength(5);
  expect(data.pillars[4]).toMatchObject({ name: 'Music' });
  expect(data.pillars[4].id).not.toBe('Music');
  expect((await new Repository(repo.name).load()).pillars).toEqual(data.pillars);
});
test('a failed finalization leaves the complete draft intact and no partial habits', async () => {
  let fail = false;
  const repo = repository(() => fail);
  await repo.saveDraft(draft);
  fail = true;
  await expect(repo.finalize('2026-09-30')).rejects.toThrow('Persistence failed');
  const failed = await repo.load();
  expect(failed.draft).toEqual(draft);
  expect(failed.onboardingComplete).toBe(false);
  expect(failed.habits).toHaveLength(0);
  fail = false;
  expect((await repo.finalize('2026-09-30')).habits).toHaveLength(4);
});
test('concurrent confirmations serialize without duplicating initial habits', async () => {
  const repo = repository();
  await repo.saveDraft(draft);
  await Promise.all([
    repo.finalize('2026-09-30'),
    new Repository(repo.name).finalize('2026-09-30'),
  ]);
  expect((await repo.load()).habits).toHaveLength(4);
});
test('a failed completion keeps the previously persisted state and retry writes once', async () => {
  let fail = false;
  const repo = repository(() => fail);
  await repo.saveDraft(draft);
  const data = await repo.finalize('2026-09-30');
  const id = data.habits[0].id;
  fail = true;
  await expect(repo.setDone(id, '2026-09-30', true, new Date(2026, 8, 30))).rejects.toThrow();
  expect((await repo.load()).occurrences).toHaveLength(0);
  fail = false;
  expect(
    (await repo.setDone(id, '2026-09-30', true, new Date(2026, 8, 30))).occurrences,
  ).toHaveLength(1);
});
test('rejects unscheduled and future dates but accepts the previous eligible occurrence', async () => {
  const repo = repository();
  await repo.saveDraft(draft);
  const data = await repo.finalize('2026-09-30');
  const id = data.habits[0].id;
  await expect(repo.setDone(id, '2026-10-01', true, new Date(2026, 9, 1))).rejects.toThrow(
    'No eligible',
  );
  await expect(repo.setDone(id, '2026-10-02', true, new Date(2026, 9, 1))).rejects.toThrow(
    'No eligible',
  );
  await repo.setDone(id, '2026-09-30', true, new Date(2026, 9, 2));
  expect((await repo.load()).occurrences).toHaveLength(1);
});
test('invalid settings never corrupt the persisted language', async () => {
  const repo = repository();
  await repo.load();
  await expect(repo.setSettings({ language: 'xx' as 'en' })).rejects.toThrow();
  expect((await repo.load()).settings.language).toBe('en');
});
test('closing a repository releases its IndexedDB connection', async () => {
  const repo = repository();
  await repo.load();
  const close = vi.spyOn(IDBDatabase.prototype, 'close');
  await repo.close();
  expect(close).toHaveBeenCalledOnce();
  close.mockRestore();
  const connection = await indexedDB.databases();
  expect(connection.some((db) => db.name === repo.name)).toBe(true);
});
test('secure random identities work when randomUUID is unavailable on plain-HTTP container origins', async () => {
  const native = globalThis.crypto;
  vi.stubGlobal('crypto', { getRandomValues: native.getRandomValues.bind(native) });
  try {
    const repo = new Repository('plain-http-identity-test');
    await repo.saveDraft(draft);
    const data = await repo.finalize('2026-09-30');
    const custom = await repo.createPillar('Music');
    const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(data.habits.every((h) => pattern.test(h.id) && pattern.test(h.periods[0].id))).toBe(
      true,
    );
    expect(custom.pillars[4].id).toMatch(pattern);
    expect(new Set(data.habits.map((h) => h.id)).size).toBe(4);
    await repo.close();
  } finally {
    vi.unstubAllGlobals();
  }
});
test('initializes an English local dataset with stable default pillars and no fake habits', async () => {
  const repo = repository();
  const data = await repo.load();
  expect(data.settings.language).toBe('en');
  expect(data.pillars.map((p) => p.id)).toEqual(['mind', 'body', 'nutrition', 'hygiene']);
  expect(data.habits).toEqual([]);
  expect(data.permanentUnlocks).toEqual([]);
  expect(data.onboardingComplete).toBe(false);
});
