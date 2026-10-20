import { expect, test } from 'vitest';
import { Repository } from '../../src/data/database';
import { agenda, summarize } from '../../src/domain/agenda';
import { calculateProgress } from '../../src/domain/progress';
import { facts } from './fixtures';

async function setup(today = '2026-09-30') {
  const repo = new Repository(crypto.randomUUID());
  await repo.saveDraft({
    step: 5,
    goals: ['mind', 'body', 'nutrition', 'hygiene'].map((pillarId) => ({
      pillarId,
      goal: `My ${pillarId} goal`,
      weekdays: [1, 3, 5],
    })),
  });
  return { repo, data: await repo.finalize(today) };
}

test('two scheduled Body goals remain pending after only one required completion and an optional addition', async () => {
  const { repo } = await setup();
  await repo.createHabit(
    { pillarId: 'body', goal: 'Complete my walk', weekdays: [5] },
    '2026-09-30',
  );
  const added = await repo.createHabit(
    { pillarId: 'body', goal: 'Try my new goal', weekdays: [5] },
    '2026-10-02',
  );
  const first = agenda(added, '2026-10-02').find(
    (i) => i.pillarId === 'body' && i.kind === 'required',
  )!;
  const partial = await repo.setDone(first.habit.id, '2026-10-02', true, new Date(2026, 9, 2));
  const body = agenda(partial, '2026-10-02').filter((i) => i.pillarId === 'body');
  expect(summarize(body)).toEqual({
    required: 2,
    requiredDone: 1,
    optional: 1,
    optionalDone: 0,
    status: 'pending',
  });
  const second = body.find((i) => i.kind === 'required' && !i.done)!;
  const complete = await repo.setDone(second.habit.id, '2026-10-02', true, new Date(2026, 9, 2));
  expect(
    summarize(agenda(complete, '2026-10-02').filter((i) => i.pillarId === 'body')).status,
  ).toBe('complete');
});
test('an optional completion participates and Undo restores a neutral first day', async () => {
  const { repo, data } = await setup();
  const id = data.habits[0].id;
  const complete = await repo.setDone(id, '2026-09-30', true, new Date(2026, 8, 30));
  expect(
    summarize(agenda(complete, '2026-09-30').filter((i) => i.pillarId === 'mind')).status,
  ).toBe('complete');
  const undone = await repo.setDone(id, '2026-09-30', false, new Date(2026, 8, 30));
  expect(summarize(agenda(undone, '2026-09-30')).status).toBe('neutral');
});
test('unscheduled dates and dates before creation have no fabricated obligations', async () => {
  const { data } = await setup();
  expect(agenda(data, '2026-10-01')).toHaveLength(0);
  expect(agenda(data, '2026-09-28')).toHaveLength(0);
  expect(agenda(data, '2026-10-02').every((i) => i.kind === 'required')).toBe(true);
});
test('creation-day opportunities are optional even off schedule, with no required obligations', async () => {
  const { data } = await setup('2026-10-01');
  const items = agenda(data, '2026-10-01');
  expect(items).toHaveLength(4);
  expect(items.every((i) => i.kind === 'optional' && i.firstRequiredDate === '2026-10-02')).toBe(
    true,
  );
  expect(summarize(items)).toEqual({
    required: 0,
    requiredDone: 0,
    optional: 4,
    optionalDone: 0,
    status: 'neutral',
  });
});
test('conditional pillar participation does not excuse a required habit or daily commitment', () => {
  const data = facts();
  data.occurrences.push({
    habitId: 'read',
    date: '2026-09-28',
    goal: 'Read 10 pages',
    pillarId: 'body',
    kind: 'required',
    done: false,
    activationId: 'initial',
    pillarParticipation: 'on-completion',
    completionProvenance: 'never-credited',
    assignmentLocked: false,
    recordedAt: '2026-09-28T12:00:00Z',
    timezone: 'UTC',
    offsetMinutes: 0,
  });
  const items = agenda(data, '2026-09-28');
  expect(items[0].kind).toBe('required');
  expect(summarize(items)).toMatchObject({ required: 1, optional: 0, status: 'pending' });
  expect(summarize(items, 'pillar')).toMatchObject({ required: 0, optional: 0, status: 'neutral' });
  expect(calculateProgress(data, '2026-09-29')).toMatchObject({
    overall: { current: 0, best: 0 },
    pillars: { body: { current: 0, best: 0 } },
    totalXp: 0,
  });
  data.occurrences[0].done = true;
  expect(summarize(agenda(data, '2026-09-28'), 'pillar').status).toBe('complete');
  expect(calculateProgress(data, '2026-09-29')).toMatchObject({
    overall: { current: 1, best: 1 },
    pillars: { body: { current: 1, best: 1 } },
    totalXp: 10,
  });
});
