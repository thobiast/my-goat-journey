import { createHash } from 'node:crypto';
import { cp, link, symlink, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { resolveSite } from '../../config/site.mjs';
import { buildProductionSite as buildSite } from '../helpers/production-build';

async function fixture() {
  const directory = await mkdtemp(resolve(tmpdir(), 'publication-build-'));
  const landingDir = resolve(directory, 'landing');
  await mkdir(resolve(landingDir, 'assets'), { recursive: true });
  await writeFile(
    resolve(landingDir, 'index.html'),
    '<!doctype html><a href="app/">Open the app</a>',
  );
  await writeFile(resolve(landingDir, 'assets/site.css'), 'body { color: green }');
  return { directory, landingDir, output: resolve(directory, 'dist') };
}

test('production fixtures resolve production semantics without changing the test environment', async () => {
  const parentNodeEnv = process.env.NODE_ENV;
  expect(parentNodeEnv).toBe('test');
  const f = await fixture();
  try {
    const site = resolveSite({});
    const result = await buildSite({ ...f, site });
    expect(result.environment).toEqual({
      nodeEnv: 'production',
      mode: 'production',
      isProduction: true,
      PROD: true,
      DEV: false,
    });
  } finally {
    expect(process.env.NODE_ENV).toBe(parentNodeEnv);
    await rm(f.directory, { recursive: true, force: true });
  }
}, 60_000);

test('distribution derives the project license and preserves notices before shell signing', async () => {
  const f = await fixture();
  try {
    const site = resolveSite({});
    await buildSite({ ...f, site });
    const worker = await readFile(resolve(f.output, 'app/sw.js'), 'utf8');
    const metadata = JSON.parse(worker.match(/const CONFIG = (.+);/)![1]);
    for (const [name, source] of [
      ['LICENSE', 'LICENSE'],
      ['third-party-notices.txt', 'public/third-party-notices.txt'],
    ]) {
      const bytes = await readFile(resolve(f.output, 'app', name));
      expect(bytes).toEqual(await readFile(source));
      expect(metadata.files).toContain(`${site.appBase}${name}`);
      expect(metadata.integrity[`${site.appBase}${name}`]).toBe(
        `sha256-${createHash('sha256').update(bytes).digest('base64')}`,
      );
    }
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
}, 60_000);

test('assembly rejects incomplete shell metadata and stale worker versions', async () => {
  const { assembleSite } = await import('../../scripts/build-site.mjs');
  const f = await fixture();
  try {
    const site = resolveSite({});
    await buildSite({ ...f, site });
    for (const kind of [
      'incomplete',
      'version',
      'corrupt',
      'proto',
      'missing-license',
      'unsigned-license',
      'corrupt-license',
      'corrupt-notice',
    ]) {
      const appDir = resolve(f.directory, kind);
      await cp(resolve(f.output, 'app'), appDir, { recursive: true });
      const worker = await readFile(resolve(appDir, 'sw.js'), 'utf8');
      const encoded = worker.match(/const CONFIG = (.+);/)![1];
      const metadata = JSON.parse(encoded);
      if (kind === 'incomplete')
        metadata.files = metadata.files.filter(
          (url: string) => !url.includes('app-icon-192-v1.png'),
        );
      if (kind === 'version') metadata.version = '0'.repeat(64);
      if (kind === 'corrupt')
        await writeFile(resolve(appDir, 'icons/app-icon-192-v1.png'), 'corrupt');
      if (kind === 'proto') await writeFile(resolve(appDir, '__proto__'), 'unexpected output');
      if (kind === 'missing-license') await rm(resolve(appDir, 'LICENSE'));
      if (kind === 'unsigned-license')
        metadata.files = metadata.files.filter((url: string) => !url.endsWith('/LICENSE'));
      if (kind === 'corrupt-license')
        await writeFile(resolve(appDir, 'LICENSE'), 'truncated project license');
      if (kind === 'corrupt-notice')
        await writeFile(
          resolve(appDir, 'third-party-notices.txt'),
          'truncated third-party notices',
        );
      await writeFile(resolve(appDir, 'sw.js'), worker.replace(encoded, JSON.stringify(metadata)));
      await expect(
        assembleSite({
          appDir,
          landingDir: f.landingDir,
          output: resolve(f.directory, `bad-${kind}`),
          site,
        }),
      ).rejects.toThrow(/Unexpected|Incomplete|Stale/i);
    }
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
}, 60_000);

test('public inputs have an explicit allowlist and require distribution notices', async () => {
  const { validatePublic } = await import('../../scripts/build-site.mjs');
  const f = await fixture();
  try {
    const publicDir = resolve(f.directory, 'public');
    await cp(resolve('public'), publicDir, { recursive: true });
    await validatePublic(publicDir);
    await writeFile(resolve(publicDir, '__proto__'), 'not a reviewed public asset');
    await expect(validatePublic(publicDir)).rejects.toThrow(/Unexpected public.*__proto__/);
    await rm(resolve(publicDir, '__proto__'));
    await mkdir(resolve(publicDir, 'private'));
    await expect(validatePublic(publicDir)).rejects.toThrow(/Unexpected.*directory/i);
    await rm(resolve(publicDir, 'private'), { recursive: true });
    await writeFile(resolve(publicDir, 'backup.json'), '{}');
    await expect(validatePublic(publicDir)).rejects.toThrow(/Unexpected public/);
    await rm(resolve(publicDir, 'backup.json'));
    await rm(resolve(publicDir, 'third-party-notices.txt'));
    await expect(validatePublic(publicDir)).rejects.toThrow(/Missing public.*third-party-notices/);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test('assembly rejects linked inputs instead of dereferencing them into publication', async () => {
  const { assembleSite } = await import('../../scripts/build-site.mjs');
  const f = await fixture();
  try {
    const site = resolveSite({});
    await buildSite({ ...f, site });
    for (const kind of ['symlink', 'hardlink']) {
      const appDir = resolve(f.directory, kind);
      await cp(resolve(f.output, 'app'), appDir, { recursive: true });
      const notice = resolve(appDir, 'third-party-notices.txt');
      await rm(notice);
      if (kind === 'symlink')
        await symlink(resolve(f.output, 'app/third-party-notices.txt'), notice);
      else await link(resolve(f.output, 'app/third-party-notices.txt'), notice);
      await expect(
        assembleSite({
          appDir,
          landingDir: f.landingDir,
          output: resolve(f.directory, `bad-${kind}`),
          site,
        }),
      ).rejects.toThrow(/link|regular/i);
      await rm(appDir, { recursive: true });
    }
    const asset = resolve(f.landingDir, 'assets/site.css');
    await rm(asset);
    await symlink(resolve(f.output, 'assets/site.css'), asset);
    await expect(
      assembleSite({
        appDir: resolve(f.output, 'app'),
        landingDir: f.landingDir,
        output: resolve(f.directory, 'bad-landing'),
        site,
      }),
    ).rejects.toThrow(/link|regular/i);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
}, 60_000);

test('licensing page assembles at an alternate prefix without changing app bytes or allowing arbitrary HTML', async () => {
  const f = await fixture();
  try {
    const site = resolveSite({ SITE_PREFIX: '/team/field-notes/' });
    const page = '<!doctype html><h1>Licenses</h1><a href="app/LICENSE">Project license</a>';
    await writeFile(resolve(f.landingDir, 'licenses.html'), page);
    const before = await buildSite({ ...f, site });
    expect(await readFile(resolve(f.output, 'licenses.html'), 'utf8')).toBe(page);
    await writeFile(resolve(f.landingDir, 'licenses.html'), page + '<p>Updated labels</p>');
    const after = await buildSite({ ...f, site });
    expect(after.appHashes).toEqual(before.appHashes);
    expect(after.version).toBe(before.version);
    await writeFile(resolve(f.landingDir, 'private.html'), '<h1>Not reviewed</h1>');
    await expect(buildSite({ ...f, site })).rejects.toThrow(/Unexpected landing/);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
}, 60_000);

test('landing-only rebuild keeps every app hash and worker version stable, even at a second prefix', async () => {
  const f = await fixture();
  try {
    const site = resolveSite({ SITE_PREFIX: '/team/field-notes/' });
    const before = await buildSite({ ...f, site });
    await writeFile(
      resolve(f.landingDir, 'index.html'),
      '<!doctype html><h1>Changed landing only</h1><a href="app/">Open the app</a>',
    );
    const after = await buildSite({ ...f, site });
    expect(after.appBase).toBe('/team/field-notes/app/');
    expect(after.appHashes).toEqual(before.appHashes);
    expect(after.version).toBe(before.version);
    expect(await readFile(resolve(f.output, 'index.html'), 'utf8')).toContain(
      'Changed landing only',
    );
    await writeFile(resolve(f.output, 'private-export.json'), '{"private":true}');
    await expect(buildSite({ ...f, site })).rejects.toThrow(/Unexpected|stale/i);
    expect(await readFile(resolve(f.output, 'private-export.json'), 'utf8')).toContain('private');
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
}, 60_000);

test('the shared build assembles landing and app without changing signed app bytes', async () => {
  const f = await fixture();
  try {
    const site = resolveSite({});
    const result = await buildSite({ ...f, site });
    expect(await readFile(resolve(f.output, 'index.html'), 'utf8')).toBe(
      await readFile(resolve(f.landingDir, 'index.html'), 'utf8'),
    );
    const worker = await readFile(resolve(f.output, 'app/sw.js'), 'utf8');
    const metadata = JSON.parse(worker.match(/const CONFIG = (.+);/)![1]);
    expect(metadata.base).toBe(site.appBase);
    expect(result.version).toBe(metadata.version);
    for (const url of metadata.files) {
      expect(url.startsWith(site.appBase)).toBe(true);
      const bytes = await readFile(resolve(f.output, 'app', url.slice(site.appBase.length)));
      expect(metadata.integrity[url]).toBe(
        `sha256-${createHash('sha256').update(bytes).digest('base64')}`,
      );
    }
    for (const [name, hash] of Object.entries(result.appHashes)) {
      expect(
        createHash('sha256')
          .update(await readFile(resolve(f.output, 'app', name)))
          .digest('hex'),
      ).toBe(hash);
    }
    expect(await readFile(resolve(f.output, 'app/third-party-notices.txt'), 'utf8')).toBe(
      await readFile('public/third-party-notices.txt', 'utf8'),
    );
    const manifest = JSON.parse(
      await readFile(resolve(f.output, 'app/site-v1.webmanifest'), 'utf8'),
    );
    expect(
      new URL(manifest.start_url, `https://example.test${site.appBase}site-v1.webmanifest`)
        .pathname,
    ).toBe(site.appBase);
    expect(manifest.scope).toBe('./');
    expect(manifest.id).toBeUndefined();
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
}, 60_000);
