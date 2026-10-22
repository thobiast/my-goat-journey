import { useState, type RefObject } from 'react';
import {
  DEFAULT_PILLARS,
  type GoalInput,
  type OnboardingDraft,
  type Language,
} from '../../domain/types';
import { GoalFields } from '../habits/GoalFields';
import { scheduleLabel, validGoal } from '../habits/formPolicy';
import type { Copy } from '../../i18n/copy';
import { PillarIcon } from '../pillars/PillarIcon';
import '../habits/forms.css';
import './onboarding.css';

interface Props {
  copy: Copy;
  draft: OnboardingDraft;
  language: Language;
  busy: boolean;
  status: string;
  heading: RefObject<HTMLHeadingElement | null>;
  editingReview: boolean;
  advance: (step: number, configured?: boolean) => void;
  update: (goal: GoalInput) => void;
  edit: (index: number) => void;
  finalize: () => void;
  setLanguage: (language: Language) => void;
}

export function Onboarding({
  copy,
  draft,
  language,
  busy,
  status,
  heading,
  editingReview,
  advance,
  update,
  edit,
  finalize,
  setLanguage,
}: Props) {
  const [attempted, setAttempted] = useState(false);
  const savedStatus = (
    <p className="onboarding-status" role="status" aria-live="polite" aria-atomic="true">
      {status}
    </p>
  );
  const compactBrand = <p className="onboarding-brand">My GOAT Journey</p>;
  if (draft.step === 0)
    return (
      <>
        <img
          className="onboarding-logo"
          src={`${import.meta.env.BASE_URL}branding/My_GOAT_Journey_mountain_logo.png`}
          width="128"
          height="128"
          alt="My GOAT Journey"
        />
        <header className="main-page-header">
          <h1 className="page-title" ref={heading} tabIndex={-1}>
            {copy.welcome}
          </h1>
          <p className="page-intro">{copy.intro}</p>
        </header>
        <p className="onboarding-pillar-list">
          {DEFAULT_PILLARS.map((id) => copy[id]).join(' · ')}
        </p>
        <div className="onboarding-welcome-actions">
          <label htmlFor="language">{copy.language}</label>
          <select
            id="language"
            disabled={busy}
            value={language}
            onChange={(event) => setLanguage(event.target.value as Language)}
          >
            <option value="en">English</option>
            <option value="pt">Português</option>
          </select>
          <button disabled={busy} onClick={() => advance(1)}>
            {copy.start}
          </button>
        </div>
        {savedStatus}
      </>
    );
  if (draft.step <= 4) {
    const current = draft.goals[draft.step - 1];
    const errors = attempted
      ? {
          goal: current.goal.trim() ? undefined : copy.onboardingGoalError,
          weekdays: current.weekdays.length ? undefined : copy.onboardingDayError,
        }
      : undefined;

    const proceed = () => {
      if (validGoal(current)) {
        advance(editingReview ? 5 : draft.step + 1, true);
        return;
      }
      setAttempted(true);
      requestAnimationFrame(() => {
        const first = !current.goal.trim()
          ? document.getElementById('goal')
          : document.querySelector<HTMLButtonElement>('.weekdays button');
        first?.focus();
      });
    };

    return (
      <>
        {compactBrand}
        <div className="onboarding-navigation">
          <button
            className="onboarding-back"
            disabled={busy}
            onClick={() => advance(editingReview ? 5 : draft.step - 1)}
          >
            ← {copy.back}
          </button>
          <p>{copy.step.replace('{step}', String(draft.step))}</p>
        </div>
        <ol className="onboarding-progress" aria-label={copy.onboardingProgress}>
          {DEFAULT_PILLARS.map((id, index) => (
            <li
              key={id}
              data-passed={index + 1 < draft.step}
              aria-current={index + 1 === draft.step ? 'step' : undefined}
            >
              <span className="visually-hidden">{copy[id]}</span>
            </li>
          ))}
        </ol>
        <header className="main-page-header">
          <h1 className="page-title onboarding-pillar-title" ref={heading} tabIndex={-1}>
            <span className={`onboarding-pillar-icon ${current.pillarId}`}>
              <PillarIcon kind={current.pillarId} />
            </span>
            {copy[current.pillarId as (typeof DEFAULT_PILLARS)[number]]}
          </h1>
        </header>
        <form
          className="habit-form onboarding-form"
          onSubmit={(event) => {
            event.preventDefault();
            proceed();
          }}
        >
          <GoalFields
            value={current}
            onChange={update}
            copy={copy}
            busy={busy}
            errors={errors}
            compact
            helpText={copy.onboardingExample}
          />
          <div className="action-row">
            <button type="submit" disabled={busy}>
              {busy ? copy.saving : copy.continue}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => advance(editingReview ? 5 : draft.step + 1, false)}
            >
              {copy.onboardingSkip}
            </button>
          </div>
        </form>
        {savedStatus}
      </>
    );
  }
  const hasHabit = draft.goals.some((goal) => goal.configured && validGoal(goal));

  const submit = () => {
    if (hasHabit) {
      finalize();
      return;
    }
    setAttempted(true);
    requestAnimationFrame(() =>
      document.querySelector<HTMLButtonElement>('[data-onboarding-add]')?.focus(),
    );
  };

  return (
    <>
      {compactBrand}
      <header className="main-page-header">
        <h1 className="page-title" ref={heading} tabIndex={-1}>
          {copy.review}
        </h1>
      </header>
      <div className="onboarding-review">
        {draft.goals.map((goal, index) => {
          const name = copy[goal.pillarId as (typeof DEFAULT_PILLARS)[number]];
          return (
            <section
              className="onboarding-review-row"
              key={goal.pillarId}
              aria-labelledby={`review-${goal.pillarId}`}
              data-onboarding-pillar={goal.pillarId}
            >
              <div className="onboarding-review-top">
                <h2 id={`review-${goal.pillarId}`}>
                  <span className={`onboarding-pillar-icon ${goal.pillarId}`}>
                    <PillarIcon kind={goal.pillarId} />
                  </span>
                  <span className="onboarding-pillar-name">{name}</span>
                </h2>
                <button
                  className="onboarding-review-edit"
                  data-onboarding-add={goal.configured ? undefined : true}
                  disabled={busy}
                  aria-label={`${goal.configured ? copy.edit : copy.addHabit} ${name}`}
                  onClick={() => edit(index)}
                >
                  {goal.configured ? copy.edit : copy.addHabit}
                </button>
              </div>
              {goal.configured ? (
                <>
                  <p className="onboarding-review-goal user-content">{goal.goal}</p>
                  <p className="onboarding-review-frequency">
                    {scheduleLabel(
                      [...goal.weekdays].sort((a, b) => a - b),
                      copy,
                    )}
                  </p>
                </>
              ) : (
                <p className="onboarding-review-empty">{copy.onboardingNoHabit}</p>
              )}
            </section>
          );
        })}
      </div>
      {!hasHabit && (
        <p id="onboarding-minimum" className="field-error" role={attempted ? 'alert' : undefined}>
          {copy.onboardingMinimum}
        </p>
      )}
      {hasHabit && <p className="onboarding-first-day">{copy.onboardingFirstDay}</p>}
      <button
        className="onboarding-finalize"
        disabled={busy}
        aria-describedby={!hasHabit ? 'onboarding-minimum' : undefined}
        onClick={submit}
      >
        {busy ? copy.saving : copy.finalize}
      </button>
      {savedStatus}
    </>
  );
}
