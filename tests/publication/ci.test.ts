import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';

const workflow = readFileSync('.github/workflows/check-build.yml', 'utf8');
const steps = workflow.split(/^      - name: /m).slice(1);

function step(name: string) {
  const found = steps.find((value) => value.startsWith(`${name}\n`));
  expect(found, `Missing CI step: ${name}`).toBeDefined();
  return found!;
}

function runBlock(name: string) {
  const block = step(name).match(/^        run: \|\n((?:          .*\n)+)/m);
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
  expect(workflow).toContain('persist-credentials: false');
  expect(workflow).toContain(
    "github.event_name == 'workflow_dispatch' && github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
  );
  expect(workflow).toContain('retention-days: 7');
  for (const action of workflow.matchAll(/uses: ([^\n ]+)/g))
    expect(action[1]).toMatch(/^actions\/[a-z-]+@[a-f0-9]{40}$/);
});

test.each(['development', 'unversioned', 'latest', 'wrong-stage'])(
  'Node selection uses the pinned development image and fails closed: %s',
  (kind) => {
    const directory = mkdtempSync(resolve(tmpdir(), 'ci-node-version-'));
    try {
      const original = readFileSync('Containerfile', 'utf8');
      const source =
        kind === 'unversioned'
          ? original.replace(/node:\d+\.\d+\.\d+/, 'node:22')
          : kind === 'latest'
            ? original.replace(/node:\d+\.\d+\.\d+/, 'node:latest')
            : kind === 'wrong-stage'
              ? original.replace('AS development', 'AS other')
              : original;
      writeFileSync(resolve(directory, 'Containerfile'), source);
      const output = resolve(directory, 'output');
      writeFileSync(output, '');
      const result = spawnSync(
        'bash',
        ['-c', runBlock('Read Node version from the development image')],
        {
          cwd: directory,
          encoding: 'utf8',
          env: { ...process.env, GITHUB_OUTPUT: output },
        },
      );
      if (kind === 'development') {
        expect(result.status, result.stderr).toBe(0);
        expect(readFileSync(output, 'utf8')).toBe(
          `version=${original.match(/node:(\d+\.\d+\.\d+)/)![1]}\n`,
        );
      } else {
        expect(result.status).not.toBe(0);
        expect(readFileSync(output, 'utf8')).toBe('');
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
