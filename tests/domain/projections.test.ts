import { expect, test } from 'vitest';
import * as agendaModule from '../../src/domain/agenda';
import * as historyModule from '../../src/domain/history';
import * as calendarModule from '../../src/features/progress/calendar';
import { validateDataset } from '../../src/data/backup';
import type { Dataset } from '../../src/domain/types';
import {
  countDefinitionReads,
  countOccurrenceVisits,
  projectionDates,
  projectionScenario,
  projectionScopes,
  projectionToday,
  projectionWindow,
  projectionWorkScenario,
} from '../helpers/projection-scenarios';

const workToday = '2026-10-10';
const workWindow = { start: '2026-09-27', end: workToday, historyEnd: workToday };

function occurrenceBudget(data: Dataset): number {
  // One indexing pass plus a modest allowance, independent of dates, habits and cards.
  return data.occurrences.length * 2 + data.habits.length * 2;
}

test.each(['agenda', 'habitHistory', 'editableOccurrences', 'calendarDays'] as const)(
  'bounded existing %s operation does not repeatedly scan saved occurrences',
  (operation) => {
    const data = projectionWorkScenario();
    const budget = occurrenceBudget(data);
    const visits = countOccurrenceVisits(data);
    if (operation === 'agenda') {
      expect(agendaModule.agenda(data, workToday)).toHaveLength(12);
    } else if (operation === 'habitHistory') {
      expect(historyModule.habitHistory(data, 'work-0', workToday)).toHaveLength(14);
    } else if (operation === 'editableOccurrences') {
      expect(historyModule.editableOccurrences(data, 'work-0', workToday)).toHaveLength(2);
    } else {
      expect(calendarModule.calendarDays(data, { kind: 'all' }, workWindow)).toHaveLength(14);
    }
    expect(visits(), `${operation} occurrence-array visits`).toBeLessThanOrEqual(budget);
  },
);

test.each(['habitHistory', 'editableOccurrences'] as const)(
  'focused history %s does not evaluate unrelated habit definitions',
  (operation) => {
    const data = projectionWorkScenario();
    const reads = countDefinitionReads(data.habits.slice(1));
    const result = historyModule[operation](data, 'work-0', workToday);
    expect(result.length).toBeGreaterThan(0);
    expect(reads()).toBe(0);
  },
);

test('an agenda projection shares its occurrence index across focused and full dated reads', () => {
  const data = projectionWorkScenario();
  const budget = occurrenceBudget(data);
  const visits = countOccurrenceVisits(data);
  const projection = agendaModule.createAgendaProjection(data);
  expect(projection.data).toBe(data);
  for (const date of projectionDates(workWindow.start, workWindow.end)) {
    expect(projection.agenda(date)).toHaveLength(12);
    for (const habit of data.habits) {
      expect(projection.habit(habit.id, date)?.habit.id).toBe(habit.id);
    }
  }
  expect(projection.habit('missing', workToday)).toBeUndefined();
  expect(visits()).toBeLessThanOrEqual(budget);
});

test('pillar history bounds occurrence work across all member histories', () => {
  const data = projectionWorkScenario();
  const budget = occurrenceBudget(data);
  const visits = countOccurrenceVisits(data);
  const days = historyModule.pillarHistory(data, 'mind', workToday);
  expect(days).toHaveLength(14);
  expect(days.every((day) => day.items.length === 6)).toBe(true);
  expect(visits()).toBeLessThanOrEqual(budget);
});

test('multi-card calendar bounds occurrence work independently of card count', () => {
  const data = projectionWorkScenario();
  const budget = occurrenceBudget(data);
  const scopes = projectionScopes(data);
  const visits = countOccurrenceVisits(data);
  const cards = calendarModule.calendarCards(data, scopes, workWindow);
  expect(cards).toHaveLength(scopes.length);
  expect(cards.every((days) => days.length === 14)).toBe(true);
  expect(visits()).toBeLessThanOrEqual(budget);
});

