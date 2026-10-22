import { readFileSync, existsSync } from 'node:fs';
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
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
  validGoal,
} from '../../src/features/habits/formPolicy';
import en from '../../src/i18n/en.json';
import pt from '../../src/i18n/pt.json';
import type { GoalInput } from '../../src/domain/types';
import { editHabit } from '../../src/domain/lifecycle';
import { definitionAt } from '../../src/domain/agenda';

// A hook seam exposes real draft callbacks without introducing a DOM dependency.
// SSR uses real React; only the isolated event test replaces the state dispatcher.
const hooks = vi.hoisted(() => ({
  enabled: false,
  calls: 0,
  draft: undefined as GoalInput | undefined,
  setValue: vi.fn(),
}));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useEffect: (...args: Parameters<typeof actual.useEffect>) =>
      hooks.enabled ? undefined : actual.useEffect(...args),
    useState: (initial: unknown) =>
      hooks.enabled
        ? [hooks.calls++ === 1 && hooks.draft ? hooks.draft : initial, hooks.setValue]
        : actual.useState(initial),
  };
});

function elements(tree: ReactNode): ReactElement<Record<string, any>>[] {
  return Children.toArray(tree).flatMap((node) =>
    isValidElement<Record<string, any>>(node) ? [node, ...elements(node.props.children)] : [],
  );
}

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
describe('Compact effective notes', () => {
  for (const copy of [en, pt])
    for (const kind of ['goal', 'schedule', 'both'] as const)
      it(`shows a conditional note and only affected current values (${copy.everyDay}, ${kind})`, () => {
        const clock = vi.spyOn(deviceClock, 'now').mockReturnValue(new Date(2026, 8, 30, 12));
        hooks.enabled = true;
        hooks.calls = 0;
        try {
          const data = facts();
          data.settings.language = copy === en ? 'en' : 'pt';
          hooks.draft = {
            pillarId: 'mind',
            goal: kind === 'schedule' ? 'Read 10 pages' : 'Read 20 pages',
            weekdays: kind === 'goal' ? [1, 3, 5] : [1],
          };
          const markup = renderToStaticMarkup(
            EditHabit({
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
          expect(markup).toContain(
            copy.habitEditIfSaved.replace(
              '{date}',
              displayDate('2026-10-01', data.settings.language),
            ),
          );
          const values = [
            kind !== 'schedule' ? 'Read 10 pages' : undefined,
            kind !== 'goal' ? scheduleLabel([1, 3, 5], copy) : undefined,
          ]
            .filter(Boolean)
            .join(' · ');
          expect(markup).toContain(copy.habitEditUntil.replace('{values}', values));
          expect(markup).not.toContain(`${copy.today}:`);
          expect(markup).not.toContain(copy.habitEditScheduled.split('{date}')[0]);
        } finally {
          hooks.enabled = false;
          hooks.draft = undefined;
          clock.mockRestore();
        }
      });
  for (const copy of [en, pt])
    for (const revisit of [false, true])
      it(`compares pillar-only draft notes with the real prospective saved definition (${copy.everyDay}, revisit=${revisit})`, () => {
        const now = new Date(2026, 8, 30, 12);
        const clock = vi.spyOn(deviceClock, 'now').mockReturnValue(now);
        hooks.enabled = true;
        hooks.calls = 0;
        try {
          const data = facts();
          data.settings.language = copy === en ? 'en' : 'pt';
          editHabit(
            data,
            data.habits[0].id,
            { pillarId: 'mind', goal: 'Read 20 pages', weekdays: [1, 3, 5] },
            revisit ? new Date(2026, 9, 2, 12) : now,
          );
          const before = structuredClone(data);
          hooks.draft = { pillarId: 'body', goal: 'Read 20 pages', weekdays: [5, 3, 1] };
          const markup = renderToStaticMarkup(
            EditHabit({
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
          const saved = structuredClone(data);
          editHabit(saved, saved.habits[0].id, hooks.draft, now);
          const actual = definitionAt(saved.habits[0], '2026-10-01')!;
          expect(actual).toMatchObject({ effectiveFrom: '2026-10-01', goal: 'Read 20 pages' });
          expect(markup).toContain(
            (revisit ? copy.habitEditIfSaved : copy.habitEditScheduled).replace(
              '{date}',
              displayDate(actual.effectiveFrom, data.settings.language),
            ),
          );
          expect(markup).toContain(copy.habitEditUntil.replace('{values}', 'Read 10 pages'));
          expect(markup).toContain(
            copy.moveBeforeHelp
              .replace('{target}', data.pillars.find((p) => p.id === 'body')!.name!)
              .split('{date}')[0],
          );
          expect(data).toEqual(before);
        } finally {
          hooks.enabled = false;
          hooks.draft = undefined;
          clock.mockRestore();
        }
      });
  it('saving an unchanged loaded future definition leaves without rebasing saved facts', () => {
    const clock = vi.spyOn(deviceClock, 'now').mockReturnValue(new Date(2026, 8, 30, 12));
    hooks.enabled = true;
    hooks.calls = 0;
    hooks.draft = undefined;
    try {
      const data = facts();
      editHabit(
        data,
        data.habits[0].id,
        { pillarId: 'mind', goal: 'Read 20 pages', weekdays: [1, 3, 5] },
        new Date(2026, 9, 2, 12),
      );
      const before = structuredClone(data);
      const save = vi.fn();
      const cancel = vi.fn();
      const form = elements(
        EditHabit({
          data,
          habit: data.habits[0],
          today: '2026-09-30',
          copy: en,
          busy: false,
          save,
          edited: () => {},
          cancel,
          dirty: () => {},
        }),
      ).find((node) => node.type === 'form')!;
      form.props.onSubmit({ preventDefault: vi.fn() });
      expect(save).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledOnce();
      expect(data).toEqual(before);
    } finally {
      hooks.enabled = false;
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
describe('Semantic draft dirty tracking', () => {
  it('clears edit dirtiness when loaded pending goal, pillar and weekday set are restored', () => {
    hooks.enabled = true;
    const clock = vi.spyOn(deviceClock, 'now').mockReturnValue(new Date(2026, 8, 30, 12));
    try {
      const data = facts();
      data.habits[0].versions.push({
        effectiveFrom: '2026-10-01',
        goal: '  Pending goal  ',
        weekdays: [1, 5],
      });
      data.habits[0].memberships.push({ effectiveFrom: '2026-10-02', pillarId: 'body' });
      data.habits[0].pendingMove = { requestedOn: '2026-09-30', pillarId: 'body' };
      const dirty = vi.fn();
      const fields = elements(
        EditHabit({
          data,
          habit: data.habits[0],
          today: '2026-09-30',
          copy: en,
          busy: false,
          save: () => {},
          edited: () => {},
          cancel: () => {},
          dirty,
        }),
      ).find((node) => node.type === GoalFields)!;
      expect(dirty).not.toHaveBeenCalled();
      const initial = fields.props.value;
      fields.props.onChange({ ...initial, goal: 'Pending goal' });
      expect(dirty).toHaveBeenLastCalledWith(true);
      fields.props.onChange({ ...initial, weekdays: [5, 1, 1] });
      expect(dirty).toHaveBeenLastCalledWith(false);
      fields.props.onChange({ ...initial, pillarId: 'mind' });
      expect(dirty).toHaveBeenLastCalledWith(true);
      fields.props.onChange({ ...initial });
      expect(dirty).toHaveBeenLastCalledWith(false);
    } finally {
      hooks.enabled = false;
      clock.mockRestore();
    }
  });
  it('clears creation dirtiness only at the blank all-days initial active pillar', () => {
    hooks.enabled = true;
    try {
      const data = facts();
      data.pillars[0].removedOn = '2026-09-29';
      const dirty = vi.fn();
      const fields = elements(
        HabitEditor({
          copy: en,
          pillars: data.pillars,
          pillarId: 'mind',
          busy: false,
          save: () => {},
          edited: () => {},
          cancel: () => {},
          dirty,
        }),
      ).find((node) => node.type === GoalFields)!;
      expect(fields.props.value.pillarId).toBe('body');
      const initial = fields.props.value;
      fields.props.onChange({ ...initial, goal: 'Read' });
      expect(dirty).toHaveBeenLastCalledWith(true);
      fields.props.onChange({ ...initial, goal: ' ' });
      expect(dirty).toHaveBeenLastCalledWith(true);
      fields.props.onChange({ ...initial, weekdays: [6, 5, 4, 3, 2, 1, 0] });
      expect(dirty).toHaveBeenLastCalledWith(false);
      fields.props.onChange({ ...initial, weekdays: [1] });
      expect(dirty).toHaveBeenLastCalledWith(true);
      fields.props.onChange(initial);
      expect(dirty).toHaveBeenLastCalledWith(false);
    } finally {
      hooks.enabled = false;
    }
  });
});
describe('Compact creation form', () => {
  it('notifies optional navigation dirty tracking only on field changes', () => {
    hooks.enabled = true;
    hooks.setValue.mockClear();
    try {
      const dirty = vi.fn();
      const edited = vi.fn();
      const save = vi.fn();
      const props = {
        copy: en,
        pillars: facts().pillars,
        pillarId: 'mind',
        busy: false,
        save,
        edited,
        cancel: () => {},
        dirty,
      };
      const tree = HabitEditor(props);
      expect(dirty).not.toHaveBeenCalled();
      const fields = elements(tree).find((node) => node.type === GoalFields)!;
      const next = { ...fields.props.value, goal: 'Read a chapter' };
      fields.props.onChange(next);
      expect(dirty).toHaveBeenCalledExactlyOnceWith(true);
      expect(edited).toHaveBeenCalledOnce();
      expect(hooks.setValue).toHaveBeenCalledExactlyOnceWith(next);
      expect(save).not.toHaveBeenCalled();
    } finally {
      hooks.enabled = false;
    }
  });
  it('compacts only habit forms and preserves full long textarea content', () => {
    const goal = 'Read a very long goal with natural wrapping and an editable ending. '.repeat(20);
    const value = { pillarId: 'mind', goal, weekdays: [1] };
    const props = { value, onChange: () => {}, copy: en, busy: false, compact: true };
    const textarea = elements(GoalFields(props)).find((node) => node.type === 'textarea')!;
    expect(textarea.props.rows).toBe(3);
    expect(textarea.props.value).toBe(goal);
    expect(
      elements(GoalFields({ ...props, compact: false })).find((node) => node.type === 'textarea')!
        .props.rows,
    ).toBeUndefined();
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
describe('Every day is a derived draft shortcut', () => {
  it('does not publish a draft change when already selected', () => {
    const onChange = vi.fn();
    const value = { pillarId: 'mind', goal: 'Read', weekdays: [6, 5, 4, 3, 2, 1, 0] };
    const shortcut = elements(GoalFields({ value, onChange, copy: en, busy: false })).find(
      (node) => node.type === 'button' && node.props.children === en.everyDay,
    )!;
    shortcut.props.onClick();
    expect(onChange).not.toHaveBeenCalled();
  });
  for (const copy of [en, pt])
    it(`tracks actual selection and never clears selected days (${copy.everyDay})`, () => {
      const saved: GoalInput = { pillarId: 'mind', goal: 'Read', weekdays: [1] };
      const snapshot = structuredClone(saved);
      let draft = saved;

      const buttons = () =>
        elements(
          GoalFields({
            value: draft,
            onChange: (next) => {
              draft = next;
            },
            copy,
            busy: false,
          }),
        ).filter((node) => node.type === 'button');

      const shortcut = () => buttons().find((node) => node.props.children === copy.everyDay)!;

      expect(shortcut().props['aria-pressed']).toBe(false);
      expect(shortcut().props.className).toContain('secondary');
      shortcut().props.onClick();
      expect(draft.weekdays).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(shortcut().props['aria-pressed']).toBe(true);
      expect(shortcut().props.className).not.toContain('secondary');
      shortcut().props.onClick();
      expect(draft.weekdays).toEqual([0, 1, 2, 3, 4, 5, 6]);
      buttons()
        .find((node) => node.props['aria-label'] === copy.weekdays[3])!
        .props.onClick();
      expect(shortcut().props['aria-pressed']).toBe(false);
      buttons()
        .find((node) => node.props['aria-label'] === copy.weekdays[3])!
        .props.onClick();
      expect(shortcut().props['aria-pressed']).toBe(true);
      for (const day of copy.weekdays)
        buttons()
          .find((node) => node.props['aria-label'] === day)!
          .props.onClick();
      expect(draft.weekdays).toEqual([]);
      for (const day of copy.weekdays)
        buttons()
          .find((node) => node.props['aria-label'] === day)!
          .props.onClick();
      expect(shortcut().props['aria-pressed']).toBe(true);
      expect(saved).toEqual(snapshot);
    });
});
