# Development and verification

[Product specification](product-specification.md) is the maintained behavior authority. [Interfaces](interfaces.md) records module/data/UX boundaries; [PWA reliability](pwa-reliability.md) covers installation, cache/update acceptance and backup-first data transfer. Commands below run from the repository root.

## Prerequisites and execution boundary

Use an existing **rootless Podman**, POSIX shell and source checkout, network access for initial pinned image/dependency downloads, free ports 5173/8088 and sufficient container storage. The host workflow targets Linux; other host environments have not been verified. Check rootless capability before using the workflow:

```sh
command -v podman
podman info --format '{{.Host.Security.Rootless}}'
# Must report true; do not continue in privileged/rootful mode.
```

Run local Node/npm/Vite/TypeScript/Vitest/Playwright commands and browser libraries inside containers, not through a host-native application toolchain. GitHub-hosted application CI runs the shared commands directly on disposable runners, as described below. No Docker daemon or Compose provider is needed. If rootless Podman is unavailable, report the blocker rather than installing host packages, changing services/firewall/TLS or using global-prune.

The wrapper owns network `my-goat-journey`, dependency/cache volumes `my-goat-journey-deps` / `my-goat-journey-cache`, and named `my-goat-journey-dev` / `my-goat-journey-runtime` containers. Ownership labels prevent managing unrelated containers. Local development, browser-test and runtime images use the `:local` tag; their image names identify each responsibility. An empty source `node_modules` mount target does not mean dependencies are installed natively on the host.

The development stage in `Containerfile` pins official **Node 24.22.1 on Debian 13
Trixie slim**, including its registry digest. Use its bundled **npm 11.19.1** for
ordinary installation, maintenance and checks. Bootstrap builds that development
image first, then passes it as `NODE_TOOLCHAIN` to `Containerfile.e2e`. The browser
image copies its Node executable and bundled npm into the standard `/usr/local`
locations and removes the older bundled executable/npm; spawned processes use the
same toolchain without runtime mounts or PATH overrides. Playwright remains
**1.56.1** with its matching digest-pinned **Ubuntu 24.04 Noble** image, native
libraries and browsers. Build the development image before building the browser
image independently; do not maintain a second Node version/digest in the browser
recipe. The production runtime remains non-root nginx on Alpine.

Development, tool and browser containers intentionally share the checkout bind.
Use the shared SELinux relabel suffix `:z`, not private `:Z`, so a new container
does not take checkout access away from a running development container on an
enforcing host. Keep `--userns=keep-id` and named-volume `:U` ownership handling;
neither replaces the checkout's shared SELinux label.

The shared resource setup also treats only existence status 1 as absence: it
creates a missing network or volume, but preserves operational existence errors
and stops before creation or dependent work. Creation failures likewise prevent
later setup and tool execution.

Before reusing the development container, the wrapper verifies that its `/workspace`
bind resolves to the current physical checkout, in addition to ownership, image,
port and prefix checks. A missing or different bind recreates only that project-owned
container; an inspection error aborts before stopping or replacing it. Production
containers have no source bind and retain their image/port/prefix checks.

For both `dev` and `run-prod`, only existence status 1 means absence. An operational
existence error aborts without retrying into an unvalidated start. Reuse is selected
only after all refresh checks succeed. Port bindings are read through structured
container inspection: a successful empty result confirms a missing binding and
permits project-owned recreation, while any inspection failure remains visible,
returns nonzero and prevents dependent stop/remove/start/create operations.

`stop` treats only `podman container exists` status 1 as absence. Operational errors
remain visible and make the command fail, even if the other named container stops
successfully; existing stop-state readback and volume retention still apply.

## Immutable bootstrap and ordinary checks

```sh
sh scripts/containers.sh bootstrap
sh scripts/containers.sh dev
sh scripts/containers.sh format:check
sh scripts/containers.sh lint
sh scripts/containers.sh typecheck
sh scripts/containers.sh test
sh scripts/containers.sh build

# Explicit ordinary browser flows; requires the running development container:
sh scripts/containers.sh e2e e2e/onboarding.spec.ts e2e/habits.spec.ts
```

Bootstrap creates project resources, builds development/browser images and consumes **the committed `package-lock.json` through `npm ci`**. It must not regenerate the lockfile. Missing/inconsistent locks fail; do not substitute `npm install` in normal setup. Confirm a disposable fresh-checkout bootstrap leaves the lockfile byte-identical before claiming reproducibility. Do not reinstall dependencies while another test/server process is using the shared dependency volume.

Dependency changes are a separate maintainer operation: deliberately edit package/version inputs, update the lock inside the development container, then verify a clean `npm ci` and review the complete package/lock diff plus checks:

```sh
sh scripts/containers.sh lock-update
sh scripts/containers.sh tool npm ci
```

Lock maintenance uses `npm install --package-lock-only --ignore-scripts` with npm’s default peer-dependency resolution. Local bootstrap, the browser image and hosted CI consume that lock with plain `npm ci`, including development/optional dependencies and normal install scripts. No legacy peer-resolution override or project npmrc is needed for the current dependency graph. Use the exact development-image Node and bundled npm for maintenance too; do not rely on personal npm configuration or add peer-resolution overrides to conceal conflicts. `--ignore-scripts` limits the lock-only maintenance step, not normal installation.

If bootstrap cannot create the development image/resources because the lock is missing, prepare those prerequisites explicitly before the maintainer update; do not silently resolve versions during bootstrap. Lock generation is not a substitute for a successful clean install. Keep matching pinned Playwright package/image/browser versions. `audit` is an optional containerized dependency report, not a complete license or security review.

