import { expect, test, vi } from 'vitest';
import { Repository } from '../../src/data/database';
import { agenda, definitionAt, membershipAt, summarize } from '../../src/domain/agenda';
import { calculateProgress } from '../../src/domain/progress';
import { facts } from '../domain/fixtures';
import { seed, stored, legacyFixture } from './fixtures';

const friday = new Date(2026, 9, 2, 12);

async function setup(data = facts()) {
  const name = crypto.randomUUID();
  await seed(name, data);
  let fail = false;
  const repo = new Repository(name, () => fail);
  return {
    repo,
    name,
    fail: (value: boolean) => {
      fail = value;
    },
  };
}

const input = { pillarId: 'mind', goal: 'Read 20 pages', weekdays: [2, 4] };

test('effective edits persist tomorrow only; same-day saves replace, revert removes pending, and no-op retries do not write', async () => {
  const { repo, name, fail } = await setup();
  const edited = await repo.editHabit('read', input, friday, 0);
  expect(edited.revision).toBe(1);
  expect(agenda(edited, '2026-10-02')[0]).toMatchObject({
    goal: 'Read 10 pages',
    weekdays: [1, 3, 5],
  });
  expect(definitionAt(edited.habits[0], '2026-10-03')).toMatchObject({
    goal: 'Read 20 pages',
    weekdays: [2, 4],
  });
  expect(agenda(edited, '2026-10-05')).toEqual([]);
  expect(await stored(name)).toEqual(edited);
  fail(true);
  expect(await repo.editHabit('read', input, friday, 1)).toEqual(edited);
  await expect(
    repo.editHabit('read', { ...input, goal: 'Another goal' }, friday, 1),
  ).rejects.toThrow('Persistence failed');
  expect(await stored(name)).toEqual(edited);
  fail(false);
  const replaced = await repo.editHabit('read', { ...input, goal: 'Read 30 pages' }, friday, 1);
  expect(replaced.habits[0].versions).toHaveLength(2);
  const reverted = await repo.editHabit(
    'read',
    { pillarId: 'mind', goal: 'Read 10 pages', weekdays: [5, 3, 1] },
    friday,
    2,
  );
  expect(reverted.habits[0].versions).toEqual(facts().habits[0].versions);
  expect(reverted.habits[0].id).toBe('read');
  const reopened = new Repository(name);
  expect(await reopened.load(friday)).toEqual(reverted);
  await repo.close();
  await reopened.close();
});

test('a pre-credit move keeps habit/daily requirement but destination participation conditional through persisted Undo/Redo', async () => {
  const { repo, name } = await setup();
  const moved = await repo.editHabit(
    'read',
    { pillarId: 'body', goal: 'Read 10 pages', weekdays: [1, 3, 5] },
    friday,
    0,
  );
  const items = agenda(moved, '2026-10-02');
  expect(items[0]).toMatchObject({
    kind: 'required',
    pillarId: 'body',
    pillarParticipation: 'on-completion',
    done: false,
  });
  expect(summarize(items)).toMatchObject({ required: 1, requiredDone: 0, status: 'pending' });
  expect(summarize(items, 'pillar')).toMatchObject({ required: 0, optional: 0, status: 'neutral' });
  expect(
    summarize(
      items.filter((i) => i.pillarId === 'mind'),
      'pillar',
    ).status,
  ).toBe('neutral');
  expect(membershipAt(moved.habits[0], '2026-10-05')?.pillarId).toBe('body');
  expect(moved.occurrences).toHaveLength(1);
  expect(await stored(name)).toEqual(moved);
  const done = await repo.setDone('read', '2026-10-02', true, friday, moved.revision);
  expect(calculateProgress(done, '2026-10-02')).toMatchObject({
    totalXp: 10,
    habits: { read: { current: 1 } },
    pillars: { body: { current: 1 }, mind: { current: 0 } },
    overall: { current: 1 },
  });
  expect(membershipAt(done.habits[0], '2026-10-02')?.pillarId).toBe('body');
  const undone = await repo.setDone('read', '2026-10-02', false, friday, done.revision);
  expect(undone.occurrences[0]).toMatchObject({
    pillarId: 'body',
    pillarParticipation: 'on-completion',
    assignmentLocked: true,
    completionProvenance: 'credited',
  });
  expect(summarize(agenda(undone, '2026-10-02'), 'pillar').status).toBe('neutral');
  const redone = await repo.setDone('read', '2026-10-02', true, friday, undone.revision);
  expect(calculateProgress(redone, '2026-10-02')).toEqual(calculateProgress(done, '2026-10-02'));
  expect(redone.occurrences).toHaveLength(1);
  const reopened = new Repository(name);
  expect(await reopened.load(friday)).toEqual(redone);
  await repo.close();
  await reopened.close();
});

