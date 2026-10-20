import type { GoalInput, Pillar } from '../../domain/types';
import { pillarName } from '../pillars/pillarName';
import type en from '../../i18n/en.json';

export type Copy = typeof en;

/** Selection is the source of truth, including manually selected weekdays. */
export function allWeekdaysSelected(weekdays: number[]): boolean {
  return [0, 1, 2, 3, 4, 5, 6].every((day) => weekdays.includes(day));
}

export function scheduleLabel(weekdays: number[], copy: Copy): string {
  return allWeekdaysSelected(weekdays)
    ? copy.everyDay
    : weekdays.map((day) => copy.shortWeekdays[day]).join(' · ');
}

interface GoalFieldsProps {
  value: GoalInput;
  onChange: (value: GoalInput) => void;
  copy: Copy;
  busy: boolean;
  pillars?: Pillar[];
  compact?: boolean;
  editing?: boolean;
  errors?: { goal?: string; weekdays?: string };
  helpText?: string;
}

export function GoalFields({
  value,
  onChange,
  copy,
  busy,
  pillars,
  compact = false,
  editing = false,
  errors,
  helpText,
}: GoalFieldsProps) {
  const pillarField = pillars && (
    <>
      <label htmlFor="pillar">{copy.pillar}</label>
      <select
        id="pillar"
        disabled={busy}
        value={value.pillarId}
        onChange={(event) => onChange({ ...value, pillarId: event.target.value })}
      >
        {pillars
          .filter((p) => !p.removedOn)
          .map((pillar) => (
            <option value={pillar.id} key={pillar.id}>
              {pillarName(pillar, copy)}
            </option>
          ))}
      </select>
    </>
  );
  return (
    <>
      {!editing && pillarField}
      <label htmlFor="goal">{editing ? copy.habitFieldLabel : copy.goal}</label>
      <textarea
        id="goal"
        rows={compact ? 3 : undefined}
        disabled={busy}
        aria-invalid={errors?.goal ? true : undefined}
        aria-describedby={errors?.goal ? 'goal-help goal-error' : 'goal-help'}
        value={value.goal}
        onChange={(event) => onChange({ ...value, goal: event.target.value })}
      />
      <p id="goal-help">{helpText ?? copy.goalHelp}</p>
      {errors?.goal && (
        <p id="goal-error" className="field-error" role="alert">
          {errors.goal}
        </p>
      )}
      {editing && pillarField}
      <fieldset
        disabled={busy}
        aria-invalid={errors?.weekdays ? true : undefined}
        aria-describedby={errors?.weekdays ? 'weekday-error' : undefined}
      >
        <legend>{copy.frequency}</legend>
        <div className="weekdays">
          {copy.weekdays.map((day, index) => (
            <button
              type="button"
              key={day}
              aria-label={day}
              aria-pressed={value.weekdays.includes(index)}
              onClick={() =>
                onChange({
                  ...value,
                  weekdays: value.weekdays.includes(index)
                    ? value.weekdays.filter((n) => n !== index)
                    : [...value.weekdays, index],
                })
              }
            >
              {copy.shortWeekdays[index]}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={
            allWeekdaysSelected(value.weekdays)
              ? 'every-day-shortcut'
              : 'every-day-shortcut secondary'
          }
          aria-pressed={allWeekdaysSelected(value.weekdays)}
          onClick={() => {
            if (!allWeekdaysSelected(value.weekdays))
              onChange({ ...value, weekdays: [0, 1, 2, 3, 4, 5, 6] });
          }}
        >
          {copy.everyDay}
        </button>
        {errors?.weekdays && (
          <p id="weekday-error" className="field-error" role="alert">
            {errors.weekdays}
          </p>
        )}
      </fieldset>
    </>
  );
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
