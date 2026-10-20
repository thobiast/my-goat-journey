import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { TrailIcon } from '../../src/features/journey/TrailIcons';

const icons = [
  ['footprints', '09ddd9fd4ac7cebfdc91e1096f7b75db019a42fffc493c4adb128a49e1dba04f'],
  ['check', '7f33acc9a77a61659531044525fc008edebe215bf4dcf1c789c8674ad3277db0'],
  ['flag', '73d58bafed0501f646bdbb015cbb4de22142836f7ff1f60c1c6bd3b0b72d81db'],
  ['chevron-left', '83b0681aa38bf55e9d52a1e4b4cced624abe1fe7678ecafda133a574f1161d93'],
  ['chevron-right', '2758143d7b2434e4aa7307dfd34405c87909ff4052f21b5f3f40d45224b4f19b'],
  ['medal', '19a93f0d070d0a04283e2bee11799d3fd73de214936224c5d4141ebe3e119756'],
  ['sparkles', 'cc8061ee31c43138e081522260d2ddd35465dfb2a4435fddd3d9857952d7231e'],
] as const;

function geometry(markup: string) {
  return Array.from(markup.matchAll(/<(path|line|circle)\s+([^>]+)\/?\s*>/g), (match) => ({
    tag: match[1],
    attributes: Object.fromEntries(
      Array.from(match[2].matchAll(/([\w-]+)="([^"]*)"/g), (attribute) => [
        attribute[1],
        attribute[2],
      ]),
    ),
  }));
}

describe('official vendored Lucide Journey icons', () => {
  test.each(icons)('%s preserves the pinned upstream SVG bytes and geometry', (name, sha256) => {
    const source = readFileSync(
      new URL(`../../src/features/journey/icons/${name}.svg`, import.meta.url),
      'utf8',
    );
    expect(createHash('sha256').update(source).digest('hex')).toBe(sha256);
    const expected = geometry(source);
    expect(expected.length).toBeGreaterThan(0);
    expect(geometry(renderToStaticMarkup(createElement(TrailIcon, { name })))).toEqual(expected);
  });

  test.each(icons)('%s is decorative with consistent default SVG presentation', (name) => {
    const markup = renderToStaticMarkup(createElement(TrailIcon, { name }));
    for (const attribute of [
      'xmlns="http://www.w3.org/2000/svg"',
      'width="20"',
      'height="20"',
      'viewBox="0 0 24 24"',
      'fill="none"',
      'stroke="currentColor"',
      'stroke-width="1.8"',
      'stroke-linecap="round"',
      'stroke-linejoin="round"',
      'aria-hidden="true"',
      'focusable="false"',
    ])
      expect(markup).toContain(attribute);
  });

  test('supports explicit icon sizing without changing official geometry', () => {
    const markup = renderToStaticMarkup(createElement(TrailIcon, { name: 'footprints', size: 32 }));
    expect(markup).toContain('width="32"');
    expect(markup).toContain('height="32"');
    expect(geometry(markup)).toEqual(
      geometry(renderToStaticMarkup(createElement(TrailIcon, { name: 'footprints' }))),
    );
  });

  test('retains the full pinned upstream ISC license', () => {
    const license = readFileSync(
      new URL('../../src/features/journey/icons/LICENSE.lucide', import.meta.url),
      'utf8',
    );
    expect(createHash('sha256').update(license).digest('hex')).toBe(
      '1e7290b35280a048667bbf0ebabac1c7fd52a75300e8b2946ac165715997f2bc',
    );
  });
});
