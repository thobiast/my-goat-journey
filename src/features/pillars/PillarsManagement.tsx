import type { Dataset, Habit, LocalDate } from '../../domain/types';
import { scheduleLabel } from '../habits/formPolicy';
import type { Copy } from '../../i18n/copy';
import { beforeCreation, displayDefinition, stateAt } from '../habits/habitPresentation';
import { pillarName } from './pillarName';
import { displayDate } from '../../presentation/civilDate';
import { pendingMoveDate } from '../../domain/lifecycle';
import { pendingReactivationDate } from '../../domain/agenda';
import { PillarIcon } from './PillarIcon';
import { ActionsDisclosure } from './ActionsDisclosure';
import { ManagementIcon } from './icons/ManagementIcon';
import './management.css';

type HabitActions = {
  edit: (id: string, move?: boolean) => void;
  review: (id: string, key: string) => void;
  lifecycle: (id: string, action: 'archive' | 'reactivate', key: string) => void;
};

interface ManagementHabitProps extends HabitActions {
  data: Dataset;
  habit: Habit;
  today: LocalDate;
  copy: Copy;
  busy: boolean;
  archived?: boolean;
}

function ManagementHabit({
  data,
  habit,
  today,
  copy,
  busy,
  archived,
  edit,
  review,
  lifecycle,
}: ManagementHabitProps) {
  const definition = displayDefinition(habit, today);
  const pending = habit.versions.at(-1)!;
  const moveDate = pendingMoveDate(habit);
  const resumes = pendingReactivationDate(habit);
  const future = beforeCreation(habit, today);
  const canReactivate = stateAt(habit, today) === 'archived';
  const name = pillarName(
    data.pillars.find((p) => p.id === habit.memberships.at(-1)!.pillarId),
    copy,
  );
  return (
    <article className="management-habit">
      <div>
        <h3>{definition.goal}</h3>
        <p>
          {archived && `${name} · `}
          {scheduleLabel(definition.weekdays, copy)}
        </p>
        {archived && !canReactivate && <p>{copy.historicalConflict}</p>}
        {future ? (
          <p>
            {copy.startsOn.replace('{date}', displayDate(habit.createdOn, data.settings.language))}
          </p>
        ) : (
          <>
            {pending.effectiveFrom > today && (
              <p>
                {copy.pendingChanges} · {displayDate(pending.effectiveFrom, data.settings.language)}
                {' · '}
                <span className="user-content">{pending.goal}</span>
              </p>
            )}
            {moveDate && (
              <p>
                {copy.managementMoveDate.replace(
                  '{date}',
                  displayDate(moveDate, data.settings.language),
                )}
              </p>
            )}
            {stateAt(habit, today) === 'awaiting' && resumes && (
              <p>
                {copy.resumesOn.replace('{date}', displayDate(resumes, data.settings.language))}
              </p>
            )}
          </>
        )}
      </div>
      <div className="habit-row-actions">
        {archived ? (
          <>
            {!future && canReactivate && (
              <button
                disabled={busy}
                data-history-id={`reactivate:${habit.id}`}
                onClick={() => lifecycle(habit.id, 'reactivate', `reactivate:${habit.id}`)}
              >
                {copy.reactivateHabit}
              </button>
            )}
            <button
              className="secondary"
              data-history-id={`review:${habit.id}`}
              disabled={busy}
              onClick={() => review(habit.id, `review:${habit.id}`)}
            >
              {copy.reviewCompletions}
            </button>
          </>
        ) : (
          <>
            {!future && (
              <button
                className="management-edit"
                data-history-id={`edit:${habit.id}`}
                disabled={busy}
                onClick={() => edit(habit.id)}
              >
                {copy.edit}
              </button>
            )}
            <ActionsDisclosure
              context={definition.goal}
              closeLabel={copy.closeActions}
              label={copy.habitActions.replace('{goal}', () => definition.goal)}
              busy={busy}
              originKey={`more:${habit.id}`}
            >
              {(close) => (
                <>
                  {!future && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        close();
                        edit(habit.id, true);
                      }}
                    >
                      {copy.moveHabit}
                    </button>
                  )}
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      close();
                      review(habit.id, `more:${habit.id}`);
                    }}
                  >
                    {copy.reviewCompletions}
                  </button>
                  {!future && (
                    <button
                      className="actions-danger"
                      disabled={busy}
                      onClick={() => {
                        close();
                        lifecycle(habit.id, 'archive', `more:${habit.id}`);
                      }}
                    >
                      {copy.archiveHabit}
                    </button>
                  )}
                </>
              )}
            </ActionsDisclosure>
          </>
        )}
      </div>
    </article>
  );
}

