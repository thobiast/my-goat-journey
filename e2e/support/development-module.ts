import type { Page } from '@playwright/test';

/** Use the module actually loaded by Vite, including its HMR version query. */
export async function developmentModuleUrl(page: Page, pathname: string): Promise<string> {
  return page.evaluate(async (pathname) => {
    // Injected browser clocks can replace Performance resource entries.
    const appEntry = new URL('./', location.href);
    const source = await (await fetch(new URL('src/app/App.tsx', appEntry))).text();
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
    const expected = new URL(pathname.replace(/^\//, ''), appEntry).pathname;
    const moduleUrl = imports.find((url) => new URL(url, location.origin).pathname === expected);
    if (!moduleUrl) throw new Error(`Development module was not imported: ${pathname}`);
    return new URL(moduleUrl, location.origin).href;
  }, pathname);
}
