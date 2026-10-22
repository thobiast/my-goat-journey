import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import { civilDate, parseLocalDate, weekday } from '../../domain/calendar';
import type { Dataset, Language, LocalDate, Pillar } from '../../domain/types';
import type { HabitProgress, StreakProgress } from '../../domain/progress';
import type { Copy } from '../habits/GoalFields';
import { PillarIcon } from '../pillars/PillarIcon';
import { calendarMonths, trackingStart } from './monthly';
import {
  calendarDays,
  periodStats,
  type CalendarDay,
  type CalendarScope,
  type DayState,
  type Interval,
  type PeriodWindow,
} from './calendar';

export const stateLabel = (state: DayState, copy: Copy) =>
  ({
    completed: copy.progressCompleted,
    partial: copy.progressPartial,
    incomplete: copy.progressIncomplete,
    unscheduled: copy.progressUnscheduled,
  })[state];

export function fullDate(date: LocalDate, language: Language) {
  return new Intl.DateTimeFormat(language === 'pt' ? 'pt-BR' : 'en', {
    timeZone: 'UTC',
    dateStyle: 'full',
  }).format(parseLocalDate(date));
}

export function rangeLabel(start: LocalDate, end: LocalDate, language: Language) {
  const formatter = new Intl.DateTimeFormat(language === 'pt' ? 'pt-BR' : 'en', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return `${formatter.format(parseLocalDate(start))} – ${formatter.format(parseLocalDate(end))}`;
}

export function StateIcon({ state }: { state: DayState }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      {state === 'completed' ? (
        <path d="m7 12 3 3 7-7" />
      ) : state === 'partial' ? (
        <path d="M12 7v10M7 12h5" />
      ) : state === 'incomplete' ? (
        <path d="m9 9 6 6m0-6-6 6" />
      ) : (
        <path d="M8 12h8" />
      )}
    </svg>
  );
}

export function CalendarLegend({ pillars, copy }: { pillars: boolean; copy: Copy }) {
  const states: DayState[] = pillars
    ? ['completed', 'partial', 'incomplete', 'unscheduled']
    : ['completed', 'incomplete', 'unscheduled'];
  return (
    <ul className="calendar-legend" aria-label={copy.calendarLegend}>
      {states.map((state) => (
        <li key={state}>
          <span className={`legend-swatch state-${state}`} aria-hidden="true" />
          {stateLabel(state, copy)}
        </li>
      ))}
    </ul>
  );
}

function datesBetween(start: LocalDate, end: LocalDate) {
  const dates: LocalDate[] = [];
  const cursor = parseLocalDate(start);
  const lastDate = parseLocalDate(end);
  for (
    let date = civilDate(cursor);
    cursor <= lastDate;
    cursor.setUTCDate(cursor.getUTCDate() + 1), date = civilDate(cursor)
  )
    dates.push(date);
  return dates;
}

interface DailyCalendarProps {
  days: CalendarDay[];
  window: PeriodWindow;
  interval: Interval;
  language: Language;
  copy: Copy;
  scopeKey: string;
  open: (date: LocalDate) => void;
  busy: boolean;
  start: LocalDate | undefined;
}

