import { expect, test } from 'vitest';
import { definitionAt } from '../../src/domain/agenda';
import { makeHabit } from '../../src/domain/creation';
import { editHabit, previewHabitEdit } from '../../src/domain/lifecycle';
import type { Dataset, GoalInput } from '../../src/domain/types';
import { facts } from './fixtures';

const friday = new Date(2026, 9, 2, 12);
const valid = { pillarId: 'body', goal: '  Read a chapter 🎵  ', weekdays: [6, 3, 0, 3, 1, 6] };
const commands = ['create', 'edit', 'preview'] as const;

function run(command: (typeof commands)[number], data: Dataset, input: GoalInput) {
  if (command === 'create') return makeHabit(input, '2026-10-02', data);
  if (command === 'edit') return editHabit(data, 'read', input, friday);
  return previewHabitEdit(data, 'read', input, friday);
}

for (const command of commands) {
  test.each([
    {
      label: 'blank goal before invalid destination and weekdays',
      goal: ' \t\n ',
      pillarId: 'missing',
      weekdays: [],
      message: 'Invalid goal or pillar',
    },
    { label: 'blank goal alone', goal: '   ', message: 'Invalid goal or pillar' },
    {
      label: 'missing destination before invalid weekdays',
      pillarId: 'missing',
      weekdays: [],
      message: 'Select a valid active pillar',
    },
    {
      label: 'removed destination before invalid weekdays',
      pillarId: 'removed',
      weekdays: [7],
      message: 'Select a valid active pillar',
    },
    { label: 'empty weekdays', weekdays: [], message: 'Select at least one valid weekday' },
    {
      label: 'fractional weekday',
      weekdays: [1, 2.5],
      message: 'Select at least one valid weekday',
    },
    { label: 'negative weekday', weekdays: [1, -1], message: 'Select at least one valid weekday' },
    {
      label: 'out-of-range weekday',
      weekdays: [1, 7],
      message: 'Select at least one valid weekday',
    },
  ])(
    `${command} rejects $label without changing caller facts or input`,
    ({ label: _label, message, ...patch }) => {
      const data = facts();
      data.pillars.push({ id: 'removed', name: 'Removed', removedOn: '2026-10-01' });
      const input = { ...valid, ...patch };
      const before = structuredClone(data);
      const original = structuredClone(input);
      expect(() => run(command, data, input)).toThrow(new Error(message));
      expect(data).toEqual(before);
      expect(input).toEqual(original);
    },
  );
}

test('creation preserves literal goals and returns fresh, sorted unique weekdays without mutating caller facts', () => {
  const data = facts();
  const before = structuredClone(data);
  const input = structuredClone(valid);
  const habit = makeHabit(input, '2026-10-02', data);
  const reordered = makeHabit({ ...input, weekdays: [1, 0, 6, 3] }, '2026-10-02', data);
  expect(habit.versions).toEqual([
    { goal: valid.goal, weekdays: [0, 1, 3, 6], effectiveFrom: '2026-10-02' },
  ]);
  expect(reordered.versions).toEqual(habit.versions);
  expect(habit.versions[0].weekdays).not.toBe(input.weekdays);
  expect(input).toEqual(valid);
  expect(data).toEqual(before);
});

test('preview and edits accept the same literal goal and weekday sets without retaining the caller array', () => {
  const data = facts();
  const before = structuredClone(data);
  const input = structuredClone(valid);
  const preview = previewHabitEdit(data, 'read', input, friday);
  expect(preview).toEqual(
    previewHabitEdit(data, 'read', { ...input, weekdays: [1, 6, 3, 0] }, friday),
  );
  expect(data).toEqual(before);
  editHabit(data, 'read', input, friday);
  const version = definitionAt(data.habits[0], preview.effectiveFrom)!;
  expect(version).toEqual({
    goal: valid.goal,
    weekdays: [0, 1, 3, 6],
    effectiveFrom: '2026-10-03',
  });
  expect(version.weekdays).not.toBe(input.weekdays);
  expect(input).toEqual(valid);
  const committed = structuredClone(data);
  editHabit(data, 'read', { ...input, weekdays: [3, 0, 1, 6, 1] }, friday);
  expect(data).toEqual(committed);
  input.weekdays.push(2);
  expect(data).toEqual(committed);
});

test('creation validates its date before invalid GoalInput', () => {
  const data = facts();
  const before = structuredClone(data);
  expect(() =>
    makeHabit({ goal: ' ', pillarId: 'missing', weekdays: [] }, '2026-02-30', data),
  ).toThrow(new Error('Invalid local date'));
  expect(data).toEqual(before);
});

for (const command of ['edit', 'preview'] as const) {
  test(`${command} retains date, entity and archived guards ahead of GoalInput validation`, () => {
    const data = facts();
    const input = { goal: ' ', pillarId: 'missing', weekdays: [] };
    const edit = (habitId: string, now: Date) =>
      command === 'edit'
        ? editHabit(data, habitId, input, now)
        : previewHabitEdit(data, habitId, input, now);
    let before = structuredClone(data);
    expect(() => edit('missing', new Date(NaN))).toThrow(new Error('Invalid lifecycle date'));
    expect(() => edit('missing', friday)).toThrow(new Error('Unknown habit'));
    expect(data).toEqual(before);
    data.habits[0].periods[0].end = '2026-10-01';
    before = structuredClone(data);
    expect(() => edit('read', friday)).toThrow(new Error('Archived habit cannot be edited'));
    expect(data).toEqual(before);
  });
}
