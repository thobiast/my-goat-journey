import { expect, test } from 'vitest';
import * as history from '../../src/domain/history';
import { updateCompletion } from '../../src/domain/completion';
import { calculateProgress } from '../../src/domain/progress';
import { facts } from './fixtures';

test('Friday selects Friday and missed implicit Wednesday, not last success; Saturday selects Friday alone', () => {
  const data = facts();
  updateCompletion(data, 'read', '2026-09-28', true, new Date(2026, 8, 28, 12));
  expect(
    history.editableOccurrences(data, 'read', '2026-10-02').map((i) => [i.date, i.done]),
  ).toEqual([
    ['2026-10-02', false],
    ['2026-09-30', false],
  ]);
  expect(history.editableOccurrences(data, 'read', '2026-10-03').map((i) => i.date)).toEqual([
    '2026-10-02',
  ]);
  const before = structuredClone(data);
  for (const date of ['2026-09-26', '2026-09-28', '2026-10-01', '2026-10-03'])
    expect(() => updateCompletion(data, 'read', date, true, new Date(2026, 9, 2, 12))).toThrow();
  expect(data).toEqual(before);
});
test('history synthesizes missed and optional-neutral rows without storing facts', () => {
  const data = facts();
  const before = structuredClone(data);
  const rows = history.habitHistory(data, 'read', '2026-10-02');
  expect(rows.map((r) => [r.date, r.status, r.editable])).toEqual([
    ['2026-10-02', 'pending', true],
    ['2026-09-30', 'missed', true],
    ['2026-09-28', 'missed', false],
    ['2026-09-27', 'optional-uncompleted', false],
  ]);
  expect(data).toEqual(before);
});
test('historical schedule and valid periods control previous eligibility, including optional creation and archived gaps', () => {
  const data = facts();
  data.habits[0].versions.push({
    effectiveFrom: '2026-10-01',
    goal: 'Read 20 pages',
    weekdays: [4],
  });
  expect(
    history.editableOccurrences(data, 'read', '2026-10-02').map((i) => [i.date, i.goal]),
  ).toEqual([['2026-10-01', 'Read 20 pages']]);
  data.habits[0].periods[0].end = '2026-09-30';
  expect(history.editableOccurrences(data, 'read', '2026-10-02').map((i) => i.date)).toEqual([
    '2026-09-30',
  ]);
  expect(history.editableOccurrences(data, 'read', '2026-09-28').map((i) => i.date)).toEqual([
    '2026-09-28',
    '2026-09-27',
  ]);
  updateCompletion(data, 'read', '2026-09-30', true, new Date(2026, 9, 2, 12));
  expect(data.habits[0].periods[0].end).toBe('2026-09-30');
  expect(data.occurrences[0]).toMatchObject({
    goal: 'Read 10 pages',
    activationId: 'initial',
    pillarId: 'mind',
  });
});
test('retained credited exemption stays correctable after Undo, while an unfinished exemption is neutral and not a new opportunity', () => {
  const data = facts();
  updateCompletion(data, 'read', '2026-09-28', true, new Date(2026, 8, 28, 12));
  updateCompletion(data, 'read', '2026-09-30', false, new Date(2026, 8, 30, 12));
  data.occurrences[1].exempt = true;
  data.habits[0].periods[0].end = '2026-09-30';
  expect(history.habitHistory(data, 'read', '2026-10-01')[0]).toMatchObject({
    date: '2026-09-30',
    status: 'exempt',
    editable: false,
  });
  expect(history.editableOccurrences(data, 'read', '2026-10-01').map((i) => i.date)).toEqual([
    '2026-09-28',
  ]);
  expect(calculateProgress(data, '2026-10-01')).toMatchObject({
    totalXp: 10,
    habits: { read: { current: 1, best: 1 } },
    overall: { current: 1, best: 1 },
  });
  data.occurrences[1].completionProvenance = 'credited';
  data.occurrences[1].assignmentLocked = true;
  updateCompletion(data, 'read', '2026-09-30', true, new Date(2026, 9, 1, 12));
  updateCompletion(data, 'read', '2026-09-30', false, new Date(2026, 9, 1, 12));
  expect(data.occurrences[1]).toMatchObject({
    exempt: true,
    done: false,
    completionProvenance: 'credited',
    assignmentLocked: true,
  });
  expect(history.editableOccurrences(data, 'read', '2026-10-01').map((i) => i.date)).toEqual([
    '2026-09-30',
  ]);
});
