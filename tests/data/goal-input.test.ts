import { expect, test, vi } from 'vitest';
import { Repository } from '../../src/data/database';
import { facts } from '../domain/fixtures';
import { seed, stored } from './fixtures';

const friday = new Date(2026, 9, 2, 12);

for (const command of ['create', 'edit'] as const) {
  test(`${command} rejects invalid input without publishing reconciled facts or advancing the revision`, async () => {
    const data = facts();
    data.pillars.push({ id: 'removed', name: 'Removed', removedOn: '2026-10-01' });
    // Reconciliation would clear this due move before the command validates input.
    data.habits[0].pendingMove = { requestedOn: '2026-09-30', pillarId: 'body' };
    data.habits[0].memberships.push({ effectiveFrom: '2026-10-02', pillarId: 'body' });
    const name = crypto.randomUUID();
    await seed(name, data);
    const repo = new Repository(name);
    const writes = vi.spyOn(IDBObjectStore.prototype, 'put');
    try {
      for (const input of [
        { goal: ' \t ', pillarId: 'missing', weekdays: [] },
        { goal: 'Changed goal', pillarId: 'missing', weekdays: [] },
        { goal: 'Changed goal', pillarId: 'removed', weekdays: [1] },
        ...[[], [1.5], [-1], [7]].map((weekdays) => ({
          goal: 'Changed goal',
          pillarId: 'mind',
          weekdays,
        })),
      ]) {
        const original = structuredClone(input);
        await expect(
          command === 'create'
            ? repo.createHabit(input, '2026-10-02', data.revision)
            : repo.editHabit('read', input, friday, data.revision),
        ).rejects.toThrow();
        expect(await stored(name)).toEqual(data);
        expect(input).toEqual(original);
      }
      expect(writes).not.toHaveBeenCalled();
    } finally {
      writes.mockRestore();
      await repo.close();
    }
    const reopened = new Repository(name);
    try {
      // Read before the pending move is due, so this read does not reconcile it.
      expect(await reopened.load(new Date(2026, 8, 30, 12))).toEqual(data);
    } finally {
      await reopened.close();
    }
  });
}
