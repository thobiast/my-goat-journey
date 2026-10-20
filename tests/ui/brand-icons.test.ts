import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';

const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const brandingPairs = [
  ['My_GOAT_Journey_app_icon.png', 'My_GOAT_Journey_color_symbol.png'],
  ['My_GOAT_Journey_Monochrome_ascent_emblem.png', 'My_GOAT_Journey_Monochrome_ascent_emblem.png'],
  ['My_GOAT_Journey_mountain_logo.png', 'My_GOAT_Journey_mountain_logo.png'],
];

// Permit color/rendering and notice chunks; only the reviewed generation-
// provenance container is forbidden. Do not require indiscriminate stripping.
test.each(brandingPairs)(
  'publication branding omits generation provenance and documents its exact bytes: %s',
  (filename, landingFilename) => {
    const image = readFileSync(`public/branding/${filename}`);
    expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const types: string[] = [];
    let offset = 8;
    while (offset < image.length) {
      const size = image.readUInt32BE(offset);
      expect(offset + size + 12).toBeLessThanOrEqual(image.length);
      types.push(image.toString('ascii', offset + 4, offset + 8));
      offset += size + 12;
    }
    expect(offset).toBe(image.length);
    expect(types[0]).toBe('IHDR');
    expect(types.at(-1)).toBe('IEND');
    expect(types, filename).not.toContain('caBX');
    expect(image.readUInt32BE(16)).toBe(1254);
    expect(image.readUInt32BE(20)).toBe(1254);
    expect(readFileSync(`landing/assets/${landingFilename}`)).toEqual(image);
    const hash = createHash('sha256').update(image).digest('hex');
    expect(source('docs/branding-pwa.md')).toContain(`${filename}\n${hash}`);
  },
);

describe('branding deployment contract', () => {
  test('runtime explicitly serves web manifests with the manifest MIME type', () => {
    expect(source('containers/nginx.conf')).toMatch(/application\/manifest\+json\s+webmanifest/);
  });
});
