import { test, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

test.each([
  { state: 'exited', exit: 0 },
  { state: 'running', exit: 125 },
])('checks actual stop state after a Podman cleanup error: $state', ({ state, exit }) => {
  const dir = mkdtempSync(join(tmpdir(), 'goat-stop-'));
  writeFileSync(
    join(dir, 'podman'),
    `#!/bin/sh
case "$*" in
  'container exists my-goat-journey-runtime') exit 1 ;;
  *Config.Labels*) printf 'my-goat-journey\n' ;;
  'stop my-goat-journey-dev') printf 'Network cleanup error\n' >&2; exit 125 ;;
  *State.Status*) printf '%s\n' "$TARGET_STATE" ;;
esac
`,
    { mode: 0o755 },
  );
  try {
    const result = spawnSync('sh', [resolve('scripts/containers.sh'), 'stop'], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TARGET_STATE: state },
    });
    expect(result.status).toBe(exit);
    expect(result.stderr.toString()).toContain('Network cleanup error');
    if (state === 'exited') expect(result.stderr.toString()).toContain('Confirmed stopped');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
