import { expect, test } from 'vitest';
import { landingExamples, defaultLandingDemoIds } from '../fixtures/landing-catalog';

// Native landing JS is intentionally outside the application TypeScript graph.
const catalogModule = '../../landing/assets/habit-catalog.js';
const translationsModule = '../../landing/assets/translations.js';

test('landing catalog owns unique stable identities, explicit pillars and idea placement', async () => {
  const { habitCatalog, defaultDemoIds } = await import(catalogModule);
  expect(habitCatalog).toEqual(
    landingExamples.map(({ id, pillar, placement }) => ({ id, pillar, placement })),
  );
  expect(new Set(habitCatalog.map((entry: { id: string }) => entry.id)).size).toBe(12);
  for (const entry of habitCatalog) {
    expect(entry.id).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
    expect(['mind', 'body', 'nutrition', 'hygiene']).toContain(entry.pillar);
  }
  expect(
    habitCatalog.filter((entry: { placement: string }) => entry.placement === 'initial'),
  ).toHaveLength(4);
  expect(
    habitCatalog.filter((entry: { placement: string }) => entry.placement === 'additional'),
  ).toHaveLength(8);
  expect(defaultDemoIds).toEqual(defaultLandingDemoIds);
});

test('both languages resolve every example by identity, independent of catalog and copy insertion order', async () => {
  const { habitCatalog } = await import(catalogModule);
  const { copy } = await import(translationsModule);
  for (const [locale, fixtureKey] of [
    ['en', 'en'],
    ['pt-BR', 'pt'],
  ] as const) {
    expect(Object.keys(copy[locale].ideas).sort()).toEqual(
      landingExamples.map((entry) => entry.id).sort(),
    );
    const reorderedCopy = Object.fromEntries(Object.entries(copy[locale].ideas).reverse());
    for (const entry of [...habitCatalog].reverse()) {
      const expected = landingExamples.find((example) => example.id === entry.id)!;
      expect({ pillar: entry.pillar, text: reorderedCopy[entry.id] }).toEqual({
        pillar: expected.pillar,
        text: expected[fixtureKey],
      });
    }
  }
});
