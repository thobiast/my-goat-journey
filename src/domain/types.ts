export type LocalDate = string;
export type Language = 'en' | 'pt';
export type ProgressInterval = '7d' | '1m' | '3m' | '12m' | '24m';
export const DEFAULT_PILLARS = ['mind', 'body', 'nutrition', 'hygiene'] as const;

export interface Pillar {
  id: string;
  name: string;
  defaultKey?: (typeof DEFAULT_PILLARS)[number];
  nameOverride?: string;
  removedOn?: LocalDate;
}

/** Goal/schedule definitions never own pillar membership. */
export interface HabitVersion {
  effectiveFrom: LocalDate;
  goal: string;
  weekdays: number[];
}

export interface MembershipVersion {
  effectiveFrom: LocalDate;
  pillarId: string;
}

export interface ActivationPeriod {
  id: string;
  start: LocalDate;
  end?: LocalDate;
  archivedOn?: LocalDate;
  reactivatedOn?: LocalDate;
}

export interface PendingReactivation {
  periodId: string;
  requestedOn: LocalDate;
}

export interface PendingMove {
  requestedOn: LocalDate;
  pillarId: string;
}

export interface Habit {
  id: string;
  createdOn: LocalDate;
  versions: HabitVersion[];
  memberships: MembershipVersion[];
  periods: ActivationPeriod[];
  pendingReactivation?: PendingReactivation;
  pendingMove?: PendingMove;
}

export type OccurrenceKind = 'optional' | 'required';
export type PillarParticipation = 'required' | 'on-completion';
export type CompletionProvenance = 'never-credited' | 'credited' | 'legacy-unknown';

export interface OccurrenceSnapshot {
  habitId: string;
  date: LocalDate;
  pillarId: string;
  goal: string;
  kind: OccurrenceKind;
  done: boolean;
  recordedAt: string;
  timezone: string;
  offsetMinutes: number;
}

export interface Occurrence extends OccurrenceSnapshot {
  activationId: string;
  pillarParticipation: PillarParticipation;
  completionProvenance: CompletionProvenance;
  assignmentLocked: boolean;
  exempt?: boolean;
}

export interface GoalInput {
  pillarId: string;
  goal: string;
  weekdays: number[];
}

/** Explicit inclusion for new drafts; absent only on pre-marker legacy drafts. */
export interface OnboardingGoal extends GoalInput {
  configured?: boolean;
}

export interface OnboardingDraft {
  step: number;
  goals: OnboardingGoal[];
  editingReview?: boolean;
}

export interface Settings {
  language: Language;
  reducedMotion: boolean;
  progressInterval?: ProgressInterval;
}

export interface DatasetFacts {
  onboardingComplete: boolean;
  draft: OnboardingDraft | null;
  settings: Settings;
  pillars: Pillar[];
  permanentUnlocks: { id: string; unlockedAt: string }[];
}

export interface Dataset extends DatasetFacts {
  schemaVersion: 2;
  revision: number;
  habits: Habit[];
  occurrences: Occurrence[];
}

/** Explicit schema-1 input only: repository results always use Dataset/schema 2. */
export interface LegacyHabitVersion extends HabitVersion {
  pillarId: string;
}

export interface LegacyHabit {
  id: string;
  createdOn: LocalDate;
  versions: LegacyHabitVersion[];
  periods: ActivationPeriod[];
}

export interface LegacyDataset extends DatasetFacts {
  schemaVersion: 1;
  habits: LegacyHabit[];
  occurrences: OccurrenceSnapshot[];
}

export type CompatibleDataset = Dataset | LegacyDataset;

export interface AgendaItem {
  habit: Habit;
  goal: string;
  weekdays: number[];
  pillarId: string;
  date: LocalDate;
  kind: OccurrenceKind;
  done: boolean;
  firstRequiredDate: LocalDate;
  activationId: string;
  pillarParticipation: PillarParticipation;
  completionProvenance: CompletionProvenance;
  assignmentLocked: boolean;
  exempt: boolean;
}

export interface AgendaSummary {
  required: number;
  requiredDone: number;
  optional: number;
  optionalDone: number;
  status: 'pending' | 'complete' | 'neutral';
}

export interface Clock {
  now(): Date;
}
