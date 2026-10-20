import { test, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PillarIcon } from '../../src/features/pillars/PillarIcon';

const officialPaths = [
  'M12.409 13.017A5 5 0 0 1 22 15c0 3.866-4 7-9 7-4.077 0-8.153-.82-10.371-2.462-.426-.316-.631-.832-.62-1.362C2.118 12.723 2.627 2 10 2a3 3 0 0 1 3 3 2 2 0 0 1-2 2c-1.105 0-1.64-.444-2-1',
  'M15 14a5 5 0 0 0-7.584 2',
  'M9.964 6.825C8.019 7.977 9.5 13 8 15',
];
test('Body uses the exact official Lucide BicepsFlexed path geometry', () => {
  const markup = renderToStaticMarkup(createElement(PillarIcon, { kind: 'body' }));
  const actual = Array.from(markup.matchAll(/<path[^>]* d="([^"]+)"/g), (m) => m[1]);
  expect(actual).toEqual(officialPaths);
  expect(markup).toContain('aria-hidden="true"');
  expect(markup).toContain('focusable="false"');
});
