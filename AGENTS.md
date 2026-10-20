# Working in My GOAT Journey

My GOAT Journey is a local-first habit tracker for anyone who wants to build
consistent routines and track their progress. It uses React, TypeScript and Vite,
with browser-local IndexedDB records and a production PWA. Completion is
self-reported; this is not a clinical tool.

## Find the relevant contract

- [README](README.md): product overview, local entry points and data limitations.
- [Contributing](CONTRIBUTING.md): contributor conventions, privacy and review guidance.
- [Product specification](docs/product-specification.md): authoritative requirements,
  acceptance criteria and deferred scope.
- [Development](docs/development.md): execution policy, commands and fixture prerequisites.
- [Interfaces](docs/interfaces.md): module, persistence and UI contracts.
- [PWA reliability](docs/pwa-reliability.md): offline installation, updates and device checks.

Read the sections relevant to the task before changing behavior. Keep detailed
requirements in these maintained documents, not duplicated in this file.

## Local development and checks

Use existing rootless Podman and a POSIX shell. Local dependency installation,
development, tests, browser dependencies, builds and production operation stay
containerized; do not use host-native Node/npm or install a host toolchain as a
fallback. If Podman is unavailable, report the blocker rather than bypassing it.

Run commands from the repository root through [the wrapper](scripts/containers.sh):

| Purpose | Command |
|---|---|
| Setup development/browser images and locked dependencies | `sh scripts/containers.sh bootstrap` |
| Start development server | `sh scripts/containers.sh dev` |
| Check/apply TypeScript formatting | `sh scripts/containers.sh format:check` / `sh scripts/containers.sh format` |
| Lint TypeScript and React Hooks | `sh scripts/containers.sh lint` |
| Type check | `sh scripts/containers.sh typecheck` |
| Unit/integration suite | `sh scripts/containers.sh test` |
| Build shared landing/PWA artifact in `dist/` | `sh scripts/containers.sh build` |
| Type check, build artifact and package production image | `sh scripts/containers.sh build-prod` |
| Start local production nginx | `sh scripts/containers.sh run-prod` |
| Stop named development/runtime containers, retaining volumes | `sh scripts/containers.sh stop` |

Bootstrap uses `npm ci` with the committed lockfile; do not refresh dependencies
as part of ordinary setup. Serialize dependency-volume changes with running checks.
Preview ports 5173/8088 bind to `0.0.0.0`; use a trusted network. Keep `SITE_PREFIX`
consistent across development, builds, serving and tests; see the development guide.

After bootstrap and starting the development server, ordinary browser examples are:

```sh
sh scripts/containers.sh e2e e2e/onboarding.spec.ts e2e/habits.spec.ts
```

Select relevant browser files explicitly. A bare `e2e` invocation also discovers
specialized suites and is not a self-preparing release gate. Compiled icon tests
need a build; production offline/update suites need prepared compiled fixtures,
including distinct A/B/C runtimes where specified. Follow the
[fixture guide](docs/development.md#ordinary-versus-specialized-browser-suites)
for server selection, `BASE_URL`, configuration and recorded skips.

[GitHub-hosted CI](.github/workflows/check-build.yml) is the exception: its disposable
runner directly runs `npm ci`, `npm run format:check`, `npm run lint`,
`npm run typecheck`, `npm run test` and `npm run build`,
using the exact Node version from the development stage of [Containerfile](Containerfile)
and its bundled npm. This does not authorize host-native local tools or establish
container/nginx/browser coverage from a hosted pass.

## Implementation and correctness

- Follow the [TypeScript style policy](CONTRIBUTING.md#typescript-style-and-checks);
  keep formatting and quality checks separate.
- Prefer simple, readable, maintainable code and existing patterns. Keep diffs
  focused; avoid unrelated refactoring and unnecessary dependencies.
- Inspect Git status and affected code first. Preserve existing work; do not reset,
  overwrite or clean unrelated changes.
- Keep project-authored documentation, comments, identifiers and tests in English;
  retain Portuguese localization and literal user-authored content.
- Preserve device-local calendar, scheduling, corrections, lifecycle and XP rules
  in the specification; do not infer new behavior from presentation changes.
- Preserve transactional persistence and validated, explicitly confirmed,
  replacement-only restore. Follow the interface contract; never merge diaries.
- Preserve offline shell integrity, version coherence and guarded updates as
  defined in PWA reliability; do not weaken safeguards to make checks pass.
- Use isolated fictional fixtures and injected clocks. Never inspect, seed, clear
  or migrate a real user diary for testing. Keep exports, profiles and traces private.

## Scope, verification and completion

- Do not silently change product rules or implement deferred features.
- Choose checks proportional to the change: application changes normally need
  typecheck, unit tests, a production build and relevant browser regressions;
  persistence/PWA changes also need their specialized prepared gates.
- For documentation-only changes, check terminology, relative links, references
  and `git diff --check`; do not rerun the full application reliability matrix.
- Report actual commands/results, failures, skips and unverified behavior. Local
  Chromium results do not establish physical-device, Safari or all-age validation.
- Do not commit, push, deploy or rewrite history unless the user's task authorizes it.
- Finish with what changed, why, relevant verification and material limitations.
