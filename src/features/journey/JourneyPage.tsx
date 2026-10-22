import { useState } from 'react';
import type { ProgressSnapshot } from '../../domain/progress';
import type { Language } from '../../domain/types';
import type { Copy } from '../../i18n/copy';
import { MountainTrail } from './MountainTrail';
import { TrailIcon } from './TrailIcons';
import { trailStretch, levelState, levelThreshold } from './trail';
import './journey.css';

export function JourneyPage({
  progress,
  language,
  copy,
}: {
  progress: ProgressSnapshot;
  language: Language;
  copy: Copy;
}) {
  const current = trailStretch(progress.level);
  const [pageIndex, setPageIndex] = useState(current.pageIndex);
  const [selectedLevel, setSelectedLevel] = useState(progress.level);
  const number = new Intl.NumberFormat(language === 'pt' ? 'pt-BR' : 'en');

  const text = (template: string, values: Record<string, number>) =>
    Object.entries(values).reduce(
      (result, [key, value]) => result.replace(`{${key}}`, number.format(value)),
      template,
    );

  const stretch = trailStretch(1 + pageIndex * 4);
  const next = progress.levelProgress;
  const fraction = next.earnedXp / next.requiredXp;
  const state = levelState(selectedLevel, progress.level);
  const stateLabel =
    copy[
      state === 'reached'
        ? 'trailStateReached'
        : state === 'current'
          ? 'trailStateCurrent'
          : 'trailStateUpcoming'
    ];

  const browse = (index: number) => {
    const target = trailStretch(1 + index * 4);
    setPageIndex(index);
    setSelectedLevel((level) => Math.max(target.startLevel, Math.min(target.endLevel, level)));
  };

  const myPosition = () => {
    setPageIndex(current.pageIndex);
    setSelectedLevel(progress.level);
  };

  return (
    <div className="journey-notes">
      <section className="journey-progress" aria-label={copy.accumulatedXp}>
        <div className="journey-progress-row">
          <h2 className="journey-level">{text(copy.generalLevel, { level: progress.level })}</h2>
          <p className="journey-xp">{number.format(progress.totalXp)} XP</p>
        </div>
        <progress
          aria-label={copy.nextLevelProgress}
          aria-valuetext={text(copy.levelProgressText, {
            earned: next.earnedXp,
            required: next.requiredXp,
          })}
          value={next.earnedXp}
          max={next.requiredXp}
        />
        <p className="journey-remaining">
          {text(copy.xpToNextLevel, { remaining: next.remainingXp, level: next.nextLevel })}
        </p>
      </section>
      <section className="journey-trail" aria-labelledby="your-trail">
        <div className="trail-navigation">
          <button
            type="button"
            className="trail-arrow"
            aria-label={copy.previousStretch}
            disabled={pageIndex === 0}
            onClick={() => browse(pageIndex - 1)}
          >
            <TrailIcon name="chevron-left" />
          </button>
          <div>
            <h2 id="your-trail">{copy.yourTrail}</h2>
            <p className="trail-range">
              {text(copy.trailRange, { start: stretch.startLevel, end: stretch.endLevel })}
            </p>
          </div>
          <button
            type="button"
            className="trail-arrow"
            aria-label={copy.nextStretch}
            onClick={() => browse(pageIndex + 1)}
          >
            <TrailIcon name="chevron-right" />
          </button>
        </div>
        <MountainTrail
          startLevel={stretch.startLevel}
          currentLevel={progress.level}
          selectedLevel={selectedLevel}
          fraction={fraction}
          showPosition={pageIndex === current.pageIndex}
          copy={copy}
          text={text}
          select={setSelectedLevel}
        />
        <div className="trail-position-row">
          <p>
            {text(copy.trailPosition, {
              level: progress.level,
              percent: Math.round(fraction * 100),
              next: next.nextLevel,
            })}
          </p>
          {pageIndex !== current.pageIndex && (
            <button type="button" onClick={myPosition}>
              {copy.myPosition}
            </button>
          )}
        </div>
      </section>
      <section
        className="selected-level"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={copy.selectedLevel}
      >
        <div className="selected-level-row">
          <h2 className="selected-level-title">
            {text(copy.generalLevel, { level: selectedLevel })}
          </h2>
          <span aria-hidden="true">·</span>
          <p>{stateLabel}</p>
        </div>
        <p className="selected-level-facts">
          {text(copy.levelThreshold, { xp: levelThreshold(selectedLevel) })}
          {state === 'upcoming' && (
            <>
              {' · '}
              {text(copy.levelRemaining, { xp: levelThreshold(selectedLevel) - progress.totalXp })}
            </>
          )}
        </p>
      </section>
      <section className="journey-streak" aria-labelledby="journey-streak">
        <h2 id="journey-streak">{copy.dailyStreak}</h2>
        <span aria-hidden="true"> · </span>
        <p className="journey-overall">
          {text(progress.overall.current === 1 ? copy.dailyStreakDayOne : copy.dailyStreakDayMany, {
            count: progress.overall.current,
          })}
          {' · '}
          {text(copy.streakRecord, { best: progress.overall.best })}
        </p>
      </section>
      <details className="journey-help">
        <summary>{copy.journeyHelpTitle}</summary>
        {copy.journeyProgressionParagraphs.map((paragraph, index) => (
          <p
            key={paragraph}
            className={
              index === copy.journeyProgressionParagraphs.length - 1
                ? 'journey-reward-help'
                : undefined
            }
          >
            {paragraph}
          </p>
        ))}
      </details>
    </div>
  );
}
