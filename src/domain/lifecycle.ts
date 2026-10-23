import {
  activationAt,
  agenda,
  definitionAt,
  membershipAt,
  nextHabitScheduledDate,
  pendingReactivationDate,
} from './agenda';
import { newIdentity } from './identity';
import { DatasetError } from './errors';
import { requireActivePillar } from './pillars';
import { normalizeGoalInput } from './goalInput';
import { civilDate, localDate, parseLocalDate } from './calendar';
import { updateCompletion } from './completion';
import type { Dataset, GoalInput, Habit, LocalDate } from './types';

function habitIn(data: Dataset, habitId: string): Habit {
  const habit = data.habits.find((h) => h.id === habitId);
  if (!habit) throw new Error('Unknown habit');
  return habit;
}

function requestDate(now: Date): LocalDate {
  if (Number.isNaN(now.getTime())) throw new Error('Invalid lifecycle date');
  return localDate(now);
}

function tomorrow(today: LocalDate): LocalDate {
  const date = parseLocalDate(today);
  date.setUTCDate(date.getUTCDate() + 1);
  return civilDate(date);
}

function editDefinition(habit: Habit, input: GoalInput, today: LocalDate): void {
  const current = definitionAt(habit, today);
  if (!current) throw new Error('No current definition');
  const effectiveFrom = tomorrow(today);
  const pending = habit.versions.find((v) => v.effectiveFrom === effectiveFrom);
  if (
    pending &&
    pending.goal === input.goal &&
    JSON.stringify([...pending.weekdays].sort()) === JSON.stringify(input.weekdays)
  )
    return;
  habit.versions = habit.versions.filter((v) => v.effectiveFrom !== effectiveFrom);
  if (
    input.goal !== current.goal ||
    JSON.stringify(input.weekdays) !== JSON.stringify([...current.weekdays].sort())
  ) {
    habit.versions.push({ effectiveFrom, goal: input.goal, weekdays: input.weekdays });
    habit.versions.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  }
}

export function pendingMoveDate(habit: Habit): LocalDate | undefined {
  return habit.pendingMove
    ? nextHabitScheduledDate(habit, habit.pendingMove.requestedOn)
    : undefined;
}

/** Once due, keep the actual dated membership; edits may only rebase not-yet-due intent. */
export function reconcilePendingMove(habit: Habit, today: LocalDate): void {
  const due = pendingMoveDate(habit);
  if (due && due <= today) delete habit.pendingMove;
}

export function reconcileHabit(habit: Habit, today: LocalDate): void {
  reconcilePendingMove(habit, today);
  const start = pendingReactivationDate(habit);
  if (start && start <= today) {
    habit.periods.push({
      id: habit.pendingReactivation!.periodId,
      start,
      reactivatedOn: habit.pendingReactivation!.requestedOn,
    });
    delete habit.pendingReactivation;
  }
}

export interface HabitState {
  state: 'active' | 'archived' | 'awaiting';
  resumesOn?: LocalDate;
}

export function habitState(habit: Habit, today: LocalDate): HabitState {
  parseLocalDate(today);
  const resumesOn = pendingReactivationDate(habit);
  if (resumesOn && habit.pendingReactivation!.requestedOn <= today) {
    return resumesOn > today ? { state: 'awaiting', resumesOn } : { state: 'active' };
  }
  return {
    state: habit.periods.some((p) => p.start <= today && (!p.end || p.end > today))
      ? 'active'
      : 'archived',
  };
}

export interface HabitEditPreview {
  effectiveFrom: LocalDate;
  moveDate?: LocalDate;
  sourcePillarId: string;
  targetPillarId: string;
  moveMode: 'none' | 'conditional' | 'preserved';
}

export function previewHabitEdit(
  data: Dataset,
  habitId: string,
  input: GoalInput,
  now: Date,
): HabitEditPreview {
  const today = requestDate(now);
  const habit = structuredClone(habitIn(data, habitId));
  if (habitState(habit, today).state === 'archived')
    throw new Error('Archived habit cannot be edited');
  const normalized = normalizeGoalInput(data, input);
  reconcilePendingMove(habit, today);
  const item = agenda(data, today).find((i) => i.habit.id === habitId);
  const sourcePillarId = item?.pillarId ?? membershipAt(habit, today)!.pillarId;
  const moving =
    sourcePillarId !== normalized.pillarId || habit.pendingMove?.pillarId === normalized.pillarId;
  const requestedOn =
    habit.pendingMove?.pillarId === normalized.pillarId ? habit.pendingMove.requestedOn : today;
  editDefinition(habit, normalized, today);
  return {
    effectiveFrom: tomorrow(today),
    sourcePillarId,
    targetPillarId: normalized.pillarId,
    moveMode: !moving
      ? 'none'
      : item &&
          !item.exempt &&
          !item.assignmentLocked &&
          item.completionProvenance === 'never-credited'
        ? 'conditional'
        : 'preserved',
    ...(moving ? { moveDate: nextHabitScheduledDate(habit, requestedOn) } : {}),
  };
}

