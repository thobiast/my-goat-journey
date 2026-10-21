import { expect, test } from 'vitest';
import { calculateProgress } from '../../src/domain/progress';
import { facts } from './fixtures';

test('replay reads stored occurrences once rather than scanning them for every date', () => {
  const data = facts();
  for (const date of ['2026-09-28', '2026-09-30', '2026-10-02']) {
    data.occurrences.push({
      habitId: 'read',
      date,
      goal: 'Read 10 pages',
      pillarId: 'mind',
      kind: 'required',
      done: true,
      activationId: 'initial',
      pillarParticipation: 'required',
      completionProvenance: 'credited',
      assignmentLocked: true,
      recordedAt: `${date}T12:00:00Z`,
      timezone: 'UTC',
      offsetMinutes: 0,
    });
  }
  let visits = 0;
  data.occurrences = new Proxy(data.occurrences, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) visits++;
      return Reflect.get(target, key, receiver);
    },
  });
  expect(calculateProgress(data, '2026-10-02').totalXp).toBe(40);
  expect(visits).toBeLessThanOrEqual(data.occurrences.length);
});
