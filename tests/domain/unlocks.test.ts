import { expect, test } from 'vitest';
import { grantPermanentUnlock } from '../../src/domain/unlocks';
import type { Dataset } from '../../src/domain/types';

const now = new Date('2026-10-02T15:00:00.000Z');

function dataset(): Dataset {
  return {
    schemaVersion: 2,
    revision: 0,
    onboardingComplete: false,
    draft: null,
    settings: { language: 'en', reducedMotion: false },
    pillars: [],
    habits: [],
    occurrences: [],
    permanentUnlocks: [],
  };
}

test.each(['', ' \t\n', null, 42])(
  'rejects a non-string or empty unlock identity without modifying facts: %j',
  (id) => {
    const data = dataset();
    const before = structuredClone(data);
    expect(() => grantPermanentUnlock(data, id as string, now)).toThrow('Invalid unlock id');
    expect(data).toEqual(before);
  },
);

test.each([new Date(NaN), null, '2026-10-02T15:00:00.000Z', 0])(
  'validates the grant time even if the item is already owned: %j',
  (time) => {
    const data = dataset();
    data.permanentUnlocks.push({ id: 'test:owned', unlockedAt: now.toISOString() });
    const before = structuredClone(data);
    expect(() => grantPermanentUnlock(data, 'test:owned', time as Date)).toThrow(
      'Invalid unlock time',
    );
    expect(data).toEqual(before);
  },
);

test('preserves exact opaque identifiers and the first committed ownership time', () => {
  const data = dataset();
  grantPermanentUnlock(data, ' test:item ', now);
  grantPermanentUnlock(data, ' test:item ', new Date('2026-10-03T15:00:00.000Z'));
  grantPermanentUnlock(data, 'test:item', now);
  expect(data.permanentUnlocks).toEqual([
    { id: ' test:item ', unlockedAt: now.toISOString() },
    { id: 'test:item', unlockedAt: now.toISOString() },
  ]);
});
