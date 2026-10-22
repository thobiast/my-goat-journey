import { useEffect, useRef, useState } from 'react';
import { agenda, pendingReactivationDate } from '../../domain/agenda';
import { habitState } from '../../domain/lifecycle';
import type { Dataset, Habit, LocalDate } from '../../domain/types';
import type { Copy } from '../../i18n/copy';
import { ReactivationDestination } from '../pillars/ReactivationDestination';
import { displayDate } from '../../presentation/civilDate';

interface HabitManagementProps {
  data: Dataset;
  habit: Habit;
  today: LocalDate;
  copy: Copy;
  busy: boolean;
  edited: () => void;
  archive: (revision: number, after: () => void) => void;
  reactivate: (revision: number, after: () => void, pillarId?: string) => void;
}

export function HabitManagement({
  data,
  habit,
  today,
  copy,
  busy,
  archive,
  reactivate,
  edited,
}: HabitManagementProps) {
  const activePillars = data.pillars.filter((p) => !p.removedOn);
  const source = habit.pendingMove?.pillarId ?? habit.memberships.at(-1)!.pillarId;
  const needsDestination = !activePillars.some((p) => p.id === source);
  const [destination, setDestination] = useState('');
  const state = habitState(habit, today);
  const [confirmation, setConfirmation] = useState<{
    action: 'archive' | 'reactivate';
    revision: number;
  }>();
  const title = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirmation) title.current?.focus();
  }, [confirmation]);

  const close = () => {
    setConfirmation(undefined);
    requestAnimationFrame(() => trigger.current?.focus());
  };

  const resumes =
    state.resumesOn ??
    pendingReactivationDate({
      ...habit,
      pendingReactivation: { periodId: 'preview-only', requestedOn: today },
    });
  const item = agenda(data, today).find((i) => i.habit.id === habit.id);
  return (
    <section className="habit-management">
      <h2>{copy.manageHabit}</h2>
      {!confirmation ? (
        <button
          ref={trigger}
          disabled={busy}
          onClick={() => {
            edited();
            setConfirmation({
              action: state.state === 'archived' ? 'reactivate' : 'archive',
              revision: data.revision,
            });
          }}
        >
          {state.state === 'archived' ? copy.reactivateHabit : copy.archiveHabit}
        </button>
      ) : (
        <div className="confirmation" role="group" aria-labelledby="lifecycle-question">
          <h3 ref={title} id="lifecycle-question" tabIndex={-1}>
            {confirmation.action === 'reactivate'
              ? copy.reactivateQuestion
              : state.state === 'awaiting'
                ? copy.cancelResumption
                : copy.archiveQuestion}
          </h3>
          {confirmation.action === 'reactivate' ? (
            <>
              <p>
                {resumes &&
                  copy.resumesOn.replace('{date}', displayDate(resumes, data.settings.language))}
              </p>
              <p>{copy.reactivateHelp}</p>
            </>
          ) : state.state === 'awaiting' ? (
            <p>{copy.cancelResumptionHelp}</p>
          ) : (
            <>
              <p>{copy.archiveHelp}</p>
              {item && <p>{item.done ? copy.archiveCompleted : copy.archiveUnfinished}</p>}
            </>
          )}
          {confirmation.action === 'reactivate' && needsDestination && (
            <ReactivationDestination
              pillars={activePillars}
              copy={copy}
              busy={busy}
              value={destination}
              change={(id) => {
                edited();
                setDestination(id);
              }}
            />
          )}
          <div className="action-row">
            <button
              disabled={busy}
              onClick={() => {
                edited();
                close();
              }}
            >
              {state.state === 'awaiting' ? copy.keepResumption : copy.cancel}
            </button>
            <button
              disabled={
                busy || (confirmation.action === 'reactivate' && needsDestination && !destination)
              }
              onClick={() =>
                confirmation.action === 'archive'
                  ? archive(confirmation.revision, close)
                  : reactivate(
                      confirmation.revision,
                      close,
                      needsDestination ? destination : undefined,
                    )
              }
            >
              {confirmation.action === 'archive' ? copy.archiveHabit : copy.reactivateHabit}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
