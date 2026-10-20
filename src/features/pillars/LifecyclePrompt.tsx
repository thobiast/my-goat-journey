import { useEffect, useRef, useState } from 'react';
import { pendingReactivationDate } from '../../domain/agenda';
import { habitState } from '../../domain/lifecycle';
import type { Dataset, Habit, LocalDate } from '../../domain/types';
import type { Copy } from '../habits/GoalFields';
import { ReactivationDestination } from './ReactivationDestination';
import { displayDate } from '../today/TodayHeader';

interface LifecyclePromptProps {
  data: Dataset;
  habit: Habit;
  today: LocalDate;
  copy: Copy;
  busy: boolean;
  action: 'archive' | 'reactivate';
  cancel: () => void;
  edited: () => void;
  confirm: (revision: number, pillarId?: string) => void;
}

export function LifecyclePrompt({
  data,
  habit,
  today,
  copy,
  busy,
  action,
  cancel,
  confirm,
  edited,
}: LifecyclePromptProps) {
  const activePillars = data.pillars.filter((p) => !p.removedOn);
  const source = habit.pendingMove?.pillarId ?? habit.memberships.at(-1)!.pillarId;
  const needsDestination = action === 'reactivate' && !activePillars.some((p) => p.id === source);
  const [destination, setDestination] = useState('');
  const title = useRef<HTMLHeadingElement>(null);
  const revision = useRef(data.revision);
  useEffect(() => {
    title.current?.focus();
  }, []);
  const state = habitState(habit, today);
  const resumes = pendingReactivationDate({
    ...habit,
    pendingReactivation: { periodId: 'preview-only', requestedOn: today },
  });
  return (
    <section className="confirmation" aria-labelledby="lifecycle-question">
      <h2 id="lifecycle-question" ref={title} tabIndex={-1}>
        {action === 'reactivate'
          ? copy.reactivateQuestion
          : state.state === 'awaiting'
            ? copy.cancelResumption
            : copy.archiveQuestion}
      </h2>
      <p className="user-content">{habit.versions.at(-1)!.goal}</p>
      {action === 'reactivate' ? (
        <>
          <p>
            {resumes &&
              copy.resumesOn.replace('{date}', displayDate(resumes, data.settings.language))}
          </p>
          <p>{copy.reactivateHelp}</p>
        </>
      ) : (
        <p>{state.state === 'awaiting' ? copy.cancelResumptionHelp : copy.managementArchiveHelp}</p>
      )}
      {needsDestination && (
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
        <button className="secondary" disabled={busy} onClick={cancel}>
          {copy.cancel}
        </button>
        <button
          disabled={busy || (needsDestination && !destination)}
          onClick={() => confirm(revision.current, needsDestination ? destination : undefined)}
        >
          {action === 'archive' ? copy.archiveHabit : copy.reactivateHabit}
        </button>
      </div>
    </section>
  );
}