test('multi-card calendar resolves same-date definitions once rather than once per card', () => {
  const single = projectionWorkScenario();
  const singleReads = countDefinitionReads(single.habits);
  calendarModule.calendarDays(single, { kind: 'all' }, workWindow);
  const singleWork = singleReads();
  expect(singleWork).toBeGreaterThan(0);

  const multi = projectionWorkScenario();
  const multiReads = countDefinitionReads(multi.habits);
  const scopes = [
    { kind: 'all' as const },
    { kind: 'pillar' as const, id: 'mind' },
    { kind: 'pillar' as const, id: 'body' },
    { kind: 'habit' as const, id: 'work-0' },
    { kind: 'habit' as const, id: 'work-1' },
    { kind: 'all' as const },
  ];
  expect(calendarModule.calendarCards(multi, scopes, workWindow)).toHaveLength(scopes.length);
  // Participation checks may add reads, but six cards must not perform six projections.
  expect(multiReads()).toBeLessThanOrEqual(singleWork * 2);
});

test('focused projection matches complete agenda while keeping stable required-before-optional order', () => {
  const data = projectionScenario();
  const before = structuredClone(data);
  const projection = agendaModule.createAgendaProjection(data);
  expect(projection.agenda(projectionToday).map((item) => item.habit.id)).toEqual([
    'read',
    'write',
    'walk',
    'newcomer',
  ]);
  for (const date of projectionDates(projectionWindow.start, projectionWindow.end)) {
    const items = agendaModule.agenda(data, date);
    expect(projection.agenda(date)).toEqual(items);
    for (const habit of data.habits) {
      expect(projection.habit(habit.id, date)).toEqual(
        items.find((item) => item.habit.id === habit.id),
      );
    }
  }
  expect(data).toEqual(before);
});

test('mixed histories preserve correction eligibility, exemption precedence and future exclusion', () => {
  const data = projectionScenario();
  const read = historyModule.habitHistory(data, 'read', projectionToday);
  expect(
    read.slice(0, 3).map(({ date, status, editable }) => ({ date, status, editable })),
  ).toEqual([
    { date: '2026-10-05', status: 'pending', editable: true },
    { date: '2026-10-02', status: 'exempt', editable: true },
    { date: '2026-09-30', status: 'missed', editable: false },
  ]);
  expect(read[1]).toMatchObject({
    goal: 'read original goal',
    pillarId: 'mind',
    activationId: 'read-initial',
    completionProvenance: 'credited',
    done: false,
    exempt: true,
  });
  expect(read[0]).toMatchObject({ pillarId: 'body', activationId: 'read-resumed' });
  expect(read.some((item) => item.date > projectionToday)).toBe(false);
  expect(historyModule.habitHistory(data, 'newcomer', projectionToday)[0]).toMatchObject({
    status: 'optional-uncompleted',
    editable: true,
  });
  expect(historyModule.habitHistory(data, 'walk', projectionToday).slice(0, 2)).toMatchObject([
    { date: '2026-10-05', status: 'pending', activationId: 'walk-reserved', editable: true },
    { date: '2026-10-01', status: 'completed', exempt: true, editable: true },
  ]);
  const retired = historyModule.habitHistory(data, 'retired', projectionToday);
  expect(retired.map(({ date, status, editable }) => ({ date, status, editable }))).toEqual([
    { date: '2026-09-30', status: 'exempt', editable: false },
    { date: '2026-09-28', status: 'missed', editable: true },
    { date: '2026-09-27', status: 'optional-uncompleted', editable: false },
  ]);
  expect(historyModule.habitHistory(data, 'missing', projectionToday)).toEqual([]);
  expect(historyModule.editableOccurrences(data, 'missing', projectionToday)).toEqual([]);
});

