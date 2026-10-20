import { expect, test } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveSite } from '../../config/site.mjs';

const resources = [
  { kind: 'network', name: 'my-goat-journey', key: 'NETWORK' },
  { kind: 'volume', name: 'my-goat-journey-deps', key: 'DEPS' },
  { kind: 'volume', name: 'my-goat-journey-cache', key: 'CACHE' },
];

function runFixture(command = 'typecheck', env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'goat-resources-'));
  const log = join(dir, 'calls');
  writeFileSync(log, '');
  // Every Podman operation is simulated, including unexpected calls.
  writeFileSync(
    join(dir, 'podman'),
    String.raw`#!/bin/sh
printf '%s\n' "$*" >> "$CALL_LOG"
case "$1 $2" in
  'network exists'|'volume exists')
    case "$3" in
      my-goat-journey) code=$NETWORK_EXISTS ;;
      my-goat-journey-deps) code=$DEPS_EXISTS ;;
      my-goat-journey-cache) code=$CACHE_EXISTS ;;
      *) exit 90 ;;
    esac
    if [ "$code" -gt 1 ]; then printf 'Existence engine failure: %s\n' "$3" >&2; fi
    exit "$code" ;;
  'network create'|'volume create')
    if [ "$3" = "$FAIL_CREATE" ]; then
      printf 'Creation engine failure: %s\n' "$3" >&2
      exit 125
    fi ;;
  'container exists') exit 1 ;;
  'image inspect') printf '%s\n' "$RESOLVED_PREFIX" ;;
  'run '*)
    case "$*" in
      *config/site.mjs*prefix*) printf '%s\n' "$RESOLVED_PREFIX" ;;
      'run -d --name '*) exit 0 ;;
      *' npm run typecheck') exit 0 ;;
      *) exit 90 ;;
    esac ;;
  *) exit 90 ;;
esac
`,
    { mode: 0o755 },
  );
  try {
    const result = spawnSync('sh', [resolve('scripts/containers.sh'), command], {
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        CALL_LOG: log,
        RESOLVED_PREFIX: resolveSite().prefix,
        NETWORK_EXISTS: '0',
        DEPS_EXISTS: '0',
        CACHE_EXISTS: '0',
        FAIL_CREATE: '',
        ...env,
      },
    });
    expect(result.error).toBeUndefined();
    const calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
    return { ...result, calls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const command of ['typecheck', 'dev', 'run-prod']) {
  for (const resource of resources) {
    test.each([2, 125])(
      `${command} aborts on ${resource.name} existence error %i before creation or dependent work`,
      (code) => {
        const result = runFixture(command, { [`${resource.key}_EXISTS`]: String(code) });
        expect(result.status).toBe(code);
        expect(result.stderr).toContain(`Existence engine failure: ${resource.name}`);
        expect(result.stderr).toContain(
          `Unable to check project ${resource.kind}: ${resource.name} (Podman exit ${code})`,
        );
        const index = resources.indexOf(resource);
        expect(result.calls).toEqual(
          resources.slice(0, index + 1).map((item) => `${item.kind} exists ${item.name}`),
        );
      },
    );
  }
}

for (const network of [0, 1]) {
  for (const deps of [0, 1]) {
    for (const cache of [0, 1]) {
      test(`resources creates only genuinely absent resources: network=${network} deps=${deps} cache=${cache}`, () => {
        const result = runFixture('typecheck', {
          NETWORK_EXISTS: String(network),
          DEPS_EXISTS: String(deps),
          CACHE_EXISTS: String(cache),
        });
        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
        const statuses = [network, deps, cache];
        const expected = resources.flatMap((item, index) => [
          `${item.kind} exists ${item.name}`,
          ...(statuses[index] === 1 ? [`${item.kind} create ${item.name}`] : []),
        ]);
        expect(result.calls.slice(0, -1)).toEqual(expected);
        expect(result.calls.at(-1)).toContain(' npm run typecheck');
        expect(result.calls.at(-1)).toContain('localhost/my-goat-journey-dev:local');
      });
    }
  }
}

for (const resource of resources) {
  test(`resources preserves creation failure for absent ${resource.name} and stops dependent work`, () => {
    const result = runFixture('typecheck', {
      [`${resource.key}_EXISTS`]: '1',
      FAIL_CREATE: resource.name,
    });
    expect(result.status).toBe(125);
    expect(result.stderr).toContain(`Creation engine failure: ${resource.name}`);
    const index = resources.indexOf(resource);
    expect(result.calls).toEqual([
      ...resources.slice(0, index + 1).map((item) => `${item.kind} exists ${item.name}`),
      `${resource.kind} create ${resource.name}`,
    ]);
  });
}