test('load fixes a due move without creating an occurrence, while a pre-due edit rebases it atomically', async () => {
  const { repo, name } = await setup();
  await repo.setDone('read', '2026-10-02', true, friday);
  const moved = await repo.editHabit(
    'read',
    { pillarId: 'body', goal: 'Read 10 pages', weekdays: [1, 3, 5] },
    friday,
  );
  const edited = await repo.editHabit(
    'read',
    { pillarId: 'body', goal: 'Read 20 pages', weekdays: [2] },
    new Date(2026, 9, 3, 12),
    moved.revision,
  );
  expect(edited.habits[0].memberships).toEqual([
    { effectiveFrom: '2026-09-27', pillarId: 'mind' },
    { effectiveFrom: '2026-10-06', pillarId: 'body' },
  ]);
  const due = await repo.load(new Date(2026, 9, 7, 12));
  expect(due.habits[0].pendingMove).toBeUndefined();
  expect(due.revision).toBe(edited.revision + 1);
  expect(due.occurrences).toEqual(edited.occurrences);
  expect(await stored(name)).toEqual(due);
  expect(await repo.load(new Date(2026, 9, 7, 12))).toEqual(due);
});

test.each([
  'credited',
  'ordinary-undo',
  'conditional-undo',
  'off-schedule',
  'legacy-unknown',
  'creation-optional',
] as const)(
  'native move matrix %s survives reload with single locked reward identity',
  async (scenario) => {
    let data = facts();
    if (scenario === 'legacy-unknown') {
      data = (await import('../../src/data/migrations')).migrateDataset(legacyFixture());
      data.habits[0].memberships = [{ effectiveFrom: '2026-09-27', pillarId: 'music' }];
    }
    data.pillars.push({ id: 'third', name: 'Third' });
    const { repo, name } = await setup(data);
    let now = friday;
    const date = scenario === 'creation-optional' ? '2026-09-27' : '2026-10-02';
    if (scenario === 'creation-optional') now = new Date(2026, 8, 27, 12);
    if (scenario === 'off-schedule') now = new Date(2026, 9, 3, 12);
    if (scenario === 'conditional-undo')
      await repo.editHabit(
        'read',
        { pillarId: 'body', goal: 'Read 10 pages', weekdays: [1, 3, 5] },
        friday,
      );
    if (['credited', 'ordinary-undo', 'conditional-undo'].includes(scenario))
      await repo.setDone('read', date, true, friday);
    if (scenario.includes('undo')) await repo.setDone('read', date, false, friday);
    const before = await repo.load(now);
    const target = scenario === 'conditional-undo' ? 'third' : 'body';
    const edited = await repo.editHabit(
      'read',
      { pillarId: target, goal: 'Read 10 pages', weekdays: [1, 3, 5] },
      now,
      before.revision,
    );
    if (scenario === 'off-schedule') expect(agenda(edited, '2026-10-03')).toEqual([]);
    else if (scenario === 'creation-optional')
      expect(agenda(edited, date)[0]).toMatchObject({
        kind: 'optional',
        pillarId: target,
        pillarParticipation: 'on-completion',
      });
    else expect(edited.occurrences).toEqual(before.occurrences);
    expect(
      calculateProgress(edited, scenario === 'off-schedule' ? '2026-10-03' : date).totalXp,
    ).toBe(calculateProgress(before, scenario === 'off-schedule' ? '2026-10-03' : date).totalXp);
    expect(await stored(name)).toEqual(edited);
    const peer = new Repository(name);
    expect(await peer.load(now)).toEqual(edited);
    if (scenario !== 'off-schedule') {
      const done = await repo.setDone('read', date, true, now, edited.revision);
      const occurrence = done.occurrences.find((o) => o.date === date)!;
      expect(occurrence.pillarId).toBe(
        scenario === 'legacy-unknown'
          ? 'music'
          : scenario === 'creation-optional' || scenario === 'conditional-undo'
            ? 'body'
            : 'mind',
      );
      expect(occurrence.pillarParticipation).toBe(
        scenario === 'conditional-undo' || scenario === 'creation-optional'
          ? 'on-completion'
          : 'required',
      );
      const undo = await repo.setDone('read', date, false, now, done.revision);
      const redo = await peer.setDone('read', date, true, now, undo.revision);
      expect(calculateProgress(redo, date)).toEqual(calculateProgress(done, date));
      expect(redo.occurrences.filter((o) => o.date === date)).toHaveLength(1);
      expect(await stored(name)).toEqual(redo);
    }
    await repo.close();
    await peer.close();
  },
);

