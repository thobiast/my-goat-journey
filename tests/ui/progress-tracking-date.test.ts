import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { HabitDetail } from '../../src/features/progress/HabitDetail';
import { calculateProgress } from '../../src/domain/progress';
import { archiveHabit, reactivateHabit } from '../../src/domain/lifecycle';
import { facts } from '../domain/fixtures';
import en from '../../src/i18n/en.json';
import pt from '../../src/i18n/pt.json';

it('keeps the original tracking start read-only in existing details after reactivation in both languages', () => {
  const data = facts();
  archiveHabit(data, 'read', new Date('2026-10-02T12:00:00'));
  reactivateHabit(data, 'read', new Date('2026-10-03T12:00:00'));
  const saved = structuredClone(data);
  for (const [copy, language, prefix] of [
    [en, 'en', 'Tracking start: '],
    [pt, 'pt-BR', 'Início do acompanhamento: '],
  ] as const) {
    const localized = structuredClone(data);
    localized.settings.language = copy === pt ? 'pt' : 'en';
    const beforeRender = structuredClone(localized);
    const html = renderToStaticMarkup(
      createElement(HabitDetail, {
        data: localized,
        habit: localized.habits[0],
        today: '2026-10-06',
        progress: calculateProgress(localized, '2026-10-06'),
        copy,
        busy: false,
        edited: () => {},
        toggle: () => {},
        edit: () => {},
        archive: () => {},
        reactivate: () => {},
      }),
    );
    const date = new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(
      new Date('2026-09-27T12:00:00'),
    );
    expect(html).toContain(`<p class="habit-tracking-start">${prefix}${date}</p>`);
    expect(html).not.toContain('name="trackingStart"');
    expect(localized).toEqual(beforeRender);
    expect(data).toEqual(saved);
  }
});
