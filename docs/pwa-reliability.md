# PWA reliability and local operation

The production PWA caches a verified offline application shell and uses quiet,
guarded automatic updates. [Product specification](product-specification.md)
governs product behavior; [Interfaces](interfaces.md) records persistence and UI
contracts; [Development](development.md) owns commands, tests and fixture setup.
This guide covers installation, offline use, cache coherence, guarded updates and
data protection, with contributor requirements for maintaining those safeguards.

## Production and development operation

Use existing rootless Podman; install no project toolchains or browser dependencies
on the host. From the checkout root, after the [bootstrap prerequisites](development.md#immutable-bootstrap-and-ordinary-checks):

```sh
sh scripts/containers.sh typecheck
sh scripts/containers.sh test
sh scripts/containers.sh build-prod
sh scripts/containers.sh run-prod
# Landing: http://localhost:8088/my-goat-journey/
# App: http://localhost:8088/my-goat-journey/app/
# Health: http://localhost:8088/health
podman exec my-goat-journey-runtime nginx -t
podman inspect my-goat-journey-runtime
sh scripts/containers.sh stop
```

The runtime is non-root nginx (`USER 101:101`) with compiled assets, an image health
check, no source/dependency mounts and no Vite process. `stop` stops only the named
project development/runtime containers and preserves volumes and browser records.
Development uses `sh scripts/containers.sh dev`, with the same paths on port 5173.
The bindings `0.0.0.0:5173` and `0.0.0.0:8088` can expose previews to the local network;
they do not configure TLS, DNS, a firewall or phone reachability.

Only production builds register the worker. Vite/HMR path parity does not establish
production offline/cache/update behavior. A trusted HTTPS origin or a
browser-recognized local loopback origin is required for service workers. Plain
HTTP on a custom container hostname or a phone-accessed host IP is not a secure
context. The ordinary online/local-record workflow can still work there, but
installation and offline reopening cannot be inferred. Do not bypass browser
security to claim support.

## Paths, artifact and installed identity

`config/site.json` and `config/site.mjs` resolve `SITE_PREFIX` once for development,
assembly, runtime and tests. The normalized site prefix has leading/trailing
slashes; the app base appends `app/`. Defaults are `/my-goat-journey/` for the
landing and `/my-goat-journey/app/` for the PWA. A root site prefix `/` still puts
the PWA at `/app/`. Keep the prefix consistent across commands and compiled fixtures.

The shared production artifact is generated `dist/`: landing at its root, compiled
PWA in `dist/app/`. Assembly preserves exact generated PWA bytes after integrity
and version hashing, rejects stale/unexpected output and does not merge arbitrary
files into the artifact. A landing-only change must leave app bytes/version
unchanged when app inputs/base are unchanged. Do not commit `dist/`. Both legal
texts participate in the integrity-checked/precached shell: `app/LICENSE` must exactly match
the root [LICENSE](../LICENSE), and `app/third-party-notices.txt` must match the
[public notices](../public/third-party-notices.txt).

`public/site-v1.webmanifest` names **My GOAT Journey** and retains relative
`start_url: ./`, `scope: ./` and icon paths. Explicit `id` is intentionally omitted;
identity derives from the resolved app start URL. Under the default prefix,
start/scope/derived identity resolve to `/my-goat-journey/app/`. Register `sw.js`
only for that app path; an installed launch must open the app directly, not the
landing. The landing is outside worker scope, is not promised offline, and must
not open the diary or app BroadcastChannel. Same-origin paths do not isolate
IndexedDB or trusted scripts. Cache/update code must not automatically unregister
other workers, clear storage or remove/reinstall an installed app.

Installation assets include 192/512 PNGs (`any`), a separate padded 512 maskable
PNG, Apple touch 180 PNG and 16/32/48 PNG plus multisize ICO favicons. Verify fresh
browser decoding, MIME/dimensions, native parsed manifest identity and the
maskable safe circle, as well as visual appearance. See [branding](branding-pwa.md)
for artwork, licensing and source provenance.

## First installation and offline continuity

The landing’s **How to install / Como instalar** section follows the product tour
and links to relative `app/`, never installs the landing. Its iPhone, Android and
Computer tabs preserve selection across EN/PT changes and support Arrow keys,
Home/End and Tab. The CTA navigates to the app; installation remains an optional
browser action. The landing does not register a worker or access diary records.

Browser controls vary by platform and version. In Safari on iPhone, use
**Share → Add to Home Screen**, leave **Open as Web App** enabled if offered,
then tap **Add**. In Android Chrome, use the menu’s installation option and
confirm; current wording is **Install and create shortcut → Install**. Desktop
Chrome offers **Cast, save, and share → Install page as app…**, or an address-bar
install control when available. If installation is unavailable, bookmark the app
and continue in the browser or use a supported browser. See the official
[Apple iPhone guide](https://support.apple.com/guide/iphone/iph42ab2f3a7/ios),
[Chrome Android instructions](https://support.google.com/chrome/answer/9658361?hl=en&co=GENIE.Platform%3DAndroid)
and [Chrome computer instructions](https://support.google.com/chrome/answer/9658361?hl=en&co=GENIE.Platform%3DDesktop).

1. Open the intended app origin online and allow the **complete** shell to install.
   An interrupted first install is not offline readiness.
2. Reopen/reload after installation so the document is controlled by the worker.
   First installation does not claim or force-reload the current editing document.
   To install on iPhone, use Safari's **Share → Add to Home Screen** from the
   [app](https://thobiast.github.io/my-goat-journey/app/) path. Other browsers may
   offer an install option in their menu or address bar.
3. Once controlled, offline reload/reopening must support all core screens,
   onboarding, habit/completion writes, corrections and progression replay.
   Exact records and persisted language, motion and Progress choices must survive
   update, offline reopening and an isolated browser-process restart while browser
   storage remains available.
4. Native file export and validated replacement-only restore in Settings must
   remain usable offline, subject to platform download/file-picker support.

The shell cache contains **application files only**. IndexedDB is the sole
authoritative diary: database `my-goat-journey`, store `dataset`, key `current`.
Cache/update changes do not change its schema or domain rules. There is no second
habit repository, completion queue, server diary or cached backup. XP, streaks and
levels are replayed from saved facts, not imported counters.

Uncached resources must fail rather than return successful HTML pretending to be
an asset. Other-origin, non-GET and non-shell data requests are not added to the
shell cache. Nginx returns real 404s for missing scripts, icons, manifests and
assets; the app has state-based screens, not advertised `/today` deep links.

**Storage is not permanent.** Private browsing, user-cleared site data, OS/browser
policies, quota or eviction can remove records or cached files. Reconnect if the
shell is evicted; reconnecting cannot recreate an evicted diary without a backup.
Never clear storage to force an update or promise indefinite retention.

## Atomic verified installation

Vite generates `sw.js` after final compiled output. The SHA-256 version includes
the deployment base, worker source and exact shipped shell bytes. Identical builds
are deterministic; an HTML-only shell change produces a new version.

Every required final file carries SHA-256 Subresource Integrity and must pass
status, redirect and integrity checks. A missing, redirected, mismatched or failed
resource rejects installation. Failed new installs remove only their newly owned
partial shell cache. A retained same-version rollback must neither overwrite
verified responses nor delete a live document's shell on failure. Installation
bookkeeping failure preserves the previous successfully completed candidate and
old working clients.

Names are app/base-scoped: `my-goat-journey:<encoded-base>:shell:<version>` and the
matching `clients` metadata cache. Metadata contains document/version assignments,
not diary facts. No operation clears IndexedDB, unrelated caches, localStorage or
other browser/user records.

## Cache coordination and document coherence

Each existing document retains its original shell and asset version after worker
activation, including same-path icon/manifest assets. New navigation/reload moves
the new document to the active version. Durable assignments survive worker restarts.
Missing old-shell files fail safely instead of mixing new network bytes into an
old document.

Cleanup stays within the app/base namespace. It may remove retired active versions
and superseded completed waiting candidates, but preserves the active version,
current successful candidate and live/pending document versions. An unsuccessful
replacement does not delete the current waiting cache. Unknown live clients and
navigation assignments not yet observed are retained conservatively; extra cache
data is preferable to breaking a slow or suspended document.

Installation holds an origin-wide app/base-scoped **Web Lock** from before retained
cache-name lookup/open through integrity processing and final candidate publication.
Cleanup holds the same lock throughout its metadata snapshot/delete decision.
This prevents a detached retained Cache handle: cleanup must not delete A's name
after its last document closes while A's installer still writes through the opened
handle. Both installer-first and cleanup-first ordering require deterministic
regressions; the native compiled-browser case must pause after the real Cache
handle opens, then verify named-cache survival, exact response bytes and offline
navigation. [Development](development.md#required-reliability-regressions) details
the test layers and prerequisites.

Predecessor retirement precedes the final successful-candidate pointer write.
Worker termination releases the Web Lock automatically; no expiring/quota-sensitive
lease metadata replaces it. Without Web Locks, new installation fails before
mutation and cleanup retains existing verified caches, which can still be served.
Do not weaken these guards to claim browser support. The cooperative protocol
coordinates participating workers, not arbitrary uncoordinated workers; worker
source changes themselves change the shell version hash.

## Quiet automatic updates and draft safety

Available versions are detected/downloaded quietly online. Routine operation has
no Update/Later banner, modal, automatic-update preference or release-by-release
acceptance. First installation only prepares offline use.

A replacement can apply at a pristine new document or a genuine clean
**hidden→visible resume**. Trusted pointer/touch/keyboard/input/change/scroll
interaction closes entry eligibility. Ordinary focus, pageshow and visible→visible checks do
not reopen it. Becoming clean after a save is not a new entry and never authorizes
an active-session reload. Dirty/unsafe resume defers the update to a later safe
entry; automatic updates never open the discard-changes dialog.

All queued repository reads/writes, onboarding autosaves/finalization,
unsaved/failed-save onboarding drafts, dirty habit/pillar forms, backup
parsing/export/restore leases, and visible data-deletion/replacement
confirmation/commit block automatic **and manual** application. Operation leases
remain active after route disposal. Save, Retry and navigation Keep editing,
Escape and explicit Discard retain their ordinary independent behavior; updates
must never lose literal input or silently discard a draft.

Preparation synchronously sets the DOM inert and the application lock, drains
persistence, then strictly rechecks safety before contacting the exact candidate.
New interaction cancels automatic eligibility. Native delayed transaction-completion
delivery and parsing barriers must establish operation ordering in tests.

## Guarded activation and failure handling

The waiting worker checks **all** in-scope window clients, including uncontrolled,
unknown, editing and suspended windows. `ACTIVATE_WHEN_ALONE` acknowledges only
when the requesting source is the sole window and the candidate is still current.
A peer's mere presence defers activation; no heartbeat response is required. Close
other app tabs/windows, then enter cleanly to retry; never force peers to reload.
Durable document assignments provide an additional coherence backstop.

No unconditional `skipWaiting()`, `clients.claim()` or controllerchange reload is
allowed. Candidate/peer checks and native activation invocation run under the
lifecycle lock, but the native promise is awaited **after releasing the lock** so
activation cleanup can acquire it.

Positive acknowledgement and activation/controller state for the **exact accepted
worker**, plus tab-local safety, gate at most one reload. Initially uncontrolled
documents observe that worker's activated state instead of relying on claim.
Late acknowledgements, unrelated controllers and disposed/timed-out attempts do
not authorize reload. If normal browser activation after the last old document
closes/reloads lets a new document enter the new version directly, no second
reload is required.

Denial, rejection or timeout releases inert/application locks without draft loss.
An unsuccessful automatic candidate is not retried in a tight loop in the same
document; explicit retry or a new safe document can try again.

Native activation is irreversible: an activation-event bookkeeping failure is
**not browser rollback**. Essential predecessor assignments must be prepared before
guarded activation; their failure denies it. Optional metadata failure retains
verified files and fences destructive cleanup/inference through active-pointer
failure handling. Failed navigation assignment remains in memory for that worker
lifetime. Under sustained quota, a restarted worker fails closed for unknown
document versions rather than mixing assets. Fresh navigation can recover from
the verified shell, but later guarded replacement can remain deferred while
predecessor identity is unavailable. Injected native quota rejection tests are not
proof of real disk exhaustion, eviction or device behavior.

## Optional localized update controls

Settings → **Check for updates / Verificar atualizações** is optional. EN/PT
feedback must truthfully distinguish checking, already current, offline, failed
checking, failed application and a downloaded update awaiting a safe transition.
The pending **Update / Atualizar** fallback can finish a deliberately deferred
session, but obeys the same draft, persistence, parsing/restore and peer guards.
Normal successful updates need no manual action or persistent notice. There is no
routine Later action or automatic-update preference.

## Backup, storage identity and moving a diary

A diary belongs to the **exact origin and browser profile/storage context**.
Protocol, hostname and port matter: `localhost`, `127.0.0.1`, a LAN IP, ports 5173
and 8088, and HTTP versus HTTPS are not interchangeable. Another browser/profile
or device may also have separate data. Do not switch origins/profiles to repair
an installation or assume browser-tab and installed-app storage are equivalent.

Export a complete private JSON backup regularly through Settings. The file includes
literal goals/history and is not uploaded. Keep it safely and verify it saved and
validates. The inclusive complete UTF-8 file limit is **20 MiB** for export/restore;
invalid/failed/quota/stale restore must preserve the previous diary. Validation
precedes separate explicit confirmation of **replacement, never merge**; current
data can be exported first. Habit archival retains history and is not backup-size
cleanup. Do not clear records or truncate a backup to fit.

Before any separately chosen clearing of site data, removal or reinstallation,
export and validate from the **actual origin/profile/installed context containing
the diary**. Removing an installed PWA or browser site data can lose storage.
Never remove/reinstall a real diary merely to refresh an icon or make a test pass.

For another device, browser/profile, host, port or protocol:

1. Verify the target app at its intended trusted origin using disposable fictional
   data, including export/restore and offline reopening.
2. Export/validate the complete backup from the source installation. Export any
   target diary worth keeping before replacement.
3. Validate the source file in the target, review it and explicitly confirm
   replacement. Never copy IndexedDB manually or merge two diaries.
4. Compare literal goals/histories, lifecycle/ownership, completions, replayed
   XP/streaks/level and persisted preferences. Test installed offline reopening.
5. Keep the source installation and private backups until the replacement is
   verified and accepted. Clearing/removal is a separate informed choice.

## Hosting and verification boundary

See the [README](../README.md#hosting-and-ci) for the hosted landing page and app.
A different path on the same owner host does not
provide storage/security isolation from other same-origin scripts. A change of
origin uses the validated replacement procedure above.

Deploy complete artifacts/images atomically, not piecemeal app files. Local nginx
revalidates HTML, `sw.js`, manifests and unhashed assets (`no-cache`); hashed JS/CSS
are immutable. GitHub Pages serves the shared static artifact, but nginx headers,
health and routing behavior do not transfer to it. When changing deployment,
verify hosted responses and secure-context installation separately from local nginx.

Reliability changes require fresh containerized typecheck, full units, production
build, healthy non-root nginx routes/headers and prepared compiled A/B/C browser
gates, plus relevant UI regressions. Report test identities, totals, failures,
interruptions and skips separately; a fixture/mock or documentation check is not
a product pass. [Development](development.md#ordinary-versus-specialized-browser-suites)
separates ordinary commands from specialized fixtures and preserves the local
Podman/exact-Node GitHub-hosted CI policy. Hosted application checks do not verify
containers, nginx or browsers. See [verification coverage and limits](development.md#verification-coverage-and-limits)
for test-layer boundaries, the [README](../README.md#hosting-and-ci) for hosting
and CI workflows, and [device coverage and limitations](#device-coverage-and-limitations)
for browser and platform considerations.
These commands do not publish or deploy the site.

## Troubleshooting

| Symptom | Safe next step |
|---|---|
| Installation or offline reopening is unavailable | Check for compiled production output, a supported secure context and successful complete shell installation. Development/HMR or an HTTP LAN address does not establish offline support. |
| An update stays pending | Finish or explicitly leave drafts, complete data operations, close other app windows and retry at a clean entry or through Settings. Do not force activation or discard input. |
| A file fails integrity checks or a shell request fails | Check that the complete artifact and correct prefix were served without post-hash edits, redirects or HTML masquerading as an asset. Preserve verified caches and diary records. |
| Web Locks are unavailable | Use a supported browser. Do not disable coordination guards to force installation. |
| An icon looks stale | Check asset URLs and ordinary reload/reopen first; OS icon caching is separate. Do not clear a diary or remove an installation merely to refresh its icon. |
| A backup is rejected or exceeds the limit | Keep the current dataset and file intact. Confirm the supported format and complete-file size; do not truncate history, merge records or bypass validation. |
| Records appear missing | Confirm the exact browser profile, hostname, port and protocol. Restore only from a validated backup after reviewing and confirming replacement. |

## Device coverage and limitations

Installation and offline use require service workers, Cache Storage, IndexedDB
and Web Locks in a supported secure context. Browser and OS policies govern
storage retention, installation controls, launcher icons and file-picker/download
behavior. Private browsing or storage eviction can remove the offline shell or
diary. Keep backups and confirm the storage context when moving between a browser
tab and an installed app; do not assume their records are shared.

For contributor regression testing, check platform-specific installation, offline
updates, interruption/peer behavior, accessibility and large-history performance
on the relevant devices. Desktop emulation, decoded icons and injected quota
failures do not substitute for real-device checks of Safari, Android launchers,
assistive technology or OS storage behavior.

## Physical-device checklist

When changing installation, storage or update behavior, use one disposable diary
on the intended trusted HTTPS origin. Record the tested build (source revision
and shell version), device, OS/browser versions, exact origin, installed/tab
storage behavior, scenarios and each actual result; desktop Chromium emulation
does not establish real-device behavior.

- [ ] Open Safari online; check name, supplied branding and all destinations. Save
      a private backup download, select it again and exercise validated confirmed
      replacement without losing the prior diary on invalid/failed input.
- [ ] Share → Add to Home Screen **from the app path**. Check the color
      goat/sun/mountain/path icon without wordmark or clipped horns, and standalone
      launch directly to the configured app start URL, never the landing. Record
      actual tab-versus-installed storage behavior rather than assuming equivalence.
- [ ] Complete first shell installation, reopen once online, then use airplane
      mode. Reopen/reload, visit all destinations, create a test habit,
      check/uncheck a completion, exercise export/restore and reopen again. Verify
      exact records and progression, not only that a still-open screen renders.
- [ ] On a new version, pristine reopen or clean resume updates quietly without a
      routine banner/modal. In **EN and PT**, dirty habit/pillar forms and unsaved
      or deliberately failed-save onboarding drafts survive background/resume
      with literal input, no reload and no automatic discard dialog. Exercise
      explicit Save/Retry and navigation Keep editing/Escape/Discard, then a later
      clean entry; becoming clean alone must not reload an active session.
- [ ] Keep another Safari tab/Home Screen window editing or suspended. Activation
      stays deferred; close the peer and enter cleanly. Optional Settings check
      and pending fallback truthfully explain current/offline/failure/awaiting
      states without forcing a peer or bypassing draft/operation guards.
- [ ] Interrupt candidate download; old tracking/offline reopening and records
      remain usable. Retry online. Exercise backup parsing/export/restore,
      deletion/replacement confirmation and onboarding autosave/finalization
      without interruption or premature application of the update.
- [ ] After transition, compare literal facts, ownership/lifecycle, progression and
      language/motion/Progress preferences; verify fresh offline installed launch.
      Inspect home-screen icon refresh after ordinary reload/reopen first. Export
      and validate a backup before any separately chosen removal/reinstallation
      or site-data clearing; never use a real diary for destructive testing.
- [ ] Review VoiceOver, software keyboard, larger text, safe areas,
      portrait/landscape and touch targets. Record actual failures and untested
      storage/eviction conditions instead of treating emulation or injected quota
      errors as device evidence.

Hosting/TLS configuration, DNS/firewall changes and notification permission/push
testing are separate from this checklist. Accounts, sync, telemetry, dark mode,
reminders, notifications and the catalog/avatar mapping remain out of scope.
