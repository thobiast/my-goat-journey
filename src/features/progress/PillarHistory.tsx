import { summarize } from '../../domain/agenda';
import { pillarHistory } from '../../domain/history';
import type { Dataset, LocalDate, Pillar } from '../../domain/types';
import type { ProgressSnapshot } from '../../domain/progress';
import type { Copy } from '../habits/GoalFields';
import { displayDate } from '../today/TodayHeader';
import { PillarHeader } from '../pillars/PillarHeader';

interface PillarHistoryProps {
  data: Dataset;
  pillar: Pillar;
  today: LocalDate;
  progress: ProgressSnapshot;
  copy: Copy;
  busy: boolean;
  openHabit: (id: string, originKey: string) => void;
  limit: number;
  showMore: () => void;
}

export function PillarHistory({
  data,
  pillar,
  today,
  progress,
  copy,
  busy,
  openHabit,
  limit,
  showMore,
}: PillarHistoryProps) {
  const days = pillarHistory(data, pillar.id, today);
  return (
    <>
      <section className={`pillar ${pillar.defaultKey ?? 'custom'}`}>
        <PillarHeader
          pillar={pillar}
          items={[]}
          copy={copy}
          streak={progress.pillars[pillar.id]}
          showDailyStatus={false}
        />
      </section>
      <h2>{copy.history}</h2>
      {!days.length && <p>{copy.noRecords}</p>}
      {days.slice(0, limit).map(({ date, items }) => {
        const summary = summarize(items, 'pillar');
        const status =
          summary.status === 'pending' && date < today ? copy.missed : copy[summary.status];
        return (
          <section className="pillar-history-day" key={date}>
            <h3>
              <time dateTime={date}>{displayDate(date, data.settings.language)}</time>
            </h3>
            <p>{status}</p>
            {summary.required > 0 && (
              <p>
                {copy.requiredCount
                  .replace('{done}', String(summary.requiredDone))
                  .replace('{total}', String(summary.required))}
              </p>
            )}
            {items.map((item) => (
              <article className="history-row" key={item.habit.id}>
                <h3>{item.goal}</h3>
                <p>
                  {item.done
                    ? copy.completionDone
                    : item.exempt
                      ? copy.exempt
                      : item.kind === 'optional'
                        ? copy.optionalUncompleted
                        : date === today
                          ? copy.pending
                          : copy.missed}
                </p>
                {item.exempt && !item.done && <p>{copy.exemptHelp}</p>}
                {item.pillarParticipation === 'on-completion' && (
                  <p>{copy.conditionalParticipation}</p>
                )}
                <button
                  data-history-id={`${item.habit.id}:${date}`}
                  disabled={busy}
                  onClick={() => openHabit(item.habit.id, `${item.habit.id}:${date}`)}
                >
                  {copy.viewHistory}
                </button>
              </article>
            ))}
          </section>
        );
      })}
      {days.length > limit && <button onClick={showMore}>{copy.showMore}</button>}
    </>
  );
}
