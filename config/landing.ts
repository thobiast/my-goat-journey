import { readFile, lstat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { resolveSite } from './site.mjs';

// Only presentation entry/assets and the license are intercepted. Vite owns the app,
// module graph and HMR, with no second server or transformed landing copy.
export function landingDevelopment(): Plugin {
  const { prefix, appBase } = resolveSite();
  return {
    name: 'my-goat-journey-landing',
    apply: 'serve',
    // Vite's development HTML rewrite runs before its %BASE_URL% substitution
    // and otherwise prepends the base twice to public-asset links. Keep source
    // and production output unchanged; let that rewrite resolve relative links.
    transformIndexHtml: { order: 'pre', handler: (html) => html.replaceAll('%BASE_URL%', './') },
    configureServer(server) {
      const landing = resolve(server.config.root, 'landing');
      server.middlewares.use(async (req, res, next) => {
        const pathname = req.url?.split('?')[0] ?? '';
        if (prefix !== '/' && pathname === prefix.slice(0, -1)) {
          res.statusCode = 302;
          res.setHeader('Location', prefix);
          res.end();
          return;
        }
        // Extensionless LICENSE would otherwise enter Vite's JS import analysis.
        // Serve the canonical bytes directly; no generated source copy or worker.
        if (pathname === `${appBase}LICENSE`) {
          try {
            const bytes = await readFile(resolve(server.config.root, 'LICENSE'));
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            res.end(bytes);
          } catch {
            res.statusCode = 404;
            res.end();
          }
          return;
        }
        let file: string;
        if (pathname === prefix || pathname === `${prefix}index.html`) file = 'index.html';
        else if (pathname === `${prefix}licenses.html`) file = 'licenses.html';
        else if (pathname.startsWith(`${prefix}assets/`)) file = pathname.slice(prefix.length);
        else {
          next();
          return;
        }
        if (
          !/^(index\.html|licenses\.html|assets\/[A-Za-z0-9_./-]+)$/.test(file) ||
          file.split('/').some((part) => part === '..' || part === '.')
        ) {
          res.statusCode = 404;
          res.end();
          return;
        }
        try {
          const target = resolve(landing, file);
          if (!(await lstat(target)).isFile()) throw new Error('Not a regular file');
          const types: Record<string, string> = {
            '.html': 'text/html; charset=utf-8',
            '.css': 'text/css',
            '.js': 'text/javascript',
            '.png': 'image/png',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon',
            '.jpg': 'image/jpeg',
            '.webp': 'image/webp',
          };
          res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(await readFile(target));
        } catch {
          res.statusCode = 404;
          res.end();
        }
      });
    },
  };
}