test.each([false, true])(
  'archive Done=%s immediately preserves earned facts and counts only retained completion through Undo/Redo',
  async (done) => {
    const { repo, name, fail } = await setup();
    await repo.grantPermanentUnlock('owned', friday);
    await repo.setDone('read', '2026-09-30', true, new Date(2026, 8, 30, 12));
    if (done) await repo.setDone('read', '2026-10-02', true, friday);
    const before = await repo.load(friday);
    fail(true);
    await expect(repo.archiveHabit('read', friday, before.revision)).rejects.toThrow(
      'Persistence failed',
    );
    expect(await stored(name)).toEqual(before);
    fail(false);
    const archived = await repo.archiveHabit('read', friday, before.revision);
    expect(archived.habits[0].periods[0]).toMatchObject({
      end: '2026-10-02',
      archivedOn: '2026-10-02',
    });
    const row = archived.occurrences.find((o) => o.date === '2026-10-02')!;
    expect(row).toMatchObject({ done, exempt: true, kind: 'required', pillarId: 'mind' });
    expect(summarize(agenda(archived, '2026-10-02'))).toMatchObject({
      required: done ? 1 : 0,
      requiredDone: done ? 1 : 0,
      status: done ? 'complete' : 'neutral',
    });
    expect(summarize(agenda(archived, '2026-10-02'), 'pillar')).toMatchObject({
      required: done ? 1 : 0,
      requiredDone: done ? 1 : 0,
      status: done ? 'complete' : 'neutral',
    });
    expect(agenda(archived, '2026-10-05')).toEqual([]);
    expect(calculateProgress(archived, '2026-10-02')).toEqual(
      calculateProgress(before, '2026-10-02'),
    );
    expect(archived.permanentUnlocks).toEqual(before.permanentUnlocks);
    fail(true);
    expect(await repo.archiveHabit('read', friday, archived.revision)).toEqual(archived);
    fail(false);
    if (done) {
      const undone = await repo.setDone('read', '2026-10-02', false, friday, archived.revision);
      expect(summarize(agenda(undone, '2026-10-02'))).toMatchObject({
        required: 0,
        status: 'neutral',
      });
      expect(undone.occurrences.find((o) => o.date === '2026-10-02')).toMatchObject({
        exempt: true,
        kind: 'required',
        completionProvenance: 'credited',
        assignmentLocked: true,
        pillarId: 'mind',
      });
      const redone = await repo.setDone('read', '2026-10-02', true, friday, undone.revision);
      expect(summarize(agenda(redone, '2026-10-02'))).toMatchObject({
        required: 1,
        requiredDone: 1,
        status: 'complete',
      });
      expect(calculateProgress(redone, '2026-10-02')).toEqual(
        calculateProgress(archived, '2026-10-02'),
      );
      expect(
        calculateProgress(redone, '2026-10-02').awards.filter((a) => a.date === '2026-10-02'),
      ).toHaveLength(1);
    } else
      await expect(
        repo.setDone('read', '2026-10-02', true, friday, archived.revision),
      ).rejects.toThrow('No eligible');
    const latest = await repo.load(friday);
    const corrected = await repo.setDone('read', '2026-09-30', false, friday, latest.revision);
    expect(corrected.habits[0].periods).toEqual(archived.habits[0].periods);
    expect(await stored(name)).toEqual(corrected);
    const peer = new Repository(name);
    expect(await peer.load(friday)).toEqual(corrected);
    await repo.close();
    await peer.close();
  },
);

