import { activationAt, agenda, definitionAt, membershipAt } from '../../domain/agenda';
import { editableOccurrences } from '../../domain/history';
import { civilDate, parseLocalDate } from '../../domain/calendar';
import type { AgendaItem, Dataset, LocalDate } from '../../domain/types';
import type { Copy } from '../habits/GoalFields';
import { displayDate } from '../today/TodayHeader';
import { fullDate, StateIcon, stateLabel } from './ConsistencyCard';
import { calendarDays, type CalendarScope, type DayState, type PeriodWindow } from './calendar';
import { pillarName } from './ProgressPage';

export interface ProgressDayProps {
  data: Dataset;
  today: LocalDate;
  scope: CalendarScope;
  date: LocalDate;
  window: PeriodWindow;
  copy: Copy;
  busy: boolean;
  openHabit: (id: string, originKey: string) => void;
  changeDay: (date: LocalDate) => void;
  toggle: (item: AgendaItem) => void;
}

export function ProgressDayPage({
  data,
  today,
  scope,
  date,
  window,
  copy,
  busy,
  openHabit,
  changeDay,
  toggle,
}: ProgressDayProps) {
  const day = calendarDays(data, scope, { start: date, end: date, historyEnd: date })[0];
  const items = agenda(data, date);

  const name = (id: string) =>
    pillarName(
      data.pillars.find((p) => p.id === id),
      copy,
    );

  const habit = scope.kind === 'habit' ? data.habits.find((h) => h.id === scope.id) : undefined;
  const title =
    scope.kind === 'all'
      ? copy.allPillarsTogether
      : scope.kind === 'pillar'
        ? name(scope.id)
        : (items.find((item) => item.habit.id === scope.id)?.goal ??
          (habit ? (definitionAt(habit, date)?.goal ?? habit.versions[0].goal) : ''));
  const relevant = data.habits.flatMap((h) => {
    const item = items.find((item) => item.habit.id === h.id);
    const membership = item?.pillarId ?? membershipAt(h, date)?.pillarId;
    if (
      scope.kind === 'habit'
        ? h.id !== scope.id
        : h.createdOn > date || !membership || (scope.kind === 'pillar' && membership !== scope.id)
    )
      return [];
    const definition = definitionAt(h, date) ?? h.versions[0];
    const state: DayState = item?.done
      ? 'completed'
      : item && item.kind === 'required' && !item.exempt
        ? 'incomplete'
        : 'unscheduled';
    const explanation =
      h.createdOn > date
        ? copy.beforeCreationDay
        : item?.exempt && !item.done
          ? copy.exemptHelp
          : !activationAt(h, date)
            ? copy.archivedDay
            : item?.kind === 'optional' && !item.done
              ? copy.optionalDayNeutral
              : state === 'unscheduled'
                ? copy.habitNotScheduled
                : '';
    return [
      {
        habit: h,
        item,
        goal: item?.goal ?? definition.goal,
        pillarId: membership ?? h.memberships[0].pillarId,
        state,
        explanation,
        editable:
          !!item &&
          editableOccurrences(data, h.id, today).some((candidate) => candidate.date === date),
      },
    ];
  });
  const previous = parseLocalDate(date);
  previous.setUTCDate(previous.getUTCDate() - 1);
  const next = parseLocalDate(date);
  next.setUTCDate(next.getUTCDate() + 1);
  const done = day.items.filter((item) => item.done).length;
  const required = day.items.filter(
    (item) =>
      (!item.exempt || item.done) &&
      item.kind === 'required' &&
      (scope.kind !== 'pillar' || item.pillarParticipation === 'required'),
  );
  const count =
    required.length + day.items.filter((item) => item.done && !required.includes(item)).length;

  function rows(pillarId?: string) {
    return relevant
      .filter((row) => !pillarId || row.pillarId === pillarId)
      .map((row) => (
        <article className="historical-habit" key={row.habit.id}>
          <h3 className="user-content">{row.goal}</h3>
          <p className="historical-state">
            <StateIcon state={row.state} />
            {stateLabel(row.state, copy)}
          </p>
          {row.explanation && <p>{row.explanation}</p>}
          {row.editable && row.item && (
            <label className="habit-check">
              <input
                type="checkbox"
                checked={row.item.done}
                disabled={busy}
                aria-label={`${copy.done}: ${row.goal} · ${displayDate(date, data.settings.language)}`}
                onChange={() => toggle(row.item!)}
              />
              <span>{copy.done}</span>
            </label>
          )}
          {row.item && !row.editable && <p>{copy.olderReadOnly}</p>}
          <button
            data-history-id={`${row.habit.id}:${date}`}
            disabled={busy}
            onClick={() => openHabit(row.habit.id, `${row.habit.id}:${date}`)}
          >
            {copy.manageHabit}
          </button>
        </article>
      ));
  }

  return (
    <>
      <p className="day-context">
        {title}
        <time className="visually-hidden" dateTime={date}>
          {fullDate(date, data.settings.language)}
        </time>
      </p>
      <section className={`day-state state-${day.state}`}>
        <h2>
          <StateIcon state={day.state} />
          {stateLabel(day.state, copy)}
        </h2>
        {day.state === 'unscheduled' ? (
          <p>
            {scope.kind === 'habit'
              ? copy.habitNotScheduled
              : scope.kind === 'pillar'
                ? copy.pillarNotScheduled
                : copy.allNotScheduled}
          </p>
        ) : (
          count > 0 && (
            <p>
              {copy.dayCompletionCount
                .replace('{done}', String(done))
                .replace('{total}', String(count))}
            </p>
          )
        )}
      </section>
      <div className="day-navigation">
        <button
          aria-label={copy.previousDay}
          disabled={busy || civilDate(previous) < window.start}
          onClick={() => changeDay(civilDate(previous))}
        >
          ←
        </button>
        <p>{displayDate(date, data.settings.language)}</p>
        <button
          aria-label={copy.nextDay}
          disabled={busy || civilDate(next) > window.historyEnd || civilDate(next) >= today}
          onClick={() => changeDay(civilDate(next))}
        >
          →
        </button>
      </div>
      <h2>{copy.historicalHabits}</h2>
      {scope.kind === 'all'
        ? data.pillars
            .filter((p) => relevant.some((row) => row.pillarId === p.id))
            .map((p) => (
              <section key={p.id}>
                <h3>{pillarName(p, copy)}</h3>
                {rows(p.id)}
              </section>
            ))
        : rows()}
      {relevant.some((row) => row.editable) && (
        <p className="progress-guidance">
          {copy.correctionHelp} {copy.permanentItemsHelp}
        </p>
      )}
    </>
  );
}
