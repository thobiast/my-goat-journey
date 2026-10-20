import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { ManagementIcon } from '../../src/features/pillars/icons/ManagementIcon';

const icons = [
  ['ellipsis', '4f495cc72013ffdfec677f03b33a150f7b4dd741979283fd6853a09024bca112'],
  ['chevron-up', 'd09f13fcbef3c493ead7e4663b5ee91804fec38d5edb5e7cc3acfbd547641cf4'],
  ['chevron-down', '66ea878e72ed3488bb3b464c39dfdccee8d1f78e560dccea40e5e12da0e87e87'],
] as const;

function geometry(markup: string) {
  return Array.from(markup.matchAll(/<(path|circle)\s+([^>]+)\/?\s*>/g), (match) => ({
    tag: match[1],
    attributes: Object.fromEntries(
      Array.from(match[2].matchAll(/([\w-]+)="([^"]*)"/g), (attribute) => [
        attribute[1],
        attribute[2],
      ]),
    ),
  }));
}

describe('official vendored Lucide management controls', () => {
  test.each(icons)('%s retains reviewed pinned SVG bytes and rendered geometry', (name, hash) => {
    const source = readFileSync(
      new URL(`../../src/features/pillars/icons/${name}.svg`, import.meta.url),
      'utf8',
    );
    expect(createHash('sha256').update(source).digest('hex')).toBe(hash);
    expect(source).not.toMatch(/script|foreignObject|href|onload/i);
    const markup = renderToStaticMarkup(createElement(ManagementIcon, { name }));
    expect(geometry(markup)).toEqual(geometry(source));
    for (const attribute of [
      'viewBox="0 0 24 24"',
      'fill="none"',
      'stroke="currentColor"',
      'stroke-width="1.8"',
      'stroke-linecap="round"',
      'stroke-linejoin="round"',
      'width="20"',
      'height="20"',
      'aria-hidden="true"',
      'focusable="false"',
    ])
      expect(markup).toContain(attribute);
  });
  test('retains the established upstream ISC license', () => {
    const license = readFileSync(
      new URL('../../src/features/pillars/icons/LICENSE.lucide', import.meta.url),
      'utf8',
    );
    expect(createHash('sha256').update(license).digest('hex')).toBe(
      '092a9de2ea14bcedb33f7fdf523461346251bf5334f62480a162466f4591afe1',
    );
  });
});
