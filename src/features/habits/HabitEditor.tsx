import './forms.css';
import { useState } from 'react';
import type { GoalInput, Pillar } from '../../domain/types';
import { GoalFields } from './GoalFields';
import { sameGoalInput } from './formPolicy';
import type { Copy } from '../../i18n/copy';

interface HabitEditorProps {
  copy: Copy;
  pillars: Pillar[];
  pillarId: string;
  busy: boolean;
  save: (input: GoalInput) => void;
  edited: () => void;
  cancel: () => void;
  dirty?: (value: boolean) => void;
}

export function HabitEditor({
  copy,
  pillars,
  pillarId,
  busy,
  save,
  edited,
  cancel,
  dirty,
}: HabitEditorProps) {
  const activePillarId =
    pillars.find((p) => p.id === pillarId && !p.removedOn)?.id ??
    pillars.find((p) => !p.removedOn)?.id ??
    '';
  const [initial] = useState<GoalInput>({
    pillarId: activePillarId,
    goal: '',
    weekdays: [0, 1, 2, 3, 4, 5, 6],
  });
  const [value, setValue] = useState<GoalInput>(initial);
  return (
    <form
      className="habit-form"
      onSubmit={(event) => {
        event.preventDefault();
        save(value);
      }}
    >
      <GoalFields
        compact
        value={value}
        onChange={(next) => {
          edited();
          dirty?.(!sameGoalInput(next, initial));
          setValue(next);
        }}
        copy={copy}
        busy={busy}
        pillars={pillars}
      />
      <p>{copy.creationOptionalHelp}</p>
      <div className="action-row">
        <button type="button" className="secondary" disabled={busy} onClick={cancel}>
          {copy.cancel}
        </button>
        <button disabled={busy} type="submit">
          {busy ? copy.saving : copy.saveHabit}
        </button>
      </div>
    </form>
  );
}
