import type { HabitProgress } from '../../domain/progress';
import type { Copy } from './GoalFields';

function emphasizedText(template: string, values: Record<string, number | string>) {
  return template.split(/(\{\w+\})/g).map((part, index) => {
    const token = part.match(/^\{(\w+)\}$/);
    return token ? <strong key={index}>{values[token[1]]}</strong> : part;
  });
}

export function HabitMetrics({ progress, copy }: { progress: HabitProgress; copy: Copy }) {
  return (
    <div className="habit-metrics">
      <p className="habit-streak-line">
        {emphasizedText(copy.streakCompact, { current: progress.current, best: progress.best })}
      </p>
      {progress.nextBonus && (
        <p className="next-bonus-message">
          {emphasizedText(
            progress.nextBonus.remaining === 1 ? copy.nextBonusOne : copy.nextBonusMany,
            { bonus: `+${progress.nextBonus.bonusXp} XP`, remaining: progress.nextBonus.remaining },
          )}
        </p>
      )}
    </div>
  );
}
