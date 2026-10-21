import { expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveSite } from '../../config/site.mjs';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'goat-source-binding-'));
  const log = join(dir, 'calls');
  writeFileSync(
    join(dir, 'podman'),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$CALL_LOG"
case "$1 $2" in
  'network exists'|'volume exists') exit 0 ;;
  'container exists') test ! -f "$CALL_LOG.removed" ;;
  'container inspect')
    case "$4" in
      *site.prefix*) printf '%s\\n' "$RESOLVED_PREFIX" ;;
      *Config.Labels*) printf '%s\\n' "\${MOCK_OWNER:-my-goat-journey}" ;;
      *NetworkSettings.Ports*) printf '%s\\n' 0.0.0.0:5173 ;;
      *Mounts*)
        if [ "\${SOURCE_INSPECT_EXIT:-0}" != 0 ]; then
          printf '%s\\n' 'Mount inspection failed' >&2; exit "$SOURCE_INSPECT_EXIT"
        fi
        printf '%s\\n' "$SOURCE_ROOT" ;;
      *Image*) printf '%s\\n' same-image ;;
      *) exit 90 ;;
    esac ;;
  'image inspect') printf '%s\\n' same-image ;;
  'port '*) printf '%s\\n' 0.0.0.0:5173 ;;
  'run '*) case "$*" in *config/site.mjs*prefix*) printf '%s\\n' "$RESOLVED_PREFIX" ;; esac ;;
  'rm '*) touch "$CALL_LOG.removed" ;;
  'stop '*|'start '*) exit 0 ;;
  *) exit 90 ;;
esac
`,
    { mode: 0o755 },
  );

  const run = (
    source: string,
    env: Record<string, string> = {},
    script = resolve('scripts/containers.sh'),
  ) => {
    const result = spawnSync('sh', [script, 'dev'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        CALL_LOG: log,
        RESOLVED_PREFIX: resolveSite().prefix,
        SOURCE_ROOT: source,
        ...env,
      },
    });
    return { ...result, calls: readFileSync(log, 'utf8') };
  };

  return { dir, run };
}

test('recreates a matching dev container when workspace binds a different checkout', () => {
  const f = fixture();
  const other = join(f.dir, 'other-checkout');
  mkdirSync(other);
  try {
    const result = f.run(other);
    expect(result.status).toBe(0);
    expect(result.calls).toContain('stop my-goat-journey-dev');
    expect(result.calls).toContain('rm my-goat-journey-dev');
    expect(result.calls).toContain('run -d --name my-goat-journey-dev');
    expect(result.calls).toContain(`${resolve('.')}:/workspace:z`);
    expect(result.calls).not.toContain('start my-goat-journey-dev');
    expect(result.calls).not.toMatch(/volume rm|prune|my-goat-journey-runtime/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('reuses the same checkout reached through a symlink without recreating it', () => {
  const f = fixture();
  const alias = join(f.dir, 'checkout alias');
  symlinkSync(resolve('.'), alias, 'dir');
  try {
    const result = f.run(alias);
    expect(result.status).toBe(0);
    expect(result.calls).toContain('start my-goat-journey-dev');
    expect(result.calls).not.toMatch(/\n(?:stop|rm) |run -d/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('reuses a canonical bind when the wrapper itself is entered through a checkout symlink', () => {
  const f = fixture();
  const alias = join(f.dir, 'checkout alias');
  symlinkSync(resolve('.'), alias, 'dir');
  try {
    const result = f.run(resolve('.'), {}, join(alias, 'scripts/containers.sh'));
    expect(result.status).toBe(0);
    expect(result.calls).toContain('start my-goat-journey-dev');
    expect(result.calls).not.toMatch(/\n(?:stop|rm) |run -d/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test.each(['', '/missing/old-checkout'])(
  'recreates dev when workspace source cannot identify this checkout: %j',
  (source) => {
    const f = fixture();
    try {
      const result = f.run(source);
      expect(result.status).toBe(0);
      expect(result.calls).toContain('rm my-goat-journey-dev');
      expect(result.calls).toContain('run -d --name my-goat-journey-dev');
      expect(result.calls).not.toContain('start my-goat-journey-dev');
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  },
);

test('mount inspection failure leaves the existing container untouched and returns the engine error', () => {
  const f = fixture();
  try {
    const result = f.run(resolve('.'), { SOURCE_INSPECT_EXIT: '125' });
    expect(result.status).toBe(125);
    expect(result.stderr).toContain('Mount inspection failed');
    expect(result.calls).not.toMatch(/\n(?:stop|rm|start) |run -d/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('a matching source never authorizes managing a non-project container', () => {
  const f = fixture();
  try {
    const result = f.run(resolve('.'), { MOCK_OWNER: 'another-project' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Refusing to manage non-project container');
    expect(result.calls).not.toMatch(/Mounts|\n(?:stop|rm|start) |run -d/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
