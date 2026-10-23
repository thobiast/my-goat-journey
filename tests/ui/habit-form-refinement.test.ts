import { readFileSync, existsSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HabitEditor } from '../../src/features/habits/HabitEditor';
import { EditHabit } from '../../src/features/habits/EditHabit';
import { deviceClock } from '../../src/domain/calendar';
import { displayDate } from '../../src/presentation/civilDate';
import { facts } from '../domain/fixtures';
import { describe, expect, it, vi } from 'vitest';
import { GoalFields } from '../../src/features/habits/GoalFields';
import {
  allWeekdaysSelected,
  scheduleLabel,
  sameGoalInput,
  validGoal,
} from '../../src/features/habits/formPolicy';
import en from '../../src/i18n/en.json';
import pt from '../../src/i18n/pt.json';

describe('Editing current and pending definitions', () => {
  for (const copy of [en, pt])
    it(`shows compact scheduled notes with only affected saved values (${copy.everyDay})`, () => {
      const clock = vi.spyOn(deviceClock, 'now').mockReturnValue(new Date(2026, 8, 30, 12));
      try {
        const data = facts();
        data.settings.language = copy === en ? 'en' : 'pt';
        data.habits[0].versions[0].weekdays = [0, 1, 2, 3, 4, 5, 6];
        data.habits[0].versions.push({
          effectiveFrom: '2026-10-01',
          goal: 'Pending goal',
          weekdays: [1, 5],
        });
        const before = structuredClone(data);
        const markup = renderToStaticMarkup(
          createElement(EditHabit, {
            data,
            habit: data.habits[0],
            today: '2026-09-30',
            copy,
            busy: false,
            save: () => {},
            edited: () => {},
            cancel: () => {},
            dirty: () => {},
          }),
        );
        expect(markup).not.toContain(`${copy.today}:`);
        expect(markup).not.toContain(`Mind · ${copy.everyDay}`);
        expect(markup).toContain(
          copy.habitEditScheduled.replace(
            '{date}',
            displayDate('2026-10-01', data.settings.language),
          ),
        );
        expect(markup).toContain(
          copy.habitEditUntil.replace('{values}', `Read 10 pages · ${copy.everyDay}`),
        );
        expect(markup).toContain('Pending goal</textarea>');
        expect(markup).not.toContain(copy.effectiveHelp.split('{date}')[0]);
        expect(markup).toContain('class="habit-form"');
        expect(data).toEqual(before);
      } finally {
        clock.mockRestore();
      }
    });
  it('does not show a goal/schedule effective-date explanation for an unchanged definition or move-only pending edit', () => {
    const clock = vi.spyOn(deviceClock, 'now').mockReturnValue(new Date(2026, 8, 30, 12));
    try {
      const data = facts();

      const render = () =>
        renderToStaticMarkup(
          createElement(EditHabit, {
            data,
            habit: data.habits[0],
            today: '2026-09-30',
            copy: en,
            busy: false,
            save: () => {},
            edited: () => {},
            cancel: () => {},
            dirty: () => {},
          }),
        );

      expect(render()).not.toContain('Today keeps its current goal.');
      expect(render()).not.toContain('Today’s goal and schedule stay unchanged.');
      data.habits[0].memberships.push({ effectiveFrom: '2026-10-02', pillarId: 'body' });
      data.habits[0].pendingMove = { requestedOn: '2026-09-30', pillarId: 'body' };
      const markup = render();
      expect(markup).not.toContain('Goal and weekdays apply from');
      expect(markup).not.toContain('Today’s goal and schedule stay unchanged.');
      expect(markup).toContain(
        `Complete this habit today to count in Body. Otherwise, it moves on ${displayDate('2026-10-02', 'en')}.`,
      );
    } finally {
      clock.mockRestore();
    }
  });
});
describe('Habit editor field hierarchy', () => {
  for (const [copy, label] of [
    [en, 'Habit'],
    [pt, 'Hábito'],
  ] as const)
    it(`puts the ${label} field before pillar without changing creation`, () => {
      const clock = vi.spyOn(deviceClock, 'now').mockReturnValue(new Date(2026, 8, 30, 12));
      try {
        const data = facts();
        const markup = renderToStaticMarkup(
          createElement(EditHabit, {
            data,
            habit: data.habits[0],
            today: '2026-09-30',
            copy,
            busy: false,
            save: () => {},
            edited: () => {},
            cancel: () => {},
            dirty: () => {},
          }),
        );
        expect(markup).toContain(`<label for="goal">${label}</label>`);
        expect(markup.indexOf('for="goal"')).toBeLessThan(markup.indexOf('for="pillar"'));
        const creation = renderToStaticMarkup(
          createElement(HabitEditor, {
            copy,
            pillars: data.pillars,
            pillarId: 'mind',
            busy: false,
            save: () => {},
            edited: () => {},
            cancel: () => {},
          }),
        );
        expect(creation).toContain(`<label for="goal">${copy.goal}</label>`);
        expect(creation.indexOf('for="pillar"')).toBeLessThan(creation.indexOf('for="goal"'));
      } finally {
        clock.mockRestore();
      }
    });
});
describe('Compact creation form', () => {
  it('starts at the first active pillar when the requested pillar is removed, without publishing edits', () => {
    const data = facts();
    data.pillars[0].removedOn = '2026-09-29';
    const dirty = vi.fn();
    const edited = vi.fn();
    const save = vi.fn();
    const markup = renderToStaticMarkup(
      createElement(HabitEditor, {
        copy: en,
        pillars: data.pillars,
        pillarId: 'mind',
        busy: false,
        save,
        edited,
        cancel: () => {},
        dirty,
      }),
    );
    expect(markup).toContain('<option value="body" selected="">');
    expect(markup).not.toContain('<option value="mind"');
    expect(markup).toContain('></textarea>');
    expect(dirty).not.toHaveBeenCalled();
    expect(edited).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
  it('compacts only habit forms and preserves full long textarea content', () => {
    const goal = 'Read a very long goal with natural wrapping and an editable ending. '.repeat(20);
    const value = { pillarId: 'mind', goal, weekdays: [1] };
    const props = { value, onChange: () => {}, copy: en, busy: false, compact: true };
    const compact = renderToStaticMarkup(createElement(GoalFields, props));
    expect(compact).toContain('rows="3"');
    expect(compact).toContain(`${goal}</textarea>`);
    const ordinary = renderToStaticMarkup(createElement(GoalFields, { ...props, compact: false }));
    expect(ordinary).not.toContain('rows=');
    expect(ordinary).toContain(`${goal}</textarea>`);
    const cssPath = new URL('../../src/features/habits/forms.css', import.meta.url);
    expect(existsSync(cssPath)).toBe(true);
    const css = readFileSync(cssPath, 'utf8');
    expect(css).toContain('.habit-form textarea');
    expect(css).toContain('resize: vertical');
    expect(css).not.toContain('font-size');
    expect(css).not.toContain('text-overflow');
  });
  for (const [copy, approved] of [
    [en, 'Today is optional. Skipping it won’t break your streak.'],
    [pt, 'Hoje é opcional. Não concluir hoje não quebra sua sequência.'],
  ] as const)
    it(`uses creation-only optional explanation in ${copy.everyDay}`, () => {
      const markup = renderToStaticMarkup(
        createElement(HabitEditor, {
          copy,
          pillars: facts().pillars,
          pillarId: 'mind',
          busy: false,
          save: () => {},
          edited: () => {},
          cancel: () => {},
        }),
      );
      expect(markup).toContain(approved);
      expect(markup).not.toContain(copy.optionalHelp);
      expect(markup).toContain('class="habit-form"');
    });
});
describe('Semantic draft comparison', () => {
  it('compares literal goal and pillar values plus weekday sets, including duplicate entries', () => {
    const pending = { pillarId: 'body', goal: '  Pending goal  ', weekdays: [1, 5] };
    expect(sameGoalInput({ ...pending, weekdays: [5, 1, 1] }, pending)).toBe(true);
    expect(sameGoalInput({ ...pending, goal: 'Pending goal' }, pending)).toBe(false);
    expect(sameGoalInput({ ...pending, pillarId: 'mind' }, pending)).toBe(false);
    expect(sameGoalInput({ ...pending, weekdays: [1] }, pending)).toBe(false);
    const blank = { pillarId: 'body', goal: '', weekdays: [0, 1, 2, 3, 4, 5, 6] };
    expect(sameGoalInput({ ...blank, weekdays: [6, 5, 4, 3, 2, 1, 0] }, blank)).toBe(true);
    expect(sameGoalInput({ ...blank, goal: ' ' }, blank)).toBe(false);
    expect(sameGoalInput({ ...blank, weekdays: [1] }, blank)).toBe(false);
  });
});

describe('Schedule summaries', () => {
  it('derives all seven actual weekdays, not array length', () => {
    expect(allWeekdaysSelected([6, 5, 4, 3, 2, 1, 0])).toBe(true);
    expect(allWeekdaysSelected([0, 1, 2, 3, 4, 5, 5])).toBe(false);
    expect(allWeekdaysSelected([0, 1, 2, 3, 4, 5, 7])).toBe(false);
    expect(allWeekdaysSelected([])).toBe(false);
  });
  for (const copy of [en, pt])
    it(`summarizes actual weekdays in ${copy.everyDay}`, () => {
      expect(scheduleLabel([6, 5, 4, 3, 2, 1, 0], copy)).toBe(copy.everyDay);
      expect(scheduleLabel([1, 3, 5], copy)).toBe(
        [1, 3, 5].map((day) => copy.shortWeekdays[day]).join(' · '),
      );
      expect(validGoal({ pillarId: 'mind', goal: 'Read', weekdays: [] })).toBe(false);
    });
});