/** Recorded future commitments survive a local-date revisit; previews stay nonthrowing. */
export function editHabit(data: Dataset, habitId: string, input: GoalInput, now: Date): void {
  const today = requestDate(now);
  const before = habitIn(data, habitId);
  const proposed = structuredClone(data);
  applyHabitEdit(proposed, habitId, input, now);
  const after = habitIn(proposed, habitId);

  const definitionKey = (habit: Habit, date: LocalDate) => {
    const version = definitionAt(habit, date);
    return version && JSON.stringify([version.goal, [...version.weekdays].sort()]);
  };

  const records = data.occurrences.filter((o) => o.habitId === habitId && o.date > today);
  const periodDates = before.periods.flatMap((period) =>
    [period.start, period.end, period.archivedOn, period.reactivatedOn].filter(
      (date): date is LocalDate => date !== undefined,
    ),
  );
  const lastKnownDate = [...records.map((o) => o.date), ...periodDates].sort().at(-1);
  if (lastKnownDate && lastKnownDate > today) {
    // Actual period boundaries are history even without occurrence rows. Keep their
    // defining timeline intact, including intervening misses leading to recorded credit.
    const boundaries = new Set([
      tomorrow(today),
      ...before.versions.map((v) => v.effectiveFrom),
      ...after.versions.map((v) => v.effectiveFrom),
      ...before.memberships.map((v) => v.effectiveFrom),
      ...after.memberships.map((v) => v.effectiveFrom),
    ]);
    for (const date of boundaries) {
      if (
        date > today &&
        date <= lastKnownDate &&
        (definitionKey(before, date) !== definitionKey(after, date) ||
          membershipAt(before, date)?.pillarId !== membershipAt(after, date)?.pillarId)
      )
        throw new DatasetError('historical-conflict');
    }
  }
  for (const occurrence of records) {
    const date = occurrence.date;
    const period = activationAt(before, date);
    const proposedPeriod = activationAt(after, date);

    const resumption = (habit: Habit) =>
      period?.reactivatedOn && nextHabitScheduledDate(habit, period.reactivatedOn);

    if (
      definitionKey(before, date) !== definitionKey(after, date) ||
      membershipAt(before, date)?.pillarId !== membershipAt(after, date)?.pillarId ||
      JSON.stringify(period) !== JSON.stringify(proposedPeriod) ||
      resumption(before) !== resumption(after)
    )
      throw new DatasetError('historical-conflict');
  }
  // Publish only after the complete proposed edit has passed the recorded-history guard.
  data.habits[data.habits.indexOf(before)] = after;
  data.occurrences = proposed.occurrences;
}

/** Apply prospective definitions and membership independently of dated occurrence snapshots. */
function applyHabitEdit(data: Dataset, habitId: string, input: GoalInput, now: Date): void {
  const today = requestDate(now);
  const habit = habitIn(data, habitId);
  if (habitState(habit, today).state === 'archived')
    throw new Error('Archived habit cannot be edited');
  const normalized = normalizeGoalInput(data, input);
  reconcileHabit(habit, today);
  const previousIntent = habit.pendingMove;
  const previousDue = pendingMoveDate(habit);
  const owner = habit.memberships.at(-1)!.pillarId;
  const item = agenda(data, today).find((i) => i.habit.id === habitId);
  if (previousDue)
    habit.memberships = habit.memberships.filter((m) => m.effectiveFrom !== previousDue);
  delete habit.pendingMove;
  editDefinition(habit, normalized, today);
  if (owner !== normalized.pillarId && item && !item.exempt) {
    updateCompletion(data, habitId, today, item.done, now);
    const occurrence = data.occurrences.find((o) => o.habitId === habitId && o.date === today)!;
    if (!occurrence.assignmentLocked && occurrence.completionProvenance === 'never-credited') {
      occurrence.pillarId = normalized.pillarId;
      occurrence.pillarParticipation = 'on-completion';
    }
  }
  if (membershipAt(habit, today)!.pillarId !== normalized.pillarId) {
    const requestedOn =
      previousIntent?.pillarId === normalized.pillarId ? previousIntent.requestedOn : today;
    habit.pendingMove = { requestedOn, pillarId: normalized.pillarId };
    const effectiveFrom = pendingMoveDate(habit)!;
    habit.memberships = habit.memberships.filter((m) => m.effectiveFrom !== effectiveFrom);
    habit.memberships.push({ effectiveFrom, pillarId: normalized.pillarId });
    habit.memberships.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  } else if (
    previousIntent &&
    previousIntent.requestedOn < today &&
    data.occurrences.some(
      (o) =>
        o.habitId === habitId &&
        o.date === previousIntent.requestedOn &&
        o.pillarId === previousIntent.pillarId &&
        o.pillarParticipation === 'on-completion' &&
        o.completionProvenance === 'never-credited',
    )
  ) {
    // A later cancellation is a dated decision, even when it repeats the source.
    // First credit of the earlier conditional occurrence may still anticipate its
    // own move, but must stop at this decision rather than owning the future.
    habit.memberships = habit.memberships.filter((m) => m.effectiveFrom !== today);
    habit.memberships.push({ effectiveFrom: today, pillarId: normalized.pillarId });
    habit.memberships.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  }
}