test.each(['same-day', 'later-off-day'] as const)(
  'pending reactivation cancellation %s creates no periods/rows, retains old progress and rejects stale request retries',
  async (timing) => {
    const { repo, name, fail } = await setup();
    const life = await import('../../src/domain/lifecycle');
    await repo.setDone('read', '2026-09-30', true, new Date(2026, 8, 30, 12));
    await repo.grantPermanentUnlock('owned', friday);
    const archived = await repo.archiveHabit('read', friday);
    expect(life.habitState(archived.habits[0], '2026-10-02')).toEqual({ state: 'archived' });
    await expect(repo.editHabit('read', input, friday, archived.revision)).rejects.toThrow(
      'Archived',
    );
    const awaiting = await repo.reactivateHabit('read', friday, archived.revision);
    expect(awaiting.habits[0].periods).toEqual(archived.habits[0].periods);
    expect(awaiting.habits[0].pendingReactivation).toMatchObject({ requestedOn: '2026-10-02' });
    expect(life.habitState(awaiting.habits[0], '2026-10-02')).toEqual({
      state: 'awaiting',
      resumesOn: '2026-10-05',
    });
    expect(agenda(awaiting, '2026-10-03')).toEqual([]);
    expect(agenda(awaiting, '2026-10-05')[0]).toMatchObject({
      kind: 'required',
      activationId: awaiting.habits[0].pendingReactivation!.periodId,
    });
    expect(calculateProgress(awaiting, '2026-10-02')).toMatchObject({
      totalXp: 10,
      habits: { read: { current: 0, best: 1, xp: 10 } },
    });
    fail(true);
    expect(await repo.reactivateHabit('read', friday, awaiting.revision)).toEqual(awaiting);
    const now = timing === 'same-day' ? friday : new Date(2026, 9, 3, 12);
    await expect(repo.archiveHabit('read', now, awaiting.revision)).rejects.toThrow(
      'Persistence failed',
    );
    expect(await stored(name)).toEqual(awaiting);
    fail(false);
    const cancelled = await repo.archiveHabit('read', now, awaiting.revision);
    expect({ ...cancelled, revision: archived.revision }).toEqual(archived);
    expect(life.habitState(cancelled.habits[0], '2026-10-05')).toEqual({ state: 'archived' });
    expect(agenda(cancelled, '2026-10-05')).toEqual([]);
    expect(calculateProgress(cancelled, '2026-10-05')).toEqual(
      calculateProgress(archived, '2026-10-05'),
    );
    await expect(repo.reactivateHabit('read', friday, archived.revision)).rejects.toThrow(
      'Stale dataset revision',
    );
    expect(await repo.archiveHabit('read', now, cancelled.revision)).toEqual(cancelled);
    const peer = new Repository(name);
    expect(await peer.load(now)).toEqual(cancelled);
    expect(await stored(name)).toEqual(cancelled);
    const requestedAgain = await repo.reactivateHabit('read', now, cancelled.revision);
    expect(requestedAgain.habits[0].pendingReactivation!.periodId).not.toBe(
      awaiting.habits[0].pendingReactivation!.periodId,
    );
    await repo.close();
    await peer.close();
  },
);

test.each([false, true])(
  'native first-due archival Done=%s reconciles before archiving with an inclusive one-day period',
  async (done) => {
    const { repo, name } = await setup();
    await repo.archiveHabit('read', friday);
    const requested = await repo.reactivateHabit('read', friday);
    const periodId = requested.habits[0].pendingReactivation!.periodId;
    const due = new Date(2026, 9, 5, 12);
    let before = requested;
    if (done) before = await repo.setDone('read', '2026-10-05', true, due, requested.revision);
    const archived = await repo.archiveHabit('read', due, before.revision);
    expect(archived.habits[0].pendingReactivation).toBeUndefined();
    expect(archived.habits[0].periods.at(-1)).toEqual({
      id: periodId,
      start: '2026-10-05',
      end: '2026-10-05',
      reactivatedOn: '2026-10-02',
      archivedOn: '2026-10-05',
    });
    expect(archived.occurrences.find((o) => o.date === '2026-10-05')).toMatchObject({
      done,
      exempt: true,
      kind: 'required',
      activationId: periodId,
    });
    expect(calculateProgress(archived, '2026-10-05').totalXp).toBe(done ? 10 : 0);
    expect(await stored(name)).toEqual(archived);
    const peer = new Repository(name);
    expect(await peer.load(due)).toEqual(archived);
    await repo.close();
    await peer.close();
  },
);

