import { expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RemovePillar } from '../../src/features/pillars/RemovePillar';
import en from '../../src/i18n/en.json';
import pt from '../../src/i18n/pt.json';
import {
  archiveHabit,
  editHabit,
  reactivateHabit,
  reconcileHabit,
} from '../../src/domain/lifecycle';
import { updateCompletion } from '../../src/domain/completion';
import { pillarHasProspectiveHabits } from '../../src/domain/pillars';
import { agenda } from '../../src/domain/agenda';
import { DEFAULT_PILLARS } from '../../src/domain/types';
import { facts } from './fixtures';

function intermediateMemberships() {
  const data = facts();
  data.pillars = DEFAULT_PILLARS.map((id) => ({ id, name: id, defaultKey: id }));
  data.habits[0].memberships.push(
    { effectiveFrom: '2026-10-02', pillarId: 'nutrition' },
    { effectiveFrom: '2026-10-05', pillarId: 'body' },
  );
  return data;
}

test('prospective occupancy includes intermediate membership before the final destination', () => {
  const data = intermediateMemberships();
  expect(agenda(data, '2026-10-02')[0]).toMatchObject({ pillarId: 'nutrition', kind: 'required' });
  expect(pillarHasProspectiveHabits(data, 'nutrition', '2026-10-01')).toBe(true);
  expect(pillarHasProspectiveHabits(data, 'body', '2026-10-01')).toBe(true);
});

test.each(['awaiting', 'materialized'] as const)(
  'intermediate destination in a future %s activation remains occupied',
  (state) => {
    const data = intermediateMemberships();
    archiveHabit(data, 'read', new Date(2026, 9, 1, 12));
    reactivateHabit(data, 'read', new Date(2026, 9, 2, 12));
    data.habits[0].memberships = [
      { effectiveFrom: '2026-09-27', pillarId: 'mind' },
      { effectiveFrom: '2026-10-05', pillarId: 'nutrition' },
      { effectiveFrom: '2026-10-07', pillarId: 'body' },
    ];
    if (state === 'materialized') reconcileHabit(data.habits[0], '2026-10-05');
    expect(pillarHasProspectiveHabits(data, 'nutrition', '2026-10-01')).toBe(true);
  },
);

test.each(['archived-gap', 'unscheduled-gap'] as const)(
  'an intermediate %s without prospective participation does not occupy a pillar',
  (scenario) => {
    const data = intermediateMemberships();
    if (scenario === 'archived-gap') {
      archiveHabit(data, 'read', new Date(2026, 9, 1, 12));
      reactivateHabit(data, 'read', new Date(2026, 9, 2, 12));
    } else data.habits[0].memberships[1].effectiveFrom = '2026-10-03';
    expect(agenda(data, '2026-10-02').some((i) => i.pillarId === 'nutrition')).toBe(false);
    expect(pillarHasProspectiveHabits(data, 'nutrition', '2026-10-01')).toBe(false);
  },
);

test('retained historical credit after cancellation does not occupy the cancelled destination', () => {
  const data = facts();
  data.pillars = DEFAULT_PILLARS.map((id) => ({ id, name: id, defaultKey: id }));
  const move = { pillarId: 'body', goal: 'Read 10 pages', weekdays: [1, 3, 5] };
  editHabit(data, 'read', move, new Date(2026, 9, 2, 12));
  editHabit(data, 'read', { ...move, pillarId: 'mind' }, new Date(2026, 9, 3, 12));
  updateCompletion(data, 'read', '2026-10-02', true, new Date(2026, 9, 3, 12));
  expect(pillarHasProspectiveHabits(data, 'body', '2026-10-03')).toBe(false);
  expect(pillarHasProspectiveHabits(data, 'mind', '2026-10-03')).toBe(true);
});

test.each([en, pt])(
  'removal view offers management, not confirmation, for intermediate occupancy in $language',
  (copy) => {
    const data = intermediateMemberships();
    const html = renderToStaticMarkup(
      createElement(RemovePillar, {
        data,
        pillar: data.pillars[2],
        today: '2026-10-01',
        copy,
        busy: false,
        cancel: () => {},
        manage: () => {},
        confirm: () => {},
      }),
    );
    expect(html).toContain(copy.pillarOccupied);
    expect(html).toContain(copy.manageHabits);
    expect(html).not.toContain(copy.confirmRemoval);
  },
);