/** Dry-run activation changes so a revisited date cannot erase known later history. */
function changeActivation(
  data: Dataset,
  habitId: string,
  now: Date,
  apply: (proposed: Dataset, habitId: string, now: Date) => void,
): void {
  const today = requestDate(now);
  const before = habitIn(data, habitId);
  const proposed = structuredClone(data);
  apply(proposed, habitId, now);
  const after = habitIn(proposed, habitId);

  const activationKey = (habit: Habit) =>
    JSON.stringify([habit.periods, habit.pendingReactivation]);

  const changed = activationKey(before) !== activationKey(after);
  if (
    changed &&
    (data.occurrences.some((o) => o.habitId === habitId && o.date > today) ||
      before.periods.some((p) =>
        [p.start, p.end, p.archivedOn, p.reactivatedOn].some((date) => date && date > today),
      ) ||
      (before.pendingReactivation && before.pendingReactivation.requestedOn > today))
  ) {
    throw new DatasetError('historical-conflict');
  }
  // Pending first-due intent alone is not actual history: ordinary cancellation is legal.
  data.habits[data.habits.indexOf(before)] = after;
  data.occurrences = proposed.occurrences;
}

/** Close only the active interval and excuse unfinished archival-day participation. */
export function archiveHabit(data: Dataset, habitId: string, now: Date): void {
  changeActivation(data, habitId, now, applyHabitArchive);
}

function applyHabitArchive(data: Dataset, habitId: string, now: Date): void {
  const today = requestDate(now);
  const habit = habitIn(data, habitId);
  reconcileHabit(habit, today);
  if (habit.pendingReactivation && pendingReactivationDate(habit)! > today) {
    delete habit.pendingReactivation;
    return;
  }
  const period = habit.periods.find((p) => p.start <= today && (!p.end || p.end >= today));
  if (!period || period.archivedOn === today) return;
  const item = agenda(data, today).find((i) => i.habit.id === habitId);
  if (item) {
    updateCompletion(data, habitId, today, item.done, now);
    data.occurrences.find((o) => o.habitId === habitId && o.date === today)!.exempt = true;
  }
  period.end = today;
  period.archivedOn = today;
}

/** Reserve a period identity; no actual interval or optional opportunity exists before first due. */
export function reactivateHabit(data: Dataset, habitId: string, now: Date): void {
  changeActivation(data, habitId, now, applyHabitReactivation);
}

/** Choose the destination and reserve activation together; past assignments stay intact. */
export function reactivateHabitInPillar(
  data: Dataset,
  habitId: string,
  pillarId: string,
  now: Date,
): void {
  changeActivation(data, habitId, now, (proposed, id, date) =>
    applyHabitReactivation(proposed, id, date, pillarId),
  );
}

function applyHabitReactivation(
  data: Dataset,
  habitId: string,
  now: Date,
  destination?: string,
): void {
  const today = requestDate(now);
  const habit = habitIn(data, habitId);
  reconcileHabit(habit, today);
  const pillarId = destination ?? habit.memberships.at(-1)!.pillarId;
  requireActivePillar(data, pillarId);
  if (habitState(habit, today).state !== 'archived') {
    if (pillarId !== habit.memberships.at(-1)!.pillarId)
      throw new Error('Archive habit before reactivation in another pillar');
    return;
  }
  if (pillarId !== habit.memberships.at(-1)!.pillarId) {
    const pendingDate = pendingMoveDate(habit);
    if (pendingDate)
      habit.memberships = habit.memberships.filter((m) => m.effectiveFrom !== pendingDate);
    habit.pendingMove = { requestedOn: today, pillarId };
    const effectiveFrom = pendingMoveDate(habit)!;
    habit.memberships = habit.memberships.filter((m) => m.effectiveFrom !== effectiveFrom);
    habit.memberships.push({ effectiveFrom, pillarId });
    habit.memberships.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  }
  habit.pendingReactivation = { periodId: newIdentity(), requestedOn: today };
}
