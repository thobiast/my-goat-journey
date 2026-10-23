import { newIdentity } from './identity';
import { normalizeGoalInput } from './goalInput';
import { parseLocalDate } from './calendar';
import type { Dataset, GoalInput, Habit, LocalDate } from './types';

export function makeHabit(input: GoalInput, today: LocalDate, data: Dataset): Habit {
  parseLocalDate(today);
  const normalized = normalizeGoalInput(data, input);
  return {
    id: newIdentity(),
    createdOn: today,
    versions: [{ goal: normalized.goal, weekdays: normalized.weekdays, effectiveFrom: today }],
    memberships: [{ effectiveFrom: today, pillarId: normalized.pillarId }],
    periods: [{ id: newIdentity(), start: today }],
  };
}