test('reactivation starts a new run at 1, re-earns streak-3 bonus once, and preserves lifetime best/XP and aggregate continuity', async () => {
  const { repo, name } = await setup();
  for (const [day, month] of [
    [28, 8],
    [30, 8],
    [2, 9],
  ]) {
    const now = new Date(2026, month, day, 12);
    const date = month === 8 ? `2026-09-${day}` : '2026-10-02';
    await repo.setDone('read', date, true, now);
  }
  const original = await repo.load(friday);
  expect(calculateProgress(original, '2026-10-02')).toMatchObject({
    totalXp: 40,
    habits: { read: { current: 3, best: 3 } },
  });
  await repo.archiveHabit('read', friday);
  const waiting = await repo.reactivateHabit('read', friday);
  const expectedPeriods = structuredClone(waiting.habits[0].periods);
  expect(calculateProgress(waiting, '2026-10-03')).toMatchObject({
    totalXp: 40,
    habits: { read: { current: 0, best: 3, xp: 40 } },
    pillars: { mind: { current: 3 } },
    overall: { current: 3 },
  });
  let latest = await repo.setDone(
    'read',
    '2026-10-05',
    true,
    new Date(2026, 9, 5, 12),
    waiting.revision,
  );
  expect(calculateProgress(latest, '2026-10-05')).toMatchObject({
    totalXp: 50,
    habits: { read: { current: 1, best: 3 } },
    pillars: { mind: { current: 4 } },
    overall: { current: 4 },
  });
  expect(latest.habits[0].periods.slice(0, -1)).toEqual(expectedPeriods);
  latest = await repo.setDone(
    'read',
    '2026-10-07',
    true,
    new Date(2026, 9, 7, 12),
    latest.revision,
  );
  latest = await repo.setDone(
    'read',
    '2026-10-09',
    true,
    new Date(2026, 9, 9, 12),
    latest.revision,
  );
  const progress = calculateProgress(latest, '2026-10-09');
  expect(progress).toMatchObject({
    totalXp: 80,
    habits: { read: { current: 3, best: 3 } },
    pillars: { mind: { current: 6 } },
    overall: { current: 6 },
  });
  expect(progress.awards.filter((a) => a.bonusXp === 10)).toHaveLength(2);
  const retries = await Promise.all(
    Array.from({ length: 4 }, () =>
      repo.setDone('read', '2026-10-09', true, new Date(2026, 9, 9, 12), latest.revision),
    ),
  );
  expect(retries).toEqual(Array(4).fill(latest));
  expect(await stored(name)).toEqual(latest);
});

test('awaiting edits rebase strict-after first due; late reopening materializes a missed activation without inventing an occurrence', async () => {
  const { repo, name, fail } = await setup();
  await repo.archiveHabit('read', friday);
  const requested = await repo.reactivateHabit('read', friday);
  const edited = await repo.editHabit(
    'read',
    { pillarId: 'mind', goal: 'Read 30 pages', weekdays: [2] },
    new Date(2026, 9, 3, 12),
    requested.revision,
  );
  const life = await import('../../src/domain/lifecycle');
  expect(life.habitState(edited.habits[0], '2026-10-03')).toEqual({
    state: 'awaiting',
    resumesOn: '2026-10-06',
  });
  expect(agenda(edited, '2026-10-05')).toEqual([]);
  const before = structuredClone(edited);
  fail(true);
  await expect(repo.load(new Date(2026, 9, 7, 12))).rejects.toThrow('Persistence failed');
  expect(await stored(name)).toEqual(before);
  fail(false);
  const late = await repo.load(new Date(2026, 9, 7, 12));
  expect(late.habits[0].periods.at(-1)).toEqual({
    id: requested.habits[0].pendingReactivation!.periodId,
    start: '2026-10-06',
    reactivatedOn: '2026-10-02',
  });
  expect(late.habits[0].pendingReactivation).toBeUndefined();
  expect(late.occurrences).toEqual(edited.occurrences);
  expect(life.habitState(late.habits[0], '2026-10-07')).toEqual({ state: 'active' });
  const corrected = await repo.setDone(
    'read',
    '2026-10-06',
    true,
    new Date(2026, 9, 7, 12),
    late.revision,
  );
  expect(calculateProgress(corrected, '2026-10-07')).toMatchObject({
    totalXp: 10,
    habits: { read: { current: 1, best: 1 } },
  });
  expect(await stored(name)).toEqual(corrected);
});

