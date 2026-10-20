import { expect, test } from 'vitest';
import {
  configuredOnboardingGoals,
  emptyOnboardingDraft,
  normalizeOnboardingDraft,
} from '../../src/domain/onboarding';
import { DEFAULT_PILLARS } from '../../src/domain/types';

test('fresh drafts contain four independent explicitly unconfigured default slots', () => {
  const expected = {
    step: 0,
    editingReview: false,
    goals: DEFAULT_PILLARS.map((pillarId) => ({
      pillarId,
      goal: '',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      configured: false,
    })),
  };
  const draft = emptyOnboardingDraft();
  expect(draft).toEqual(expected);
  expect(normalizeOnboardingDraft(null)).toEqual(expected);
  draft.goals[0].weekdays.pop();
  expect(draft.goals[1].weekdays).toHaveLength(7);
  expect(emptyOnboardingDraft()).toEqual(expected);
});

test('normalization restores canonical slots without interpreting retained text as inclusion', () => {
  const draft = {
    step: 5,
    goals: [
      { pillarId: 'hygiene', goal: '  Retained text 🎵  ', weekdays: [], configured: false },
      { pillarId: 'body', goal: 'Chosen', weekdays: [5, 1], configured: true },
      { pillarId: 'mind', goal: 'Missing marker in new draft', weekdays: [2] },
    ],
  };
  const before = structuredClone(draft);
  const normalized = normalizeOnboardingDraft(draft);
  expect(normalized).toEqual({
    step: 5,
    editingReview: false,
    goals: [
      { ...draft.goals[2], configured: false },
      draft.goals[1],
      { pillarId: 'nutrition', goal: '', weekdays: [0, 1, 2, 3, 4, 5, 6], configured: false },
      draft.goals[0],
    ],
  });
  expect(normalizeOnboardingDraft(normalized)).toEqual(normalized);
  normalized.goals[1].weekdays.push(3);
  expect(draft).toEqual(before);
});

test.each([0, 1, 2, 3, 4, 5])(
  'legacy inclusion requires progression before saved step %i',
  (step) => {
    const goals = DEFAULT_PILLARS.map((pillarId) => ({
      pillarId,
      goal: `Goal ${pillarId}`,
      weekdays: [1],
    }));
    const normalized = normalizeOnboardingDraft({ step, goals });
    expect(normalized.goals.map((g) => g.configured)).toEqual(
      DEFAULT_PILLARS.map((_id, index) => index + 1 < step),
    );
    expect(normalized.step).toBe(step);
    expect(normalized.goals.map(({ configured: _configured, ...goal }) => goal)).toEqual(goals);
  },
);

test.each([
  { goal: '  ', weekdays: [1] },
  { goal: 'Text', weekdays: [] },
  { goal: 'Text', weekdays: [7] },
])('invalid legacy review text remains unconfigured: %j', (invalid) => {
  const normalized = normalizeOnboardingDraft({
    step: 5,
    goals: [{ pillarId: 'mind', ...invalid }],
  });
  expect(normalized.goals[0]).toEqual({ pillarId: 'mind', ...invalid, configured: false });
});

test('selection returns only configured goal inputs and leaves selected validation to creation', () => {
  const draft = emptyOnboardingDraft();
  draft.step = 5;
  draft.goals[0] = { ...draft.goals[0], goal: 'Skipped valid text', configured: false };
  draft.goals[1] = { ...draft.goals[1], goal: '  My walk  ', weekdays: [5, 1], configured: true };
  draft.goals[2] = { ...draft.goals[2], goal: '', weekdays: [], configured: true };
  expect(configuredOnboardingGoals(draft)).toEqual([
    { pillarId: 'body', goal: '  My walk  ', weekdays: [5, 1] },
    { pillarId: 'nutrition', goal: '', weekdays: [] },
  ]);
  const goals = configuredOnboardingGoals(draft);
  goals[0].weekdays.pop();
  expect(draft.goals[1].weekdays).toEqual([5, 1]);
  expect(configuredOnboardingGoals(emptyOnboardingDraft())).toEqual([]);
});

test.each([true, false])(
  'normalization preserves persisted review-edit intent %s',
  (editingReview) => {
    const draft = { ...emptyOnboardingDraft(), step: 2, editingReview };
    expect(normalizeOnboardingDraft(draft).editingReview).toBe(editingReview);
  },
);
