export interface Site {
  prefix: string;
  appBase: string;
}

export function resolveSite(env?: { SITE_PREFIX?: string }): Site;

export function resolveAppURL(value: string, env?: { SITE_PREFIX?: string }): string;
