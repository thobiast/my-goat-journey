import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { resolveSite } from '../config/site.mjs';

async function hashes(directory) {
  const result = Object.create(null);
  async function collect(path, prefix = '') {
    const directory = await lstat(path);
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error(`Publication input must be a regular directory, not a link: ${path}`);
    const entries = await readdir(path, { withFileTypes: true });
    if (prefix && !entries.length) throw new Error(`Unexpected empty publication directory: ${prefix}`);
    for (const entry of entries) {
      const name = `${prefix}${entry.name}`;
      const target = resolve(path, entry.name);
      const stat = await lstat(target);
      if (stat.isSymbolicLink() || !stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1)) throw new Error(`Publication rejects links and nonregular files: ${name}`);
      if (stat.isDirectory()) await collect(target, `${name}/`);
      else result[name] = createHash('sha256').update(await readFile(target)).digest('hex');
    }
  }
  await collect(directory);
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

const publicFiles = [
  'site-v1.webmanifest', 'third-party-notices.txt',
  'branding/My_GOAT_Journey_Monochrome_ascent_emblem.png',
  'branding/My_GOAT_Journey_mountain_logo.png', 'branding/My_GOAT_Journey_app_icon.png',
  'icons/favicon-16-v1.png', 'icons/favicon-32-v1.png', 'icons/favicon-48-v1.png',
  'icons/favicon-v1.ico', 'icons/apple-touch-icon-180-v1.png',
  'icons/app-icon-192-v1.png', 'icons/app-icon-512-v1.png', 'icons/app-icon-maskable-512-v1.png',
];

export async function validatePublic(directory = 'public') {
  const names = Object.keys(await hashes(directory));
  for (const name of names) if (!publicFiles.includes(name)) throw new Error(`Unexpected public file: ${name}`);
  for (const name of publicFiles) if (!names.includes(name)) throw new Error(`Missing public file: ${name}`);
}

const landingPages = ['index.html', 'licenses.html'];

async function validateLanding(directory) {
  const names = Object.keys(await hashes(directory));
  if (!names.includes('index.html') || names.some(name => !landingPages.includes(name) && !/^assets\/[A-Za-z0-9_./-]+\.(css|js|png|jpe?g|svg|ico|webp)$/.test(name))) {
    throw new Error('Unexpected landing output: only index.html, licenses.html and reviewed assets are allowed');
  }
}

async function validateApp(directory, site) {
  const names = Object.keys(await hashes(directory));
  const assets = names.filter(name => /^assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(name));
  const expected = new Set(['index.html', 'sw.js', 'LICENSE', ...publicFiles, ...assets]);
  if (!assets.length) {
    throw new Error('Unexpected or stale app output');
  }
  if (names.some(name => !expected.has(name))) {
    throw new Error('Unexpected or stale app output');
  }
  if ([...expected].some(name => !names.includes(name))) {
    throw new Error('Unexpected or stale app output');
  }
  const worker = await readFile(resolve(directory, 'sw.js'), 'utf8');
  const encoded = worker.match(/const CONFIG = (.+);/)?.[1];
  if (!encoded) throw new Error('Incomplete worker metadata');
  const metadata = JSON.parse(encoded);
  const shellFiles = [...assets, 'LICENSE', 'third-party-notices.txt', 'index.html', 'site-v1.webmanifest', ...publicFiles.filter(name => name.startsWith('icons/')), 'branding/My_GOAT_Journey_mountain_logo.png'].sort();
  const declaredShellFiles = JSON.stringify(metadata.files);
  const expectedShellFiles = JSON.stringify(shellFiles.map(name => `${metadata.base}${name}`));
  if (declaredShellFiles !== expectedShellFiles) {
    throw new Error('Incomplete app-shell metadata');
  }
  const integrityFiles = JSON.stringify(Object.keys(metadata.integrity).sort());
  const sortedShellFiles = JSON.stringify([...metadata.files].sort());
  if (integrityFiles !== sortedShellFiles) {
    throw new Error('Incomplete app-shell metadata');
  }
  const digest = createHash('sha256').update(metadata.base).update('\0').update(worker.replace(encoded, '__APP_SHELL_CONFIG__'));
  if (site && metadata.base !== site.appBase) throw new Error('App base does not match SITE_PREFIX');
  for (const url of metadata.files) {
    if (!url.startsWith(metadata.base)) throw new Error('Unexpected app-shell URL');
    const name = url.slice(metadata.base.length);
    if (!expected.has(name)) throw new Error('Unexpected app-shell file');
    const bytes = await readFile(resolve(directory, name));
    const integrity = `sha256-${createHash('sha256').update(bytes).digest('base64')}`;
    if (metadata.integrity[url] !== integrity) throw new Error('Stale app integrity');
    digest.update('\0').update(name).update('\0').update(String(bytes.length)).update('\0').update(bytes);
  }
  if (metadata.version !== digest.digest('hex')) throw new Error('Stale worker version');
  if (assets.some(name => !metadata.files.includes(`${metadata.base}${name}`))) throw new Error('Unexpected stale app asset');
  return metadata;
}

