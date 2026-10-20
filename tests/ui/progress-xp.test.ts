import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { calculateProgress } from '../../src/domain/progress';
import { ProgressPage, initialProgressView } from '../../src/features/progress/ProgressPage';
import { facts } from '../domain/fixtures';
import en from '../../src/i18n/en.json';
import pt from '../../src/i18n/pt.json';
import { GlobalXpProgress } from '../../src/features/progress/GlobalXpProgress';
import { updateCompletion } from '../../src/domain/completion';
import type { Dataset } from '../../src/domain/types';

function render() {
  const data = facts();
  return renderToStaticMarkup(
    createElement(ProgressPage, {
      data,
      today: '2026-10-03',
      progress: calculateProgress(data, '2026-10-03'),
      copy: en,
      busy: false,
      value: initialProgressView,
      change: () => {},
      openHabit: () => {},
      add: () => {},
    }),
  );
}

function completedFacts(count: number): Dataset {
  const data = facts();
  const template = data.habits[0];
  data.habits = Array.from({ length: count }, (_, index) => ({
    ...structuredClone(template),
    id: `habit-${index}`,
  }));
  data.occurrences = data.habits.map((habit) => ({
    habitId: habit.id,
    date: habit.createdOn,
    pillarId: 'mind',
    goal: habit.versions[0].goal,
    kind: 'optional',
    done: true,
    recordedAt: '2026-09-27T12:00:00.000Z',
    timezone: 'UTC',
    offsetMinutes: 0,
    activationId: 'initial',
    pillarParticipation: 'on-completion',
    completionProvenance: 'credited',
    assignmentLocked: true,
  }));
  return data;
}

describe('Global Progress XP', () => {
  it.each([en, pt])(
    'formats larger replay-derived totals and levels without changing current-level progress',
    (copy) => {
      const data = completedFacts(1234);
      const progress = calculateProgress(data, '2026-09-27');
      const language = copy === pt ? 'pt' : 'en';
      const html = renderToStaticMarkup(
        createElement(GlobalXpProgress, { progress, language, copy }),
      );
      expect(progress.totalXp).toBe(12340);
      expect(html).toContain(language === 'pt' ? '12.340 / 12.400 XP' : '12,340 / 12,400 XP');
      expect(html).toContain(language === 'pt' ? 'Nível 124' : 'Level 124');
      expect(html).toContain(
        language === 'pt' ? 'Faltam 60 XP para o nível 125' : '60 XP to reach level 125',
      );
      expect(html).toContain('value="40" max="100"');
    },
  );

  it('replays corrections at exact boundaries instead of retaining a stale level', () => {
    const data = completedFacts(10);

    const renderBlock = () =>
      renderToStaticMarkup(
        createElement(GlobalXpProgress, {
          progress: calculateProgress(data, '2026-09-27'),
          language: 'en',
          copy: en,
        }),
      );

    expect(renderBlock()).toContain('100 / 200 XP');
    expect(renderBlock()).toContain('value="0" max="100"');
    updateCompletion(data, 'habit-0', '2026-09-27', false, new Date('2026-09-27T12:00:00'));
    expect(renderBlock()).toContain('90 / 100 XP');
    expect(renderBlock()).toContain('value="90" max="100"');
    updateCompletion(data, 'habit-0', '2026-09-27', true, new Date('2026-09-27T12:01:00'));
    expect(renderBlock()).toContain('100 / 200 XP');
    expect(renderBlock()).toContain('value="0" max="100"');
  });

  it('keeps English and Portuguese catalog keys aligned', () => {
    expect(Object.keys(pt).sort()).toEqual(Object.keys(en).sort());
  });
  it('shows zero XP before the tabs with an accessible current-level bar and decorative rocket', () => {
    const html = render();
    expect(html).toContain('class="progress-xp"');
    expect(html.indexOf('class="progress-xp"')).toBeLessThan(html.indexOf('class="progress-tabs"'));
    expect(html).toContain('Level 1');
    expect(html).toContain('0 / 100 XP');
    expect(html).toContain('Level 2');
    expect(html).toContain('100 XP to reach level 2');
    expect(html).toMatch(
      /<progress[^>]*aria-label="[^"]+"[^>]*aria-valuetext="[^"]*100 XP to reach level 2[^>]*value="0"[^>]*max="100"/,
    );
    expect(html).toContain('aria-hidden="true">🚀</span>');
    expect(html).not.toContain('XP accumulated');
  });
});
