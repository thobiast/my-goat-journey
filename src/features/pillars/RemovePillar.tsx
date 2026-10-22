import { useRef } from 'react';
import { pillarHasProspectiveHabits } from '../../domain/pillars';
import type { Dataset, LocalDate, Pillar } from '../../domain/types';
import type { Copy } from '../../i18n/copy';

interface RemovePillarProps {
  data: Dataset;
  pillar: Pillar;
  today: LocalDate;
  copy: Copy;
  busy: boolean;
  cancel: () => void;
  manage: () => void;
  confirm: (revision: number) => void;
}

export function RemovePillar({
  data,
  pillar,
  today,
  copy,
  busy,
  cancel,
  manage,
  confirm,
}: RemovePillarProps) {
  const revision = useRef(data.revision);
  const occupied = pillarHasProspectiveHabits(data, pillar.id, today);
  return (
    <section className="confirmation">
      <p>{occupied ? copy.pillarOccupied : copy.removePillarHelp}</p>
      <div className="action-row">
        <button className="secondary" disabled={busy} onClick={cancel}>
          {copy.cancel}
        </button>
        {occupied ? (
          <button disabled={busy} onClick={manage}>
            {copy.manageHabits}
          </button>
        ) : (
          <button className="destructive" disabled={busy} onClick={() => confirm(revision.current)}>
            {copy.confirmRemoval}
          </button>
        )}
      </div>
    </section>
  );
}
