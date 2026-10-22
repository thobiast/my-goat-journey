import { definitionAt, membershipAt } from '../../domain/agenda';
import { habitState } from '../../domain/lifecycle';
import type { Habit, LocalDate } from '../../domain/types';

export const beforeCreation = (habit: Habit, today: LocalDate) => today < habit.createdOn;

// Stored identity for read-only UI, never an applicable definition or Today item.
export const displayDefinition = (habit: Habit, today: LocalDate) =>
  beforeCreation(habit, today) ? habit.versions[0] : definitionAt(habit, today)!;

export const displayMembership = (habit: Habit, today: LocalDate) =>
  beforeCreation(habit, today) ? habit.memberships[0] : membershipAt(habit, today)!;

export function stateAt(habit: Habit, today: LocalDate) {
  return beforeCreation(habit, today) ? 'waitingToStart' : habitState(habit, today).state;
}
