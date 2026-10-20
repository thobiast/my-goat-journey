import { expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import en from '../../src/i18n/en.json';
import { calculateProgress } from '../../src/domain/progress';
import { Repository } from '../../src/data/database';
import { parseBackup, serializeBackup, validateDataset } from '../../src/data/backup';
import {
  PROGRESS_INTERVALS,
  isProgressInterval,
  progressIntervalOrDefault,
} from '../../src/domain/preferences';
import {
  ProgressPage,
  initialProgressView,
  initialProgressViewFor,
} from '../../src/features/progress/ProgressPage';
import { DEFAULT_PILLARS, type Settings } from '../../src/domain/types';
import { facts } from '../domain/fixtures';

const invalid = [undefined, null, '', '2m', '7D', '3m ', 0, 7, true, {}, ['3m']];
test('empty-state Add habit navigation is disabled while an interval write owns busy feedback', () => {
  const data = facts();
  const html = renderToStaticMarkup(
    createElement(ProgressPage, {
      data,
      today: '2026-10-03',
      progress: calculateProgress(data, '2026-10-03'),
      copy: en,
      busy: true,
      value: { ...initialProgressView, pillarId: 'body' },
      change: () => {},
      openHabit: () => {},
      add: () => {},
    }),
  );
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Add habit<\/button>/);
});

function portableFacts() {
  const data = facts();
  data.pillars = DEFAULT_PILLARS.map((id) => ({ id, name: id, defaultKey: id }));
  return data;
}

test('all existing interval options remain in their established order with a 7d default', () => {
  expect(PROGRESS_INTERVALS).toEqual(['7d', '1m', '3m', '12m', '24m']);
  expect(initialProgressView.interval).toBe('7d');
  expect(initialProgressViewFor({ language: 'en', reducedMotion: false })).toEqual(
    initialProgressView,
  );
});
test.each(PROGRESS_INTERVALS)('valid %s restores a latest-window initial view', (interval) => {
  expect(isProgressInterval(interval)).toBe(true);
  expect(progressIntervalOrDefault(interval)).toBe(interval);
  const settings = { language: 'en' as const, reducedMotion: false, progressInterval: interval };
  const before = structuredClone(settings);
  expect(initialProgressViewFor(settings)).toEqual({ ...initialProgressView, interval, offset: 0 });
  expect(settings).toEqual(before);
});
test.each(invalid)('invalid/missing saved preference %j safely falls back to 7d', (value) => {
  expect(isProgressInterval(value)).toBe(false);
  expect(progressIntervalOrDefault(value)).toBe('7d');
  expect(
    initialProgressViewFor({
      language: 'en',
      reducedMotion: false,
      progressInterval: value,
    } as Settings).interval,
  ).toBe('7d');
});
test.each(PROGRESS_INTERVALS)(
  'saved %s survives repository reopen and portable backup without derived calendar data',
  async (interval) => {
    const repo = new Repository(crypto.randomUUID());
    const original = await repo.load();
    const saved = await repo.setSettings({ progressInterval: interval }, original.revision);
    const reopened = await new Repository(repo.name).load();
    expect(reopened).toEqual(saved);
    expect(reopened.settings).toEqual({ ...original.settings, progressInterval: interval });
    for (const key of [
      'pillars',
      'habits',
      'occurrences',
      'permanentUnlocks',
      'draft',
      'onboardingComplete',
    ] as const)
      expect(saved[key]).toEqual(original[key]);
    expect((await parseBackup(serializeBackup(saved))).dataset.settings).toEqual(saved.settings);
  },
);
test.each(invalid)(
  'malformed explicit preference write %j rejects without mutation',
  async (value) => {
    const repo = new Repository(crypto.randomUUID());
    const before = await repo.load();
    await expect(
      repo.setSettings({ progressInterval: value } as Partial<Settings>, before.revision),
    ).rejects.toThrow('Invalid Progress interval');
    expect(await repo.load()).toEqual(before);
  },
);
test.each(invalid)('portable invalid preference %j normalizes only that preference', (value) => {
  const input = portableFacts();
  const settings = { ...input.settings, progressInterval: value };
  const before = structuredClone(input);
  const result = validateDataset({ ...input, settings });
  expect(result).toEqual({ ...before, settings: { ...before.settings, progressInterval: '7d' } });
  expect(input).toEqual(before);
});
test('legacy missing preference stays absent; derived calendar settings are still rejected', () => {
  const input = portableFacts();
  expect(validateDataset(input)).toEqual(input);
  expect(() => validateDataset({ ...input, settings: { ...input.settings, offset: 1 } })).toThrow();
  expect(() =>
    validateDataset({
      ...input,
      settings: { ...input.settings, progressWindow: { start: '2026-10-01' } },
    }),
  ).toThrow();
});
test('failed preference write retains the old selection and unrelated language/motion patch preserves the preference', async () => {
  let fail = false;
  const repo = new Repository(crypto.randomUUID(), () => fail);
  const saved = await repo.setSettings({ progressInterval: '3m' });
  fail = true;
  await expect(repo.setSettings({ progressInterval: '1m' }, saved.revision)).rejects.toThrow(
    'Persistence failed',
  );
  expect(await repo.load()).toEqual(saved);
  fail = false;
  const changed = await repo.setSettings({ language: 'pt', reducedMotion: true }, saved.revision);
  expect(changed.settings).toEqual({ language: 'pt', reducedMotion: true, progressInterval: '3m' });
});
