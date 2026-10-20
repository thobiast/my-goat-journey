import { expect, test } from 'vitest';

test('site prefix has one committed default and derives the app path', async () => {
  const { resolveSite } = await import('../../config/site.mjs');
  expect(resolveSite({})).toEqual({
    prefix: '/my-goat-journey/',
    appBase: '/my-goat-journey/app/',
  });
  expect(resolveSite({ SITE_PREFIX: 'field-notes' })).toEqual({
    prefix: '/field-notes/',
    appBase: '/field-notes/app/',
  });
  expect(resolveSite({ SITE_PREFIX: '/team/diary/' })).toEqual({
    prefix: '/team/diary/',
    appBase: '/team/diary/app/',
  });
  expect(resolveSite({ SITE_PREFIX: '/' })).toEqual({ prefix: '/', appBase: '/app/' });
});

test('Playwright app URL derives from an origin but preserves an explicit app entry', async () => {
  const { resolveAppURL } = await import('../../config/site.mjs');
  expect(resolveAppURL('http://my-goat-journey-dev:5173', {})).toBe(
    'http://my-goat-journey-dev:5173/my-goat-journey/app/',
  );
  expect(resolveAppURL('http://my-goat-journey-runtime:8080/', { SITE_PREFIX: '/second/' })).toBe(
    'http://my-goat-journey-runtime:8080/second/app/',
  );
  expect(resolveAppURL('http://fixture:8080/legacy/app/', {})).toBe(
    'http://fixture:8080/legacy/app/',
  );
  expect(resolveAppURL('http://fixture:8080/legacy/app/index.html', {})).toBe(
    'http://fixture:8080/legacy/app/index.html',
  );
});

test('unsafe or ambiguous prefixes fail with a configuration error', async () => {
  const { resolveSite } = await import('../../config/site.mjs');
  for (const SITE_PREFIX of [
    '',
    ' ',
    '//host/',
    '/one//two/',
    '/a/../b/',
    '/./',
    '/a?b/',
    '/a#b/',
    'https://host/',
    '/a%2fb/',
    '/a\\\\b/',
    '/$uri/',
    '/health/',
  ]) {
    expect(() => resolveSite({ SITE_PREFIX })).toThrow(/Invalid SITE_PREFIX/);
  }
});
