import { calculateProgress } from '../../domain/progress';
import type { Dataset } from '../../domain/types';

/** Presentation-only reward for one newly committed Today completion, never a total-XP delta. */
export function committedCompletionXp(
  before: Dataset,
  after: Dataset,
  habitId: string,
  date: string,
  today: string,
): number | undefined {
  if (
    date !== today ||
    before.occurrences.some((item) => item.habitId === habitId && item.date === date && item.done)
  )
    return undefined;
  const award = calculateProgress(after, today).awards.find(
    (item) => item.habitId === habitId && item.date === date,
  );
  return award ? award.baseXp + award.bonusXp : undefined;
}
