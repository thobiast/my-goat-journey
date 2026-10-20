import type { AgendaItem, Language, Pillar } from '../../domain/types';
import { pillarName } from '../pillars/pillarName';
import type { ProgressSnapshot } from '../../domain/progress';
import type { Copy } from '../habits/GoalFields';
import { PillarIcon } from '../pillars/PillarIcon';
import { HabitMetrics } from '../habits/HabitMetrics';
import { summarize } from '../../domain/agenda';
import { displayDate } from './TodayHeader';
import './today.css';
import { XpFeedback, type XpFeedbackValue } from './XpFeedback';

function text(template: string, values: Record<string, number | string>) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replace(`{${key}}`, String(value)),
    template,
  );
}

function CompletionCheck() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 8l3 3 7-7" />
    </svg>
  );
}

function PillarName({
  pillar,
  copy,
  iconSize = 24,
}: {
  pillar: Pillar;
  copy: Copy;
  iconSize?: number;
}) {
  return (
    <div className="pillar-title">
      <span className="pillar-icon">
        <PillarIcon kind={pillar.defaultKey} size={iconSize} />
      </span>
      <h2>{pillarName(pillar, copy)}</h2>
    </div>
  );
}

interface TodayPageProps {
  xpFeedback?: XpFeedbackValue;
  items: AgendaItem[];
  pillars: Pillar[];
  progress: ProgressSnapshot;
  language: Language;
  copy: Copy;
  busy: boolean;
  toggle: (item: AgendaItem) => void;
  addHabit: () => void;
}

export function TodayPage({
  items,
  pillars,
  progress,
  language,
  copy,
  busy,
  toggle,
  addHabit,
  xpFeedback,
}: TodayPageProps) {
  const visibleItems = items.filter((item) => !item.exempt || item.done);
  return (
    <>
      <div className="summary-shell">
        <ul className="pillar-summary" aria-label={copy.pillarSummary}>
          {pillars.map((pillar) => {
            const group = visibleItems.filter((item) => item.pillarId === pillar.id);
            const count = summarize(group, 'pillar');
            const streak = progress.pillars[pillar.id];
            return (
              <li
                className={`summary-tile ${pillar.defaultKey ?? 'custom'}${pillarName(pillar, copy).length > 24 ? ' summary-wide' : ''}`}
                key={pillar.id}
              >
                <div className="summary-top-row">
                  <div className="summary-title">
                    <PillarName pillar={pillar} copy={copy} iconSize={20} />
                  </div>
                  {count.required > 0 && (
                    <span className="summary-count">
                      <span aria-hidden="true">
                        {count.requiredDone}/{count.required}
                      </span>
                      <span className="visually-hidden">
                        {text(copy.todayCompletionCount, {
                          done: count.requiredDone,
                          total: count.required,
                        })}
                      </span>
                    </span>
                  )}
                </div>
                <div className="summary-copy">
                  <p className="pillar-streak">
                    {text(copy.streakCompact, { current: streak.current, best: streak.best })}
                  </p>
                  {count.required === 0 && (
                    <p>
                      {group.some(
                        (i) => i.kind === 'required' && i.pillarParticipation === 'on-completion',
                      )
                        ? copy.conditionalParticipation
                        : count.optional
                          ? copy.optionalOnly
                          : copy.noHabitsToday}
                    </p>
                  )}
                  {count.required > 0 && (
                    <div className="pillar-day-status" data-status-label={copy.completedToday}>
                      {count.status === 'complete' && (
                        <>
                          <CompletionCheck />
                          <span>{copy.completedToday}</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      {!visibleItems.length && <p>{copy.nothingDue}</p>}
      {pillars.map((pillar) => {
        const group = visibleItems.filter((item) => item.pillarId === pillar.id);
        if (!group.length) return null;
        const count = summarize(group, 'pillar');
        const countTemplate =
          count.status === 'complete'
            ? count.required === 1
              ? copy.todayGroupCompletedCountOne
              : copy.todayGroupCompletedCount
            : count.required === 1
              ? copy.todayGroupCountOne
              : copy.todayGroupCount;
        return (
          <section
            aria-label={pillarName(pillar, copy)}
            className={`pillar today-pillar ${pillar.defaultKey ?? 'custom'}`}
            key={pillar.id}
          >
            <div className="pillar-header">
              <PillarName pillar={pillar} copy={copy} iconSize={20} />
              <p className="today-pillar-status">
                {count.required > 0 ? (
                  <>
                    {count.status === 'complete' && <CompletionCheck />}
                    <span>
                      {text(countTemplate, { done: count.requiredDone, total: count.required })}
                    </span>
                  </>
                ) : (
                  <span>
                    {copy[count.status]}
                    {' · '}
                    {group.some(
                      (i) => i.kind === 'required' && i.pillarParticipation === 'on-completion',
                    )
                      ? copy.conditionalParticipation
                      : copy.optionalOnly}
                  </span>
                )}
              </p>
            </div>
            {group.map((item) => {
              const habit = progress.habits[item.habit.id];
              return (
                <article className="today-goal" data-completed={item.done} key={item.habit.id}>
                  <div className="goal-row">
                    <div className="goal-copy">
                      <h3>{item.goal}</h3>
                    </div>
                    <label className="habit-check" data-saving={busy}>
                      <input
                        type="checkbox"
                        checked={item.done}
                        disabled={busy}
                        aria-label={`${copy.done}: ${item.goal}`}
                        aria-description={displayDate(item.date, language)}
                        onChange={() => toggle(item)}
                      />
                      <span>{copy.done}</span>
                      <XpFeedback
                        feedback={
                          xpFeedback?.habitId === item.habit.id && xpFeedback.date === item.date
                            ? xpFeedback
                            : undefined
                        }
                        language={language}
                      />
                    </label>
                  </div>
                  {item.exempt && (
                    <div className="habit-today-status">
                      <p>{copy.archived}</p>
                    </div>
                  )}
                  {item.kind === 'required' && item.pillarParticipation === 'on-completion' && (
                    <div className="habit-today-status">
                      <p>{item.kind === 'required' ? copy.requiredToday : copy.optional}</p>
                      <p>{copy.countsWhenDone.replace('{target}', pillarName(pillar, copy))}</p>
                    </div>
                  )}
                  {item.kind === 'optional' && (
                    <div className="habit-today-status">
                      <p>{copy.optional}</p>
                      <p className="first-required">
                        {copy.firstRequiredShort}{' '}
                        <time dateTime={item.firstRequiredDate}>
                          {displayDate(item.firstRequiredDate, language, true)}
                        </time>
                      </p>
                    </div>
                  )}
                  <HabitMetrics progress={habit} copy={copy} />
                </article>
              );
            })}
          </section>
        );
      })}
      <details className="today-help">
        <summary>{copy.helpTitle}</summary>
        <p>{copy.streakHelp}</p>
        <p>{copy.baseXpHelp}</p>
        <p>{copy.optionalHelp}</p>
      </details>
      <button disabled={busy} onClick={addHabit}>
        {copy.addHabit}
      </button>
    </>
  );
}
