import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolveSite } from '../config/site.mjs';

export function renderNginx(site = resolveSite()) {
  // Revalidate even callers supplying a resolved object; no nginx injection.
  const normalized = resolveSite({ SITE_PREFIX: site.prefix });
  if (normalized.appBase !== site.appBase) throw new Error('App base must derive from SITE_PREFIX');
  return readFileSync(new URL('../containers/nginx.conf', import.meta.url), 'utf8')
    .replaceAll('__SITE_PREFIX__', site.prefix)
    .replaceAll('__APP_BASE__', site.appBase)
    .replaceAll('__APP_ENTRY__', site.appBase.slice(0, -1))
    .replaceAll('__PREFIX_REDIRECT__', site.prefix === '/' ? '' : `location = ${site.prefix.slice(0, -1)} { return 301 ${site.prefix}; }`)
    .replaceAll('__OUTSIDE_PREFIX__', site.prefix === '/' ? '' : 'location / { return 404; }');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/render-nginx.mjs OUTPUT');
  writeFileSync(process.argv[2], renderNginx());
}
