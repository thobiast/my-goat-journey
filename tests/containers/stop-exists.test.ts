import { expect, test } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function stopFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'goat-stop-exists-'));
  const log = join(dir, 'calls');
  writeFileSync(
    join(dir, 'podman'),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$CALL_LOG"
case "$*" in
  'container exists my-goat-journey-dev')
    if [ "$DEV_EXISTS" -gt 1 ]; then printf '%s\\n' 'Dev engine failure' >&2; fi
    exit "$DEV_EXISTS" ;;
  'container exists my-goat-journey-runtime')
    if [ "$RUNTIME_EXISTS" -gt 1 ]; then printf '%s\\n' 'Runtime engine failure' >&2; fi
    exit "$RUNTIME_EXISTS" ;;
  *Config.Labels*) printf '%s\\n' "\${MOCK_OWNER:-my-goat-journey}" ;;
  'stop my-goat-journey-dev'|'stop my-goat-journey-runtime') exit 0 ;;
  *) exit 90 ;;
esac
`,
    { mode: 0o755 },
  );

  const run = (dev: number, runtime: number, env: Record<string, string> = {}) => {
    const result = spawnSync('sh', [resolve('scripts/containers.sh'), 'stop'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        CALL_LOG: log,
        DEV_EXISTS: String(dev),
        RUNTIME_EXISTS: String(runtime),
        ...env,
      },
    });
    return { ...result, calls: readFileSync(log, 'utf8') };
  };

  return { dir, run };
}

test.each([
  { dev: 125, runtime: 1, stopped: [], errors: ['Dev engine failure'] },
  { dev: 1, runtime: 125, stopped: [], errors: ['Runtime engine failure'] },
  { dev: 125, runtime: 0, stopped: ['my-goat-journey-runtime'], errors: ['Dev engine failure'] },
  { dev: 0, runtime: 125, stopped: ['my-goat-journey-dev'], errors: ['Runtime engine failure'] },
  { dev: 125, runtime: 125, stopped: [], errors: ['Dev engine failure', 'Runtime engine failure'] },
])(
  'stop propagates exists errors while checking both named containers: dev=$dev runtime=$runtime',
  ({ dev, runtime, stopped, errors }) => {
    const f = stopFixture();
    try {
      const result = f.run(dev, runtime);
      expect(result.status).toBe(125);
      for (const error of errors) expect(result.stderr).toContain(error);
      expect(result.stderr).toContain('Unable to check project container');
      const calls = result.calls.trim().split('\n');
      expect(calls.filter((line) => line.startsWith('container exists '))).toEqual([
        'container exists my-goat-journey-dev',
        'container exists my-goat-journey-runtime',
      ]);
      expect(calls.filter((line) => line.startsWith('stop '))).toEqual(
        stopped.map((name) => `stop ${name}`),
      );
      if (!stopped.length) expect(result.calls).not.toContain('container inspect');
      expect(result.calls).not.toMatch(/volume rm|prune|\nrm /);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  },
);

test.each([
  { dev: 1, runtime: 1, stopped: [] },
  { dev: 0, runtime: 1, stopped: ['my-goat-journey-dev'] },
  { dev: 1, runtime: 0, stopped: ['my-goat-journey-runtime'] },
  { dev: 0, runtime: 0, stopped: ['my-goat-journey-dev', 'my-goat-journey-runtime'] },
])(
  'stop treats only status 1 as absence: dev=$dev runtime=$runtime',
  ({ dev, runtime, stopped }) => {
    const f = stopFixture();
    try {
      const result = f.run(dev, runtime);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      const calls = result.calls.trim().split('\n');
      expect(calls.filter((line) => line.startsWith('stop '))).toEqual(
        stopped.map((name) => `stop ${name}`),
      );
      expect(calls.filter((line) => line.startsWith('container inspect '))).toHaveLength(
        stopped.length,
      );
      expect(result.calls).not.toMatch(/volume rm|prune|\nrm /);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  },
);