/** Each calendar month owns its alignment padding and dated cells. */
export function DailyCalendar({
  days,
  window,
  interval,
  language,
  copy,
  scopeKey,
  open,
  busy,
  start,
}: DailyCalendarProps) {
  const [focused, setFocused] = useState<LocalDate>();
  const dayMap = new Map(days.map((day) => [day.date, day]));
  const hasBefore = days.some((day) => !start || day.date < start);
  const numbered = interval === '7d' || interval === '1m' || interval === '3m';
  const selectable = days.filter((day) => day.applicable);
  const first = selectable[0]?.date;
  const active = selectable.some((day) => day.date === focused) ? focused : first;
  // A calendar render formats many dates with one locale/options pair.
  const dateFormatter = new Intl.DateTimeFormat(language === 'pt' ? 'pt-BR' : 'en', {
    timeZone: 'UTC',
    dateStyle: 'full',
  });
  const dateLabel = (date: LocalDate) => dateFormatter.format(parseLocalDate(date));
  const monthFormatter = new Intl.DateTimeFormat(language === 'pt' ? 'pt-BR' : 'en', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  });

  function move(event: KeyboardEvent<HTMLButtonElement>, date: LocalDate) {
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const key = event.key as keyof typeof delta;
    let target: LocalDate | undefined;
    if (key in delta) {
      const cursor = parseLocalDate(date);
      cursor.setUTCDate(cursor.getUTCDate() + delta[key]);
      const candidate = civilDate(cursor);
      // Skip noninteractive participation gaps without making them eligible.
      target =
        delta[key] > 0
          ? selectable.find((day) => day.date >= candidate)?.date
          : [...selectable].reverse().find((day) => day.date <= candidate)?.date;
    } else if (event.key === 'Home') target = selectable[0]?.date;
    else if (event.key === 'End') target = selectable.at(-1)?.date;
    else return;
    event.preventDefault();
    const container = event.currentTarget.closest('.daily-calendar');
    const button = Array.from(
      container?.querySelectorAll<HTMLButtonElement>('[data-calendar-date]') ?? [],
    ).find((button) => button.dataset.calendarDate === target);
    button?.focus();
  }

  function number(date: LocalDate) {
    return (
      numbered && (
        <span aria-hidden="true">
          {interval === '7d' && (
            <small>
              <span className="weekday-short">{copy.shortWeekdays[weekday(date)]}</span>
              <span className="weekday-narrow">{copy.shortWeekdays[weekday(date)][0]}</span>
            </small>
          )}
          <span className="day-number">{parseLocalDate(date).getUTCDate()}</span>
        </span>
      )
    );
  }

  function cell(date: LocalDate | null, index: number) {
    if (!date)
      return (
        <span className="calendar-blank calendar-padding" key={`pad-${index}`} aria-hidden="true" />
      );
    if (date < window.start || date > window.historyEnd)
      return <span className="calendar-blank" key={date} aria-hidden="true" />;
    if (!start || date < start)
      return (
        <span
          className="calendar-before"
          role="img"
          data-context-date={date}
          data-context="before-tracking"
          aria-label={`${dateLabel(date)} · ${copy.beforeTracking}`}
          key={date}
        >
          {number(date)}
        </span>
      );
    const day = dayMap.get(date);
    if (!day?.applicable) return <span className="calendar-blank" key={date} aria-hidden="true" />;
    return (
      <button
        key={date}
        className={`calendar-day state-${day.state}`}
        data-calendar-date={date}
        data-state={day.state}
        data-history-id={`${scopeKey}:${date}`}
        aria-label={`${dateLabel(date)} · ${stateLabel(day.state, copy)}`}
        tabIndex={active === date ? 0 : -1}
        disabled={busy}
        onFocus={() => setFocused(date)}
        onKeyDown={(event) => move(event, date)}
        onClick={() => open(date)}
      >
        {number(date)}
      </button>
    );
  }

  return (
    <div className={`daily-calendar calendar-${interval}`}>
      {hasBefore && (
        <p className="calendar-context">
          <span className="before-tracking-swatch" aria-hidden="true" />
          {copy.beforeTracking}
        </p>
      )}
      {interval === '7d' ? (
        <div className="numbered-calendar week-strip">
          {datesBetween(window.start, window.end).map((date, index) => cell(date, index))}
        </div>
      ) : (
        <div className={`calendar-months ${numbered ? 'numbered-months' : 'compact-months'}`}>
          {calendarMonths(window).map((month) => (
            <section
              className="calendar-month"
              data-month={month.key}
              key={month.key}
              aria-label={monthFormatter.format(parseLocalDate(month.start))}
            >
              <h3 className="calendar-month-label">
                {monthFormatter.format(parseLocalDate(month.start))}
              </h3>
              <p className="month-context">
                {(!start || month.end < start) && month.end <= window.historyEnd
                  ? copy.beforeTracking
                  : ''}
              </p>
              <div className="month-weekdays" aria-hidden="true">
                {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                  <span key={day} title={copy.weekdays[day]}>
                    <span className="weekday-short">{copy.shortWeekdays[day]}</span>
                    <span className="weekday-narrow">{copy.shortWeekdays[day][0]}</span>
                  </span>
                ))}
              </div>
              <div
                className={`monthly-grid ${numbered ? 'numbered-calendar' : 'compact-calendar'}`}
              >
                {month.cells.map((date, index) => cell(date, index))}
              </div>
            </section>
          ))}
        </div>
      )}
      <p role="status" aria-live="polite" className="visually-hidden">
        {focused &&
          dayMap.get(focused)?.applicable &&
          `${dateLabel(focused)} · ${stateLabel(dayMap.get(focused)!.state, copy)}`}
      </p>
    </div>
  );
}

