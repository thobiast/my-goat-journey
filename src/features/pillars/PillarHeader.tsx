import type { AgendaItem, Pillar } from '../../domain/types';
import { pillarName } from '../pillars/pillarName';
import { summarize } from '../../domain/agenda';
import type { Copy } from '../habits/GoalFields';
import type { StreakProgress } from '../../domain/progress';
import { PillarIcon } from './PillarIcon';

export function PillarHeader({
  pillar,
  items,
  copy,
  streak,
  showDailyStatus = true,
}: {
  pillar: Pillar;
  items: AgendaItem[];
  copy: Copy;
  streak: StreakProgress;
  showDailyStatus?: boolean;
}) {
  const summary = showDailyStatus ? summarize(items, 'pillar') : undefined;
  return (
    <div className="pillar-header">
      <div className="pillar-title">
        <span className="pillar-icon">
          <PillarIcon kind={pillar.defaultKey} />
        </span>
        <h2>{pillarName(pillar, copy)}</h2>
      </div>
      {summary && (
        <p>
          {copy[summary.status]}
          {summary.required > 0 &&
            ` · ${copy.requiredCount.replace('{done}', String(summary.requiredDone)).replace('{total}', String(summary.required))}`}
        </p>
      )}
      <p className="pillar-streak">
        {copy.streakCompact
          .replace('{current}', String(streak.current))
          .replace('{best}', String(streak.best))}
      </p>
    </div>
  );
}
