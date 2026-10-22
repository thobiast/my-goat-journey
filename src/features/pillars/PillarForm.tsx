import { useEffect, useState } from 'react';
import type { Copy } from '../habits/GoalFields';

interface PillarFormProps {
  name: string;
  copy: Copy;
  busy: boolean;
  cancel: () => void;
  save: (name: string) => void;
  edited: () => void;
  rename: boolean;
  dirty?: (value: boolean) => void;
}

export function PillarForm({
  name,
  copy,
  busy,
  cancel,
  save,
  edited,
  rename,
  dirty,
}: PillarFormProps) {
  const [value, setValue] = useState(name);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => dirty?.(value !== name), [value, name, dirty]);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!value.trim()) {
          setInvalid(true);
          document.getElementById('pillar-name')?.focus();
          return;
        }
        if (rename && value === name) {
          cancel();
          return;
        }
        save(value);
      }}
    >
      <label htmlFor="pillar-name">{copy.pillarName}</label>
      <input
        id="pillar-name"
        disabled={busy}
        value={value}
        aria-invalid={invalid}
        aria-describedby={invalid ? 'pillar-error' : undefined}
        onChange={(event) => {
          edited();
          setInvalid(false);
          setValue(event.target.value);
        }}
      />
      {invalid && (
        <p role="alert" id="pillar-error">
          {copy.pillarNameError}
        </p>
      )}
      <div className="action-row">
        <button className="secondary" type="button" disabled={busy} onClick={cancel}>
          {copy.cancel}
        </button>
        <button disabled={busy} type="submit">
          {busy ? copy.saving : rename ? copy.saveChanges : copy.savePillar}
        </button>
      </div>
    </form>
  );
}
