import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { deviceClock } from '../../src/domain/calendar';
import { Repository } from '../../src/data/database';
import { seed } from '../data/fixtures';
import { facts } from '../domain/fixtures';
import { DEFAULT_PILLARS } from '../../src/domain/types';
import { EditHabit } from '../../src/features/habits/EditHabit';
import { PillarsManagement } from '../../src/features/pillars/PillarsManagement';
import en from '../../src/i18n/en.json';
import pt from '../../src/i18n/pt.json';

async function removedHistory() {
  const data = facts();
  data.pillars = DEFAULT_PILLARS.map((id) => ({ id, name: id, defaultKey: id }));
  const name = crypto.randomUUID();
  await seed(name, data);
  const repo = new Repository(name);
  try {
    await repo.archiveHabit('read', new Date(2026, 9, 2, 12));
    return await repo.removePillar('mind', new Date(2026, 9, 2, 12));
  } finally {
    await repo.close();
  }
}

test('a retained removed destination cannot crash editing on a revisited tracked date or offer a historical rewrite', async () => {
  const data = await removedHistory();
  const before = structuredClone(data);
  const clock = vi.spyOn(deviceClock, 'now').mockReturnValue(new Date(2026, 8, 30, 12));
  try {
    for (const copy of [en, pt]) {
      const html = renderToStaticMarkup(
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
      expect(html).toContain(copy.historicalConflict);
      expect(html).toContain(copy.cancel);
      expect(html).not.toContain(copy.saveChanges);
      expect(html).not.toContain('<select');
    }
  } finally {
    clock.mockRestore();
  }
  expect(data).toEqual(before);
});

test('Archived keeps removed-source history discoverable on revisited dates without claiming reactivation is available', async () => {
  const data = await removedHistory();
  const before = structuredClone(data);
  const html = renderToStaticMarkup(
    createElement(PillarsManagement, {
      data,
      today: '2026-09-30',
      copy: en,
      busy: false,
      archived: true,
      collapsed: {},
      toggle: () => {},
      create: () => {},
      edit: () => {},
      review: () => {},
      lifecycle: () => {},
      openArchived: () => {},
      newPillar: () => {},
      managePillar: () => {},
    }),
  );
  expect(html).toContain('Read 10 pages');
  expect(html).toContain(en.reviewCompletions);
  expect(html).toContain(en.historicalConflict);
  expect(html).not.toContain(en.reactivateHabit);
  expect(data).toEqual(before);
});
