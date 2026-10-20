import { createServer, resolveConfig } from 'vite';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { resolveSite } from '../../config/site.mjs';

test('Vite serves the unchanged landing source and HMR app at the shared paths', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'publication-dev-'));
  await mkdir(resolve(root, 'landing/assets'), { recursive: true });
  await mkdir(resolve(root, 'src'));
  const landing =
    '<!doctype html><a href="app/">Open the app</a><link rel="stylesheet" href="assets/site.css">';
  await writeFile(resolve(root, 'landing/index.html'), landing);
  const licenses = '<!doctype html><h1>Licenses</h1><a href="app/LICENSE">Project license</a>';
  await writeFile(resolve(root, 'landing/licenses.html'), licenses);
  await writeFile(resolve(root, 'landing/assets/site.css'), 'body { color: green }');
  const license = 'Canonical project license fixture\n';
  await writeFile(resolve(root, 'LICENSE'), license);
  await mkdir(resolve(root, 'public'));
  await writeFile(resolve(root, 'public/site-v1.webmanifest'), '{"start_url":"./","scope":"./"}');
  await writeFile(
    resolve(root, 'index.html'),
    '<!doctype html><link rel="manifest" href="%BASE_URL%site-v1.webmanifest"><div id="root">App</div><script type="module" src="/src/demo.js"></script>',
  );
  await writeFile(resolve(root, 'src/demo.js'), 'export const example = true;');
  const server = await createServer({
    root,
    configFile: resolve('vite.config.ts'),
    server: { port: 0, host: '127.0.0.1' },
    logLevel: 'error',
  });
  try {
    await server.listen();
    const origin = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`;
    const { prefix, appBase } = resolveSite();
    expect(server.config.base).toBe(appBase);
    expect(await (await fetch(`${origin}${prefix}`)).text()).toBe(landing);
    const legalPage = await fetch(`${origin}${prefix}licenses.html`);
    expect(legalPage.status).toBe(200);
    expect(legalPage.headers.get('content-type')).toContain('text/html');
    expect(await legalPage.text()).toBe(licenses);
    const css = await fetch(`${origin}${prefix}assets/site.css`);
    expect(css.headers.get('content-type')).toContain('text/css');
    expect(await css.text()).toBe('body { color: green }');
    const legal = await fetch(`${origin}${appBase}LICENSE`);
    expect(legal.status).toBe(200);
    expect(legal.headers.get('content-type')).toContain('text/plain');
    expect(await legal.text()).toBe(license);
    const app = await (await fetch(`${origin}${appBase}`)).text();
    expect(app).toContain(`${appBase}@vite/client`);
    expect(app).toContain(`${appBase}src/demo.js`);
    expect(app).toContain(`href="${appBase}site-v1.webmanifest"`);
    expect(app).not.toContain(`${appBase}${appBase.slice(1)}`);
    const manifest = await fetch(`${origin}${appBase}site-v1.webmanifest`);
    expect(manifest.headers.get('content-type')).toContain('application/manifest+json');
    expect(await (await fetch(`${origin}${appBase}src/demo.js`)).text()).toContain(
      'example = true',
    );
    const entry = await fetch(`${origin}${prefix.slice(0, -1)}`, { redirect: 'manual' });
    if (prefix === '/') {
      expect(entry.status).toBe(200);
      expect(entry.headers.get('location')).toBeNull();
      expect(await entry.text()).toBe(landing);
    } else {
      expect(entry.status).toBe(302);
      expect(entry.headers.get('location')).toBe(prefix);
    }
    expect(
      (await resolveConfig({}, 'serve')).plugins.some(
        (p) => p.name === 'my-goat-journey-app-shell',
      ),
    ).toBe(false);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
