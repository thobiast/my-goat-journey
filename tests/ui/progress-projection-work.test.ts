import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { ProgressPage, initialProgressView } from '../../src/features/progress/ProgressPage';
import { calculateProgress } from '../../src/domain/progress';
import en from '../../src/i18n/en.json';
import { countOccurrenceVisits, projectionWorkScenario } from '../helpers/projection-scenarios';

test('the real Progress page shares occurrence work across all visible habit calendars', () => {
  const data = projectionWorkScenario();
  const progress = calculateProgress(data, '2026-10-10');
  const budget = data.occurrences.length * 3;
  const visits = countOccurrenceVisits(data);
  const html = renderToStaticMarkup(
    createElement(ProgressPage, {
      data,
      today: '2026-10-10',
      progress,
      copy: en,
      busy: false,
      value: initialProgressView,
      change: () => {},
      openHabit: () => {},
      add: () => {},
    }),
  );
  expect([...html.matchAll(/class="consistency-card /g)]).toHaveLength(data.habits.length);
  // One earlier-history search and one shared range index, with one pass of headroom.
  expect(visits()).toBeLessThanOrEqual(budget);
});
