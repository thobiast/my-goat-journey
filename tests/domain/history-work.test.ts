import { expect, test } from 'vitest';
import { habitHistory } from '../../src/domain/history';
import { facts } from './fixtures';

test('a habit history does not evaluate the definitions of unrelated habits', () => {
  const data = facts();
  const unrelated = structuredClone(data.habits[0]);
  unrelated.id = 'unrelated';
  unrelated.periods[0].id = 'unrelated-activation';
  let reads = 0;
  const versions = unrelated.versions;
  Object.defineProperty(unrelated, 'versions', {
    get() {
      reads++;
      return versions;
    },
  });
  data.habits.push(unrelated);
  expect(habitHistory(data, 'read', '2026-10-02')).toHaveLength(4);
  expect(reads).toBe(0);
});
