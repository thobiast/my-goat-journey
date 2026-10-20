import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { TodayPage } from '../../src/features/today/TodayPage';
import { agenda } from '../../src/domain/agenda';
import { calculateProgress } from '../../src/domain/progress';
import { updateCompletion } from '../../src/domain/completion';
import { facts } from '../domain/fixtures';
import en from '../../src/i18n/en.json';
import pt from '../../src/i18n/pt.json';

for (const language of ['en', 'pt'] as const) {
  const copy = language === 'en' ? en : pt;
  for (const [total, done] of [
    [2, 0],
    [2, 1],
    [2, 2],
    [1, 0],
    [1, 1],
  ]) {
    test(`Today group status is count-first with appropriate number ${language} ${done}/${total}`, () => {
      const data = facts();
      const date = '2026-09-28';
      if (total === 2) {
        const other = structuredClone(data.habits[0]);
        other.id = 'other';
        data.habits.push(other);
      }
      for (const habit of data.habits.slice(0, done))
        updateCompletion(data, habit.id, date, true, new Date(`${date}T12:00:00`));
      const html = renderToStaticMarkup(
        createElement(TodayPage, {
          items: agenda(data, date),
          pillars: data.pillars,
          progress: calculateProgress(data, date),
          language,
          copy,
          busy: false,
          toggle: () => {},
          addHabit: () => {},
        }),
      );
      const status = html.match(/<p class="today-pillar-status">([\s\S]*?)<\/p>/)![1];
      const adjective = language === 'en' ? 'completed' : total === 1 ? 'concluído' : 'concluídos';
      const suffix = done === total ? (language === 'en' ? ' today' : ' hoje') : '';
      expect(status.replace(/<[^>]*>/g, '')).toBe(`${done}/${total} ${adjective}${suffix}`);
      expect(status.includes('<svg')).toBe(done === total);
      if (done === total) {
        expect(status).toContain('aria-hidden="true"');
        expect(html).toContain(`<span>${copy.completedToday}</span>`);
      }
      expect(status).not.toContain('✓');
    });
  }
  for (const optional of [false, true])
    test(`zero required scope never becomes count-based success ${language} optional=${optional}`, () => {
      const data = facts();
      const date = optional ? '2026-09-27' : '2026-09-29';
      const html = renderToStaticMarkup(
        createElement(TodayPage, {
          items: agenda(data, date),
          pillars: data.pillars,
          progress: calculateProgress(data, date),
          language,
          copy,
          busy: false,
          toggle: () => {},
          addHabit: () => {},
        }),
      );
      expect(html).not.toContain('0/0');
      if (optional) expect(html).toContain(copy.optionalOnly);
      else expect(html).not.toContain('today-pillar-status');
    });
}