test('pillar history preserves dated membership, newest-first dates and original habit order', () => {
  const data = projectionScenario();
  const before = structuredClone(data);
  const mind = historyModule.pillarHistory(data, 'mind', projectionToday);
  const body = historyModule.pillarHistory(data, 'body', projectionToday);
  expect(mind.map((day) => day.date)).toEqual([
    '2026-10-05',
    '2026-10-02',
    '2026-09-30',
    '2026-09-28',
    '2026-09-27',
  ]);
  expect(mind[0].items.map((item) => item.habit.id)).toEqual(['newcomer', 'write']);
  expect(mind[1].items.map((item) => item.habit.id)).toEqual(['read', 'write']);
  expect(body[0].items.map((item) => item.habit.id)).toEqual(['read', 'walk']);
  for (const pillar of data.pillars) {
    const rows = data.habits
      .flatMap((habit) => historyModule.habitHistory(data, habit.id, projectionToday))
      .filter((item) => item.pillarId === pillar.id);
    const expected = [...new Set(rows.map((item) => item.date))]
      .sort()
      .reverse()
      .map((date) => ({ date, items: rows.filter((item) => item.date === date) }));
    expect(historyModule.pillarHistory(data, pillar.id, projectionToday)).toEqual(expected);
  }
  expect(historyModule.pillarHistory(data, 'missing', projectionToday)).toEqual([]);
  expect(data).toEqual(before);
});

test('mixed calendar cards retain complete output, chronological dates and scope-specific gray gaps', () => {
  const data = projectionScenario();
  const before = structuredClone(data);
  const scopes = projectionScopes(data);
  const cards = calendarModule.calendarCards(data, scopes, projectionWindow);
  expect(cards).toEqual(
    scopes.map((scope) => calendarModule.calendarDays(data, scope, projectionWindow)),
  );
  expect(cards[0].map((day) => day.date)).toEqual(
    projectionDates(projectionWindow.start, projectionWindow.historyEnd),
  );
  const findDay = (scope: calendarModule.CalendarScope, date: string) =>
    calendarModule.calendarCards(data, [scope], { start: date, end: date, historyEnd: date })[0][0];
  expect(findDay({ kind: 'habit', id: 'read' }, '2026-10-03')).toMatchObject({
    state: 'unscheduled',
    applicable: true,
    items: [],
  });
  expect(findDay({ kind: 'pillar', id: 'nutrition' }, '2026-09-30')).toMatchObject({
    state: 'unscheduled',
    applicable: true,
  });
  expect(findDay({ kind: 'pillar', id: 'nutrition' }, '2026-10-01')).toMatchObject({
    state: 'unscheduled',
    applicable: false,
    items: [],
  });
  expect(findDay({ kind: 'habit', id: 'walk' }, '2026-10-01')).toMatchObject({
    state: 'completed',
    applicable: true,
  });
  expect(findDay({ kind: 'habit', id: 'stretch' }, '2026-09-30')).toMatchObject({
    state: 'unscheduled',
    applicable: true,
    items: [],
  });
  expect(agendaModule.summarize(agendaModule.agenda(data, projectionToday)).status).toBe('pending');
  expect(agendaModule.summarize(agendaModule.agenda(data, '2026-09-26')).status).toBe('neutral');
  expect(calendarModule.calendarCards(data, [], projectionWindow)).toEqual([]);
  expect(
    calendarModule.calendarCards(data, scopes, { ...projectionWindow, historyEnd: '2026-09-25' }),
  ).toEqual(scopes.map(() => []));
  expect(data).toEqual(before);
});

