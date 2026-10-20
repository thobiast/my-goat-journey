// Test-only process entry point; NODE_ENV is supplied before these imports load.
import { build, resolveConfig } from 'vite';
import { buildSite } from '../../scripts/build-site.mjs';

const { kind, output, landingDir, site, base, changedHtml } = JSON.parse(process.argv[2]);
const environment = config => ({
  nodeEnv: process.env.NODE_ENV,
  mode: config.mode,
  isProduction: config.isProduction,
  PROD: config.env.PROD,
  DEV: config.env.DEV,
});

if (kind === 'site') {
  // Resolve the shared Vite config in the same fresh process as assembly.
  const config = await resolveConfig({ base: site.appBase }, 'build', 'production');
  const result = await buildSite({ output, landingDir, site });
  console.log(JSON.stringify({ ...result, environment: environment(config) }));
} else if (kind === 'app') {
  let resolvedEnvironment;
  await build({
    base,
    build: { outDir: output, emptyOutDir: true },
    logLevel: 'warn',
    plugins: [{
      name: 'test-production-environment',
      configResolved(config) { resolvedEnvironment = environment(config); },
      transformIndexHtml(html) { return changedHtml ? `${html}\n<!-- changed final shell bytes -->` : html; },
    }],
  });
  console.log(JSON.stringify(resolvedEnvironment));
} else {
  throw new Error(`Unknown production fixture kind: ${kind}`);
}
