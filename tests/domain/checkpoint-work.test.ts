import { expect, test, vi } from 'vitest';
import { validateDataset } from '../../src/data/backup';
import { calculateProgress } from '../../src/domain/progress';
import { hasEarlierHistory } from '../../src/features/progress/calendar';
import { trackingStart } from '../../src/features/progress/monthly';
import { DEFAULT_PILLARS } from '../../src/domain/types';
import { facts } from './fixtures';

function stretchedFacts(last: string) {
  const data = facts();
  data.pillars = DEFAULT_PILLARS.map((id) => ({ id, name: id, defaultKey: id }));
  const habit = data.habits[0];
  habit.createdOn = '0100-01-01';
  habit.versions[0].effectiveFrom = habit.createdOn;
  habit.memberships[0].effectiveFrom = habit.createdOn;
  habit.periods[0].start = habit.createdOn;
  data.habits.push({
    ...structuredClone(habit),
    id: 'late',
    createdOn: last,
    versions: [{ ...habit.versions[0], effectiveFrom: last }],
    memberships: [{ effectiveFrom: last, pillarId: 'body' }],
    periods: [{ id: 'late-period', start: last }],
  });
  return data;
}

/** Fail early even on the old engine: a regression must not enumerate millions of dates. */
function boundedCivilWork<T>(operation: () => T): { result: T; work: number } {
  const original = Date.prototype.setUTCDate;
  let work = 0;
  const spy = vi.spyOn(Date.prototype, 'setUTCDate').mockImplementation(function (
    this: Date,
    day: number,
  ) {
    expect(++work, 'public operation expanded empty civil days').toBeLessThan(200);
    return original.call(this, day);
  });
  try {
    return { result: operation(), work };
  } finally {
    spy.mockRestore();
  }
}

for (const last of ['0110-01-01', '9998-01-01']) {
  test(`public progress is bounded by stored facts, not the empty span to ${last}`, () => {
    const data = stretchedFacts(last);
    const { result } = boundedCivilWork(() => calculateProgress(data, last));
    expect(result.totalXp).toBe(0);
    expect(result.habits.read.current).toBe(0);
    expect(result.habits.late.current).toBe(0);
  });

  test(`portable validation retains replay without expanding the empty span to ${last}`, () => {
    const data = stretchedFacts(last);
    const { result } = boundedCivilWork(() => validateDataset(data));
    expect(result).toEqual(data);
  });

  test(`earlier participation preserves missing, late and future-only scopes at ${last}`, () => {
    const data = stretchedFacts(last);
    expect(
      boundedCivilWork(() => hasEarlierHistory(data, { kind: 'pillar', id: 'absent' }, last))
        .result,
    ).toBe(false);
    expect(
      boundedCivilWork(() => hasEarlierHistory(data, { kind: 'habit', id: 'late' }, last)).result,
    ).toBe(false);
    expect(
      boundedCivilWork(() => hasEarlierHistory(data, { kind: 'pillar', id: 'body' }, last)).result,
    ).toBe(false);
    expect(boundedCivilWork(() => hasEarlierHistory(data, { kind: 'all' }, last)).result).toBe(
      true,
    );
  });

  test(`tracking start retains empty and late pillar participation at ${last}`, () => {
    const data = stretchedFacts(last);
    expect(
      boundedCivilWork(() => trackingStart(data, { kind: 'pillar', id: 'absent' })).result,
    ).toBeUndefined();
    expect(boundedCivilWork(() => trackingStart(data, { kind: 'pillar', id: 'body' })).result).toBe(
      last,
    );
    expect(boundedCivilWork(() => trackingStart(data, { kind: 'all' })).result).toBe('0100-01-01');
    expect(boundedCivilWork(() => trackingStart(data, { kind: 'habit', id: 'late' })).result).toBe(
      last,
    );
  });
}

test('stretching identical stored-fact shapes does not increase public-path civil work', () => {
  const counts = ['0110-01-01', '9998-01-01'].map((last) => {
    const data = stretchedFacts(last);
    return [
      boundedCivilWork(() => calculateProgress(data, last)).work,
      boundedCivilWork(() => validateDataset(data)).work,
      boundedCivilWork(() => hasEarlierHistory(data, { kind: 'pillar', id: 'absent' }, last)).work,
      boundedCivilWork(() => trackingStart(data, { kind: 'pillar', id: 'absent' })).work,
    ];
  });
  // Weekday alignment can change schedule lookups by at most one weekly cycle per habit.
  counts[1].forEach((count, index) => expect(count).toBeLessThanOrEqual(counts[0][index] + 14));
});
