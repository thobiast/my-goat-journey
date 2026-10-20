import { newIdentity } from './identity';
import { requireActivePillar } from './pillars';
import { parseLocalDate } from './calendar';
import type { Dataset, GoalInput, Habit, LocalDate } from './types';

export function makeHabit(input: GoalInput, today: LocalDate, data: Dataset): Habit {
  parseLocalDate(today);
  if (!input.goal.trim()) throw new Error('Invalid goal or pillar');
  requireActivePillar(data, input.pillarId);
  if (
    !input.weekdays.length ||
    input.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
  )
    throw new Error('Select at least one valid weekday');
  return {
    id: newIdentity(),
    createdOn: today,
    versions: [
      { goal: input.goal, weekdays: [...new Set(input.weekdays)].sort(), effectiveFrom: today },
    ],
    memberships: [{ effectiveFrom: today, pillarId: input.pillarId }],
    periods: [{ id: newIdentity(), start: today }],
  };
}
