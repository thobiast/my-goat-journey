import './forms.css';
import { useEffect, useState, type ReactNode } from 'react';
import { agenda, definitionAt } from '../../domain/agenda';
import { habitState, previewHabitEdit } from '../../domain/lifecycle';
import { deviceClock } from '../../domain/calendar';
import type { Dataset, GoalInput, Habit, LocalDate } from '../../domain/types';
import { GoalFields } from './GoalFields';
import { sameGoalInput, scheduleLabel, validGoal } from './formPolicy';
import type { Copy } from '../../i18n/copy';
import { displayDate } from '../../presentation/civilDate';
import { pillarName } from '../pillars/pillarName';

interface EditHabitProps {
  data: Dataset;
  habit: Habit;
  today: LocalDate;
  copy: Copy;
  busy: boolean;
  save: (input: GoalInput) => void;
  edited: () => void;
  cancel: () => void;
  dirty: (value: boolean) => void;
  moveFocus?: boolean;
  history?: ReactNode;
}

export function EditHabit({
  data,
  habit,
  today,
  copy,
  busy,
  save,
  edited,
  cancel,
  dirty,
  moveFocus,
  history,
}: EditHabitProps) {
  useEffect(() => {
    if (moveFocus) document.getElementById('pillar')?.focus();
  }, [moveFocus]);
  const current = definitionAt(habit, today)!;
  const pending = habit.versions.at(-1)!;
  const [initial] = useState<GoalInput>({
    goal: pending.goal,
    weekdays: pending.weekdays,
    pillarId: habit.memberships.at(-1)!.pillarId,
  });
  const [value, setValue] = useState<GoalInput>(initial);
  const [attempted, setAttempted] = useState(false);
  const errors = attempted
    ? {
        goal: value.goal.trim() ? undefined : copy.onboardingGoalError,
        weekdays: value.weekdays.length ? undefined : copy.onboardingDayError,
      }
    : undefined;
  const destinationAvailable = data.pillars.some((p) => p.id === value.pillarId && !p.removedOn);
  const applicable = habitState(habit, today).state !== 'archived';
  const preview =
    applicable && destinationAvailable && validGoal(value)
      ? previewHabitEdit(data, habit.id, value, deviceClock.now())
      : undefined;
  if (!applicable || !destinationAvailable)
    return (
      <section>
        <p role="status">{copy.historicalConflict}</p>
        <p className="user-content">{value.goal}</p>
        <button className="secondary" disabled={busy} onClick={cancel}>
          {copy.cancel}
        </button>
        {history}
      </section>
    );
  const item = agenda(data, today).find((i) => i.habit.id === habit.id);

  const name = (id: string) =>
    pillarName(
      data.pillars.find((p) => p.id === id),
      copy,
    );

  const fill = (template: string) =>
    template
      .replace('{date}', displayDate(preview!.moveDate!, data.settings.language))
      .replace('{source}', () => name(preview!.sourcePillarId))
      .replace('{target}', () => name(preview!.targetPillarId));

  const goalChanged = value.goal !== current.goal;
  const scheduleChanged = [0, 1, 2, 3, 4, 5, 6].some(
    (day) => value.weekdays.includes(day) !== current.weekdays.includes(day),
  );
  const definitionChanged = goalChanged || scheduleChanged;
  const definitionDraftChanged = !sameGoalInput({ ...value, pillarId: initial.pillarId }, initial);
  // Saving a pillar draft can also advance a retained future definition on a
  // revisited date. Keep saved timing separate from the command's preview.
  const definitionDateChanged =
    !sameGoalInput(value, initial) &&
    pending.effectiveFrom > today &&
    preview?.effectiveFrom !== pending.effectiveFrom;
  const conditionalDefinition = definitionDraftChanged || definitionDateChanged;
  const effectiveDate = conditionalDefinition ? preview?.effectiveFrom : pending.effectiveFrom;
  const untilValues = [
    goalChanged ? current.goal : undefined,
    scheduleChanged ? scheduleLabel(current.weekdays, copy) : undefined,
  ]
    .filter((value) => value !== undefined)
    .join(' · ');
  return (
    <form
      className="habit-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!validGoal(value)) {
          setAttempted(true);
          requestAnimationFrame(() => {
            const first = !value.goal.trim()
              ? document.getElementById('goal')
              : document.querySelector<HTMLButtonElement>('.weekdays button');
            first?.focus();
          });
          return;
        }
        if (sameGoalInput(value, initial)) {
          cancel();
          return;
        }
        save(value);
      }}
    >
      <GoalFields
        compact
        editing
        value={value}
        onChange={(next) => {
          edited();
          dirty(!sameGoalInput(next, initial));
          setValue(next);
        }}
        copy={copy}
        busy={busy}
        pillars={data.pillars}
        errors={errors}
      />
      {preview && definitionChanged && effectiveDate && (
        <p className="habit-edit-note">
          {(conditionalDefinition ? copy.habitEditIfSaved : copy.habitEditScheduled).replace(
            '{date}',
            displayDate(effectiveDate, data.settings.language),
          )}{' '}
          <span className="user-content">
            {copy.habitEditUntil.replace('{values}', () => untilValues)}
          </span>
        </p>
      )}
      {preview?.moveMode === 'conditional' && (
        <>
          <p>{fill(copy.moveBeforeHelp)}</p>
          <p>{item?.kind === 'optional' ? copy.optionalHelp : copy.requiredToday}</p>
        </>
      )}
      {preview?.moveMode === 'preserved' && (
        <p>
          {fill(
            item?.done
              ? copy.moveCreditedHelp
              : item?.completionProvenance === 'credited'
                ? copy.moveUndoneHelp
                : copy.movePreservedHelp,
          )}
        </p>
      )}
      <div className="action-row">
        <button type="button" className="secondary" disabled={busy} onClick={cancel}>
          {copy.cancel}
        </button>
        <button disabled={busy} type="submit">
          {busy ? copy.saving : copy.saveChanges}
        </button>
      </div>
    </form>
  );
}
