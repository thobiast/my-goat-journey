import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProgressPage, initialProgressView } from '../../src/features/progress/ProgressPage';
import { calculateProgress } from '../../src/domain/progress';
import { facts } from '../domain/fixtures';
import en from '../../src/i18n/en.json';
import pt from '../../src/i18n/pt.json';
import { ProgressDayPage } from '../../src/features/progress/ProgressDayPage';
import { archiveHabit, editHabit } from '../../src/domain/lifecycle';
import { updateCompletion } from '../../src/domain/completion';
import { ConsistencyCard } from '../../src/features/progress/ConsistencyCard';
import { periodWindow } from '../../src/features/progress/calendar';

function render(interval = initialProgressView.interval) {
  const data = facts();
  return renderToStaticMarkup(
    createElement(ProgressPage, {
      data,
      today: '2026-10-03',
      progress: calculateProgress(data, '2026-10-03'),
      copy: en,
      busy: false,
      value: { ...initialProgressView, interval },
      change: () => {},
      openHabit: () => {},
      openPillar: () => {},
      add: () => {},
    }),
  );
}

describe('Consistency Cards presentation', () => {
  it('keeps weekday and number on every seven-day cell, including inactive pre-tracking context', () => {
    const html = renderToStaticMarkup(
      createElement(ConsistencyCard, {
        data: facts(),
        scope: { kind: 'habit', id: 'read' },
        window: periodWindow('2026-10-03', '7d', 0),
        interval: '7d',
        copy: en,
        title: 'Test',
        metric: { current: 0, best: 0 },
        busy: false,
        openDay: () => {},
      }),
    );
    expect([...html.matchAll(/<small>/g)]).toHaveLength(7);
    expect([...html.matchAll(/class="day-number"/g)]).toHaveLength(7);
  });
  it('removes manual date entry and repeated instructions while keeping the concise scope in both languages', () => {
    for (const [copy, scopeText] of [
      [en, 'History through yesterday. Streaks include today.'],
      [pt, 'Histórico até ontem. As sequências incluem hoje.'],
    ] as const) {
      const data = facts();
      const html = renderToStaticMarkup(
        createElement(ProgressPage, {
          data,
          today: '2026-10-03',
          progress: calculateProgress(data, '2026-10-03'),
          copy,
          busy: false,
          value: initialProgressView,
          change: () => {},
          openHabit: () => {},
          add: () => {},
        }),
      );
      expect(html).not.toContain('type="date"');
      expect(html).not.toContain('calendar-access');
      expect(html).not.toContain('Calendar date');
      expect(html).not.toContain('Data do calendário');
      expect(html).not.toContain('history-end-note');
      expect(html).not.toContain(copy.openHabitHelp);
      expect(html).toContain(scopeText);
    }
  });
  it('labels and renders inactive pre-creation context without affecting the period count', () => {
    const html = render('3m');
    expect(html).toContain('data-context-date="2026-08-31"');
    expect(html).toContain('data-context="before-tracking"');
    expect(html).toContain('Before tracking');
    expect(html).not.toContain('Tracking since');
    expect(html).not.toContain('class="tracking-since"');
    expect(html).not.toContain('data-calendar-date="2026-08-31"');
    expect(html).toContain('0/3 days completed');
  });
  it('renders separate numbered month blocks with horizontal weekdays for the three-month interval', () => {
    const html = render('3m');
    expect([...html.matchAll(/data-month="([^"]+)"/g)].map((match) => match[1])).toEqual([
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(html).toContain('August 2026</h3>');
    expect(html).toContain('class="month-weekdays"');
    expect(html).toContain('class="day-number"');
  });
  it('explains archived and pre-creation neutral periods without missed-day or correction controls', () => {
    const data = facts();
    archiveHabit(data, 'read', new Date(2026, 9, 2, 12));
    for (const [date, explanation] of [
      ['2026-10-03', en.archivedDay],
      ['2026-09-26', en.beforeCreationDay],
    ]) {
      const html = renderToStaticMarkup(
        createElement(ProgressDayPage, {
          data,
          today: '2026-10-06',
          scope: { kind: 'habit', id: 'read' },
          date,
          window: periodWindow('2026-10-06', '3m', 0),
          copy: en,
          busy: false,
          openHabit: () => {},
          changeDay: () => {},
          toggle: () => {},
        }),
      );
      expect(html).toContain(explanation);
      expect(html).toContain(en.progressUnscheduled);
      expect(html).not.toContain('type="checkbox"');
      expect(html).not.toContain('>Not completed<');
    }
  });
  it('uses historical snapshot goals and pillar groups after later moves and definition changes', () => {
    const data = facts();
    const now = new Date(2026, 9, 2, 12);
    updateCompletion(data, 'read', '2026-10-02', true, now);
    editHabit(
      data,
      'read',
      { pillarId: 'body', goal: 'A new prospective goal', weekdays: [1, 3, 5] },
      now,
    );
    const before = structuredClone(data);
    const html = renderToStaticMarkup(
      createElement(ProgressDayPage, {
        data,
        today: '2026-10-06',
        scope: { kind: 'all' },
        date: '2026-10-02',
        window: periodWindow('2026-10-06', '3m', 0),
        copy: en,
        busy: false,
        openHabit: () => {},
        changeDay: () => {},
        toggle: () => {},
      }),
    );
    expect(html).toContain('<h3>Mind</h3>');
    expect(html).toContain('Read 10 pages');
    expect(html).not.toContain('A new prospective goal');
    expect(html).not.toContain('<h3>Body</h3>');
    expect(html).not.toContain('type="checkbox"');
    expect(data).toEqual(before);
  });
  it('uses concise singular metric units for one completion or day in both languages', () => {
    for (const copy of [en, pt])
      for (const kind of ['habit', 'all'] as const) {
        const html = renderToStaticMarkup(
          createElement(ConsistencyCard, {
            data: facts(),
            scope: kind === 'habit' ? { kind, id: 'read' } : { kind },
            window: periodWindow('2026-10-03', '7d', 0),
            interval: '7d',
            copy,
            title: 'Test',
            metric: { current: 1, best: 1 },
            busy: false,
            openDay: () => {},
          }),
        );
        const expected =
          copy === en
            ? kind === 'habit'
              ? 'completion'
              : 'day'
            : kind === 'habit'
              ? 'conclusão'
              : 'dia';
        expect(html).toContain(`<span>${expected}</span>`);
      }
  });
  it('opens a dated neutral habit detail with localized explanation and no partial state', () => {
    for (const copy of [en, pt]) {
      const data = facts();
      data.settings.language = copy === pt ? 'pt' : 'en';
      const html = renderToStaticMarkup(
        createElement(ProgressDayPage, {
          data,
          today: '2026-10-03',
          scope: { kind: 'habit', id: 'read' },
          date: '2026-10-01',
          window: periodWindow('2026-10-03', '7d', 0),
          copy,
          busy: false,
          openHabit: () => {},
          changeDay: () => {},
          toggle: () => {},
        }),
      );
      expect(html).toContain(copy.habitNotScheduled);
      expect(html).toContain(copy.progressUnscheduled);
      expect(html).toMatch(/dateTime="2026-10-01"/i);
      expect(html).not.toContain(copy.progressPartial);
      expect(html).toContain(copy.manageHabit);
    }
  });
  it('shares five interval choices with the latest seven-day window selected', () => {
    const html = render();
    expect(html).toContain('>7d</button>');
    expect(html).toMatch(/aria-pressed="true"[^>]*>7d<\/button>/);
    for (const interval of ['1m', '3m', '12m', '24m'])
      expect(html).toContain(`>${interval}</button>`);
  });
  it('offers daily buttons through yesterday and replaces repeated history actions with full-goal management', () => {
    const html = render();
    expect(html).toContain('class="consistency-card');
    expect(html).toContain('data-calendar-date="2026-10-02"');
    expect(html).not.toContain('data-calendar-date="2026-10-03"');
    expect(html).not.toContain('>View history</button>');
    expect(html).toContain('>Read 10 pages</button>');
    expect(html).toContain('days completed');
  });
});
