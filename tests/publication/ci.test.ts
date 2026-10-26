import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';

const workflow = readFileSync('.github/workflows/check-build.yml', 'utf8');
const steps = workflow.split(/^      - name: /m).slice(1);

function step(name: string, source = workflow) {
  const found = source
    .split(/^      - name: /m)
    .slice(1)
    .find((value) => value.startsWith(`${name}\n`));
  expect(found, `Missing CI step: ${name}`).toBeDefined();
  return found!;
}

function runBlock(name: string, source = workflow) {
  const block = step(name, source).match(/^        run: \|\n((?:          .*\n)+)/m);
  expect(block, `Missing shell block: ${name}`).not.toBeNull();
  return block![1].replace(/^          /gm, '');
}

test('hosted application CI installs the lock and runs the shared checks without container orchestration', () => {
  const runs = steps
    .map((value) => value.match(/^        run: \|\n((?:          .*\n)+)/m)?.[1] || '')
    .join('\n');
  expect(runs).not.toMatch(/\b(?:podman|docker)\s|containers\.sh/);
  expect(runs).toContain('npm ci\n');
  for (const command of ['format:check', 'lint', 'typecheck', 'test', 'build'])
    expect(runs).toContain(`npm run ${command}\n`);
  expect(runs).not.toMatch(/npm run format(?:\s|$)|prettier[^\n]*--write/);
  expect(runs).not.toMatch(/npm install|--passWithNoTests|--exclude|--testNamePattern/);
  expect(runs.match(/sha256sum --check/g)).toHaveLength(2);
  for (const file of ['dist/index.html', 'dist/app/index.html', 'dist/app/sw.js'])
    expect(runs).toContain(`test -f ${file}`);
  expect(runs).toContain('cmp LICENSE dist/app/LICENSE');
  expect(runs).toContain('cmp public/third-party-notices.txt dist/app/third-party-notices.txt');
  expect(JSON.parse(readFileSync('package.json', 'utf8')).scripts).toMatchObject({
    typecheck: 'tsc --noEmit',
    test: 'vitest run',
    build: 'node scripts/build-site.mjs',
  });
});

test('setup-node is SHA-pinned, consumes the development version and does not select latest or cache node_modules', () => {
  const setup = step('Set up the project Node version');
  expect(setup).toMatch(/uses: actions\/setup-node@[a-f0-9]{40}(?: |\n)/);
  expect(setup).toContain('node-version: ${{ steps.node-version.outputs.version }}');
  expect(setup).toContain('check-latest: false');
  expect(setup).toContain('package-manager-cache: false');
  expect(workflow).not.toContain('node_modules');
  expect(workflow).toContain('contents: read');
  expect(workflow).toContain('runs-on: ubuntu-24.04');
  expect(workflow).toContain('persist-credentials: false');
  expect(workflow).toContain(
    "github.event_name == 'workflow_dispatch' && github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
  );
  expect(workflow).toContain('retention-days: 7');
  for (const action of workflow.matchAll(/uses: ([^\n ]+)/g))
    expect(action[1]).toMatch(/^actions\/[a-z-]+@[a-f0-9]{40}$/);
});

// Reuse only the digest fixture: the approved image/version must not follow the
// current Containerfile, so this contract can fail before that image is updated.
const digest = readFileSync('Containerfile', 'utf8')
  .split('\n')[0]
  .match(/@sha256:([0-9a-f]{64}) /)![1];
const approvedStage = `FROM docker.io/library/node:24.22.1-trixie-slim@sha256:${digest} AS development`;
const nodeSelectionCases = [
  { name: 'approved exact version', source: approvedStage, accepts: true },
  { name: 'bookworm', source: approvedStage.replace('trixie', 'bookworm'), accepts: false },
  { name: 'wrong distro', source: approvedStage.replace('trixie', 'noble'), accepts: false },
  {
    name: 'missing digest',
    source: approvedStage.replace(`@sha256:${digest}`, ''),
    accepts: false,
  },
  { name: 'empty digest', source: approvedStage.replace(digest, ''), accepts: false },
  {
    name: 'wrong digest algorithm',
    source: approvedStage.replace('sha256:', 'sha512:'),
    accepts: false,
  },
  {
    name: 'truncated digest',
    source: approvedStage.replace(digest, digest.slice(1)),
    accepts: false,
  },
  { name: 'long digest', source: approvedStage.replace(digest, `${digest}0`), accepts: false },
  {
    name: 'nonhex digest',
    source: approvedStage.replace(digest, `g${digest.slice(1)}`),
    accepts: false,
  },
  {
    name: 'uppercase digest',
    source: approvedStage.replace(digest, `A${digest.slice(1)}`),
    accepts: false,
  },
  { name: 'floating major', source: approvedStage.replace('24.22.1', '24'), accepts: false },
  { name: 'floating minor', source: approvedStage.replace('24.22.1', '24.22'), accepts: false },
  { name: 'latest', source: approvedStage.replace('24.22.1', 'latest'), accepts: false },
  {
    name: 'unversioned image',
    source: approvedStage.replace(':24.22.1-trixie-slim', ''),
    accepts: false,
  },
  {
    name: 'wrong stage',
    source: approvedStage.replace('AS development', 'AS other'),
    accepts: false,
  },
  { name: 'trailing junk', source: `${approvedStage} junk`, accepts: false },
];

describe.each(['check-build.yml', 'publish-pages.yml'])('%s Node selection', (filename) => {
  test.each(nodeSelectionCases)(
    'uses the exact pinned Trixie image and fails closed: $name',
    (entry) => {
      const source = readFileSync(`.github/workflows/${filename}`, 'utf8');
      const directory = mkdtempSync(resolve(tmpdir(), 'ci-node-version-'));
      try {
        writeFileSync(resolve(directory, 'Containerfile'), `${entry.source}\n`);
        const output = resolve(directory, 'output');
        writeFileSync(output, '');
        const result = spawnSync(
          'bash',
          ['-c', runBlock('Read Node version from the development image', source)],
          {
            cwd: directory,
            encoding: 'utf8',
            env: { ...process.env, GITHUB_OUTPUT: output },
          },
        );
        expect(result.error).toBeUndefined();
        if (entry.accepts) {
          expect(result.status, result.stderr).toBe(0);
          expect(readFileSync(output, 'utf8')).toBe('version=24.22.1\n');
        } else {
          expect(result.status, result.stderr).toBe(1);
          expect(result.stderr).toContain(
            'Expected an exact Node version in the pinned development stage of Containerfile.',
          );
          expect(readFileSync(output, 'utf8')).toBe('');
        }
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
