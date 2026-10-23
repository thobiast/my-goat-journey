import { requireActivePillar } from './pillars';
import type { Dataset, GoalInput } from './types';

/** Validate complete command input, preserving literal goal text and caller-owned facts. */
export function normalizeGoalInput(data: Dataset, input: GoalInput): GoalInput {
  if (!input.goal.trim()) throw new Error('Invalid goal or pillar');
  requireActivePillar(data, input.pillarId);
  if (
    !input.weekdays.length ||
    input.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
  )
    throw new Error('Select at least one valid weekday');
  return { ...input, weekdays: [...new Set(input.weekdays)].sort() };
}
