import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';

function wrapperFixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'publication-wrapper-'));
  mkdirSync(resolve(root, 'scripts'));
  mkdirSync(resolve(root, 'bin'));
  cpSync('scripts/containers.sh', resolve(root, 'scripts/containers.sh'));
  cpSync('config', resolve(root, 'config'), { recursive: true });
  writeFileSync(resolve(root, 'package-lock.json'), '{}');
  const log = resolve(root, 'calls.jsonl');
  writeFileSync(log, '');
  writeFileSync(
    resolve(root, 'bin/podman'),
    `#!/usr/bin/env node
const fs = require('node:fs'); const cp = require('node:child_process');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALL_LOG, JSON.stringify(args)+'\\n');
if (args.includes('config/site.mjs')) { const r=cp.spawnSync('node',['config/site.mjs',args.at(-1)],{encoding:'utf8'}); process.stdout.write(r.stdout); process.stderr.write(r.stderr); process.exit(r.status); }
if (args[0]==='run' && args.includes('npm') && args.includes('ci') && process.env.FAIL_CI) process.exit(1);
if (args[0]==='container' && args[1]==='exists') process.exit(process.env.DEV_EXISTING && !fs.existsSync(process.env.CALL_LOG+'.removed') ? 0 : 1);
if (args[0]==='container' && args[1]==='inspect') {
  const format=args[3];
  if (format.includes('site.prefix')) console.log(process.env.CURRENT_PREFIX || '/old/');
  else if (format.includes('Labels')) console.log('my-goat-journey');
  else if (format.includes('NetworkSettings.Ports')) console.log('0.0.0.0:5173');
  else if (format.includes('Mounts')) console.log(process.cwd());
  else if (format.includes('.Image')) console.log('image-id');
}
if (args[0]==='image' && args[1]==='inspect') console.log(args[3].includes('site.prefix') ? (process.env.IMAGE_PREFIX || '/my-goat-journey/') : 'image-id');
if (args[0]==='port') console.log('0.0.0.0:5173');
if (args[0]==='rm') fs.writeFileSync(process.env.CALL_LOG+'.removed','');
`,
    { mode: 0o755 },
  );

  const run = (command: string, env = {}) => {
    const result = spawnSync('sh', ['scripts/containers.sh', command], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        BASE_URL: '',
        PATH: `${root}/bin:${process.env.PATH}`,
        CALL_LOG: log,
        ...env,
      },
    });
    const calls: string[][] = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return { ...result, calls };
  };

  return { root, run };
}

