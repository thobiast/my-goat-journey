import type { ProgressSnapshot } from '../../domain/progress';
import type { Language } from '../../domain/types';
import type { Copy } from '../habits/GoalFields';

/** Global committed progression, independent of the displayed calendar window. */
export function GlobalXpProgress({
  progress,
  language,
  copy,
}: {
  progress: ProgressSnapshot;
  language: Language;
  copy: Copy;
}) {
  const number = new Intl.NumberFormat(language === 'pt' ? 'pt-BR' : 'en');

  const text = (template: string, values: Record<string, number>) =>
    Object.entries(values).reduce(
      (result, [key, value]) => result.replace(`{${key}}`, number.format(value)),
      template,
    );

  const next = progress.levelProgress;
  const remaining = text(copy.progressXpRemaining, {
    remaining: next.remainingXp,
    level: next.nextLevel,
  });

  return (
    <section className="progress-xp">
      <div className="progress-xp-row">
        <div className="progress-xp-current">
          <strong>{text(copy.generalLevel, { level: progress.level })}</strong>
          <span className="progress-xp-fraction">
            {text(copy.progressXpFraction, {
              total: progress.totalXp,
              threshold: progress.totalXp + next.remainingXp,
            })}
          </span>
        </div>
        <div className="progress-xp-next">
          <strong>{text(copy.generalLevel, { level: next.nextLevel })}</strong>
          <span className="progress-xp-rocket" aria-hidden="true">
            🚀
          </span>
        </div>
      </div>
      <progress
        aria-label={copy.nextLevelProgress}
        aria-valuetext={`${text(copy.levelProgressText, { earned: next.earnedXp, required: next.requiredXp })} ${remaining}`}
        value={next.earnedXp}
        max={next.requiredXp}
      />
      <p className="progress-xp-remaining">{remaining}</p>
    </section>
  );
}