interface PillarsManagementProps extends HabitActions {
  data: Dataset;
  today: LocalDate;
  copy: Copy;
  busy: boolean;
  collapsed: Record<string, boolean>;
  toggle: (id: string) => void;
  create: (id: string) => void;
  archived?: boolean;
  openArchived: () => void;
  newPillar: () => void;
  managePillar: (id: string, action: 'rename' | 'remove' | 'streaks') => void;
}

export function PillarsManagement({
  data,
  today,
  copy,
  busy,
  collapsed,
  toggle,
  create,
  edit,
  review,
  lifecycle,
  archived,
  openArchived,
  newPillar,
  managePillar,
}: PillarsManagementProps) {
  const props = { data, today, copy, busy, edit, review, lifecycle };
  if (archived) {
    const habits = data.habits.filter(
      (h) =>
        stateAt(h, today) === 'archived' ||
        data.pillars.some((p) => p.id === h.memberships.at(-1)!.pillarId && p.removedOn),
    );
    return (
      <>
        {habits.map((habit) => (
          <ManagementHabit {...props} archived habit={habit} key={habit.id} />
        ))}
        {!habits.length && <p>{copy.noArchivedHabits}</p>}
      </>
    );
  }
  return (
    <>
      <div className="action-row management-toolbar">
        <button data-history-id="new-pillar" disabled={busy} onClick={newPillar}>
          {copy.newPillar}
        </button>
        <button
          className="secondary"
          data-history-id="archived"
          disabled={busy}
          onClick={openArchived}
        >
          {copy.archivedHabits}
        </button>
      </div>
      {data.pillars
        .filter((p) => !p.removedOn)
        .map((pillar) => {
          const habits = data.habits.filter(
            (h) => stateAt(h, today) !== 'archived' && h.memberships.at(-1)!.pillarId === pillar.id,
          );
          const name = pillarName(pillar, copy);
          return (
            <section
              className={`management-pillar ${pillar.defaultKey ?? 'custom'}`}
              aria-label={name}
              key={pillar.id}
            >
              <div className="management-pillar-header">
                <h2>
                  <button
                    className="pillar-disclosure"
                    data-history-id={`group:${pillar.id}`}
                    aria-expanded={!(collapsed[pillar.id] ?? true)}
                    aria-controls={`habits-${pillar.id}`}
                    disabled={busy}
                    onClick={() => toggle(pillar.id)}
                    aria-label={name}
                  >
                    <span className="pillar-icon">
                      <PillarIcon kind={pillar.defaultKey} />
                    </span>
                    <span>
                      {name}
                      <small>
                        {(habits.length === 1
                          ? copy.activeHabitSingular
                          : copy.activeHabitCount
                        ).replace('{count}', String(habits.length))}
                      </small>
                    </span>
                    <ManagementIcon
                      name={(collapsed[pillar.id] ?? true) ? 'chevron-down' : 'chevron-up'}
                    />
                  </button>
                </h2>
                <ActionsDisclosure
                  context={name}
                  closeLabel={copy.closeActions}
                  label={copy.pillarActions.replace('{pillar}', () => name)}
                  busy={busy}
                  originKey={`pillar:${pillar.id}`}
                >
                  {(close) => (
                    <>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          close();
                          managePillar(pillar.id, 'rename');
                        }}
                      >
                        {copy.renamePillar}
                      </button>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          close();
                          managePillar(pillar.id, 'streaks');
                        }}
                      >
                        {copy.viewPillarStreaks}
                      </button>
                      <button
                        className="actions-danger"
                        disabled={busy}
                        onClick={() => {
                          close();
                          managePillar(pillar.id, 'remove');
                        }}
                      >
                        {copy.removePillar}
                      </button>
                    </>
                  )}
                </ActionsDisclosure>
              </div>
              {!(collapsed[pillar.id] ?? true) && (
                <div id={`habits-${pillar.id}`}>
                  {habits.map((habit) => (
                    <ManagementHabit {...props} habit={habit} key={habit.id} />
                  ))}
                  {!habits.length && <p className="management-empty">{copy.noHabitsYet}</p>}
                  <div className="management-add">
                    <button
                      className="management-add-button"
                      data-history-id={`add:${pillar.id}`}
                      disabled={busy}
                      onClick={() => create(pillar.id)}
                    >
                      <span aria-hidden="true">+ </span>
                      {copy.addHabit}
                    </button>
                  </div>
                </div>
              )}
            </section>
          );
        })}
    </>
  );
}
