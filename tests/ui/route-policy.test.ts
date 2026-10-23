import { describe, expect, test } from 'vitest';
import {
  backDestination,
  backLabel,
  dedicatedReview,
  habitRoutePresentation,
  primaryDestination,
  routeHeader,
  routeHeading,
  type RouteReturns,
} from '../../src/app/routePolicy';
import type { Route } from '../../src/app/routes';
import type { PrimaryDestination } from '../../src/app/BottomNavigation';
import en from '../../src/i18n/en.json';
import pt from '../../src/i18n/pt.json';
import { facts } from '../domain/fixtures';

const day: Route = {
  screen: 'progressDay',
  scope: { kind: 'habit', id: 'fictional-habit' },
  date: '2026-10-02',
  window: { start: '2026-10-01', end: '2026-10-07', historyEnd: '2026-10-07' },
};
const history: Route = { screen: 'pillarHistory', pillarId: 'mind' };
const detail: Route = { screen: 'habitDetail', habitId: 'fictional-habit' };
const editor: Route = { screen: 'editHabit', habitId: 'fictional-habit' };
const returns: RouteReturns = {
  detail: day,
  pillarHistory: { screen: 'progress' },
  settings: detail,
  management: { screen: 'today' },
};

for (const [language, copy] of [
  ['en', en],
  ['pt', pt],
] as const) {
  describe(language, () => {
    const headings: [PrimaryDestination, string, string | undefined][] =
      language === 'en'
        ? [
            ['today', 'Today', undefined],
            ['pillars', 'Pillars', 'Organize your pillars and habits.'],
            ['journey', 'Your Journey', 'One step closer, every day.'],
            ['progress', 'Progress', 'Consistency, one day at a time.'],
            ['settings', 'Settings', 'Preferences and your private data.'],
          ]
        : [
            ['today', 'Hoje', undefined],
            ['pillars', 'Pilares', 'Organize seus pilares e hábitos.'],
            ['journey', 'Sua jornada', 'Um passo mais perto, a cada dia.'],
            ['progress', 'Progresso', 'Consistência, um dia de cada vez.'],
            ['settings', 'Configurações', 'Preferências e seus dados privados.'],
          ];
    const heading = (route: Route, options = {}) =>
      routeHeading(route, copy, {
        language,
        pillar: undefined,
        habitAvailable: true,
        readOnlyEditor: false,
        ...options,
      });

    test.each(headings)('%s has its primary heading and introduction', (screen, title, intro) => {
      const route: Route = { screen };
      expect(heading(route)).toEqual(intro ? { title, intro } : { title });
      expect(primaryDestination(route, returns)).toBe(screen);
      expect(routeHeader(route)).toMatchObject({ primaryPage: true, quietBack: false });
    });

    test('historical date headings and nested Back labels remain localized', () => {
      expect(heading(day)).toEqual({
        title: language === 'en' ? 'Friday, October 2, 2026' : 'sexta-feira, 2 de outubro de 2026',
      });
      const targets: [Route, string][] = [
        [{ screen: 'archived' }, language === 'en' ? 'Archived' : 'Arquivados'],
        [history, language === 'en' ? 'View pillar streaks' : 'Ver sequências do pilar'],
        [detail, language === 'en' ? 'Review completions' : 'Revisar conclusões'],
        [
          { screen: 'habitAction', habitId: 'fictional-habit', action: 'archive' },
          language === 'en' ? 'Manage habit' : 'Gerenciar hábito',
        ],
        [day, language === 'en' ? 'History' : 'Histórico'],
        [{ screen: 'progress' }, language === 'en' ? 'Progress' : 'Progresso'],
        [{ screen: 'today' }, language === 'en' ? 'Today' : 'Hoje'],
        [{ screen: 'journey' }, language === 'en' ? 'Pillars' : 'Pilares'],
        [{ screen: 'settings' }, language === 'en' ? 'Pillars' : 'Pilares'],
      ];
      for (const [target, label] of targets) expect(backLabel(target, copy)).toBe(label);
    });

    test('pillar creation, rename and unavailable-identity fallbacks preserve existing copy', () => {
      expect(heading({ screen: 'pillar' }).title).toBe(
        language === 'en' ? 'New pillar' : 'Novo pilar',
      );
      expect(heading({ screen: 'pillar', pillarId: 'missing' }).title).toBe(copy.newPillar);
      const pillar = { id: 'custom', name: '  Fictional $& pillar  ' };
      expect(heading({ screen: 'pillar', pillarId: pillar.id }, { pillar }).title).toBe(
        language === 'en' ? 'Rename pillar' : 'Renomear pilar',
      );
      expect(heading(history, { pillar }).title).toBe(pillar.name);
      expect(
        heading(history, { pillar: { id: 'mind', name: 'Mind', defaultKey: 'mind' } }).title,
      ).toBe(language === 'en' ? 'Mind' : 'Mente');
      expect(heading(history).title).toBe('');
      expect(heading(detail, { habitAvailable: false }).title).toBe('');
      expect(heading(editor, { habitAvailable: false }).title).toBe(copy.editHabit);
    });

    test('editable and read-only editors keep their distinct titles', () => {
      expect(heading(editor).title).toBe(language === 'en' ? 'Edit habit' : 'Editar hábito');
      expect(heading(editor, { readOnlyEditor: true }).title).toBe(copy.reviewCompletions);
      expect(heading(detail).title).toBe(copy.reviewCompletions);
      expect(heading({ screen: 'habit', pillarId: 'mind' }).title).toBe(copy.addHabit);
      expect(heading({ screen: 'removePillar', pillarId: 'mind' }).title).toBe(
        copy.removePillarQuestion,
      );
    });
  });
}

