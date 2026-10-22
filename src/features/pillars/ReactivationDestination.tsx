import type { Pillar } from '../../domain/types';
import type { Copy } from '../../i18n/copy';
import { pillarName } from './pillarName';

interface ReactivationDestinationProps {
  pillars: Pillar[];
  copy: Copy;
  busy: boolean;
  value: string;
  change: (id: string) => void;
}

export function ReactivationDestination({
  pillars,
  copy,
  busy,
  value,
  change,
}: ReactivationDestinationProps) {
  return (
    <>
      <p>{pillars.length ? copy.chooseActivePillar : copy.noDestinationPillar}</p>
      <label htmlFor="pillar">{copy.pillar}</label>
      <select
        id="pillar"
        disabled={busy || !pillars.length}
        value={value}
        onChange={(event) => change(event.target.value)}
      >
        <option value="">{copy.pillar}</option>
        {pillars.map((p) => (
          <option key={p.id} value={p.id}>
            {pillarName(p, copy)}
          </option>
        ))}
      </select>
    </>
  );
}
