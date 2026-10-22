import type { GoalInput } from '../../domain/types';
import type { Copy } from '../../i18n/copy';

/** Selection is the source of truth, including manually selected weekdays. */
export function allWeekdaysSelected(weekdays: number[]): boolean {
  return [0, 1, 2, 3, 4, 5, 6].every((day) => weekdays.includes(day));
}

export function scheduleLabel(weekdays: number[], copy: Copy): string {
  return allWeekdaysSelected(weekdays)
    ? copy.everyDay
    : weekdays.map((day) => copy.shortWeekdays[day]).join(' · ');
}

export function sameGoalInput(left: GoalInput, right: GoalInput): boolean {
  const leftDays = new Set(left.weekdays);
  const rightDays = new Set(right.weekdays);
  return (
    left.goal === right.goal &&
    left.pillarId === right.pillarId &&
    leftDays.size === rightDays.size &&
    [...leftDays].every((day) => rightDays.has(day))
  );
}

export function validGoal(value: GoalInput) {
  return !!value.goal.trim() && value.weekdays.length > 0;
}
