import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { TodayHeader } from '../../src/features/today/TodayHeader';
import { agenda, summarize } from '../../src/domain/agenda';
import { updateCompletion } from '../../src/domain/completion';
import { archiveHabit, editHabit } from '../../src/domain/lifecycle';
import { calculateProgress } from '../../src/domain/progress';
import type { Dataset, Language } from '../../src/domain/types';
import { facts } from '../domain/fixtures';
import en from '../../src/i18n/en.json';
import pt from '../../src/i18n/pt.json';

const message = {
  en: 'Good job! All habits completed today.',
  pt: 'Muito bem! Todos os hábitos de hoje concluídos.',
};

function render(data: Dataset, date: string, language: Language) {
  const copy = language === 'en' ? en : pt;
  return renderToStaticMarkup(
    createElement(TodayHeader, {
      copy,
      today: date,
      language,
      summary: summarize(agenda(data, date)),
      totalXp: calculateProgress(data, date).totalXp,
      heading: { current: null },
    }),
  );
}

for (const language of ['en', 'pt'] as const) {
  const copy = language === 'en' ? en : pt;
  test(`completed required day celebrates while retaining its localized count ${language}`, () => {
    const data = facts();
    const now = new Date('2026-09-28T12:00:00');
    expect(render(data, '2026-09-28', language)).not.toContain(message[language]);
    updateCompletion(data, 'read', '2026-09-28', true, now);
    const before = structuredClone(data);
    const progress = calculateProgress(data, '2026-09-28');
    const html = render(data, '2026-09-28', language);
    expect(html).toContain(message[language]);
    expect(html).toContain(
      copy.todayCompletionCount.replace('{done}', '1').replace('{total}', '1'),
    );
    expect(html.indexOf(message[language])).toBeLessThan(
      html.indexOf(copy.todayCompletionCount.replace('{done}', '1').replace('{total}', '1')),
    );
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('focusable="false"');
    expect(data).toEqual(before);
    expect(calculateProgress(data, '2026-09-28')).toEqual(progress);
  });
  test(`correction and new local day remove recognition without changing rules ${language}`, () => {
    const data = facts();
    const now = new Date('2026-09-28T12:00:00');
    updateCompletion(data, 'read', '2026-09-28', true, now);
    expect(render(data, '2026-09-28', language)).toContain(message[language]);
    updateCompletion(data, 'read', '2026-09-28', false, now);
    expect(render(data, '2026-09-28', language)).not.toContain(message[language]);
    expect(render(data, '2026-09-28', language)).toContain(
      copy.todayCompletionCount.replace('{done}', '0').replace('{total}', '1'),
    );
    updateCompletion(data, 'read', '2026-09-28', true, now);
    expect(render(data, '2026-09-29', language)).not.toContain(message[language]);
    expect(render(data, '2026-09-29', language)).toContain(copy.noRequired);
    expect(render(data, '2026-09-30', language)).not.toContain(message[language]);
  });
  test(`empty, unscheduled and unchecked creation opportunities stay neutral ${language}`, () => {
    const data = facts();
    for (const date of ['2026-09-27', '2026-09-29']) {
      expect(summarize(agenda(data, date)).status).toBe('neutral');
      expect(render(data, date, language)).not.toContain(message[language]);
      expect(render(data, date, language)).toContain(copy.noRequired);
    }
    data.habits = [];
    expect(render(data, '2026-09-28', language)).not.toContain(message[language]);
  });
  test(`completed optional opportunity is eligible but other unchecked optional goals do not block ${language}`, () => {
    const data = facts();
    const other = structuredClone(data.habits[0]);
    other.id = 'optional-other';
    data.habits.push(other);
    updateCompletion(data, 'read', '2026-09-27', true, new Date('2026-09-27T12:00:00'));
    expect(summarize(agenda(data, '2026-09-27')).status).toBe('complete');
    expect(render(data, '2026-09-27', language)).toContain(message[language]);
    expect(render(data, '2026-09-27', language)).toContain(copy.noRequired);
  });
  test(`unscheduled and unchecked newly added goals cannot block a complete required day ${language}`, () => {
    const data = facts();
    const optional = structuredClone(data.habits[0]);
    const unscheduled = structuredClone(data.habits[0]);
    optional.id = 'new';
    optional.createdOn = '2026-09-28';
    optional.versions[0].effectiveFrom = '2026-09-28';
    optional.memberships[0].effectiveFrom = '2026-09-28';
    optional.periods[0].start = '2026-09-28';
    unscheduled.id = 'not-due';
    unscheduled.versions[0].weekdays = [2];
    data.habits.push(optional, unscheduled);
    updateCompletion(data, 'read', '2026-09-28', true, new Date('2026-09-28T12:00:00'));
    const summary = summarize(agenda(data, '2026-09-28'));
    expect(summary).toMatchObject({
      required: 1,
      requiredDone: 1,
      optional: 1,
      optionalDone: 0,
      status: 'complete',
    });
    expect(render(data, '2026-09-28', language)).toContain(message[language]);
  });
  test(`unfinished archive exemptions are neutral; retained credited archival remains eligible ${language}`, () => {
    const pending = facts();
    const now = new Date('2026-09-28T12:00:00');
    archiveHabit(pending, 'read', now);
    expect(summarize(agenda(pending, '2026-09-28')).status).toBe('neutral');
    expect(render(pending, '2026-09-28', language)).not.toContain(message[language]);
    const credited = facts();
    updateCompletion(credited, 'read', '2026-09-28', true, now);
    archiveHabit(credited, 'read', now);
    expect(render(credited, '2026-09-28', language)).toContain(message[language]);
    updateCompletion(credited, 'read', '2026-09-28', false, now);
    expect(render(credited, '2026-09-28', language)).not.toContain(message[language]);
  });
  test(`conditional pillar participation cannot excuse an unfinished daily requirement ${language}`, () => {
    const data = facts();
    const other = structuredClone(data.habits[0]);
    const now = new Date('2026-09-28T12:00:00');
    other.id = 'other';
    data.habits.push(other);
    editHabit(data, 'read', { pillarId: 'body', goal: 'Read 10 pages', weekdays: [1, 3, 5] }, now);
    updateCompletion(data, 'other', '2026-09-28', true, now);
    expect(
      summarize(
        agenda(data, '2026-09-28').filter((item) => item.pillarId === 'mind'),
        'pillar',
      ).status,
    ).toBe('complete');
    expect(summarize(agenda(data, '2026-09-28')).status).toBe('pending');
    expect(render(data, '2026-09-28', language)).not.toContain(message[language]);
    updateCompletion(data, 'read', '2026-09-28', true, now);
    expect(render(data, '2026-09-28', language)).toContain(message[language]);
  });
}
