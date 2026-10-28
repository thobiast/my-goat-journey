import { expect, test } from 'vitest';
import { Repository } from '../../src/data/database';
import { migrateDataset } from '../../src/data/migrations';
import { agenda } from '../../src/domain/agenda';
import { previewHabitEdit } from '../../src/domain/lifecycle';
import { DEFAULT_PILLARS } from '../../src/domain/types';
import { facts } from '../domain/fixtures';
import { legacyFixture, seed, stored } from './fixtures';

const friday = new Date(2026, 9, 2, 12);
const saturday = new Date(2026, 9, 3, 12);
const monday = new Date(2026, 9, 5, 12);
const move = { pillarId: 'body', goal: 'Read 10 pages', weekdays: [1, 3, 5] };

async function setup() {
  const data = facts();
  data.pillars = DEFAULT_PILLARS.map((id) => ({ id, name: id, defaultKey: id }));
  const name = crypto.randomUUID();
  await seed(name, data);
  return { data, name, repo: new Repository(name) };
}

test('cancelling a future move preserves a locked differing snapshot without claiming another future move', async () => {
  const data = migrateDataset(legacyFixture());
  data.pillars.push({ id: 'third', name: 'Third' });
  const name = crypto.randomUUID();
  await seed(name, data);
  const repo = new Repository(name);
  try {
    const ready = await repo.load(friday);
    const moved = await repo.editHabit(
      'read',
      { ...move, pillarId: 'third', goal: 'New goal' },
      friday,
      ready.revision,
    );
    const input = { ...move, goal: 'Real locked cancellation edit' };
    const preview = previewHabitEdit(moved, 'read', input, friday);
    const saved = await repo.editHabit('read', input, friday, moved.revision);
    expect(saved.habits[0].pendingMove).toBeUndefined();
    expect(saved.habits[0].memberships).toEqual(data.habits[0].memberships);
    expect(saved.occurrences).toEqual(data.occurrences);
    expect(agenda(saved, '2026-10-02')[0]).toMatchObject({
      pillarId: 'music',
      assignmentLocked: true,
      completionProvenance: 'legacy-unknown',
      done: false,
    });
    expect(await stored(name)).toEqual(saved);
    expect(preview).toEqual({
      effectiveFrom: '2026-10-03',
      sourcePillarId: 'music',
      targetPillarId: 'body',
      moveMode: 'preserved',
    });
  } finally {
    await repo.close();
  }
});

test('cancelling a conditional move retargets today but does not invent a future membership date', async () => {
  const { data, repo, name } = await setup();
  try {
    const moved = await repo.editHabit('read', move, friday, 0);
    const input = { ...move, pillarId: 'mind', goal: 'Real cancellation goal edit' };
    const before = structuredClone(moved);
    const preview = previewHabitEdit(moved, 'read', input, friday);
    expect(moved).toEqual(before);
    const saved = await repo.editHabit('read', input, friday, moved.revision);
    const { pendingMove: _pending, ...habit } = moved.habits[0];
    expect(saved).toEqual({
      ...moved,
      revision: moved.revision + 1,
      habits: [
        {
          ...habit,
          memberships: data.habits[0].memberships,
          versions: [
            ...habit.versions,
            { effectiveFrom: '2026-10-03', goal: input.goal, weekdays: move.weekdays },
          ],
        },
      ],
      occurrences: moved.occurrences.map((occurrence) => ({ ...occurrence, pillarId: 'mind' })),
    });
    expect(agenda(saved, '2026-10-02')[0]).toMatchObject({
      pillarId: 'mind',
      kind: 'required',
      pillarParticipation: 'on-completion',
      done: false,
    });
    expect(agenda(saved, '2026-10-05')[0]).toMatchObject({
      pillarId: 'mind',
      kind: 'required',
      pillarParticipation: 'required',
      done: false,
    });
    expect(await stored(name)).toEqual(saved);
    expect(await repo.load(monday)).toEqual(saved);
    expect(preview).toEqual({
      effectiveFrom: '2026-10-03',
      sourcePillarId: 'body',
      targetPillarId: 'mind',
      moveMode: 'conditional',
    });
  } finally {
    await repo.close();
  }
});

test.each(['body', 'mind'])(
  'a revisited %s choice distinguishes settled future membership from cancellable pending intent',
  async (target) => {
    const { data, repo, name } = await setup();
    try {
      const moved = await repo.editHabit('read', move, saturday, 0);
      const settled = await repo.load(monday);
      expect(settled.revision).toBe(moved.revision + 1);
      expect(settled.habits[0].pendingMove).toBeUndefined();
      const input = { ...move, pillarId: target, goal: 'Real settled-history goal edit' };
      const before = structuredClone(settled);
      const preview = previewHabitEdit(settled, 'read', input, friday);
      expect(settled).toEqual(before);
      const saved = await repo.editHabit('read', input, friday, settled.revision);
      expect(saved.habits[0].memberships).toEqual(settled.habits[0].memberships);
      expect(saved.habits[0].versions).toEqual([
        ...data.habits[0].versions,
        { effectiveFrom: '2026-10-03', goal: input.goal, weekdays: move.weekdays },
      ]);
      expect(saved.revision).toBe(settled.revision + 1);
      expect(agenda(saved, '2026-10-02')[0]).toMatchObject({
        pillarId: 'mind',
        kind: 'required',
        done: false,
        pillarParticipation: target === 'body' ? 'required' : 'on-completion',
      });
      expect(agenda(saved, '2026-10-05')[0]).toMatchObject({
        pillarId: 'body',
        pillarParticipation: 'required',
      });
      if (target === 'body') {
        expect(saved.habits[0].pendingMove).toEqual({
          requestedOn: '2026-10-02',
          pillarId: 'body',
        });
        expect(saved.occurrences).toEqual([]);
      } else {
        expect(saved.habits[0].pendingMove).toBeUndefined();
        expect(saved.occurrences).toHaveLength(1);
      }
      expect(await stored(name)).toEqual(saved);
      expect(await repo.load(friday)).toEqual(saved);
      expect(preview).toEqual({
        effectiveFrom: '2026-10-03',
        sourcePillarId: 'mind',
        targetPillarId: target,
        moveMode: target === 'body' ? 'preserved' : 'conditional',
        ...(target === 'body' ? { moveDate: '2026-10-05' } : {}),
      });
    } finally {
      await repo.close();
    }
  },
);
