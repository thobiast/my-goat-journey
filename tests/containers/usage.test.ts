import { expect, test } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

for (const args of [[], ['help'], ['-h'], ['--help'], ['unknown-command']]) {
  test(`usage lists every command without changing exit 2 or invoking Podman: ${JSON.stringify(args)}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'goat-usage-'));
    const log = join(dir, 'calls');
    writeFileSync(log, '');
    writeFileSync(join(dir, 'podman'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALL_LOG"\nexit 90\n', {
      mode: 0o755,
    });
    try {
      const result = spawnSync('sh', [resolve('scripts/containers.sh'), ...args], {
        encoding: 'utf8',
        timeout: 10_000,
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CALL_LOG: log },
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(2);
      expect(result.stderr).toBe('');
      expect(result.stdout).toBe(
        'Usage: sh scripts/containers.sh {bootstrap|lock-update|dev|stop|format:check|format|lint|typecheck|test|build|audit|tool|e2e|build-prod|run-prod}\n',
      );
      expect(readFileSync(log, 'utf8')).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
