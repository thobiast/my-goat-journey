import { readFileSync, existsSync } from 'node:fs';
import { expect, test } from 'vitest';

const path = '.github/workflows/publish-pages.yml';

const workflow = () => (existsSync(path) ? readFileSync(path, 'utf8') : '');

test('local production context retains both canonical landing HTML pages', () => {
  const rules = readFileSync('.containerignore', 'utf8').split('\n');
  expect(rules[0]).toBe('*');
  for (const page of ['index.html', 'licenses.html']) {
    expect(rules).toContain(`!landing/${page}`);
    expect(rules).toContain(`!dist/${page}`);
  }
});

test('Pages publication is manual, main-only and deploys only the validated shared artifact', () => {
  const pages = workflow();
  expect(pages, 'Missing manual Pages publication workflow').not.toBe('');
  expect(pages.match(/^on:\n([\s\S]*?)\n\S/m)?.[1].trim()).toBe('workflow_dispatch:');
  expect(pages).toContain('permissions: {}');
  expect(pages).toContain('group: github-pages');
  expect(pages).toContain('cancel-in-progress: false');
  const build = pages.split('\n  build:\n')[1]?.split('\n  deploy:\n')[0] || '';
  const deploy = pages.split('\n  deploy:\n')[1] || '';
  const guard =
    "if: ${{ github.event_name == 'workflow_dispatch' && github.repository == 'thobiast/my-goat-journey' && github.ref == 'refs/heads/main' }}";
  for (const job of [build, deploy]) expect(job).toContain(guard);
  expect(build).toContain('contents: read');
  expect(build).toContain('pages: read');
  expect(build).not.toMatch(/pages: write|id-token: write/);
  expect(deploy).toContain('needs: build');
  expect(deploy).toContain('pages: write');
  expect(deploy).toContain('id-token: write');
  expect(deploy).not.toContain('contents:');
  expect(deploy).toContain('name: github-pages');
  expect(deploy).toContain('url: ${{ steps.deployment.outputs.page_url }}');
  expect(deploy).toContain('id: deployment');
  expect(deploy).toContain('artifact_name: github-pages');
  expect(deploy).toContain('preview: false');
  expect(build).toContain('enablement: false');
  expect(build).toContain('path: dist/');
  expect(build).toContain('include-hidden-files: false');
  expect(build).toContain('name: github-pages');
  expect(pages).not.toMatch(
    /pull_request|workflow_run|secrets\.|npm install|\b(?:podman|docker)\s|containers\.sh|always\(\)/,
  );
  for (const action of [
    'checkout',
    'setup-node',
    'configure-pages',
    'upload-pages-artifact',
    'deploy-pages',
  ]) {
    expect(pages).toMatch(new RegExp(`uses: actions/${action}@[a-f0-9]{40}(?: |\\n)`));
  }
  for (const action of pages.matchAll(/uses: ([^\n ]+)/g))
    expect(action[1]).toMatch(/^actions\/[a-z-]+@[a-f0-9]{40}$/);
  expect(build.indexOf('npm run build')).toBeLessThan(
    build.indexOf('uses: actions/upload-pages-artifact@'),
  );

  // Keep the existing immutable install, exact runtime selection and validation
  // bodies identical rather than introducing another CI/build abstraction.
  const check = readFileSync('.github/workflows/check-build.yml', 'utf8');
  const names = [
    'Check out the event revision',
    'Read Node version from the development image',
    'Set up the project Node version',
    'Install from the committed lockfile',
    'Type check and test',
    'Build the shared production artifact',
  ];

  function step(source: string, name: string) {
    const found = source
      .split(/^      - name: /m)
      .slice(1)
      .find((value) => value.startsWith(`${name}\n`));
    expect(found, `Missing shared validation step: ${name}`).toBeDefined();
    return found!.trimEnd();
  }

  for (const name of names) expect(step(build, name)).toBe(step(check, name));
});
