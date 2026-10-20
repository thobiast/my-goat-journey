import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolveSite } from '../config/site.mjs';

const { appBase } = resolveSite();

// Full Chromium's new headless mode includes browser-level favicon/manifest handling.
// Playwright's default headless shell does not fetch tab favicons.
test.use({ channel: 'chromium' });

// Isolated contexts only: no normal diary, cache or storage is cleared.
async function verifyIcons(
  page: Page,
  request: APIRequestContext,
  url: string,
  expectedPath: string,
) {
  const faviconResponses: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/icons/favicon-')) faviconResponses.push(response.url());
  });
  await page.goto(url);
  await expect(page).toHaveTitle('My GOAT Journey');
  const manifestLink = page.locator('link[rel="manifest"]');
  await expect(manifestLink).toHaveCount(1);
  const manifestURL = await manifestLink.evaluate((el: HTMLLinkElement) => el.href);
  const response = await request.get(manifestURL);
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toContain('application/manifest+json');
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    name: 'My GOAT Journey',
    short_name: 'My GOAT Journey',
    start_url: './',
    scope: './',
    display: 'standalone',
  });
  expect(manifest.icons).toHaveLength(3);
  expect(
    manifest.icons.map((icon: { sizes: string; purpose: string }) => [icon.sizes, icon.purpose]),
  ).toEqual([
    ['192x192', 'any'],
    ['512x512', 'any'],
    ['512x512', 'maskable'],
  ]);
  const links = await page
    .locator('link[rel="icon"], link[rel="apple-touch-icon"]')
    .evaluateAll((els: HTMLLinkElement[]) =>
      els.map((el) => ({ url: el.href, sizes: el.sizes.value, type: el.type, rel: el.rel })),
    );
  expect(links.filter((link) => link.rel === 'apple-touch-icon')).toEqual([
    expect.objectContaining({ sizes: '180x180', type: 'image/png' }),
  ]);
  expect(
    links
      .filter((link) => link.type === 'image/png')
      .map((link) => link.sizes)
      .sort(),
  ).toEqual(['16x16', '180x180', '32x32', '48x48']);
  // Capture native favicon requests BEFORE loading images for pixel verification.
  await expect.poll(() => faviconResponses.length).toBeGreaterThan(0);
  const automaticFaviconResponses = [...faviconResponses];
  const assets = [
    ...manifest.icons.map((icon: { src: string; sizes: string; type: string }) => ({
      url: new URL(icon.src, manifestURL).href,
      sizes: icon.sizes,
      type: icon.type,
    })),
    ...links,
  ];
  const decodedAssets: {
    url: string;
    sizes: string;
    opaque: boolean;
    maxArtworkRadius: number;
  }[] = [];
  for (const asset of assets) {
    expect(new URL(asset.url).origin).toBe(new URL(page.url()).origin);
    const assetResponse = await request.get(asset.url);
    expect(assetResponse.ok(), asset.url).toBe(true);
    expect(assetResponse.headers()['content-type'], asset.url).toContain(asset.type);
    if (asset.type !== 'image/png') continue;
    const result = await page.evaluate(async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, image.width, image.height).data;
      let opaque = true;
      let maxArtworkRadius = 0;
      for (let y = 0; y < image.height; y++)
        for (let x = 0; x < image.width; x++) {
          const offset = (y * image.width + x) * 4;
          if (pixels[offset + 3] !== 255) opaque = false;
          if (Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2]) < 235)
            maxArtworkRadius = Math.max(
              maxArtworkRadius,
              Math.hypot(x + 0.5 - image.width / 2, y + 0.5 - image.height / 2),
            );
        }
      return { sizes: `${image.width}x${image.height}`, opaque, maxArtworkRadius };
    }, asset.url);
    decodedAssets.push({ url: asset.url, ...result });
    expect(result.sizes, asset.url).toBe(asset.sizes);
    expect(result.opaque, asset.url).toBe(true);
    if (asset.url.includes('maskable'))
      expect(result.maxArtworkRadius).toBeLessThanOrEqual(512 * 0.4);
  }
  for (const field of ['start_url', 'scope'])
    expect(new URL(manifest[field], manifestURL).pathname).toBe(expectedPath);
  const client = await page.context().newCDPSession(page);
  const nativeManifest = await client.send('Page.getAppManifest');
  expect(nativeManifest.errors).toEqual([]);
  expect(nativeManifest.data).toBeTruthy();
  expect(nativeManifest.manifest?.id).toBeTruthy();
  expect(new URL(nativeManifest.manifest?.id ?? '').pathname).toBe(expectedPath);
  expect(JSON.parse(nativeManifest.data ?? '').icons).toEqual(manifest.icons);
  const installability = await client.send('Page.getInstallabilityErrors');
  const nativeIcons = await client.send('Page.getManifestIcons');
  const nativeIcon = nativeIcons.primaryIcon
    ? Buffer.from(nativeIcons.primaryIcon, 'base64')
    : null;
  expect(nativeIcon?.length ?? 0).toBeGreaterThan(0);
  const auditName =
    expectedPath === '/'
      ? new URL(page.url()).port === '8080'
        ? 'runtime'
        : 'development'
      : 'prefixed';
  mkdirSync('artifacts/brand-icons', { recursive: true });
  writeFileSync(
    `artifacts/brand-icons/${auditName}-browser-audit.json`,
    JSON.stringify(
      {
        url: page.url(),
        manifestURL,
        nativeManifest,
        installability,
        automaticFaviconResponses,
        decodedAssets,
        primaryIconBytes: nativeIcon?.length ?? 0,
      },
      null,
      2,
    ),
  );
  if (nativeIcon)
    writeFileSync(`artifacts/brand-icons/${auditName}-chromium-primary-icon.png`, nativeIcon);
}

test('document exposes local installation icons with decodable declared sizes', async ({
  page,
  request,
}) => {
  await verifyIcons(page, request, './', appBase);
});

test('prefixed production build keeps manifest identity and every icon under its deployment base', async ({
  page,
  request,
}) => {
  const server = spawn(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      '4177',
      '--strictPort',
      '--base',
      appBase,
      '--outDir',
      'dist/app',
    ],
    { stdio: 'pipe' },
  );
  let output = '';
  server.stdout.on('data', (chunk) => {
    output += chunk;
  });
  server.stderr.on('data', (chunk) => {
    output += chunk;
  });
  try {
    const url = `http://127.0.0.1:4177${appBase}`;
    await expect
      .poll(async () => {
        try {
          return (await request.get(url)).status();
        } catch {
          return 0;
        }
      })
      .toBe(200);
    await verifyIcons(page, request, url, appBase);
  } finally {
    server.kill('SIGTERM');
    writeFileSync('artifacts/brand-icons/prefixed-preview-server.txt', output);
  }
});
