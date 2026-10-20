import { DEFAULT_PILLARS, type GoalInput, type OnboardingDraft } from './types';

/** Project selected inputs only; makeHabit remains the final validity authority. */
export function configuredOnboardingGoals(draft: OnboardingDraft): GoalInput[] {
  return normalizeOnboardingDraft(draft)
    .goals.filter((goal) => goal.configured === true)
    .map(({ pillarId, goal, weekdays }) => ({ pillarId, goal, weekdays }));
}

export function emptyOnboardingDraft(): OnboardingDraft {
  return {
    step: 0,
    editingReview: false,
    goals: DEFAULT_PILLARS.map((pillarId) => ({
      pillarId,
      goal: '',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      configured: false,
    })),
  };
}

/** Legacy inference is confined to marker-free drafts and already-passed valid slots. */
export function normalizeOnboardingDraft(draft: OnboardingDraft | null): OnboardingDraft {
  const empty = emptyOnboardingDraft();
  if (!draft) return empty;
  const legacy = !draft.goals.some((goal) => Object.hasOwn(goal, 'configured'));
  return {
    step: draft.step,
    editingReview: draft.editingReview ?? false,
    goals: empty.goals.map((slot, index) => {
      const goal = draft.goals.find((goal) => goal.pillarId === slot.pillarId);
      if (!goal) return slot;
      const valid =
        !!goal.goal.trim() &&
        goal.weekdays.length > 0 &&
        goal.weekdays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6);
      const configured = legacy ? index + 1 < draft.step && valid : goal.configured === true;
      return { pillarId: goal.pillarId, goal: goal.goal, weekdays: [...goal.weekdays], configured };
    }),
  };
}