async function validateArtifact(output) {
  const entries = await readdir(output);
  if (['index.html', 'assets', 'app'].some(name => !entries.includes(name)) || entries.some(name => !['index.html', 'licenses.html', 'assets', 'app'].includes(name))) throw new Error('Unexpected or stale site output; review and remove it before rebuilding');
  await validateApp(resolve(output, 'app'));
  const landing = Object.keys(await hashes(output)).filter(name => !name.startsWith('app/'));
  if (landing.some(name => !landingPages.includes(name) && !/^assets\/[A-Za-z0-9_./-]+\.(css|js|png|jpe?g|svg|ico|webp)$/.test(name))) throw new Error('Unexpected landing output');
}

export async function assembleSite({ appDir, landingDir, output, site = resolveSite() }) {
  const metadata = await validateApp(appDir, site);
  await validateLanding(landingDir);
  const appHashes = await hashes(appDir);
  await mkdir(output); // Never merge with an existing output tree.
  await cp(appDir, resolve(output, 'app'), { recursive: true });
  for (const page of (await readdir(landingDir)).filter(name => landingPages.includes(name))) {
    await cp(resolve(landingDir, page), resolve(output, page));
  }
  await cp(resolve(landingDir, 'assets'), resolve(output, 'assets'), { recursive: true });
  if (JSON.stringify(await hashes(resolve(output, 'app'))) !== JSON.stringify(appHashes)) throw new Error('App bytes changed during assembly');
  return { ...site, appHashes, version: metadata.version };
}

export async function buildSite({ output = 'dist', landingDir = 'landing', site = resolveSite() } = {}) {
  output = resolve(output);
  await validatePublic();
  await mkdir(dirname(output), { recursive: true });
  let existing = false;
  try { await lstat(output); existing = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) await validateArtifact(output);
  const stage = await mkdtemp(resolve(dirname(output), '.publication-'));
  try {
    const appDir = resolve(stage, 'compiled-app');
    await build({ base: site.appBase, build: { outDir: appDir, emptyOutDir: true }, logLevel: 'warn' });
    const assembled = resolve(stage, 'site');
    const result = await assembleSite({ appDir, landingDir: resolve(landingDir), output: assembled, site });
    if (existing) await rename(output, resolve(stage, 'previous-site'));
    try { await rename(assembled, output); }
    catch (error) {
      if (existing) await rename(resolve(stage, 'previous-site'), output);
      throw error;
    }
    return result;
  } finally { await rm(stage, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) throw new Error('Build paths come from SITE_PREFIX; do not pass Vite CLI overrides to the shared publication build.');
  const result = await buildSite();
  console.log(`Assembled dist: landing ${result.prefix}, app ${result.appBase}, version ${result.version}`);
}
