import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { resolveSite } from '../../config/site.mjs';

export interface BuildEnvironment {
  nodeEnv: string;
  mode: string;
  isProduction: boolean;
  PROD: boolean;
  DEV: boolean;
}

type Site = ReturnType<typeof resolveSite>;
const execute = promisify(execFile);
const runner = fileURLToPath(new URL('./production-build-runner.mjs', import.meta.url));

async function runProductionBuild(options: object) {
  // Set this at process creation, before Vite or any plugin can be imported.
  // Never change the parent Vitest environment, even while builds overlap.
  try {
    const { stdout, stderr } = await execute(process.execPath, [runner, JSON.stringify(options)], {
      env: { ...process.env, NODE_ENV: 'production' },
      timeout: 50_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (stderr) process.stderr.write(stderr);
    return JSON.parse(stdout);
  } catch (error) {
    const failure = error as Error & {
      code?: unknown;
      signal?: string;
      stdout?: string;
      stderr?: string;
    };
    throw new Error(
      `Production fixture build failed (code ${failure.code}, signal ${failure.signal}): ${failure.message}\n${failure.stdout ?? ''}\n${failure.stderr ?? ''}`,
      { cause: error },
    );
  }
}

export async function buildProductionSite(options: {
  output: string;
  landingDir: string;
  site: Site;
}): Promise<
  Site & {
    appHashes: Record<string, string>;
    version: string;
    environment: BuildEnvironment;
  }
> {
  return runProductionBuild({ kind: 'site', ...options });
}

export async function buildProductionApp(options: {
  output: string;
  base: string;
  changedHtml?: boolean;
}): Promise<BuildEnvironment> {
  return runProductionBuild({ kind: 'app', ...options });
}
