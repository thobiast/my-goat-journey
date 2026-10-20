import { expect, test } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveSite } from '../../config/site.mjs';

const modes = [
  { command: 'dev', name: 'my-goat-journey-dev', hostPort: '5173', containerPort: '5173' },
  { command: 'run-prod', name: 'my-goat-journey-runtime', hostPort: '8088', containerPort: '8080' },
];

function runFixture(mode: (typeof modes)[number], env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'goat-refresh-safety-'));
  const log = join(dir, 'calls');
  // This executable never delegates to an engine, including on unexpected calls.
  // Model both the old port command and structured inspection to prove RED first.
  writeFileSync(
    join(dir, 'podman'),
    String.raw`#!/bin/sh
printf '%s\n' "$*" >> "$CALL_LOG"
port_binding() {
  if [ "$PORT_EXIT" != 0 ]; then
    printf '%s\n' 'Port inspection engine failure' >&2
    exit "$PORT_EXIT"
  fi
  case "$BINDING" in
    matching) printf '0.0.0.0:%s\n' "$HOST_PORT" ;;
    different) printf '127.0.0.1:%s\n' "$HOST_PORT" ;;
    missing) : ;;
    *) exit 90 ;;
  esac
}
case "$1 $2" in
  'network exists'|'volume exists') exit 0 ;;
  'container exists')
    count=0
    if [ -f "$CALL_LOG.exists-count" ]; then read -r count < "$CALL_LOG.exists-count"; fi
    count=$((count + 1))
    printf '%s\n' "$count" > "$CALL_LOG.exists-count"
    if [ "$count" = 1 ] && [ "$INITIAL_EXISTS_EXIT" != 0 ]; then
      printf '%s\n' 'Temporary container-exists engine failure' >&2
      exit "$INITIAL_EXISTS_EXIT"
    fi
    test "$ABSENT" != 1 && test ! -f "$CALL_LOG.removed" ;;
  'container inspect')
    case "$4" in
      *site.prefix*) printf '%s\n' "$RESOLVED_PREFIX" ;;
      *Config.Labels*) printf '%s\n' "$MOCK_OWNER" ;;
      *NetworkSettings.Ports*)
        expected='{{range (index .NetworkSettings.Ports "'"$CONTAINER_PORT"'/tcp")}}{{.HostIP}}:{{.HostPort}}{{println}}{{end}}'
        [ "$4" = "$expected" ] || exit 90
        port_binding ;;
      *Mounts*) pwd -P ;;
      '{{.Image}}') printf '%s\n' same-image ;;
      *) exit 90 ;;
    esac ;;
  'image inspect')
    case "$4" in
      *site.prefix*) printf '%s\n' "$RESOLVED_PREFIX" ;;
      '{{.Id}}') printf '%s\n' same-image ;;
      *) exit 90 ;;
    esac ;;
  'port '*) port_binding ;;
  'run '*)
    case "$*" in
      *config/site.mjs*prefix*) printf '%s\n' "$RESOLVED_PREFIX" ;;
      'run -d --name '*) exit 0 ;;
      *) exit 90 ;;
    esac ;;
  'rm '*) touch "$CALL_LOG.removed" ;;
  'stop '*|'start '*) exit 0 ;;
  *) exit 90 ;;
esac
`,
    { mode: 0o755 },
  );
  try {
    const result = spawnSync('sh', [resolve('scripts/containers.sh'), mode.command], {
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        CALL_LOG: log,
        RESOLVED_PREFIX: resolveSite().prefix,
        MOCK_OWNER: 'my-goat-journey',
        HOST_PORT: mode.hostPort,
        CONTAINER_PORT: mode.containerPort,
        PORT_EXIT: '0',
        BINDING: 'matching',
        ABSENT: '0',
        INITIAL_EXISTS_EXIT: '0',
        ...env,
      },
    });
    expect(result.error).toBeUndefined();
    const calls = readFileSync(log, 'utf8').trim().split('\n');
    const operations = calls.filter((call) => /^(?:stop|rm|start) |^run -d /.test(call));
    expect(calls.join('\n')).not.toMatch(/volume rm|prune/);
    return { ...result, calls, operations };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const mode of modes) {
  test.each([
    { owner: 'my-goat-journey', exit: '125' },
    { owner: 'another-project', exit: '125' },
    { owner: 'my-goat-journey', exit: '2' },
    { owner: 'another-project', exit: '2' },
  ])(
    `${mode.command} aborts the first exists error $exit for $owner even if the next check would succeed`,
    ({ owner, exit }) => {
      const result = runFixture(mode, { MOCK_OWNER: owner, INITIAL_EXISTS_EXIT: exit });
      expect(result.status).toBe(Number(exit));
      expect(result.stderr).toContain('Temporary container-exists engine failure');
      expect(result.stderr).toContain(
        `Unable to check project container: ${mode.name} (Podman exit ${exit})`,
      );
      expect(result.operations).toEqual([]);
      expect(result.calls.filter((call) => call.startsWith('container exists '))).toEqual([
        `container exists ${mode.name}`,
      ]);
      expect(result.calls.some((call) => call.startsWith('container inspect '))).toBe(false);
    },
  );

  test.each(['1', '125'])(
    `${mode.command} aborts on port inspection exit %s without touching the container`,
    (portExit) => {
      const result = runFixture(mode, { PORT_EXIT: portExit });
      expect(result.status).toBe(Number(portExit));
      expect(result.stderr).toContain('Port inspection engine failure');
      expect(result.operations).toEqual([]);
    },
  );

  test(`${mode.command} reuses a fully matching project container`, () => {
    const result = runFixture(mode);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.operations).toEqual([`start ${mode.name}`]);
    expect(result.calls.some((call) => call.includes('Config.Labels'))).toBe(true);
    expect(result.calls.some((call) => call.includes('Mounts'))).toBe(mode.command === 'dev');
  });

  test(`${mode.command} rejects foreign ownership before inspecting bindings`, () => {
    const result = runFixture(mode, { MOCK_OWNER: 'another-project', PORT_EXIT: '125' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Refusing to manage non-project container: ${mode.name}`);
    expect(
      result.calls.some(
        (call) => call.startsWith('port ') || call.includes('NetworkSettings.Ports'),
      ),
    ).toBe(false);
    expect(result.operations).toEqual([]);
  });

  test(`${mode.command} creates a container when genuinely absent`, () => {
    const result = runFixture(mode, { ABSENT: '1' });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.calls.some((call) => call.startsWith('container inspect '))).toBe(false);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toContain(`run -d --name ${mode.name}`);
    expect(result.operations[0]).toContain(`-p 0.0.0.0:${mode.hostPort}:${mode.containerPort}`);
    expect(result.operations[0]).toContain(':local');
  });

  test.each(['different', 'missing'])(
    `${mode.command} recreates a project container for a successfully observed %s binding`,
    (binding) => {
      const result = runFixture(mode, { BINDING: binding });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.operations).toHaveLength(3);
      expect(result.operations.slice(0, 2)).toEqual([`stop ${mode.name}`, `rm ${mode.name}`]);
      expect(result.operations[2]).toContain(`run -d --name ${mode.name}`);
      expect(result.operations[2]).toContain(`-p 0.0.0.0:${mode.hostPort}:${mode.containerPort}`);
    },
  );
}
