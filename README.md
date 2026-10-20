<p align="center">
  <img src="public/branding/My_GOAT_Journey_app_icon.png" width="96" height="96" alt="Goat above a mountain path and yellow sun">
</p>

<h1 align="center">My GOAT Journey</h1>

<p align="center"><strong>Small commitments. Your own journey.</strong></p>

<p align="center">
  A local-first habit tracker with flexible weekday schedules and visible progress.<br>
  Choose your habits, check off today's commitments, and follow your mountain journey.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="Apache 2.0 license"></a>
  <a href="https://github.com/thobiast/my-goat-journey/actions/workflows/check-build.yml"><img src="https://github.com/thobiast/my-goat-journey/actions/workflows/check-build.yml/badge.svg" alt="Check and build workflow status"></a>
</p>

<p align="center">
  <a href="https://thobiast.github.io/my-goat-journey/app/">Open the app</a> ·
  <a href="https://thobiast.github.io/my-goat-journey/">Explore My GOAT Journey</a> ·
  <a href="#screenshots">Screenshots</a> ·
  <a href="#run-locally">Run locally</a> ·
  <a href="#documentation-and-contributing">Documentation</a>
</p>

## Screenshots

Today, Pillars and Progress with fictional sample data. Select an image to view it
full size. [Capture notes](docs/screenshots/readme/README.md).

<p>
  <a href="docs/screenshots/readme/today-en.png"><img src="docs/screenshots/readme/today-en.png" width="260" align="top" alt="Today checklist grouped by pillar, with completed and pending habits"></a>
  <a href="docs/screenshots/readme/pillars-en.png"><img src="docs/screenshots/readme/pillars-en.png" width="260" align="top" alt="Pillars view with habit schedules and controls to add or edit habits"></a>
  <a href="docs/screenshots/readme/progress-en.png"><img src="docs/screenshots/readme/progress-en.png" width="260" align="top" alt="Progress calendars showing completed days and current and best habit streaks"></a>
</p>

## What you can do

- Schedule habits every day or on selected weekdays, with days off left out of your commitments.
- Organize multiple habits under Mind, Body, Nutrition and Hygiene, or create your own pillars.
- See what's due in a clear daily checklist and check off each completed goal.
- Review consistency calendars and current/best streaks for habits, pillars and your daily agenda.
- Earn XP and milestone bonuses, gain levels, and follow your progress up the mountain.
- Keep records locally, export backups, and install the app for offline use after setup.
- Available in English and Brazilian Portuguese. Your goals and pillar names stay as entered.

Start with just one habit; you don't need to fill every pillar. See the
[product specification](docs/product-specification.md) for scheduling, corrections
and retained history. Completion is self-reported. This is not a clinical tool,
and XP and levels do not measure health, intelligence or personal worth.

## Your data and offline use

You don't need an account or login. Habit records stay in your device's browser
profile, in IndexedDB. There is no application-server diary, cross-device sync,
advertising or application telemetry. Each browser profile and origin has its own
records; changing device, hostname or port does not move them.

You control JSON backup export and restore in Settings. Restore validates the
file and asks before **replacing, never merging**, local records. Exported files
contain your goals and history and are not encrypted by the app; keep them private
wherever you choose to save or share them. Clearing browser/site data, storage
eviction or removing an installation can lose records, so export backups regularly.
See the [backup and storage guide](docs/pwa-reliability.md#backup-storage-identity-and-moving-a-diary)
for file limits and safe transfers.

Open the [app](https://thobiast.github.io/my-goat-journey/app/) online, let offline
preparation finish, then reopen it once while still online. You can add it to your
Home Screen on iPhone with **Share → Add to Home Screen**, or use your browser's
install option where available. After preparation, core screens and habit tracking
work offline while browser storage remains available. The landing page requires
a connection. Offline use requires the compiled production app and a supported
browser in a secure context (trusted HTTPS or browser-recognized loopback).
See [installation and troubleshooting](docs/pwa-reliability.md#first-installation-and-offline-continuity)
for details.

## Run locally

The documented Linux workflow requires existing **rootless Podman**, a POSIX
shell, a source checkout and initial network access. Local application tools and
browser dependencies stay in containers; you don't need host Node/npm.

From the repository root:

```sh
sh scripts/containers.sh bootstrap
sh scripts/containers.sh dev
```

Bootstrap installs from the committed lockfile with `npm ci`.

- Landing: http://localhost:5173/my-goat-journey/
- App: http://localhost:5173/my-goat-journey/app/

<details>
<summary>Build and run the production app locally</summary>

```sh
sh scripts/containers.sh build-prod
sh scripts/containers.sh run-prod
```

- Landing: http://localhost:8088/my-goat-journey/
- App: http://localhost:8088/my-goat-journey/app/

Stop the named development/runtime containers while preserving volumes:

```sh
sh scripts/containers.sh stop
```

</details>

Preview ports **5173 and 8088 bind to `0.0.0.0`**, so use a trusted network.
These commands do not configure HTTPS or a firewall. For checks, alternate
`SITE_PREFIX` values and fixture preparation, see [Development](docs/development.md).
Local execution remains containerized; GitHub-hosted application CI runs the shared
commands directly on its disposable runner.

## Documentation and contributing

| Document | When to use it |
|---|---|
| [Product specification](docs/product-specification.md) | Product rules, acceptance criteria and future scope. |
| [Development](docs/development.md) | Setup, commands, CI boundaries and test fixtures. |
| [Interface contracts](docs/interfaces.md) | Module, persistence and UI behavior. |
| [PWA reliability](docs/pwa-reliability.md) | Installation, offline use, updates and backup safety. |
| [Branding](docs/branding-pwa.md) | Source assets, icon generation and provenance. |
| [Contributing](CONTRIBUTING.md) | Contribution conventions, safe fixtures and review guidance. |

## Status and roadmap

See [device coverage and limitations](docs/pwa-reliability.md#device-coverage-and-limitations)
for browser installation and storage considerations.

Avatar/cosmetic personalization, an achievement catalog and reminders/notifications
are future work, not shipped features.

## Hosting and CI

Source code: [thobiast/my-goat-journey](https://github.com/thobiast/my-goat-journey).
The landing page and app are available on GitHub Pages:

- Landing: https://thobiast.github.io/my-goat-journey/
- App: https://thobiast.github.io/my-goat-journey/app/

The [Check and build workflow](.github/workflows/check-build.yml)
installs locked dependencies, checks TypeScript formatting and lint, runs type
checking and the ordinary unit suite, and
builds the shared landing/PWA artifact. It checks lockfile integrity and distributed
license/notices, retaining a review artifact only for manual runs on the default
branch. It **does not deploy** or run container/nginx or browser integration checks.

The separate [Publish GitHub Pages (manual) workflow](.github/workflows/publish-pages.yml)
validates, builds and deploys the shared artifact only when manually run from
`main`. Pushes and pull requests do not deploy. See the
[CI command mapping](docs/development.md#github-hosted-application-ci) and
[manual Pages instructions](docs/development.md#manual-github-pages-publication)
for maintainer details.

## License and artwork

The project's own code, documentation and original assets, including the supplied
logos and derived installation icons, are licensed under [Apache 2.0](LICENSE),
to the extent of the rights available to license. No separate restrictive branding
policy is added.

Third-party material retains its existing terms; see [third-party notices](public/third-party-notices.txt)
and adjacent vendored-icon notices. [Branding provenance](docs/branding-pwa.md#artwork-provenance-and-attribution)
records AI-assisted artwork generation and the limits of the available attribution.