```sh
sh scripts/containers.sh audit
# Run date-sensitive checks in separate explicit-timezone processes, serially:
for zone in UTC Pacific/Apia America/New_York Asia/Tokyo; do
  sh scripts/containers.sh tool env TZ="$zone" npm run test -- \
    tests/domain tests/data tests/ui/monthly-calendar.test.ts \
    tests/ui/progress-calendar.test.ts tests/ui/calendar-label-work.test.ts
done
```

Do not change a global timezone midway through concurrent tests. Compare identical
fictional stored facts and the same explicit civil Today; an actual instant can
legitimately yield different device-local Todays. Historical utilities use UTC-backed
civil carriers and explicit UTC label formatting, while `localDate` reads actual
instants in the device zone. Include skipped-day, Gregorian validation, leap/month/year
and DST cases, plus local midnight on either side of Today.

`e2e/civil-dates.spec.ts` uses isolated UTC and Pacific/Apia browser contexts and an
injected clock to check English/Portuguese historical labels, calendar navigation,
native export and confirmed replacement with exact fictional fact readback. It also
checks device-local Today and midnight refresh in UTC, Pacific/Apia,
America/New_York and Asia/Tokyo. Run it
against development with `sh scripts/containers.sh e2e e2e/civil-dates.spec.ts`.
For compiled verification, first prepare the shared build and a matching production
runtime, then select the same file with that runtime's `BASE_URL`; no source-module
seam or full A/B/C lifecycle fixture is required for this date-only flow.

## GitHub-hosted application CI

`.github/workflows/check-build.yml` runs on pushes, pull requests and manual dispatches. It runs application checks directly on a disposable `ubuntu-24.04` GitHub-hosted runner, without Podman, Docker or the local wrapper. The separate manual Pages workflow uses the same checks before publication. Local development/testing and production operation remain Podman-based. Local and hosted callers consume the same committed dependencies and package/shared commands:

