import { expect, test, vi } from 'vitest';
import { Repository } from '../../src/data/database';
import { validateDataset } from '../../src/data/backup';
import { agenda, definitionAt, membershipAt } from '../../src/domain/agenda';
import { previewHabitEdit } from '../../src/domain/lifecycle';
import { DEFAULT_PILLARS } from '../../src/domain/types';
import { facts } from '../domain/fixtures';
import { seed, stored } from './fixtures';

const friday = new Date(2026, 9, 2, 12);
const saturday = new Date(2026, 9, 3, 12);
const move = { pillarId: 'body', goal: 'Read 10 pages', weekdays: [1, 3, 5] };

for (const target of ['body', 'nutrition', 'mind']) {
  test(`revisited goal edit with ${target} compares preview against exact Repository facts`, async () => {
    const data = facts();
    data.pillars = DEFAULT_PILLARS.map((id) => ({ id, name: id, defaultKey: id }));
    const name = crypto.randomUUID();
    await seed(name, data);
    const repo = new Repository(name);
    try {
      const originalAgenda = agenda(data, '2026-10-02');
      const pending = await repo.editHabit('read', move, saturday, 0);
      expect(pending.revision).toBe(1);
      expect(pending.occurrences).toEqual([]);
      expect(pending.habits[0].pendingMove).toEqual({
        requestedOn: '2026-10-03',
        pillarId: 'body',
      });
      expect(pending.habits[0].memberships).toEqual([
        { effectiveFrom: '2026-09-27', pillarId: 'mind' },
        { effectiveFrom: '2026-10-05', pillarId: 'body' },
      ]);
      expect(agenda(pending, '2026-10-02').map(({ habit: _habit, ...item }) => item)).toEqual(
        originalAgenda.map(({ habit: _habit, ...item }) => item),
      );
      expect(originalAgenda[0]).toMatchObject({
        pillarId: 'mind',
        kind: 'required',
        done: false,
        pillarParticipation: 'required',
        completionProvenance: 'never-credited',
        assignmentLocked: false,
      });
      const before = structuredClone(pending);
      const input = { ...move, pillarId: target, goal: '  Read $& notes $$ literally  ' };
      const preview = previewHabitEdit(pending, 'read', input, friday);
      expect(pending).toEqual(before);
      const saved = await repo.editHabit('read', input, friday, pending.revision);
      expect(saved).toEqual({
        ...before,
        revision: 2,
        habits: [
          {
            ...before.habits[0],
            versions: [
              ...data.habits[0].versions,
              { effectiveFrom: '2026-10-03', goal: input.goal, weekdays: move.weekdays },
            ],
            memberships:
              target === 'mind'
                ? data.habits[0].memberships
                : [
                    ...data.habits[0].memberships,
                    { effectiveFrom: '2026-10-05', pillarId: target },
                  ],
            ...(target === 'mind'
              ? {}
              : {
                  pendingMove: {
                    requestedOn: target === 'body' ? '2026-10-03' : '2026-10-02',
                    pillarId: target,
                  },
                }),
          },
        ].map((habit) => {
          if (target === 'mind') delete habit.pendingMove;
          return habit;
        }),
        occurrences:
          target === 'body'
            ? []
            : [
                expect.objectContaining({
                  habitId: 'read',
                  date: '2026-10-02',
                  goal: move.goal,
                  kind: 'required',
                  done: false,
                  pillarId: target,
                  pillarParticipation: 'on-completion',
                  completionProvenance: 'never-credited',
                  assignmentLocked: false,
                }),
              ],
      });
      expect(agenda(saved, '2026-10-02')[0]).toMatchObject({
        pillarId: target === 'body' ? 'mind' : target,
        pillarParticipation: target === 'body' ? 'required' : 'on-completion',
        kind: 'required',
        done: false,
        goal: move.goal,
      });
      expect(membershipAt(saved.habits[0], '2026-10-05')?.pillarId).toBe(target);
      expect(definitionAt(saved.habits[0], '2026-10-03')?.goal).toBe(input.goal);
      expect(validateDataset(saved)).toEqual(saved);
      expect(await stored(name)).toEqual(saved);
      expect(await repo.load(friday)).toEqual(saved);
      const writes = vi.spyOn(IDBObjectStore.prototype, 'put');
      try {
        expect(await repo.editHabit('read', input, friday, saved.revision)).toEqual(saved);
        expect(writes).not.toHaveBeenCalled();
      } finally {
        writes.mockRestore();
      }
      expect(preview).toEqual({
        effectiveFrom: '2026-10-03',
        sourcePillarId: 'mind',
        targetPillarId: target,
        moveMode: target === 'body' ? 'preserved' : 'conditional',
        ...(target === 'mind' ? {} : { moveDate: '2026-10-05' }),
      });
    } finally {
      await repo.close();
    }
  });
}