test('browser containers receive the same resolved prefix as Vite', () => {
  const f = wrapperFixture();
  try {
    const result = f.run('e2e', { SITE_PREFIX: 'team/notes' });
    expect(result.status).toBe(0);
    const launch = result.calls.find((args) =>
      args.includes('localhost/my-goat-journey-e2e:local'),
    )!;
    expect(launch).toContain('SITE_PREFIX=/team/notes/');
    expect(launch).toContain('BASE_URL=http://my-goat-journey-dev:5173');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('runtime refuses a prefix inconsistent with its compiled image before managing containers', () => {
  const f = wrapperFixture();
  try {
    const mismatch = f.run('run-prod', { SITE_PREFIX: '/second/', IMAGE_PREFIX: '/other/' });
    expect(mismatch.status).not.toBe(0);
    expect(mismatch.stderr).toContain('build-prod');
    expect(mismatch.calls.some((args) => args[0] === 'stop' || args.includes('-d'))).toBe(false);
    const match = f.run('run-prod', { SITE_PREFIX: 'second', IMAGE_PREFIX: '/second/' });
    expect(match.status).toBe(0);
    const launch = match.calls.find((args) => args.includes('-d'))!;
    expect(launch).toContain('site.prefix=/second/');
    expect(launch).toContain('0.0.0.0:8088:8080');
    expect(launch.some((arg) => arg.startsWith('SITE_PREFIX='))).toBe(false);
    expect(match.calls.some((args) => args.some((arg) => arg.includes('.Mounts')))).toBe(false);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('dev refresh detects prefix changes but reuses an equivalent normalized prefix', () => {
  for (const CURRENT_PREFIX of ['/old/', '/team/notes/']) {
    const f = wrapperFixture();
    try {
      const result = f.run('dev', { DEV_EXISTING: '1', CURRENT_PREFIX, SITE_PREFIX: 'team/notes' });
      expect(result.status).toBe(0);
      expect(result.calls.some((args) => args[0] === 'rm')).toBe(CURRENT_PREFIX === '/old/');
      expect(result.calls.some((args) => args[0] === 'start')).toBe(
        CURRENT_PREFIX === '/team/notes/',
      );
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  }
});

test('dev and production resolve and forward one normalized prefix without changing resource interfaces', () => {
  const f = wrapperFixture();
  try {
    const dev = f.run('dev', { SITE_PREFIX: 'team/notes' });
    expect(dev.status).toBe(0);
    const launch = dev.calls.find(
      (args) => args.includes('-d') && args.includes('localhost/my-goat-journey-dev:local'),
    )!;
    expect(launch).toContain('SITE_PREFIX=/team/notes/');
    expect(launch).toContain('site.prefix=/team/notes/');
    expect(launch).toContain('0.0.0.0:5173:5173');
    expect(launch).toContain('my-goat-journey-deps:/workspace/node_modules:U');
    expect(launch).toContain('--userns=keep-id');
    const production = f.run('build-prod', { SITE_PREFIX: 'team/notes' });
    expect(production.status).toBe(0);
    const calls = production.calls;
    expect(calls.some((args) => args.includes('npm') && args.includes('build'))).toBe(true);
    expect(calls.some((args) => args.includes('npm') && args.includes('typecheck'))).toBe(true);
    const image = calls.filter((args) => args[0] === 'build').at(-1)!;
    expect(image).toContain('--build-arg');
    expect(image).toContain('SITE_PREFIX=/team/notes/');
    expect(image).toContain('runtime');
    expect(readFileSync('package.json', 'utf8')).toContain('node scripts/build-site.mjs');
    expect(readFileSync('Containerfile', 'utf8')).toMatch(
      /COPY dist \/usr\/share\/nginx\/html\$\{SITE_PREFIX\}/,
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test.each(['format:check', 'format', 'lint', 'typecheck', 'test', 'build'])(
  'local %s executes the shared npm command inside Podman',
  (command) => {
    const f = wrapperFixture();
    try {
      const result = f.run(command, { SITE_PREFIX: '/team/notes/' });
      expect(result.status).toBe(0);
      const launches = result.calls.filter((args) => args[0] === 'run');
      expect(launches).toHaveLength(1);
      expect(launches[0].slice(-3)).toEqual(['npm', 'run', command]);
      expect(launches[0]).toContain('localhost/my-goat-journey-dev:local');
      expect(launches[0]).toContain('--userns=keep-id');
      expect(launches[0]).toContain('my-goat-journey-deps:/workspace/node_modules:U');
      expect(launches[0]).toContain('SITE_PREFIX=/team/notes/');
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  },
);

test('lock maintenance uses the same default peer resolution as immutable installs', () => {
  const f = wrapperFixture();
  try {
    const result = f.run('lock-update');
    expect(result.status).toBe(0);
    const launches = result.calls.filter((args) => args[0] === 'run');
    expect(launches).toHaveLength(1);
    expect(launches[0].slice(launches[0].indexOf('npm'))).toEqual([
      'npm',
      'install',
      '--package-lock-only',
      '--ignore-scripts',
    ]);
    expect(launches[0]).toContain('localhost/my-goat-journey-dev:local');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('normal bootstrap consumes the lock; missing or inconsistent lock explains lock-update', () => {
  const f = wrapperFixture();
  try {
    const good = f.run('bootstrap');
    expect(good.status).toBe(0);
    expect(good.calls.some((args) => args.includes('ci'))).toBe(true);
    expect(good.calls.some((args) => args.includes('--package-lock-only'))).toBe(false);
    expect(readFileSync(resolve(f.root, 'package-lock.json'), 'utf8')).toBe('{}');
    const inconsistent = f.run('bootstrap', { FAIL_CI: '1' });
    expect(inconsistent.status).not.toBe(0);
    expect(inconsistent.stderr).toContain('lock-update');
    rmSync(resolve(f.root, 'package-lock.json'));
    const missing = f.run('bootstrap');
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain('lock-update');
    expect(missing.stderr).toContain('package-lock.json');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
