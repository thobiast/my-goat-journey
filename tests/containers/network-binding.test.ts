import { test, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveSite } from '../../config/site.mjs';

test.each([
  { command: 'dev', name: 'my-goat-journey-dev', hostPort: 5173, containerPort: 5173 },
  { command: 'run-prod', name: 'my-goat-journey-runtime', hostPort: 8088, containerPort: 8080 },
])(
  'recreates $name when its existing port binding differs from the authorized network bind',
  ({ command, name, hostPort, containerPort }) => {
    const dir = mkdtempSync(join(tmpdir(), 'goat-binding-'));
    const log = join(dir, 'calls');
    writeFileSync(
      join(dir, 'podman'),
      `#!/bin/sh
printf '%s\\n' "$*" >> "$CALL_LOG"
case "$1 $2" in
  'container exists') test ! -f "$CALL_LOG.removed" ;;
  'container inspect')
    case "$*" in
      *site.prefix*) printf '%s\\n' "$RESOLVED_PREFIX" ;;
      *Config.Labels*) printf 'my-goat-journey\\n' ;;
      *NetworkSettings.Ports*) printf '127.0.0.1:%s\\n' "$HOST_PORT" ;;
      *Mounts*) pwd -P ;;
      *Image*) printf 'same-image\\n' ;;
    esac ;;
  'image inspect')
    case "$*" in *site.prefix*) printf '%s\\n' "$RESOLVED_PREFIX" ;; *) printf 'same-image\\n' ;; esac ;;
  'run '* ) case "$*" in *config/site.mjs*prefix*) printf '%s\\n' "$RESOLVED_PREFIX" ;; esac ;;
  'port '* ) printf '127.0.0.1:%s\\n' "$HOST_PORT" ;;
  'rm '* ) touch "$CALL_LOG.removed" ;;
esac
`,
      { mode: 0o755 },
    );
    try {
      execFileSync('sh', [resolve('scripts/containers.sh'), command], {
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          CALL_LOG: log,
          HOST_PORT: String(hostPort),
          RESOLVED_PREFIX: resolveSite().prefix,
        },
      });
      const calls = readFileSync(log, 'utf8');
      expect(calls).toContain(`rm ${name}`);
      expect(calls).toContain(`run -d --name ${name}`);
      expect(calls).toContain(`-p 0.0.0.0:${hostPort}:${containerPort}`);
      expect(calls).not.toContain('volume rm');
      expect(calls).not.toContain('fii-cockpit');
      expect(calls).not.toContain('prune');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
