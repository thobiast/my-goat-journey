import { useState } from 'react';
import { habitHistory } from '../../domain/history';
import { parseLocalDate } from '../../domain/calendar';
import type { AgendaItem, Dataset, Habit, LocalDate } from '../../domain/types';
import type { ProgressSnapshot } from '../../domain/progress';
import { scheduleLabel, type Copy } from '../habits/GoalFields';
import { HabitMetrics } from '../habits/HabitMetrics';
import { displayDate } from '../today/TodayHeader';
import {
  beforeCreation,
  displayDefinition,
  displayMembership,
  pillarName,
  stateAt,
} from './ProgressPage';
import { pendingReactivationDate } from '../../domain/agenda';
import { pendingMoveDate } from '../../domain/lifecycle';
import { HabitManagement } from './HabitManagement';
import { trackingStart } from './monthly';

interface HabitDetailProps {
  data: Dataset;
  habit: Habit;
  today: LocalDate;
  progress: ProgressSnapshot;
  copy: Copy;
  busy: boolean;
  management?: boolean;
  readOnly?: boolean;
  edited: () => void;
  toggle: (item: AgendaItem) => void;
  edit: () => void;
  archive: (revision: number, after: () => void) => void;
  reactivate: (revision: number, after: () => void, pillarId?: string) => void;
}