interface ConsistencyCardProps {
  data: Dataset;
  days?: CalendarDay[];
  scope: CalendarScope;
  window: PeriodWindow;
  interval: Interval;
  copy: Copy;
  title: string;
  pillar?: Pillar;
  subtitle?: string;
  metric: StreakProgress | HabitProgress;
  busy: boolean;
  openDay: (date: LocalDate) => void;
  openHabit?: () => void;
}

export function ConsistencyCard({
  data,
  days: projectedDays,
  scope,
  window,
  interval,
  copy,
  title,
  pillar,
  subtitle,
  metric,
  busy,
  openDay,
  openHabit,
}: ConsistencyCardProps) {
  const days = projectedDays ?? calendarDays(data, scope, window);
  const stats = periodStats(days);
  const start = trackingStart(data, scope);
  const trackingDate =
    scope.kind !== 'habit' && start
      ? new Intl.DateTimeFormat(data.settings.language === 'pt' ? 'pt-BR' : 'en', {
          timeZone: 'UTC',
          dateStyle: 'medium',
        }).format(parseLocalDate(start))
      : undefined;

  const unit = (count: number) =>
    scope.kind === 'habit'
      ? count === 1
        ? copy.progressCompletionUnit
        : copy.progressCompletionsUnit
      : count === 1
        ? copy.progressDayUnit
        : copy.progressDaysUnit;

  const key = scope.kind === 'all' ? 'all' : `${scope.kind}:${scope.id}`;
  const bonus = 'nextBonus' in metric ? metric.nextBonus : null;
  const fraction = copy.periodCompletionCount
    .replace('{completed}', String(stats.completed))
    .replace('{eligible}', String(stats.eligible));
  return (
    <article
      className={`consistency-card ${scope.kind === 'all' ? 'aggregate-card' : (pillar?.defaultKey ?? 'custom')}`}
    >
      <div className="consistency-heading">
        <span className="pillar-icon">
          <PillarIcon kind={scope.kind === 'all' ? 'custom' : pillar?.defaultKey} />
        </span>
        <div>
          <h2>
            {openHabit ? (
              <button
                className="goal-detail-link"
                data-history-id={'id' in scope ? scope.id : undefined}
                disabled={busy}
                onClick={openHabit}
              >
                {title}
              </button>
            ) : (
              title
            )}
          </h2>
          {subtitle && <p>{subtitle}</p>}
          {trackingDate && (
            <p className="tracking-since">{copy.trackingSince.replace('{date}', trackingDate)}</p>
          )}
        </div>
      </div>
      <DailyCalendar
        days={days}
        window={window}
        interval={interval}
        language={data.settings.language}
        copy={copy}
        scopeKey={key}
        busy={busy}
        open={openDay}
        start={start}
      />
      <div className="consistency-summary">
        <div
          className="period-donut"
          role="img"
          aria-label={
            stats.percent === null ? copy.noScheduledPeriod : `${stats.percent}% · ${fraction}`
          }
          style={{ '--percent': `${stats.percent ?? 0}%` } as CSSProperties}
        >
          <strong className="period-percent">
            {stats.percent === null ? '—' : `${stats.percent}%`}
          </strong>
        </div>
        <p className="period-fraction">{stats.eligible ? fraction : copy.noScheduledPeriod}</p>
        <dl>
          <div>
            <dt>{copy.currentStreak}</dt>
            <dd data-live-streak="current">
              {metric.current} <span>{unit(metric.current)}</span>
            </dd>
          </div>
          <div>
            <dt>{copy.bestStreak}</dt>
            <dd data-live-streak="best">
              {metric.best} <span>{unit(metric.best)}</span>
            </dd>
          </div>
        </dl>
      </div>
      {bonus && (
        <p className="consistency-bonus">
          {(bonus.remaining === 1 ? copy.nextBonusOne : copy.nextBonusMany)
            .replace('{bonus}', `+${bonus.bonusXp} XP`)
            .replace('{remaining}', String(bonus.remaining))}
        </p>
      )}
    </article>
  );
}