| Local wrapper | Shared command run directly in hosted CI | Responsibility |
|---|---|---|
| `sh scripts/containers.sh bootstrap` | `npm ci` | Immutable dependency installation from `package-lock.json`; local bootstrap additionally creates Podman resources and builds development/browser images. |
| `sh scripts/containers.sh format:check` | `npm run format:check` | Check the bounded TypeScript/tooling formatting scope; `format` applies it locally, never in CI. |
| `sh scripts/containers.sh lint` | `npm run lint` | Focused TypeScript quality and React Hooks checks; see the [style policy](../CONTRIBUTING.md#typescript-style-and-checks). |
| `sh scripts/containers.sh typecheck` | `npm run typecheck` → `tsc --noEmit` | Application type validation. |
| `sh scripts/containers.sh test` | `npm run test` → `vitest run` | Full ordinary suite, including mocked container-orchestration contracts. |
| `sh scripts/containers.sh build` | `npm run build` → `node scripts/build-site.mjs` | Single production assembly, output allowlists and pre/post-copy PWA integrity/version validation. |

The digest-pinned development stage in `Containerfile` is the Node-version source of truth (currently **24.22.1**, Debian **13 Trixie**). Both workflows accept only its exact numeric `node:<version>-trixie-slim@sha256:<64 lowercase hex digits> AS development` format, fail closed otherwise, and pass the extracted version to full-SHA-pinned `actions/setup-node` with latest selection and automatic package-manager caching disabled. Hosted checks still run directly on `ubuntu-24.04`; they do not use the local container OS. There is no separate `engines`, `packageManager`, npm pin or npmrc policy to override: use the npm bundled with that Node release, just as the local development image does. No dependency or lock regeneration is part of CI; `lock-update` is a separate deliberate local maintainer operation.

CI records the lockfile SHA-256 before `npm ci` and checks it after installation and after the build. It checks landing/app/worker presence and exact project-license/third-party-notice comparisons. The build reads the shared prefix configuration, not a CI-specific base. Check and build uses read-only permissions, credential-free checkout, pinned actions and manual/default-branch-only review artifact retention; that workflow does not deploy or activate Pages.

`tests/containers/*.test.ts` and `tests/publication/wrapper.test.ts` are ordinary unit/contract tests: their temporary `podman` executables mock orchestration, and do not require a container engine. They remain in `npm run test`. Publication/PWA build and development-server tests run real Vite/assembly against isolated fixtures; these are application tests, not nginx/container integration.

Production fixtures in `tests/publication/assembly.test.ts` and `tests/pwa/build.test.ts` use `tests/helpers/production-build.ts` to launch a fresh Node process with `NODE_ENV=production` **before Vite/plugins load**. Assembly still calls the shared `buildSite` entry point with its explicit prefix, landing input and isolated output; worker-only fixtures retain their explicit base and final-HTML variant. Regression assertions check resolved Vite production flags (`isProduction`, `import.meta.env.PROD=true`, `import.meta.env.DEV=false`) and the unchanged parent `NODE_ENV=test`. Vite's `mode=production` alone is insufficient inside Vitest. Development-server and worker-disabled fixtures intentionally stay in-process; do not change the parent environment, suppress warnings or alter app chunking to make production fixtures pass.

```sh
sh scripts/containers.sh tool npm run test -- tests/publication/assembly.test.ts tests/pwa/build.test.ts
```

Real rootless resource/image creation, browser-image compatibility, nginx packaging/non-root execution/headers/health, port/mount ownership and compiled browser/offline/update fixtures remain container-specific local checks. Use the existing local bootstrap, `build-prod`, runtime and explicitly prepared Playwright gates when their infrastructure or behavior changes. Hosted application CI does not validate Podman resource creation, image recipes, nginx or Playwright; mock passes do not verify infrastructure.

Static workflow validation and local container passes do not replace inspecting
GitHub-hosted runner results. Report each verification layer separately.

### Manual GitHub Pages publication

GitHub Pages serves the [landing page and app](../README.md#hosting-and-ci).
Use [`publish-pages.yml`](../.github/workflows/publish-pages.yml) to deploy updates
manually from `main`. The workflow does not enable Pages or change repository
settings; maintain its configuration and deploy as follows:

1. Under **Settings → Pages → Build and deployment**, keep **GitHub Actions**
   selected as the source. Do not select branch-based publishing.
2. Review the **github-pages** environment under **Settings → Environments**;
   restrict deployments to `main` and apply any desired approval protection.
   The workflow independently enforces the exact repository and `refs/heads/main`.
3. In **Actions → Publish GitHub Pages (manual) → Run workflow**, choose **main**.
   The workflow file must be on the default branch for manual dispatch to appear.
   Review the selected revision before dispatching; there is no arbitrary-ref input.
4. Inspect both jobs and the environment's deployment URL. After a successful
   hosted run, verify the actual landing, `licenses.html`, app entry, linked
   assets, manifest and app-only worker on the hosted HTTPS origin with a
   disposable fictional diary. Confirm offline installation/reopening separately;
   hosted success does not establish physical-device behavior.

Only `workflow_dispatch` triggers publication. Pushes and pull requests run the
validation workflow, not Pages. Dispatching the publication workflow on another
branch or repository skips both jobs. The build job checks out **`github.sha`**,
validates and builds that exact event revision, not a later moving `main` tip or
an artifact from another workflow. It repeats the existing immutable installation,
exact Containerfile-derived Node selection with bundled npm, formatting/lint checks, ordinary typecheck/
unit suite, shared build and lockfile/license/notices safeguards. A regression
keeps those validation steps aligned with Check and build; no hosted container
or second build variant is introduced.

Top-level permissions are empty. The build job grants only `contents: read` for
checkout and `pages: read` for `configure-pages` metadata (`enablement: false`).
Only the dependent deploy job receives `pages: write` and `id-token: write`; it
runs in `github-pages` and exposes `steps.deployment.outputs.page_url`. GitHub's
provided token/OIDC are used; no personal access token or runtime secret is needed.
Direct action references are full upstream commit SHAs. The workflow-wide
`github-pages` concurrency group serializes publication with
`cancel-in-progress: false`: an active deployment is not cancelled. GitHub may
replace an older pending run when more dispatches are queued; this is not a FIFO
release queue.

Official `configure-pages`, `upload-pages-artifact` and `deploy-pages` actions
configure metadata, upload **`dist/`** under the `github-pages` artifact name
(one-day retention), and deploy only after the entire build/upload job succeeds.
The shared build validates output allowlists and final-byte PWA integrity before
upload; nothing modifies or appends to the artifact afterward. Pages supplies
`/my-goat-journey/` in the project URL: do **not** add a matching directory inside
`dist/`, override the shared prefix, or upload the source checkout. The app remains
in `dist/app/`, with app-only scope and the same manifest identity. Local Vite,
Podman/nginx and landing-only build stability are unchanged.

Troubleshooting:

- Missing **Run workflow**: confirm the workflow exists on the default branch
  and the account can run Actions. A skipped build/deploy usually means the
  repository/ref guard did not match; select `main` in the intended repository.
- Pages configuration failure: check that Pages was manually set to **GitHub
  Actions**. The workflow deliberately cannot auto-enable it; do not add a PAT.
- Environment/permission failure: review repository Actions policy and
  `github-pages` branch/approval protections; do not broaden the build token.
- Install/build/integrity failure: inspect the failing step and reproduce with
  the local container commands above. Do not regenerate the lockfile, bypass
  tests, or alter hashed output just to publish.
- Missing artifact/expired approval: require a successful build/upload in the
  same run. If its artifact has expired, dispatch a fresh reviewed `main` run;
  do not substitute an unrelated retained review build.
- Hosted 404, wrong app paths or failed worker integrity: check Pages source,
  complete artifact layout and the shared prefix. Nginx headers/health do not
  apply to Pages. Preserve the diary and verified caches; do not clear browser
  storage or force worker activation to mask an artifact or hosting problem.

## One path configuration in every mode

`config/site.json` holds the checked-in default; `config/site.mjs` resolves **`SITE_PREFIX`** for Vite, assembly, runtime and tests. Do not independently override Vite's base or hardcode another default in a fixture/server. Resolution produces site `prefix` and `appBase = prefix + 'app/'`, both with leading/trailing slashes.

Default prefix is `/my-goat-journey/`. Slash-separated ASCII letters/digits/hyphens/underscores are supported, with optional outer slashes; `/` is the root-site form. Empty values, URL schemes, query/fragment characters, dot segments, doubled slashes and reserved `/health` prefix are rejected with an explicit error. Root site still puts the app at `/app/`, not at the site root.

| Mode | Landing | App |
|---|---|---|
| Development | http://localhost:5173/my-goat-journey/ | http://localhost:5173/my-goat-journey/app/ |
| Production | http://localhost:8088/my-goat-journey/ | http://localhost:8088/my-goat-journey/app/ |

Use the **same prefix for every command in a development or verification run**. For example, a disposable alternate-prefix run:

```sh
export SITE_PREFIX=/field-notes/
sh scripts/containers.sh dev
sh scripts/containers.sh build
sh scripts/containers.sh build-prod
sh scripts/containers.sh run-prod
# Landing/app use /field-notes/ and /field-notes/app/ on the same ports.
# Pass the same SITE_PREFIX to test commands too.
```

If returning to the checked-in default, unset the variable and restart/rebuild the corresponding mode. `BASE_URL` selects an E2E **server origin/entry**, not the compilation prefix; keep it aligned with `SITE_PREFIX`. Test containers reach named servers on the project network, not the host's localhost. For example:

```sh
BASE_URL=http://my-goat-journey-runtime:8080/my-goat-journey/app/ \
  sh scripts/containers.sh e2e e2e/onboarding.spec.ts e2e/habits.spec.ts
```

**Network exposure remains:** `0.0.0.0:5173` → 5173 and `0.0.0.0:8088` → 8080. These bindings may expose previews on the local network; TLS/firewall setup and real-phone reachability are not established by these bindings. Browser records belong to exact origins/profiles: `localhost` is not `127.0.0.1`, and the two ports are different diaries.

## Shared production artifact and runtime

Vite **8.3.5** uses Rolldown/Oxc for JavaScript and Lightning CSS for CSS
minification. The explicit build target retains the previous JavaScript and CSS
baseline: Chrome/Edge 107, Firefox 104 and Safari 16. TypeScript's `react-jsx`
setting continues to select the automatic React JSX runtime. Vitest and its
related packages remain **4.1.12**; do not couple a Vitest major upgrade to this
build-tool change. No esbuild or Rollup fallback is installed.

```sh
sh scripts/containers.sh build
# Generates assembled dist/ for the resolved prefix.
sh scripts/containers.sh build-prod
sh scripts/containers.sh run-prod
podman exec my-goat-journey-runtime nginx -t
podman inspect my-goat-journey-runtime
# Local runtime health: http://localhost:8088/health
```

`build` uses `scripts/build-site.mjs`. `build-prod` invokes that same assembly, then packages its exact `dist/` bytes in the runtime image; the Containerfile does not compile a second app. The same source/base yields one site artifact:

```text
dist/                  # generated, never committed
├── index.html         # landing
├── licenses.html      # bilingual licensing information
├── assets/            # reviewed landing resources
└── app/               # compiled PWA: index, assets, worker, manifest, icons, LICENSE/notices
```

The root `LICENSE` is the sole authoritative project license text. Development serves its exact bytes as plain text at the same derived app path (`app/LICENSE`), bypassing Vite’s import analysis without enabling a production worker. Vite derives `app/LICENSE` from it before generating final-byte worker integrity/version metadata; `app/third-party-notices.txt` retains the exact existing public notice text. Both legal texts participate in the precached shell and integrity/version checks, and the landing links to these same distributed files. No PWA file is appended or modified after hashing. Assembly compiles the PWA for the derived app base, then copies it beneath `app/` without modifying final-byte worker/version/integrity inputs. Validate exact app hashes before/after copying. Landing-only changes must leave app output/version unchanged if app inputs/base are unchanged. Reject unexpected/stale files, links and nonregular inputs; do not merge a new output into an arbitrary old `dist/`.

The production runtime is non-root nginx (`101:101`) serving compiled assets without source/dependency mounts or Vite; `/health` is local-runtime-only. An image build alone is not proof of health or correct prefixed serving.

Nginx emits relative `301` redirects for entries missing their trailing slash,
keeping the browser on the requested external origin (including published port
8088, rather than container port 8080). Check through the published host port:

```sh
curl -sS -D - -o /dev/null http://localhost:8088/my-goat-journey
curl -sS -D - -o /dev/null http://localhost:8088/my-goat-journey/app
curl -fsS -L --max-redirs 3 -o /dev/null -w '%{url_effective}\n' \
  http://localhost:8088/my-goat-journey/app
```

Expect `Location: /my-goat-journey/` and
`Location: /my-goat-journey/app/`, then a final URL on port 8088. Repeat with the
resolved paths for alternate prefixes; a root-site build has `/` and `/app/`,
with `/app` redirecting to `/app/`. Keep alternate runtime fixtures disposable;
requests to port 8080 alone do not verify published-port redirect behavior.

GitHub Pages serves the same shared static artifact, assembled locally in Podman or in GitHub-hosted CI. See the [README](../README.md#hosting-and-ci) for the public URLs and deployment instructions. Nginx headers, health checks and fallback behavior are specific to local production. When changing deployment configuration, verify hosted responses separately. Navigation is state-based; the supported entry points are the landing and app URLs.

## Ordinary versus specialized browser suites

The two explicit ordinary examples above need only bootstrap plus their selected server. `sh scripts/containers.sh e2e` with no selection can discover specialized cases too and is **not** a self-preparing fresh-clone release gate.

| Suite/config | Additional prerequisite and boundary |
|---|---|
| Ordinary onboarding/habits/management/history | Prepared browser image/dependency volume and selected dev or compiled server. Fixtures use isolated fictional datasets/injected dates. |
| `source-refresh.spec.ts` and controlled Repository promise seams | Development source/modules only; compiled skips must be recorded, never counted as production passes. |
| `brand-icons.spec.ts` | Run `build` first: its compiled preview consumes the shared `dist/app` and configured app base, in addition to the selected server. Container-local Vite preview does not verify production nginx or Pages behavior. |
| `playwright.update-safety.config.ts` | Running development app and isolated controlled operation/draft barriers; this verifies update-safety seams, not real compiled shell installation. |
| `playwright.production-pwa.config.ts` / `production-pwa.spec.ts` | Real compiled A/B/C nginx fixtures at the same configured prefix on the project network: `my-goat-journey-runtime`, `my-goat-journey-pwa-update-next`, `my-goat-journey-pwa-update-later`; its preview case also consumes shared `dist/app`. A/B/C must differ in app shell bytes, not only landing copy. The browser loopback proxy establishes a supported secure-context fixture without new host ports/security bypasses. |
| Scoped regressions / heading-focus config | Select the intended running dev/compiled origin and satisfy any selected icon/prefix fixture prerequisite; record each development-only skip and each actual executed result. |

Do not depend on untracked helpers or claim the entire specialized A/B/C suite is reproduced by an ordinary E2E command. Where a dedicated orchestrator is not supplied, fixture preparation is explicit QA work: use disposable reviewed source contexts, compile through the shared configuration/build logic, start only project-owned test containers, match fresh output/base to test expectations, and record commands/hashes. TEST-only worker hooks or forced activation are evidence of failure/cache mechanisms, **not** proof of the product's normal adoption policy. Never ship them.

After preparing each prerequisite, select its configuration explicitly:

```sh
# Development lifecycle seams; requires the running development server:
sh scripts/containers.sh e2e --config playwright.update-safety.config.ts

# Real emitted workers; requires all three distinct compiled nginx fixtures:
sh scripts/containers.sh e2e --config playwright.production-pwa.config.ts

# Compiled UI regressions; requires runtime plus build output for icon checks:
BASE_URL=http://my-goat-journey-runtime:8080 \
  sh scripts/containers.sh e2e --config playwright.compiled-regressions.config.ts
```

The A/B/C suite uses its own browser-container loopback proxy at
`http://127.0.0.1:4185` and forwards to those fixed container names on port 8080;
changing `BASE_URL` does not prepare or replace them. Its configured app base
still comes from `SITE_PREFIX`. The wrapper forwards `SITE_PREFIX` and `BASE_URL`,
but not arbitrary host environment variables: the configs' `UPDATE_SAFETY_EVIDENCE`
and `PRODUCTION_PWA_EVIDENCE` overrides are not passed through by the wrapper.
Default evidence paths are under `artifacts/`.

### Required reliability regressions

Keep the acceptance requirements in [PWA reliability](pwa-reliability.md) covered
at the appropriate layer; a simulated client/worker does not prove real browser
installation or activation. In particular:

- `tests/pwa/build.test.ts`, `tests/publication/assembly.test.ts` and
  `tests/pwa/server.test.ts` cover final-byte shell hashes, deterministic versions,
  changed-HTML versioning, prefix isolation, exact license/notices, assembly
  allowlists, app-only scope and truthful static failures/cache headers. Retain
  root and prefixed worker fixtures as namespace tests, not supported root-app
  installation instructions.
- `tests/pwa/service-worker.test.ts` must exercise **both lock orderings** at
  `/` and `/my-goat-journey/`: retained A opens its actual Cache handle → last A
  document closes → B attempts cleanup → A publishes; and B commits to deleting
  A → A installer waits before opening its destination → cleanup finishes → A
  installs. Use deterministic barriers, not timing sleeps. Verify complete exact
  cached responses and offline navigation after publication. A failed rollback
  must release coordination so cleanup and a later installation can proceed.
- Keep atomic new-install failure, failed retained rollback, successful-candidate
  publication/retirement ordering and bookkeeping-failure tests. Predecessor
  retirement precedes the final successful-candidate pointer write; failure must
  preserve the previous completed candidate. Cover missing Web Locks rejection
  before mutation and conservative serving/cleanup of existing verified shells.
- Retain multi-version document assignments across worker restart, same-path
  asset coherence, unknown/pending client retention, superseded waiting-candidate
  cleanup and unrelated-cache isolation. Essential predecessor-assignment failure
  must deny guarded activation. Optional activation/metadata failures and sustained
  quota must retain verified shell files and fail closed for unknown versions,
  not assume browser rollback or mix network assets into an old document.
- The worker model also covers stalled headers/body consumption, a single total
  transfer budget across files, delayed storage settlement and coordinated failed
  candidate deletion before navigation resumes. Keep exact predecessor bytes,
  client assignments, retained rollbacks, no late publication/writes after cleanup,
  and later successful installation covered under root/default/alternate bases.
  Native compiled tests must hold real HTTP transfers, observe actual cancellation
  and held/pending Web Locks, and record predecessor navigation recovery time;
  accelerated model clocks are not native-browser evidence. Do not shorten the
  production transfer budget only for browser tests.
- Keep interrupted-installation ownership regressions at root/default/alternate
  bases. Transfer only persisted caches into fresh worker/lock contexts at intent,
  open, individual write, complete-transfer and post-publication boundaries; a
  caught rejection or transfer timeout is not termination. Cover same-version
  retry, retained rollback, publication/marker ordering, repeated/interrupted
  deletion, quota/metadata failures and assigned/pending/ambiguous/foreign-cache
  protection. Native compiled-browser cases must use real CacheStorage and fresh
  workers/browser contexts. Label seeded persisted states separately from actual
  worker termination, and preserve exact fictional records through fresh offline
  reopening. Include an actual first-ever installing-worker stop with no incumbent,
  then an ordinary retry of the **same compiled version**, complete exact bytes and
  fresh offline entry. Model initial intent, partial writes, transfer completion,
  verified-state transition, publication and interrupted deletion/marker cleanup;
  retain negative quota/missing-metadata/active/waiting/assignment cases. Never
  modify signed shell output to manufacture fixtures.
- `tests/pwa/update-client.test.ts` covers pristine entry, genuine hidden→visible
  resume, interaction cancellation, exact-worker acknowledgement, the one-reload
  latch, denial/error/timeout unlock and absence of automatic retry loops.
  Guarded native `skipWaiting()` must be invoked under coordination but awaited
  outside it so activation cleanup can acquire the lock.
- `e2e/update-safety.spec.ts` exercises real application safety with a controlled
  development update seam. Keep EN/PT dirty habit/pillar and failed onboarding
  drafts, explicit Save/Retry/Discard, queued reads/writes/autosaves/finalization,
  export/parse/restore leases and visible deletion/replacement confirmation covered.
  Leases remain active after route disposal. Native transaction-completion delivery
  and file-parsing barriers establish ordering; becoming clean does not authorize
  an active-session reload.
- `e2e/production-pwa.spec.ts` uses compiled A/B/C workers for offline reload,
  full isolated browser-process restart, native backup/validated replacement,
  exact facts/preferences/progression, quiet safe updates and conservative peers
  (including uncontrolled, unknown, editing and suspended windows). Interrupt a
  candidate and preserve the prior usable shell/candidate. The retained-handle
  race regression pauses **after real `CacheStorage.open()` returns the Cache
  handle**, not before an asset fetch/open; assert named-cache survival, exact
  response bytes and offline navigation. Keep native metadata quota-rejection
  coverage, but do not call it actual disk exhaustion. Instrumentation in
  `e2e/support/pwa-update.ts` and forced TEST activation isolate cache mechanisms;
  only normal guarded-activation cases establish product adoption policy.

### Verification coverage and limits

The development update-safety suite exercises controlled operation/draft seams;
it does not establish compiled-worker installation or physical-device behavior.
Use the prepared production A/B/C suite for real emitted-worker regressions and
record the tested source revision, shell versions, commands and actual results.
Report failures, interruptions, skips and retries separately from passes; results
from one build do not verify later changes. Browser installation requirements,
storage limitations and physical-device regression procedures are documented in
[PWA reliability](pwa-reliability.md#device-coverage-and-limitations).
See the [README](../README.md#hosting-and-ci) for repository, Pages and hosted
CI status. Local results do not establish GitHub Actions results.

Some tests emit screenshots under `docs/screenshots/`. Do not commit generated captures without review; keep the maintained fictional README subset separate from private raw evidence. Test traces/profiles/databases/exports/logs are private; source fixture builders/localization JSON are legitimate tracked inputs.

## Focused path and scope browser checks

After bootstrap, run the development case against Vite, then the compiled cases against nginx. Each uses a disposable browser-container loopback proxy and fictional data; no normal browser profile is opened.

```sh
sh scripts/containers.sh dev
sh scripts/containers.sh e2e e2e/publication-paths.spec.ts --grep 'development serves'
sh scripts/containers.sh e2e e2e/source-refresh.spec.ts
sh scripts/containers.sh build-prod
sh scripts/containers.sh run-prod
BASE_URL=http://my-goat-journey-runtime:8080 \
  sh scripts/containers.sh e2e e2e/publication-paths.spec.ts --grep 'production direct|production fresh'
```

Pass the same `SITE_PREFIX` to these commands for an alternate-prefix run. The complete `e2e/publication-paths.spec.ts` also contains an isolated synthetic-registration regression. Keep that safeguard when changing registration/scope behavior; it never authorizes changes to a real user's registrations or storage.

## Focused Today presentation checks

The Today presentation suite uses isolated fictional fixtures and the running
development server; it does not require the specialized PWA A/B/C matrix. Run
application checks and browser gates serially when sharing the dependency volume:

```sh
sh scripts/containers.sh typecheck
sh scripts/containers.sh test
sh scripts/containers.sh build
sh scripts/containers.sh e2e e2e/today-field-notes.spec.ts e2e/today-xp-feedback.spec.ts
sh scripts/containers.sh e2e e2e/today-celebration.spec.ts \
  --grep 'Daily recognition|Optional additions|truly empty|Completed header (en|pt) (320|390|430|1280)px'
```

The layout fixture checks EN/PT at 320/390/430/1280 CSS pixels with 100%/200%
root text, long goals/names, multiple/custom/empty pillars, keyboard completion,
44px targets, fixed navigation clearance and overflow. Screenshots are private
under `artifacts/today-colored-groups/screenshots/`. Preserve any captures needed
for comparison outside that output directory before rerunning. The same layout
cases capture pending/checked neutral surfaces and long custom group headers.
XP tests cover committed base and milestone rewards, failure/retry, action identity/rapid interaction,
non-triggering refresh/external/history paths, enabled actions queued behind
background reads, announcements and both motion
preferences. Native transaction aborts and controlled development-only barriers
are verification seams, never product options. These checks do not establish
physical-phone, Safari or assistive-technology certification.

## Focused Progress presentation checks

```sh
sh scripts/containers.sh typecheck
sh scripts/containers.sh test
sh scripts/containers.sh build
sh scripts/containers.sh e2e e2e/progress-refresh.spec.ts
sh scripts/containers.sh e2e e2e/progress.spec.ts e2e/progress-interval.spec.ts \
  e2e/consistency-cards.spec.ts e2e/consistency-accessibility.spec.ts \
  e2e/consistency-history.spec.ts e2e/monthly-calendars.spec.ts
```

Use the prepared development server and run toolchain gates serially. The Progress
suite uses isolated fictional data and an injected clock to cover zero/within-level/
boundary XP, committed completion and historical correction, validated replacement,
filter/interval/period independence, and day-return context. Layout checks cover
EN/PT, long names, 320/390/1280 CSS pixels and 100%/200% root text, including
whole-word containment rather than page overflow alone. Screenshots are private
under `artifacts/progress-refresh/screenshots/`; preserve needed captures before
reruns. A fresh profile is required; never seed the normal preview diary. These UI
checks do not replace the compiled-worker update matrix or physical-device testing.

### Spacing and habit-header checks

```sh
sh scripts/containers.sh e2e e2e/progress-spacing.spec.ts
```

This suite checks EN/PT at 320/390/1280 CSS pixels and 100%/200% root text with
long fictional names. Native Chromium `Emulation.setSafeAreaInsetsOverride`
provides a 34px bottom inset; verify actual navigation padding and measured
height before checking final-card/metrics clearance at maximum scroll. This is
browser emulation, not physical-device safe-area certification.

From a clean checkout, this command requires only the prepared development server,
not a baseline artifact or capture marker. It writes measurements and screenshots
under `artifacts/progress-spacing/after/` and checks layout, touch targets, saved
facts, localized read-only tracking-start details and return context. Keep the
output private and review captures in both languages.

For a deliberate spacing comparison, create your own baseline from the unmodified
checkout before editing:

```sh
mkdir -p artifacts/progress-spacing
touch artifacts/progress-spacing/capture-baseline
sh scripts/containers.sh e2e e2e/progress-spacing.spec.ts --grep 'Compact Progress'
rm artifacts/progress-spacing/capture-baseline
# Make the intended spacing change, then run the full file shown above.
```

The marker selects capture mode and writes `before/` JSON/screenshots. Without it,
matching `before/` JSON enables optimization-specific comparisons: protected XP
geometry/markup, interval styles, legend fonts, calendar facts/colors and metrics
must match, while the first card rises by at least 8px and the first calendar by
at least 24px. This is not a general unchanged-layout comparison and an unchanged
rerun is not expected to pass those reduction assertions. Preserve needed outputs
privately, then move `before/` and any capture marker outside the suite's output
directory before ordinary regression runs, which need no baseline.

## Landing page maintenance and checks

`landing/index.html` and `landing/assets/field-notes.css` own the editorial page.
The small native ES modules in the same assets directory are copied unchanged by
the existing assembly: `habit-catalog.js` owns the twelve stable example IDs,
explicit pillars, initial/additional placement and ID-based demonstration defaults;
`translations.js` holds paired EN/pt-BR copy with example text keyed by those IDs;
`language.js` shares the landing-only preference, labels and metadata;
`landing.js` initializes demonstrations; `licenses.js` loads only canonical legal texts;
`demonstrations.js` owns the in-memory checklist/XP; `tour.js` owns tour selection,
calendar details and the bounded level example. No extra framework, dependency,
font request, build or pathname router is involved. `landing/licenses.html` is the
only additional root HTML page admitted by the publication allowlist and development
middleware. Other unreviewed HTML remains rejected.

The footer has one localized Licenses / Licenças link to `licenses.html`. The legal
page shares EN/PT controls and explains project/original-asset licensing from the
README and branding documentation. Its native disclosures load the unchanged
`app/LICENSE` and `app/third-party-notices.txt` as plain text, retaining direct links
when JavaScript is unavailable or inline loading fails. Do not hand-copy, translate
or relicense the official texts, and never import the real app to display them.
The concise demo caption appears once under the hero and once under the tour.

The header uses adjacent native EN/PT buttons with stable accessible names English
and Português, `aria-pressed`, and 44px touch targets. The only persistent landing
preference is `my-goat-journey.landing.language`.
Do not reuse app settings keys, consult browser language on first visit, open
IndexedDB, register a worker, or join application channels from these modules.
Translate controls and metadata as well as visible prose, and keep existing DOM
controls during locale changes to preserve focus and interaction state.

The Today example uses Monday, October 26, 2026 (all displayed schedules include
Monday), 50 fictional prior XP and 10 XP per visible non-milestone completion.
Today in the tour and the Journey strip/view share those completions. Progress is
explicitly a separate fictional daily-reading history: tracking begins October 5,
through October 26, with missed days 8/13/21. Percentage and streaks are derived
from those facts. Dates after the sample cutoff are inert; before-tracking dates
are hatched and inert. Weekday labels use initials when available space or enlarged
text would crowd three-letter names. Keep new fictional fixtures coherent; do not
import domain/persistence code merely to render a preview. Progress opens first;
calendar day, selected level and checklist state survive view/locale changes. The
tour uses natural heights and top-aligned explanatory text. Desktop previews are
460px wide within the centered 1280px container; narrow layouts use available width.

`demonstrations.js` mirrors canonical brain/biceps/utensils/droplet geometry from
`PillarIcon.tsx` and `BicepsFlexed.tsx`, used by every idea and both Today headers.
The focused browser regression compares rendered geometry with those sources.
Preserve the existing ISC notice for Lucide Biceps/Sparkles. Completed habit rows
stay neutral with normal text; only the native checkbox indicates completion.

Catalog order controls presentation only. Selection, completions, DOM references,
localized example text and pillar grouping use stable IDs, never matching array
positions. Four demonstration habits remain an explicit product choice: the
selected example followed by the named defaults, without duplicates. The initial
selection is `read-book`, and `eat-fruit` starts completed. Catalog state stays in
memory and never touches the diary. `tests/landing/habit-catalog.test.ts` pins all
EN/PT wording, frequencies and assignments against an independent fixture; the
landing browser suite also reorders catalog and translation keys independently
using test-only module responses, then exercises the unchanged renderer.

The ordinary formatting, ESLint and TypeScript checks do not validate native
landing JavaScript. Catalog unit tests, focused browser tests and publication
capture exercise these modules; review their source and use containerized
`node --check` for syntax validation as well.

Run through the established wrapper, serially with other project checks:

```sh
sh scripts/containers.sh typecheck
sh scripts/containers.sh test
sh scripts/containers.sh e2e --config playwright.landing.config.ts
sh scripts/containers.sh e2e e2e/publication-paths.spec.ts --grep 'development serves'
sh scripts/containers.sh build-prod
sh scripts/containers.sh run-prod
BASE_URL=http://my-goat-journey-runtime:8080 \
  sh scripts/containers.sh e2e --config playwright.landing.config.ts
BASE_URL=http://my-goat-journey-runtime:8080 \
  sh scripts/containers.sh e2e e2e/publication-paths.spec.ts \
  --grep 'production direct|production fresh|isolated legacy'
```

The landing matrix covers both locales at 320/375/390/430/768/1440 CSS pixels and
100%/200% root text, including each tour view. It checks language fallback,
selection persistence, checklist/XP consistency, native keyboard operation,
feedback expiry, reduced motion, FAQ and actual app navigation. Storage spies
reject diary/channel/worker access. Compiled publication cases additionally use
secure loopback contexts to verify app worker scope, exact fictional diary
preservation, fresh offline reopening and targeted legacy-fixture retirement.
The full ordinary unit suite retains alternate-prefix assembly/hash/version
stability checks. Use the same `SITE_PREFIX` across each alternate-prefix run;
restore default development/runtime configuration afterward.

The opt-in screenshot suite `e2e/publication-captures.spec.ts` includes a landing
check permitting exactly seven module URLs total: the entry module and six imported
modules, with byte-identical HTML, local assets, no manifest and zero
diary/channel/worker registration checks. Its source-preview server supplies
JavaScript MIME types.
It requires explicit `PUBLICATION_CAPTURE=1`; the wrapper does not forward
`PUBLICATION_*` variables. After bootstrap, `build-prod` and `run-prod`, capture
fictional app screenshots at the default prefix with:

```sh
podman run --rm --userns=keep-id --network my-goat-journey \
  --label app=my-goat-journey --shm-size=512m \
  -e PUBLICATION_CAPTURE=1 -e SITE_PREFIX=/my-goat-journey/ \
  -e BASE_URL=http://my-goat-journey-runtime:8080/my-goat-journey/app/ \
  -v "$PWD:/workspace:z" \
  -v my-goat-journey-deps:/workspace/node_modules:U \
  localhost/my-goat-journey-e2e:local npm run e2e -- \
  e2e/publication-captures.spec.ts --grep 'capture current Today'
```

For an alternate prefix, align both environment values with the compiled runtime.
The default output is `artifacts/publication-captures/`; the suite creates only
fictional data in a fresh browser context. Review candidates before replacing the
maintained [README images](screenshots/readme/README.md). Do not count a skipped
capture case as a production pass or enable it in the ordinary landing matrix.

The landing matrix generates screenshots under `artifacts/landing-refinement/screenshots/`.
Preserve any evidence needed for comparison before reruns, inspect desktop/mobile
captures in both languages, and keep raw logs/traces out of commits. Browser emulation is not
physical-iPhone, Safari, hosted CI or GitHub Pages validation.

## Changed-scope verification and cleanup

Use disposable contexts and serialize shared-volume/source/image-changing gates. Preserve actual result logs privately; a timeout/interruption, skipped test, local baseline run or mock is not a new production pass. Check:

- Immutable bootstrap/unchanged lock, typecheck/units and relevant browser regressions.
- Both fresh landing/app requests and reloads, linked assets and HMR at the chosen prefix; no development worker.
- Healthy non-root nginx and intended artifact/notices, real 404s for missing static files and unsupported entries.
- Resolved manifest start/scope/derived identity/icons and app-only worker; exact app bytes through assembly and landing-only version stability.
- A second prefix; compiled offline/coherent update/draft/backup/peer safeguards and isolated registration/scope regressions without data loss.
- Relative documentation links, `git diff --check` and generated/private-file exclusion.

Use [PWA reliability](pwa-reliability.md) for acceptance requirements, [device coverage and limitations](pwa-reliability.md#device-coverage-and-limitations) and the physical-device checklist. Do not weaken Web Locks/cache/update guards to manufacture browser support. See the [README](../README.md#hosting-and-ci) for hosted entry points and CI workflows; local workflow validation is not a GitHub-hosted pass.

For documentation-only changes, check terminology, relative links, retained requirements and `git diff --check`; do not rerun application builds/tests or the full reliability matrix merely for editorial changes.

```sh
sh scripts/containers.sh stop
```

`stop` checks ownership and stops only named development/runtime containers, preserving volumes and browser records. A rootless cleanup diagnostic remains visible; success requires readback confirming the container stopped, not a claimed repair of host networking. Dedicated A/B/C QA containers are separate scoped resources: record their ownership and remove only those temporary fixtures when finished. Never global-prune, wipe a real profile or remove an installed app to make a test green.

## Documentation and licensing

The maintained set is README, CONTRIBUTING, AGENTS, product specification, this guide, interfaces, PWA reliability and branding. Keep commands, requirements and verification limits consistent across these documents. The project’s own code, documentation and original assets, including supplied logos and derived icons, use [Apache-2.0](../LICENSE) to the extent of available rights; [third-party terms](../public/third-party-notices.txt) remain unchanged. Artwork attribution and unresolved provenance are maintained in [branding provenance](branding-pwa.md#artwork-provenance-and-attribution).