test('conditional target respects other required habits; a closed moved miss breaks habit/daily but no destination or source run', async () => {
  const data = facts();
  const companion = structuredClone(data.habits[0]);
  companion.id = 'walk';
  companion.periods[0].id = 'walk-period';
  companion.memberships[0].pillarId = 'body';
  data.habits.push(companion);
  const { repo } = await setup(data);
  await repo.setDone('read', '2026-09-30', true, new Date(2026, 8, 30, 12));
  await repo.setDone('walk', '2026-09-30', true, new Date(2026, 8, 30, 12));
  const moved = await repo.editHabit(
    'read',
    { pillarId: 'body', goal: 'Read 10 pages', weekdays: [1, 3, 5] },
    friday,
  );
  expect(summarize(agenda(moved, '2026-10-02'), 'pillar')).toMatchObject({
    required: 1,
    requiredDone: 0,
    status: 'pending',
  });
  const walking = await repo.setDone('walk', '2026-10-02', true, friday);
  expect(summarize(agenda(walking, '2026-10-02'), 'pillar')).toMatchObject({
    required: 1,
    requiredDone: 1,
    status: 'complete',
  });
  expect(summarize(agenda(walking, '2026-10-02'))).toMatchObject({
    required: 2,
    requiredDone: 1,
    status: 'pending',
  });
  expect(calculateProgress(walking, '2026-10-03')).toMatchObject({
    habits: { read: { current: 0 }, walk: { current: 2 } },
    pillars: { mind: { current: 1 }, body: { current: 2 } },
    overall: { current: 0 },
  });
  const checkedLater = await repo.setDone(
    'read',
    '2026-10-02',
    true,
    new Date(2026, 9, 3, 12),
    walking.revision,
  );
  expect(
    checkedLater.occurrences.find((o) => o.habitId === 'read' && o.date === '2026-10-02'),
  ).toMatchObject({ pillarId: 'body', pillarParticipation: 'on-completion' });
  expect(calculateProgress(checkedLater, '2026-10-03')).toMatchObject({
    totalXp: 40,
    habits: { read: { current: 2 } },
    pillars: { body: { current: 2 } },
    overall: { current: 2 },
  });
});

test.each(['edit', 'archive', 'reactivate', 'cancel'] as const)(
  '%s actual transaction abort after put retains committed facts and permits deliberate retry',
  async (action) => {
    const { repo, name } = await setup();
    if (action === 'reactivate' || action === 'cancel') await repo.archiveHabit('read', friday);
    if (action === 'cancel') await repo.reactivateHabit('read', friday);
    const before = await repo.load(friday);
    const put = IDBObjectStore.prototype.put;
    const abort = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      const request = put.call(this, value, key);
      this.transaction.abort();
      return request;
    });

    const operation = () =>
      action === 'edit'
        ? repo.editHabit('read', input, friday, before.revision)
        : action === 'reactivate'
          ? repo.reactivateHabit('read', friday, before.revision)
          : repo.archiveHabit('read', friday, before.revision);

    try {
      await expect(operation()).rejects.toThrow();
    } finally {
      abort.mockRestore();
    }
    expect(await stored(name)).toEqual(before);
    const peer = new Repository(name);
    expect(await peer.load(friday)).toEqual(before);
    const retried = await operation();
    expect(retried.revision).toBe(before.revision + 1);
    expect(await stored(name)).toEqual(retried);
    expect(await peer.load(friday)).toEqual(retried);
    await repo.close();
    await peer.close();
  },
);
