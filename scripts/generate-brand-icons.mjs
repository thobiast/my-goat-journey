// Run in the existing Playwright container; no new image/library dependency.
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const sourceDir = 'public/branding';
const outputDir = 'public/icons';
mkdirSync(outputDir, { recursive: true });
mkdirSync('artifacts/brand-icons', { recursive: true });
const sources = Object.fromEntries(['app_icon', 'Monochrome_ascent_emblem', 'mountain_logo'].map(name => {
  const filename = `My_GOAT_Journey_${name}.png`;
  const bytes = readFileSync(`${sourceDir}/${filename}`);
  return [name, { filename, sha256: createHash('sha256').update(bytes).digest('hex'), data: `data:image/png;base64,${bytes.toString('base64')}` }];
}));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const output = await page.evaluate(async sources => {
    const load = async data => { const image = new Image(); image.src = data; await image.decode(); return image; };
    const color = await load(sources.app_icon.data);
    const mono = await load(sources.Monochrome_ascent_emblem.data);
    const canvas = document.createElement('canvas'); canvas.width = color.width; canvas.height = color.height;
    const context = canvas.getContext('2d'); context.drawImage(color, 0, 0);
    const pixels = context.getImageData(0, 0, color.width, color.height).data;
    // Ignore the supplied almost-white paper texture, not any colored artwork.
    let radius = 0;
    for (let y = 0; y < color.height; y++) for (let x = 0; x < color.width; x++) {
      const i = (y * color.width + x) * 4;
      if (Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 235) radius = Math.max(radius, Math.hypot(x + .5 - color.width / 2, y + .5 - color.height / 2));
    }
    // Fit ALL colored artwork in radius .38, inside the .40 maskable safe circle.
    // Uniform scaling only; retain the full original square without cropping.
    const maskableDrawSize = Math.floor(512 * .38 / radius * color.width);
    const specs = [
      ['app-icon-192-v1.png', color, 192, 192],
      ['app-icon-512-v1.png', color, 512, 512],
      ['app-icon-maskable-512-v1.png', color, 512, maskableDrawSize],
      ['apple-touch-icon-180-v1.png', color, 180, 180],
      ['favicon-16-v1.png', mono, 16, 16],
      ['favicon-32-v1.png', mono, 32, 32],
      ['favicon-48-v1.png', mono, 48, 48],
    ];
    const images = specs.map(([filename, image, size, drawSize]) => {
      const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
      const context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, size, size);
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
      const offset = (size - drawSize) / 2;
      context.drawImage(image, offset, offset, drawSize, drawSize);
      return { filename, size, drawSize, data: canvas.toDataURL('image/png').split(',')[1] };
    });
    return { images, sourceArtworkRadius: radius, maskableDrawSize };
  }, sources);
  const inventory = output.images.map(({ filename, size, drawSize, data }) => {
    const bytes = Buffer.from(data, 'base64'); writeFileSync(`${outputDir}/${filename}`, bytes);
    return { filename, size, drawSize, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
  // ICO container embeds the exact generated PNGs; no independent redrawing.
  const icoImages = output.images.filter(image => image.filename.startsWith('favicon-'));
  const header = Buffer.alloc(6 + icoImages.length * 16); header.writeUInt16LE(1, 2); header.writeUInt16LE(icoImages.length, 4);
  let offset = header.length;
  const payloads = icoImages.map((image, index) => {
    const bytes = Buffer.from(image.data, 'base64'); const entry = 6 + index * 16;
    header[entry] = image.size; header[entry + 1] = image.size;
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(bytes.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
    offset += bytes.length; return bytes;
  });
  const ico = Buffer.concat([header, ...payloads]); writeFileSync(`${outputDir}/favicon-v1.ico`, ico);
  inventory.push({ filename: 'favicon-v1.ico', sizes: icoImages.map(image => image.size), bytes: ico.length, sha256: createHash('sha256').update(ico).digest('hex') });
  const report = { renderer: await browser.version(), sources: Object.fromEntries(Object.entries(sources).map(([key, { data, ...metadata }]) => [key, metadata])), sourceArtworkRadius: output.sourceArtworkRadius, maskableDrawSize: output.maskableDrawSize, safeCircleRadius: 204.8, inventory };
  writeFileSync('artifacts/brand-icons/generation.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
