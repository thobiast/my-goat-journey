import { expect, test } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

test('replaces only a project-owned stale development container without removing volumes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'goat-wrapper-'));
  const log = join(dir, 'calls');
  writeFileSync(
    join(dir, 'podman'),
    `#!/bin/sh
printf '%s\n' "$*" >> "$CALL_LOG"
case "$*" in
  'container exists my-goat-journey-dev') test ! -f "$CALL_LOG.removed" ;;
  'rm my-goat-journey-dev') touch "$CALL_LOG.removed" ;;
  'container inspect --format {{.Image}} my-goat-journey-dev') printf 'old-image\n' ;;
  'image inspect --format {{.Id}} localhost/my-goat-journey-dev:local') printf 'new-image\n' ;;
  *NetworkSettings.Ports*) printf '0.0.0.0:5173\n' ;;
  *Mounts*) pwd -P ;;
  *Config.Labels*) printf '%s\n' "\${MOCK_OWNER:-my-goat-journey}" ;;
esac
`,
    { mode: 0o755 },
  );
  try {
    execFileSync('sh', [resolve('scripts/containers.sh'), 'dev'], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CALL_LOG: log },
    });
    const calls = readFileSync(log, 'utf8');
    expect(calls).toContain('rm my-goat-journey-dev');
    expect(calls).toContain('run -d --name my-goat-journey-dev');
    expect(calls).not.toContain('volume rm');
    expect(calls).not.toContain('prune');
    writeFileSync(log, '');
    const refusal = spawnSync('sh', [resolve('scripts/containers.sh'), 'stop'], {
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        CALL_LOG: log,
        MOCK_OWNER: 'other-project',
      },
    });
    expect(refusal.status).toBe(1);
    expect(readFileSync(log, 'utf8')).not.toContain('stop my-goat-journey');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
