import { agenda, pendingReactivationDate, summarize } from './agenda';
import { localDate, parseLocalDate } from './calendar';
import { migrateDataset } from '../data/migrations';
import type { AgendaSummary, CompatibleDataset, LocalDate } from './types';

export interface StreakProgress {
  current: number;
  best: number;
}

export interface NextBonus {
  threshold: number;
  bonusXp: number;
  remaining: number;
}

export interface HabitProgress extends StreakProgress {
  xp: number;
  nextBonus: NextBonus | null;
}

export interface CompletionAward {
  habitId: string;
  date: LocalDate;
  activationId: string;
  sequenceId: string;
  streak: number;
  baseXp: number;
  bonusXp: number;
}

export interface LevelProgress {
  earnedXp: number;
  requiredXp: 100;
  remainingXp: number;
  nextLevel: number;
}

export interface ProgressSnapshot {
  habits: Record<string, HabitProgress>;
  pillars: Record<string, StreakProgress>;
  overall: StreakProgress;
  totalXp: number;
  level: number;
  levelProgress: LevelProgress;
  awards: CompletionAward[];
}

export const BASE_XP = 10;
export const MILESTONES = [
  { threshold: 3, bonusXp: 10 },
  { threshold: 7, bonusXp: 30 },
  { threshold: 14, bonusXp: 60 },
  { threshold: 30, bonusXp: 100 },
  { threshold: 45, bonusXp: 150 },
  { threshold: 60, bonusXp: 200 },
  { threshold: 70, bonusXp: 250 },
  { threshold: 80, bonusXp: 300 },
  { threshold: 90, bonusXp: 350 },
  { threshold: 100, bonusXp: 400 },
  { threshold: 125, bonusXp: 500 },
  { threshold: 150, bonusXp: 600 },
  { threshold: 175, bonusXp: 700 },
  { threshold: 200, bonusXp: 800 },
  { threshold: 250, bonusXp: 1000 },
  { threshold: 300, bonusXp: 1200 },
  { threshold: 365, bonusXp: 1500 },
] as const;

function reconcileAggregateDay(
  progress: StreakProgress,
  summary: AgendaSummary,
  closed: boolean,
): void {
  if (summary.status === 'complete') {
    progress.current++;
    progress.best = Math.max(progress.best, progress.current);
  } else if (summary.status === 'pending' && closed) {
    progress.current = 0;
  }
}

/** Reconcile derived progress from dated facts without mutating the browser dataset. */
export function calculateProgress(input: CompatibleDataset, today: LocalDate): ProgressSnapshot {
  const data = migrateDataset(input);
  parseLocalDate(today);
  const result: ProgressSnapshot = {
    habits: Object.fromEntries(
      data.habits.map((h) => [h.id, { current: 0, best: 0, xp: 0, nextBonus: null }]),
    ),
    pillars: Object.fromEntries(data.pillars.map((p) => [p.id, { current: 0, best: 0 }])),
    overall: { current: 0, best: 0 },
    totalXp: 0,
    level: 1,
    levelProgress: { earnedXp: 0, requiredXp: 100, remainingXp: 100, nextLevel: 2 },
    awards: [],
  };
  const starts = Object.create(null) as Record<string, string>;
  const activations = Object.create(null) as Record<string, string>;
  const firstDate = data.habits.map((h) => h.createdOn).sort()[0] ?? today;
  const cursor = parseLocalDate(firstDate);
  for (
    let date = localDate(cursor);
    date <= today;
    cursor.setDate(cursor.getDate() + 1), date = localDate(cursor)
  ) {
    const items = agenda(data, date);
    for (const item of items) {
      const progress = result.habits[item.habit.id];
      const activationId = item.activationId;
      if (activations[item.habit.id] !== activationId) {
        progress.current = 0;
        delete starts[item.habit.id];
        activations[item.habit.id] = activationId;
      }
      if (!item.done) {
        if (date < today && item.kind === 'required' && !item.exempt) {
          progress.current = 0;
          delete starts[item.habit.id];
        }
        continue;
      }
      progress.current++;
      progress.best = Math.max(progress.best, progress.current);
      const bonusXp = MILESTONES.find((m) => m.threshold === progress.current)?.bonusXp ?? 0;
      starts[item.habit.id] ??= date;
      result.awards.push({
        habitId: item.habit.id,
        date,
        activationId,
        sequenceId: `${activationId}:${starts[item.habit.id]}`,
        streak: progress.current,
        baseXp: BASE_XP,
        bonusXp,
      });
      progress.xp += BASE_XP + bonusXp;
      result.totalXp += BASE_XP + bonusXp;
    }
    reconcileAggregateDay(result.overall, summarize(items), date < today);
    for (const pillar of data.pillars) {
      const summary = summarize(
        items.filter((item) => item.pillarId === pillar.id),
        'pillar',
      );
      reconcileAggregateDay(result.pillars[pillar.id], summary, date < today);
    }
  }
  for (const habit of data.habits) {
    const progress = result.habits[habit.id];
    const resumeDate = pendingReactivationDate(habit);
    if (resumeDate && habit.pendingReactivation!.requestedOn <= today && resumeDate > today)
      progress.current = 0;
    const next = MILESTONES.find((m) => m.threshold > progress.current);
    progress.nextBonus = next ? { ...next, remaining: next.threshold - progress.current } : null;
  }
  result.level = 1 + Math.floor(result.totalXp / 100);
  const earnedXp = result.totalXp % 100;
  result.levelProgress = {
    earnedXp,
    requiredXp: 100,
    remainingXp: 100 - earnedXp,
    nextLevel: result.level + 1,
  };
  return result;
}
