import { useMemo } from 'react';
import { definitionAt, membershipAt, pendingReactivationDate } from '../../domain/agenda';
import { habitState } from '../../domain/lifecycle';
import type { Dataset, Habit, LocalDate, Pillar, Settings } from '../../domain/types';
import { PROGRESS_INTERVALS, progressIntervalOrDefault } from '../../domain/preferences';
import type { ProgressSnapshot } from '../../domain/progress';
import type { Copy } from '../habits/GoalFields';
import { displayDate } from '../today/TodayHeader';
import { CalendarLegend, ConsistencyCard, rangeLabel } from './ConsistencyCard';
import {
  hasEarlierHistory,
  periodWindow,
  type CalendarScope,
  type Interval,
  type PeriodWindow,
} from './calendar';
import { pillarName } from '../pillars/pillarName';
import { GlobalXpProgress } from './GlobalXpProgress';
import './progress.css';

export interface ProgressView {
  view: 'habits' | 'pillars';
  status: 'active' | 'archived';
  pillarId: string;
  expanded: boolean;
  interval: Interval;
  offset: number;
}

export const initialProgressView: ProgressView = {
  view: 'habits',
  status: 'active',
  pillarId: 'all',
  expanded: false,
  interval: '7d',
  offset: 0,
};

export const initialProgressViewFor = (settings: Settings): ProgressView => ({
  ...initialProgressView,
  interval: progressIntervalOrDefault(settings.progressInterval),
});

export { pillarName } from '../pillars/pillarName';

export const beforeCreation = (habit: Habit, today: LocalDate) => today < habit.createdOn;

// Stored identity for read-only UI, never an applicable definition or Today item.
export const displayDefinition = (habit: Habit, today: LocalDate) =>
  beforeCreation(habit, today) ? habit.versions[0] : definitionAt(habit, today)!;

export const displayMembership = (habit: Habit, today: LocalDate) =>
  beforeCreation(habit, today) ? habit.memberships[0] : membershipAt(habit, today)!;

export function stateAt(habit: Habit, today: LocalDate) {
  return beforeCreation(habit, today) ? 'waitingToStart' : habitState(habit, today).state;
}

interface ProgressPageProps {
  data: Dataset;
  today: LocalDate;
  progress: ProgressSnapshot;
  copy: Copy;
  busy: boolean;
  value: ProgressView;
  change: (value: ProgressView) => void;
  selectInterval?: (interval: Interval) => void;
  openHabit: (id: string) => void;
  openPillar?: (id: string) => void;
  add: () => void;
  openDay?: (scope: CalendarScope, date: LocalDate, window: PeriodWindow) => void;
}

