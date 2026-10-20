import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import { HabitDetail } from '../../src/features/progress/HabitDetail';
import { PillarsManagement } from '../../src/features/pillars/PillarsManagement';
import { calculateProgress } from '../../src/domain/progress';
import { facts } from '../domain/fixtures';
import en from '../../src/i18n/en.json';
import pt from '../../src/i18n/pt.json';

const noop = () => {};

afterEach(() => vi.unstubAllGlobals());

test.each([en, pt])(
  'missing expansion entries collapse without hiding management or stable identity',
  (copy) => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    const data = facts();
    const before = structuredClone(data);
    const html = renderToStaticMarkup(
      createElement(PillarsManagement, {
        data,
        today: '2026-10-02',
        copy,
        busy: false,
        collapsed: { mind: false },
        toggle: noop,
        create: noop,
        edit: noop,
        review: noop,
        lifecycle: noop,
        openArchived: noop,
        newPillar: noop,
        managePillar: noop,
      }),
    );
    expect(html).toContain('data-history-id="group:mind" aria-expanded="true"');
    expect(html).toContain('data-history-id="group:body" aria-expanded="false"');
    expect(html).toContain('data-history-id="pillar:body"');
    expect(html).not.toContain('id="habits-body"');
    expect(data).toEqual(before);
  },
);

test.each([en, pt])(
  'dedicated review retains dated goals, source pillars, XP and pending context but no management commands',
  (copy) => {
    const data = facts();
    const habit = data.habits[0];
    habit.versions.push(
      { effectiveFrom: '2026-10-01', goal: 'Read and reflect', weekdays: [1, 3, 5] },
      {
        effectiveFrom: '2026-10-03',
        goal: 'Read a longer chapter',
        weekdays: [0, 1, 2, 3, 4, 5, 6],
      },
    );
    habit.memberships.push({ effectiveFrom: '2026-10-01', pillarId: 'body' });
    data.occurrences.push({
      habitId: habit.id,
      date: '2026-09-28',
      done: true,
      goal: 'Read 10 pages',
      pillarId: 'mind',
      activationId: 'initial',
      kind: 'required',
      pillarParticipation: 'required',
      completionProvenance: 'credited',
      assignmentLocked: true,
      recordedAt: '2026-09-28T12:00:00Z',
      timezone: 'UTC',
      offsetMinutes: 0,
    });
    const before = structuredClone(data);
    const html = renderToStaticMarkup(
      createElement(HabitDetail, {
        data,
        habit,
        today: '2026-10-02',
        progress: calculateProgress(data, '2026-10-02'),
        copy,
        busy: false,
        management: false,
        toggle: noop,
        edit: noop,
        archive: noop,
        reactivate: noop,
        edited: noop,
      }),
    );
    expect(html.match(/type="checkbox"/g) ?? []).toHaveLength(2);
    expect(html).toContain('dateTime="2026-10-02"');
    expect(html).toContain('dateTime="2026-09-30"');
    expect(html).toContain('dateTime="2026-09-28"');
    expect(html).toContain('Read and reflect');
    expect(html).toContain('Read 10 pages');
    expect(html).toContain('Mind · +10 XP');
    expect(html).toContain('class="review-supporting"');
    expect(html).toContain('class="history-changes"');
    expect(html).not.toContain('class="review-management"');
    expect(html).toContain('Read a longer chapter');
    expect(html).toContain(copy.everyDay);
    expect(html).toContain(copy.olderReadOnly);
    expect(html).not.toContain(`>${copy.editHabit}</button>`);
    expect(html).not.toContain(`>${copy.editPending}</button>`);
    expect(html).not.toContain(`>${copy.archiveHabit}</button>`);
    expect(html).not.toContain(`>${copy.reactivateHabit}</button>`);
    expect(html.indexOf('history-row correction-row')).toBeLessThan(
      html.indexOf('class="review-supporting"'),
    );
    expect(data).toEqual(before);
  },
);

test.each([en, pt])(
  'Progress-origin review keeps management secondary in a closed native disclosure',
  (copy) => {
    const data = facts();
    const habit = data.habits[0];
    const html = renderToStaticMarkup(
      createElement(HabitDetail, {
        data,
        habit,
        today: '2026-10-02',
        progress: calculateProgress(data, '2026-10-02'),
        copy,
        busy: false,
        toggle: noop,
        edit: noop,
        archive: noop,
        reactivate: noop,
        edited: noop,
      }),
    );
    expect(html).toContain('<details class="review-management">');
    expect(html).toContain(`>${copy.editHabit}</button>`);
    expect(html).toContain(`>${copy.archiveHabit}</button>`);
    expect(html.indexOf('class="review-management"')).toBeGreaterThan(
      html.indexOf('history-row correction-row'),
    );
  },
);
