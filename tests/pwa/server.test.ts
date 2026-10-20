import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

import { resolveSite } from '../../config/site.mjs';

const nginx = readFileSync('containers/nginx.conf', 'utf8');
test('runtime rendering uses the shared prefix for landing, app, assets and app-only worker', async () => {
  const { renderNginx } = await import('../../scripts/render-nginx.mjs');
  for (const SITE_PREFIX of ['/my-goat-journey/', '/team/notes/']) {
    const site = resolveSite({ SITE_PREFIX });
    const config = renderNginx(site);
    expect(config).toContain(`location ${site.prefix} { try_files $uri $uri/ =404; }`);
    expect(config).toContain(`location = ${site.appBase}sw.js { try_files $uri =404; }`);
    expect(config).toContain(
      `location = ${site.prefix.slice(0, -1)} { return 301 ${site.prefix}; }`,
    );
    expect(config).toContain(`~^${site.appBase}assets/`);
    expect(config).toContain('location / { return 404; }');
    expect(config).toContain('location = /health');
    expect(config).not.toContain('__');
    expect(config).not.toContain('Service-Worker-Allowed');
    expect(config).not.toContain('/index.html;');
  }
  expect(readFileSync('Containerfile', 'utf8')).toContain('node scripts/render-nginx.mjs');
});
test('runtime does not cache HTML, worker or manifest and caches hashed assets immutably', () => {
  expect(nginx).toMatch(/map \$uri \$app_cache_control/);
  expect(nginx).toContain('default "no-cache";');
  expect(nginx).toContain('public, max-age=31536000, immutable');
  expect(nginx).toContain('add_header Cache-Control $app_cache_control always;');
});
test('runtime reserves worker and local asset paths without a misleading SPA fallback', () => {
  expect(nginx).toContain('location = __APP_BASE__sw.js { try_files $uri =404; }');
  for (const directory of ['assets', 'icons', 'branding']) {
    expect(nginx).toContain(`location __APP_BASE__${directory}/ { try_files $uri =404; }`);
  }
  expect(nginx).toMatch(/location ~.*js.*css.*\{\s*try_files \$uri =404;/);
  expect(nginx).toContain('location __SITE_PREFIX__ { try_files $uri $uri/ =404; }');
});
