import type { RefObject } from 'react';
import type { AgendaSummary, Language, LocalDate } from '../../domain/types';
import { parseLocalDate } from '../../domain/calendar';
import type { Copy } from '../habits/GoalFields';
import { TrailIcon } from '../journey/TrailIcons';
import './today-feedback.css';

export function displayDate(date: LocalDate, language: Language, short = false): string {
  return new Intl.DateTimeFormat(
    language === 'pt' ? 'pt-BR' : 'en',
    short
      ? { day: 'numeric', month: 'short' }
      : { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' },
  ).format(parseLocalDate(date));
}

interface TodayHeaderProps {
  copy: Copy;
  today: LocalDate;
  language: Language;
  summary: AgendaSummary;
  totalXp: number;
  heading: RefObject<HTMLHeadingElement | null>;
}

export function TodayHeader({
  copy,
  today,
  language,
  summary,
  totalXp,
  heading,
}: TodayHeaderProps) {
  const formattedXp = new Intl.NumberFormat(language === 'pt' ? 'pt-BR' : 'en').format(totalXp);
  const count = summary.required
    ? copy.todayCompletionCount
        .replace('{done}', String(summary.requiredDone))
        .replace('{total}', String(summary.required))
    : copy.noRequired;
  return (
    <header className="today-header main-page-header">
      <div className="today-header-line">
        <div className="today-title-date">
          <h1 className="page-title" ref={heading} tabIndex={-1}>
            {copy.today}
          </h1>
          <time dateTime={today}>{displayDate(today, language)}</time>
        </div>
        <span className="header-xp">
          <span className="header-xp-value" aria-hidden="true">
            <TrailIcon name="sparkles" size={16} />
            <span>
              <strong>{formattedXp}</strong> XP
            </span>
          </span>
          <span className="visually-hidden">
            {copy.totalXpDescription.replace('{xp}', formattedXp)}
          </span>
        </span>
      </div>
      <p className="today-motto page-intro">{copy.dayMotto}</p>
      <section
        className={`today-progress${summary.status === 'complete' ? ' today-complete' : ''}`}
        aria-label={copy.todayProgressTitle}
      >
        <div className="today-progress-copy">
          {summary.status === 'complete' ? (
            <p className="today-complete-message">{copy.todayAllCompleted}</p>
          ) : (
            <h2>{copy.todayProgressTitle}</h2>
          )}
          <p className="today-count">{count}</p>
        </div>
        {summary.status === 'complete' ? (
          <span className="today-complete-icon">
            <TrailIcon name="medal" size={32} />
          </span>
        ) : (
          summary.required > 0 && (
            <span className="today-progress-circle" aria-hidden="true">
              <svg viewBox="0 0 44 44" focusable="false">
                <circle className="circle-track" cx="22" cy="22" r="19" />
                <circle
                  className="circle-value"
                  cx="22"
                  cy="22"
                  r="19"
                  pathLength="100"
                  strokeDasharray={`${(100 * summary.requiredDone) / summary.required} 100`}
                />
              </svg>
              <span>{Math.round((100 * summary.requiredDone) / summary.required)}%</span>
            </span>
          )
        )}
      </section>
    </header>
  );
}