export function ProgressPage({
  data,
  today,
  progress,
  copy,
  busy,
  value,
  change,
  selectInterval,
  openHabit,
  add,
  openDay,
}: ProgressPageProps) {
  const filtered = data.habits.filter(
    (h) =>
      (value.status === 'archived'
        ? stateAt(h, today) === 'archived'
        : stateAt(h, today) !== 'archived') &&
      (value.pillarId === 'all' || displayMembership(h, today).pillarId === value.pillarId),
  );
  const window = useMemo(
    () => periodWindow(today, value.interval, value.offset),
    [today, value.interval, value.offset],
  );
  const scopes: CalendarScope[] =
    value.view === 'pillars'
      ? [{ kind: 'all' }]
      : filtered.map((h) => ({ kind: 'habit', id: h.id }));
  const earlier = scopes.some((scope) => hasEarlierHistory(data, scope, window.start));

  const reset = () => change({ ...value, status: 'active', pillarId: 'all' });

  const card = (
    scope: CalendarScope,
    title: string,
    metric: ProgressSnapshot['overall'],
    pillar?: Pillar,
    subtitle?: string,
    habitId?: string,
  ) => (
    <ConsistencyCard
      key={scope.kind === 'all' ? 'all' : scope.id}
      data={data}
      scope={scope}
      window={window}
      interval={value.interval}
      copy={copy}
      title={title}
      metric={metric}
      pillar={pillar}
      subtitle={subtitle}
      busy={busy}
      openDay={(date) => openDay?.(scope, date, window)}
      openHabit={habitId ? () => openHabit(habitId) : undefined}
    />
  );

  return (
    <>
      <GlobalXpProgress progress={progress} language={data.settings.language} copy={copy} />
      <div className="progress-tabs" role="tablist" aria-label={copy.progress}>
        {(['habits', 'pillars'] as const).map((view) => (
          <button
            key={view}
            role="tab"
            id={`progress-tab-${view}`}
            aria-selected={value.view === view}
            tabIndex={value.view === view ? 0 : -1}
            onKeyDown={(event) => {
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const next =
                  event.key === 'Home'
                    ? 'habits'
                    : event.key === 'End'
                      ? 'pillars'
                      : view === 'habits'
                        ? 'pillars'
                        : 'habits';
                change({ ...value, view: next });
                document.getElementById(`progress-tab-${next}`)?.focus();
              }
            }}
            aria-controls="progress-cards"
            onClick={() => change({ ...value, view })}
            disabled={busy}
          >
            {copy[view]}
          </button>
        ))}
      </div>
      <div className="interval-selector" role="group" aria-label={copy.intervalLabel}>
        {PROGRESS_INTERVALS.map((interval) => (
          <button
            key={interval}
            aria-pressed={value.interval === interval}
            disabled={busy}
            onClick={() =>
              selectInterval ? selectInterval(interval) : change({ ...value, interval, offset: 0 })
            }
          >
            {interval}
          </button>
        ))}
      </div>
      <div className="period-navigation">
        <button
          aria-label={copy.previousPeriod}
          disabled={busy || !earlier}
          onClick={() => change({ ...value, offset: value.offset + 1 })}
        >
          ←
        </button>
        <p aria-live="polite">
          <time dateTime={window.start}>
            {rangeLabel(window.start, window.end, data.settings.language)}
          </time>
        </p>
        <button
          aria-label={copy.nextPeriod}
          disabled={busy || value.offset === 0}
          onClick={() => change({ ...value, offset: Math.max(0, value.offset - 1) })}
        >
          →
        </button>
      </div>
      {value.view === 'habits' && (
        <div className="progress-filter-row">
          <details
            className="progress-filters"
            open={value.expanded}
            onToggle={(event) => {
              const expanded = event.currentTarget.open;
              if (expanded !== value.expanded) change({ ...value, expanded });
            }}
          >
            <summary>{copy.filters}</summary>
            <fieldset disabled={busy}>
              <legend>{copy.filterStatus}</legend>
              <div className="action-row">
                {(['active', 'archived'] as const).map((status) => (
                  <button
                    key={status}
                    aria-pressed={value.status === status}
                    onClick={() => change({ ...value, status })}
                  >
                    {status === 'active' ? copy.activeHabits : copy.archivedHabits}
                  </button>
                ))}
              </div>
            </fieldset>
            <label htmlFor="pillar-filter">{copy.pillarFilter}</label>
            <select
              id="pillar-filter"
              disabled={busy}
              value={value.pillarId}
              onChange={(event) => change({ ...value, pillarId: event.target.value })}
            >
              <option value="all">{copy.allPillars}</option>
              {data.pillars.map((p) => (
                <option key={p.id} value={p.id}>
                  {pillarName(p, copy)}
                </option>
              ))}
            </select>
            <button disabled={busy} onClick={reset}>
              {copy.resetFilters}
            </button>
          </details>
          <p className="filter-summary">
            {value.status === 'active' ? copy.activeHabits : copy.archivedHabits}
            {' · '}
            {value.pillarId === 'all'
              ? copy.allPillars
              : pillarName(
                  data.pillars.find((p) => p.id === value.pillarId),
                  copy,
                )}
          </p>
        </div>
      )}
      <CalendarLegend copy={copy} pillars={value.view === 'pillars'} />
      <p className="streak-scope-note">{copy.streakScopeNote}</p>
      <section id="progress-cards" role="tabpanel" aria-labelledby={`progress-tab-${value.view}`}>
        {value.view === 'habits' ? (
          <>
            {filtered.map((h) => {
              const definition = displayDefinition(h, today);
              const pillar = data.pillars.find(
                (p) => p.id === displayMembership(h, today).pillarId,
              );
              const resumes = pendingReactivationDate(h);
              const schedule =
                definition.weekdays.length === 7
                  ? copy.everyDay
                  : definition.weekdays.map((day) => copy.shortWeekdays[day]).join(' · ');
              const lifecycle = beforeCreation(h, today)
                ? ` · ${copy.waitingToStart} · ${copy.startsOn.replace('{date}', displayDate(h.createdOn, data.settings.language))}`
                : stateAt(h, today) === 'awaiting' && resumes
                  ? ` · ${copy.resumesOn.replace('{date}', displayDate(resumes, data.settings.language))}`
                  : value.status === 'archived'
                    ? ` · ${copy.archived}`
                    : '';
              return card(
                { kind: 'habit', id: h.id },
                definition.goal,
                progress.habits[h.id],
                pillar,
                `${pillarName(pillar, copy)} · ${schedule}${lifecycle}`,
                h.id,
              );
            })}
            {!filtered.length && (
              <section className="progress-empty">
                <p>
                  {value.pillarId !== 'all'
                    ? copy.noMatches
                    : value.status === 'active'
                      ? copy.noActiveHabits
                      : copy.noArchivedHabits}
                </p>
                <div className="action-row">
                  <button onClick={reset}>{copy.resetFilters}</button>
                  {value.status === 'active' && (
                    <>
                      <button onClick={() => change({ ...value, status: 'archived' })}>
                        {copy.archivedHabits}
                      </button>
                      <button disabled={busy} onClick={add}>
                        {copy.addHabit}
                      </button>
                    </>
                  )}
                </div>
              </section>
            )}
          </>
        ) : (
          <>
            {card({ kind: 'all' }, copy.allPillarsTogether, progress.overall)}
            <h2 className="by-pillar-title">{copy.byPillar}</h2>
            {data.pillars.map((p) =>
              card({ kind: 'pillar', id: p.id }, pillarName(p, copy), progress.pillars[p.id], p),
            )}
          </>
        )}
      </section>
    </>
  );
}
