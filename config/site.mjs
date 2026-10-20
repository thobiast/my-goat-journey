import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const defaults = JSON.parse(readFileSync(new URL('./site.json', import.meta.url), 'utf8'));

export function resolveSite(env = process.env) {
  const value = env.SITE_PREFIX ?? defaults.prefix;
  if (typeof value !== 'string' || !value || value.startsWith('//') || !/^\/?[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?$/.test(value) && value !== '/') {
    throw new Error('Invalid SITE_PREFIX: use slash-separated letters, digits, hyphens or underscores (for example /field-notes/).');
  }
  const prefix = value === '/' ? '/' : `/${value.replace(/^\/|\/$/g, '')}/`;
  if (prefix.startsWith('/health/')) throw new Error('Invalid SITE_PREFIX: /health is reserved for the local health check.');
  return { prefix, appBase: `${prefix}app/` };
}

export function resolveAppURL(value, env = process.env) {
  const url = new URL(value);
  if (url.pathname === '/') url.pathname = resolveSite(env).appBase;
  return url.href;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const site = resolveSite();
  const field = process.argv[2];
  if (field !== 'prefix' && field !== 'appBase') throw new Error('Usage: node config/site.mjs {prefix|appBase}');
  console.log(site[field]);
}
