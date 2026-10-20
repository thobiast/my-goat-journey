import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig, type Plugin, type ResolvedConfig } from 'vite';
import { resolveSite } from './config/site.mjs';
import { landingDevelopment } from './config/landing';

// Run after Vite writes HTML, hashed chunks and public files: the version describes
// shipped bytes, not a timestamp, source revision or a pre-transform HTML shell.
function appShell(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'my-goat-journey-app-shell',
    apply: 'build',
    configResolved(value) {
      config = value;
    },
    async closeBundle() {
      if (!config.build.write) return;
      const base = config.base;
      if (
        !base.startsWith('/') ||
        !base.endsWith('/') ||
        base.includes('?') ||
        base.includes('#')
      ) {
        throw new Error('App-shell builds require an absolute pathname base ending in /');
      }
      const output = resolve(config.root, config.build.outDir);
      // Derive the distributed license from the sole canonical text before hashing.
      await writeFile(resolve(output, 'LICENSE'), await readFile(resolve(config.root, 'LICENSE')));
      const files: string[] = [];

      async function collect(directory: string, prefix = ''): Promise<void> {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const name = `${prefix}${entry.name}`;
          if (entry.isDirectory()) await collect(resolve(directory, entry.name), `${name}/`);
          else if (
            name === 'LICENSE' ||
            name === 'third-party-notices.txt' ||
            name === 'index.html' ||
            name === 'site-v1.webmanifest' ||
            name.startsWith('assets/') ||
            name.startsWith('icons/') ||
            name === 'branding/My_GOAT_Journey_mountain_logo.png'
          )
            files.push(name);
        }
      }

      await collect(output);
      files.sort();
      const source = await readFile(resolve(config.root, 'src/pwa/service-worker.js'), 'utf8');
      const digest = createHash('sha256').update(base).update('\0').update(source);
      const integrity: Record<string, string> = {};
      for (const file of files) {
        const bytes = await readFile(resolve(output, file));
        integrity[`${base}${file}`] =
          `sha256-${createHash('sha256').update(bytes).digest('base64')}`;
        digest
          .update('\0')
          .update(file)
          .update('\0')
          .update(String(bytes.length))
          .update('\0')
          .update(bytes);
      }
      const metadata = {
        base,
        version: digest.digest('hex'),
        files: files.map((file) => `${base}${file}`),
        integrity,
      };
      await writeFile(
        resolve(output, 'sw.js'),
        source.replace('__APP_SHELL_CONFIG__', JSON.stringify(metadata)),
      );
    },
  };
}

export default defineConfig({
  base: resolveSite().appBase,
  plugins: [landingDevelopment(), appShell()],
  server: {
    host: '0.0.0.0',
    allowedHosts: ['my-goat-journey-dev'],
    watch: { ignored: ['**/artifacts/**', '**/dist/**'] },
  },
});