export function HabitDetail({
  data,
  habit,
  today,
  progress,
  copy,
  busy,
  toggle,
  edit,
  archive,
  reactivate,
  edited,
  management = true,
  readOnly = false,
}: HabitDetailProps) {
  const [limit, setLimit] = useState(30);
  const history = habitHistory(data, habit.id, today);
  const editable = readOnly ? [] : history.filter((i) => i.editable);
  const older = history.filter((i) => readOnly || !i.editable);
  const future = beforeCreation(habit, today);
  const definition = displayDefinition(habit, today);
  const membership = displayMembership(habit, today);

  const name = (id: string) =>
    pillarName(
      data.pillars.find((p) => p.id === id),
      copy,
    );

  const metric = progress.habits[habit.id];
  const start = trackingStart(data, { kind: 'habit', id: habit.id });
  const trackingDate = start
    ? new Intl.DateTimeFormat(data.settings.language === 'pt' ? 'pt-BR' : 'en', {
        timeZone: 'UTC',
        dateStyle: 'medium',
      }).format(parseLocalDate(start))
    : undefined;
  const moved = habit.pendingMove;
  const moveDate = pendingMoveDate(habit);
  const currentItem = history.find((i) => i.date === today);
  const moveTemplate =
    currentItem &&
    !currentItem.assignmentLocked &&
    currentItem.completionProvenance === 'never-credited'
      ? copy.moveBeforeHelp
      : currentItem?.done
        ? copy.moveCreditedHelp
        : currentItem?.completionProvenance === 'credited'
          ? copy.moveUndoneHelp
          : copy.movePreservedHelp;
  const moveCopy =
    !future && moved && moveDate
      ? moveTemplate
          .replace('{date}', displayDate(moveDate, data.settings.language))
          .replace('{source}', () => name(currentItem?.pillarId ?? membership.pillarId))
          .replace('{target}', () => name(moved.pillarId))
      : undefined;
  const pending =
    !future &&
    stateAt(habit, today) !== 'archived' &&
    habit.versions.some((v) => v.effectiveFrom > today);
  const pendingContext = pending && (
    <section className="pending-changes">
      <h3>
        {copy.pendingChanges}
        {' · '}
        {displayDate(habit.versions.at(-1)!.effectiveFrom, data.settings.language)}
      </h3>
      <p className="user-content">{habit.versions.at(-1)!.goal}</p>
      <p>{scheduleLabel(habit.versions.at(-1)!.weekdays, copy)}</p>
      {management && !readOnly && (
        <button className="secondary" disabled={busy} onClick={edit}>
          {copy.editPending}
        </button>
      )}
    </section>
  );
  return (
    <div className="completion-review">
      {future && (
        <>
          <p>
            {copy.startsOn.replace('{date}', displayDate(habit.createdOn, data.settings.language))}
          </p>
          <p>{copy.futureDateHelp}</p>
        </>
      )}
      {!future && !readOnly && (
        <section className="review-explanation">
          <h2>{copy.correctCompletion}</h2>
          <p>{copy.correctionHelp}</p>
          <p>{copy.permanentItemsHelp}</p>
        </section>
      )}
      {editable.map((item) => (
        <article className="history-row correction-row" key={item.date}>
          <h3>
            <time dateTime={item.date}>{displayDate(item.date, data.settings.language)}</time>
            {' · '}
            {item.date === today ? copy.today : copy.previousOccurrence}
          </h3>
          <div className="goal-row">
            <div className="goal-copy">
              <p className="user-content">{item.goal}</p>
              <p>{name(item.pillarId)}</p>
            </div>
            <label className="habit-check">
              <input
                type="checkbox"
                checked={item.done}
                disabled={busy}
                aria-label={`${copy.done}: ${item.goal} · ${displayDate(item.date, data.settings.language)}`}
                onChange={() => toggle(item)}
              />
              <span>{copy.done}</span>
            </label>
          </div>
        </article>
      ))}
      <h2>{copy.history}</h2>
      {!future && <p>{copy.olderReadOnly}</p>}
      {older.slice(0, limit).map((item) => {
        const award = progress.awards.find((a) => a.habitId === habit.id && a.date === item.date);
        const status =
          item.status === 'completed'
            ? copy.completionDone
            : item.status === 'optional-uncompleted'
              ? copy.optionalUncompleted
              : copy[item.status];
        return (
          <article className="history-row" key={item.date}>
            <h3>
              <time dateTime={item.date}>{displayDate(item.date, data.settings.language)}</time>
              {' · '}
              {status}
            </h3>
            <p className="user-content">{item.goal}</p>
            <p>
              {name(item.pillarId)}
              {award && ` · +${award.baseXp + award.bonusXp} XP`}
            </p>
            {item.exempt && !item.done && <p>{copy.exemptHelp}</p>}
          </article>
        );
      })}
      {!future && !history.length && <p>{copy.noRecords}</p>}
      {older.length > limit && (
        <button className="secondary" onClick={() => setLimit((n) => n + 30)}>
          {copy.showMore}
        </button>
      )}
      <details className="review-supporting">
        <summary>{copy.helpTitle}</summary>
        {trackingDate && (
          <p className="habit-tracking-start">
            {copy.trackingStartDate.replace('{date}', trackingDate)}
          </p>
        )}
        <p>
          {name(membership.pillarId)} · {scheduleLabel(definition.weekdays, copy)}
        </p>
        <p>{copy[stateAt(habit, today)]}</p>
        {stateAt(habit, today) === 'awaiting' && (
          <p>
            {copy.resumesOn.replace(
              '{date}',
              displayDate(pendingReactivationDate(habit)!, data.settings.language),
            )}
          </p>
        )}
        <HabitMetrics progress={metric} copy={copy} />
        <p className="review-xp">{metric.xp} XP</p>
        {moveCopy && <p>{moveCopy}</p>}
        {!management && pendingContext}
      </details>
      {management && !future && !readOnly && (
        <details className="review-management">
          <summary>{copy.manageHabit}</summary>
          {pendingContext}
          {stateAt(habit, today) !== 'archived' && (
            <button className="secondary" disabled={busy} onClick={edit}>
              {copy.editHabit}
            </button>
          )}
          <HabitManagement
            data={data}
            habit={habit}
            today={today}
            copy={copy}
            busy={busy}
            archive={archive}
            reactivate={reactivate}
            edited={edited}
          />
        </details>
      )}
      <details className="history-changes">
        <summary>{copy.changes}</summary>
        <h3>{copy.goal}</h3>
        {habit.versions.map((v) => (
          <p key={v.effectiveFrom}>
            <time>{displayDate(v.effectiveFrom, data.settings.language)}</time>
            {' · '}
            <span className="user-content">{v.goal}</span> · {scheduleLabel(v.weekdays, copy)}
          </p>
        ))}
        <h3>{copy.pillars}</h3>
        {habit.memberships.map((v) => (
          <p key={v.effectiveFrom}>
            {displayDate(v.effectiveFrom, data.settings.language)} · {name(v.pillarId)}
          </p>
        ))}
        {habit.periods.map((p) => (
          <p key={p.id}>
            {displayDate(p.start, data.settings.language)}
            {p.end && ` — ${displayDate(p.end, data.settings.language)}`}
            {p.archivedOn && ` · ${copy.archived}`}
          </p>
        ))}
      </details>
    </div>
  );
}