test('new public operations observe in-place completion and definition edits without revision changes', () => {
  const data = projectionScenario();
  const revision = data.revision;
  const scopes = [{ kind: 'habit' as const, id: 'write' }];
  const window = { start: '2026-10-02', end: '2026-10-02', historyEnd: '2026-10-02' };
  expect(
    agendaModule.agenda(data, window.start).find((item) => item.habit.id === 'write')?.done,
  ).toBe(true);
  expect(historyModule.habitHistory(data, 'write', projectionToday)[1].status).toBe('completed');
  expect(calendarModule.calendarCards(data, scopes, window)[0][0].state).toBe('completed');
  const saved = data.occurrences.find(
    (item) => item.habitId === 'write' && item.date === window.start,
  )!;
  saved.done = false;
  const stretch = data.habits.find((habit) => habit.id === 'stretch')!;
  stretch.versions[0].goal = 'stretch edited in-place';
  stretch.versions[0].weekdays.push(1);
  validateDataset(data);
  expect(data.revision).toBe(revision);
  expect(
    agendaModule.agenda(data, window.start).find((item) => item.habit.id === 'write')?.done,
  ).toBe(false);
  expect(agendaModule.createAgendaProjection(data).habit('stretch', projectionToday)?.goal).toBe(
    'stretch edited in-place',
  );
  expect(historyModule.habitHistory(data, 'write', projectionToday)[1].status).toBe('missed');
  expect(historyModule.editableOccurrences(data, 'write', projectionToday)[1].done).toBe(false);
  expect(
    historyModule
      .pillarHistory(data, 'mind', projectionToday)[1]
      .items.find((item) => item.habit.id === 'write')?.done,
  ).toBe(false);
  expect(calendarModule.calendarCards(data, scopes, window)[0][0].state).toBe('incomplete');
  expect(calendarModule.calendarDays(data, scopes[0], window)[0].state).toBe('incomplete');
});

test('replacement datasets at the same revision never reuse another dataset projection', () => {
  const original = projectionScenario();
  const replacement = structuredClone(original);
  replacement.habits.find((habit) => habit.id === 'stretch')!.versions[0].goal = 'replacement goal';
  replacement.habits.find((habit) => habit.id === 'stretch')!.memberships[0].pillarId = 'mind';
  validateDataset(replacement);
  expect(replacement.revision).toBe(original.revision);
  for (const data of [original, replacement, original]) {
    const expectedGoal = data === replacement ? 'replacement goal' : 'stretch original goal';
    const expectedPillar = data === replacement ? 'mind' : 'body';
    expect(agendaModule.createAgendaProjection(data).habit('stretch', '2026-10-01')).toMatchObject({
      goal: expectedGoal,
      pillarId: expectedPillar,
    });
    expect(historyModule.habitHistory(data, 'stretch', projectionToday)[0]).toMatchObject({
      goal: expectedGoal,
      pillarId: expectedPillar,
    });
    expect(
      historyModule
        .pillarHistory(data, expectedPillar, projectionToday)
        .flatMap((day) => day.items)
        .some((item) => item.habit.id === 'stretch'),
    ).toBe(true);
    expect(
      calendarModule.calendarCards(data, [{ kind: 'habit', id: 'stretch' }], {
        start: '2026-10-01',
        end: '2026-10-01',
        historyEnd: '2026-10-01',
      })[0][0].items[0],
    ).toMatchObject({ goal: expectedGoal, pillarId: expectedPillar });
  }
});

test('local-day changes refresh pending statuses, correction windows and closed calendar dates', () => {
  const data = projectionScenario();
  const monday = historyModule.habitHistory(data, 'write', '2026-10-05');
  const wednesday = historyModule.habitHistory(data, 'write', '2026-10-07');
  expect(monday[0]).toMatchObject({ date: '2026-10-05', status: 'pending', editable: true });
  expect(wednesday.slice(0, 3)).toMatchObject([
    { date: '2026-10-07', status: 'pending', editable: true },
    { date: '2026-10-05', status: 'missed', editable: true },
    { date: '2026-10-02', status: 'completed', editable: false },
  ]);
  for (const today of ['2026-10-05', '2026-10-07', '2026-10-05']) {
    const window = calendarModule.periodWindow(today, '7d', 0);
    const cards = calendarModule.calendarCards(data, [{ kind: 'all' }], window);
    expect(cards[0].at(-1)?.date).toBe(window.historyEnd);
    expect(cards[0].some((day) => day.date >= today)).toBe(false);
    expect(historyModule.pillarHistory(data, 'mind', today)[0].date).toBe(today);
  }
});
