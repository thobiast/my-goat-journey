import { expect, test } from 'vitest';
import { agenda } from '../../src/domain/agenda';
import { makeHabit } from '../../src/domain/creation';
import { editHabit } from '../../src/domain/lifecycle';
import { DEFAULT_PILLARS, type Dataset } from '../../src/domain/types';

test('creation-day first-required feedback uses the effective edited schedule without changing today goal', () => {
  const data: Dataset = {
    schemaVersion: 2,
    revision: 0,
    onboardingComplete: true,
    draft: null,
    settings: { language: 'en', reducedMotion: false },
    pillars: DEFAULT_PILLARS.map((id) => ({ id, name: id, defaultKey: id })),
    habits: [],
    occurrences: [],
    permanentUnlocks: [],
  };
  const habit = makeHabit(
    { pillarId: 'body', goal: 'Original goal', weekdays: [5] },
    '2026-09-30',
    data,
  );
  data.habits.push(habit);
  expect(agenda(data, '2026-09-30')[0].firstRequiredDate).toBe('2026-10-02');
  editHabit(
    data,
    habit.id,
    { pillarId: 'body', goal: 'Future goal', weekdays: [4] },
    new Date(2026, 8, 30, 12),
  );
  expect(agenda(data, '2026-09-30')[0]).toMatchObject({
    kind: 'optional',
    goal: 'Original goal',
    firstRequiredDate: '2026-10-01',
  });
  expect(agenda(data, '2026-10-01')[0]).toMatchObject({ kind: 'required', goal: 'Future goal' });
  expect(data.occurrences).toEqual([]);
});
