import { createHash } from 'node:crypto';
import { resolveConfig } from 'vite';
import { buildProductionApp } from '../helpers/production-build';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { expect, onTestFinished, test } from 'vitest';

async function temporaryBuildOutput() {
  const output = await mkdtemp(resolve(tmpdir(), 'pwa-build-'));
  onTestFinished(() => rm(output, { recursive: true, force: true }));
  return output;
}

test('production build emits a base-aware precached shell service worker', async () => {
  const output = await temporaryBuildOutput();
  const parentNodeEnv = process.env.NODE_ENV;
  expect(parentNodeEnv).toBe('test');
  const environment = await buildProductionApp({ base: '/', output });
  expect(environment).toEqual({
    nodeEnv: 'production',
    mode: 'production',
    isProduction: true,
    PROD: true,
    DEV: false,
  });
  expect(process.env.NODE_ENV).toBe(parentNodeEnv);
  expect(existsSync(`${output}/sw.js`)).toBe(true);
  const source = readFileSync(`${output}/sw.js`, 'utf8');
  const config = JSON.parse(source.match(/const CONFIG = (.+);/)![1]);
  expect(config.base).toBe('/');
  expect(config.version).toMatch(/^[a-f0-9]{64}$/);
  expect(config.files).toContain('/index.html');
  for (const file of config.files) {
    expect(config.integrity[file]).toBe(
      `sha256-${createHash('sha256')
        .update(readFileSync(`${output}${file}`))
        .digest('base64')}`,
    );
  }
  expect(config.files).toContain('/LICENSE');
  expect(readFileSync(`${output}/LICENSE`)).toEqual(readFileSync('LICENSE'));
  expect(config.files).toContain('/third-party-notices.txt');
  expect(readFileSync(`${output}/third-party-notices.txt`)).toEqual(
    readFileSync('public/third-party-notices.txt'),
  );
  expect(config.files).toContain('/site-v1.webmanifest');
  expect(config.files).toContain('/icons/app-icon-192-v1.png');
  expect(config.files).toContain('/branding/My_GOAT_Journey_mountain_logo.png');
  expect(config.files.some((file: string) => /^\/assets\/.+\.js$/.test(file))).toBe(true);
  expect(config.files.some((file: string) => /^\/assets\/.+\.css$/.test(file))).toBe(true);
}, 30_000);

test('identical final shell bytes reproduce the worker, changed HTML changes its version', async () => {
  const reference = await temporaryBuildOutput();
  await buildProductionApp({ base: '/', output: reference });
  const repeat = await temporaryBuildOutput();
  await buildProductionApp({ base: '/', output: repeat });
  expect(readFileSync(`${repeat}/sw.js`, 'utf8')).toBe(readFileSync(`${reference}/sw.js`, 'utf8'));
  const changed = await temporaryBuildOutput();
  await buildProductionApp({ base: '/', output: changed, changedHtml: true });
  expect(readFileSync(`${changed}/index.html`, 'utf8')).not.toBe(
    readFileSync(`${reference}/index.html`, 'utf8'),
  );

  const metadata = (directory: string) =>
    JSON.parse(readFileSync(`${directory}/sw.js`, 'utf8').match(/const CONFIG = (.+);/)![1]);

  expect(metadata(changed).version).not.toBe(metadata(reference).version);
}, 60_000);

test('prefixed build precaches only its own base and unchanged manifest identity', async () => {
  const prefix = '/my-goat-journey/';
  const directory = await temporaryBuildOutput();
  await buildProductionApp({ base: prefix, output: directory });
  const metadata = JSON.parse(
    readFileSync(`${directory}/sw.js`, 'utf8').match(/const CONFIG = (.+);/)![1],
  );
  expect(metadata.base).toBe(prefix);
  expect(metadata.files).toContain(`${prefix}index.html`);
  for (const path of metadata.files) {
    expect(path.startsWith(prefix)).toBe(true);
    expect(existsSync(`${directory}/${path.slice(prefix.length)}`)).toBe(true);
  }
  expect(readFileSync(`${directory}/site-v1.webmanifest`, 'utf8')).toBe(
    readFileSync('public/site-v1.webmanifest', 'utf8'),
  );
  const manifest = JSON.parse(readFileSync(`${directory}/site-v1.webmanifest`, 'utf8'));
  expect(manifest.start_url).toBe('./');
  expect(manifest.scope).toBe('./');
  expect(manifest.id).toBeUndefined();
}, 30_000);

test('development does not enable the production worker generator', async () => {
  const config = await resolveConfig({}, 'serve');
  expect(config.plugins.some((plugin) => plugin.name === 'my-goat-journey-app-shell')).toBe(false);
});

test('runtime build context includes the existing public shell assets', () => {
  expect(readFileSync('.containerignore', 'utf8')).toContain('!public/**');
  expect(readFileSync('.containerignore', 'utf8')).toContain('!LICENSE');
});