test('nested details return one level at a time without losing day scope or period', () => {
  expect(backDestination(detail, returns, false)).toBe(day);
  expect(primaryDestination(detail, returns)).toBe('progress');
  expect(backDestination(day, returns, false)).toEqual({ screen: 'progress' });
  const viaHistory = { ...returns, detail: history };
  expect(backDestination(detail, viaHistory, false)).toBe(history);
  expect(primaryDestination(detail, viaHistory)).toBe('progress');
  expect(backDestination(history, returns, false)).toBe(returns.pillarHistory);
  expect(primaryDestination(detail, { ...viaHistory, pillarHistory: { screen: 'pillars' } })).toBe(
    'pillars',
  );
});

test('direct editing returns to management while detail-entered editing returns to detail', () => {
  const origins: RouteReturns = { ...returns, detail: { screen: 'archived' } };
  expect(backDestination(editor, origins, true)).toBe(origins.detail);
  expect(backDestination(editor, origins, false)).toEqual(detail);
  expect(primaryDestination(editor, origins)).toBe('pillars');
  expect(backDestination({ screen: 'archived' }, origins, false)).toEqual({ screen: 'pillars' });
});

test('management captures Today and Settings retains its exact contextual return', () => {
  for (const route of [
    { screen: 'habit', pillarId: 'mind' },
    { screen: 'pillar' },
    { screen: 'removePillar', pillarId: 'mind' },
    { screen: 'habitAction', habitId: 'fictional-habit', action: 'reactivate' },
  ] satisfies Route[]) {
    expect(backDestination(route, returns, false)).toBe(returns.management);
    expect(primaryDestination(route, returns)).toBe('today');
  }
  expect(backDestination({ screen: 'settings' }, returns, false)).toBe(detail);
  expect(primaryDestination({ screen: 'settings' }, returns)).toBe('settings');
  expect(primaryDestination(detail, { ...returns, detail: { screen: 'journey' } })).toBe('journey');
  expect(primaryDestination(detail, { ...returns, detail: { screen: 'settings' } })).toBe(
    'pillars',
  );
  // A return that is itself detail is not followed recursively to its day origin.
  expect(
    primaryDestination({ screen: 'habit', pillarId: 'mind' }, { ...returns, management: detail }),
  ).toBe('pillars');
});

test('explicit review overrides inferred management context, including explicit false', () => {
  for (const origin of [{ screen: 'pillars' }, { screen: 'archived' }] satisfies Route[]) {
    expect(dedicatedReview(undefined, origin, returns.pillarHistory)).toBe(true);
    expect(dedicatedReview(false, origin, returns.pillarHistory)).toBe(false);
  }
  expect(dedicatedReview(undefined, history, { screen: 'pillars' })).toBe(true);
  expect(dedicatedReview(undefined, history, { screen: 'progress' })).toBe(false);
  expect(dedicatedReview(true, day, { screen: 'progress' })).toBe(true);
  expect(dedicatedReview(undefined, day, { screen: 'pillars' })).toBe(false);
});

test('before-creation editors present read-only detail without authorizing any write', () => {
  const habit = facts().habits[0];
  const before = structuredClone(habit);
  expect(habitRoutePresentation(editor, habit, '1900-01-01')).toEqual({
    readOnlyEditor: true,
    detailReadOnly: true,
  });
  expect(habitRoutePresentation(editor, habit, habit.createdOn)).toEqual({
    readOnlyEditor: false,
    detailReadOnly: true,
  });
  expect(habitRoutePresentation(detail, habit, '1900-01-01')).toEqual({
    readOnlyEditor: false,
    detailReadOnly: false,
  });
  expect(habitRoutePresentation(editor, undefined, '1900-01-01')).toEqual({
    readOnlyEditor: false,
    detailReadOnly: true,
  });
  expect(habit).toEqual(before);
});

test('subordinate headers retain quiet Back while day details retain ordinary Back', () => {
  for (const route of [
    detail,
    editor,
    history,
    { screen: 'archived' },
    { screen: 'habit', pillarId: 'mind' },
    { screen: 'pillar' },
    { screen: 'removePillar', pillarId: 'mind' },
    { screen: 'habitAction', habitId: 'fictional-habit', action: 'archive' },
  ] satisfies Route[]) {
    expect(routeHeader(route)).toEqual({
      primaryPage: false,
      quietBack: true,
      showBrand: false,
      className: 'pillars-management-page',
    });
  }
  expect(routeHeader(day)).toEqual({
    primaryPage: false,
    quietBack: false,
    showBrand: false,
    className: 'progress-day-page',
  });
  expect(routeHeader({ screen: 'settings' })).toEqual({
    primaryPage: true,
    quietBack: false,
    showBrand: false,
    className: 'settings-page',
  });
});
