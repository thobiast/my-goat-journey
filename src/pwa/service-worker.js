// The production build replaces this token with final output metadata.
const CONFIG = __APP_SHELL_CONFIG__;
const PREFIX = `my-goat-journey:${encodeURIComponent(CONFIG.base)}:`;
const SHELL_PREFIX = `${PREFIX}shell:`;
const CACHE = `${SHELL_PREFIX}${CONFIG.version}`;
const absolute = path => new URL(path, self.location.origin).href;
const assetDirectories = ['assets/', 'icons/', 'branding/'].map(path => `${CONFIG.base}${path}`);
const META = `${PREFIX}clients`;
const metaPath = `${CONFIG.base}__app_shell__/`;
const activeKey = absolute(`${metaPath}active`);
const installedKey = absolute(`${metaPath}installed`);
const clientKey = id => absolute(`${metaPath}client/${encodeURIComponent(id)}`);
const retiredKey = version => absolute(`${metaPath}retired/${version}`);
const installingKey = version => absolute(`${metaPath}installing/${version}`);
// Only exact marker key/value pairs can authorize shell-name construction.
const validVersion = version => typeof version === 'string' && /^[a-zA-Z0-9_-]+$/.test(version);
const inScope = client => {
  const url = new URL(client.url);
  return url.origin === self.location.origin && url.pathname.startsWith(CONFIG.base);
};
const windows = async () => (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(inScope);
const read = async (cache, key) => (await cache.match(key))?.text();
// Quota can prevent a new document assignment without evicting verified bytes.
// Keep that document coherent for this worker lifetime. Removing the active
// pointer is the durable failure fence: cleanup retains everything and a later
// replacement must not guess unknown predecessor assignments. A restarted
// worker fails closed for lost volatile assignments; a new navigation recovers.
const volatileClients = new Map();
const fenceMetadataFailure = metadata => metadata.delete(activeKey);
// Web Locks are origin-wide across worker globals, unlike a local promise or a
// check-then-write CacheStorage marker. Hold this lock from before opening an
// installing destination through publication, and across cleanup's whole
// snapshot/delete operation. Worker termination automatically releases it;
// there is no durable lease to expire unsafely or strand after interruption.
const shellLock = `${PREFIX}shell-lifecycle`;
const withShellLock = async action => {
  if (!self.navigator?.locks) throw new Error('App-shell coordination is unavailable');
  return self.navigator.locks.request(shellLock, action);
};

// Positive bootstrap evidence is admitted only before any app/base shell or
// metadata exists, with no active/waiting registration. This is not a claim about
// other window controllers: the tag identifies a new, never-published cache
// incarnation. Any assignment blocks recovery; client enumeration must work.
async function firstInstallation(metadata, version, owned = false) {
  if (self.registration.scope !== absolute(CONFIG.base) || self.registration.active || self.registration.waiting) return false;
  const entries = await metadata.keys();
  if (owned ? entries.length !== 1 || entries[0].url !== installingKey(version) : entries.length !== 0) return false;
  const allowed = new Set([META]);
  if (owned) allowed.add(`${SHELL_PREFIX}${version}`);
  if ((await caches.keys()).some(name => name.startsWith(PREFIX) && !allowed.has(name))) return false;
  for (const client of await windows()) if (typeof client.id !== 'string' || !client.id) return false;
  return true;
}

// Caller holds shellLock, so no live installer can own a deletable handle.
// Unlike retirement cleanup, interrupted-install recovery protects ALL durable
// assignments, even an observed assignment whose client is no longer enumerated.
async function recoverInstallations(metadata) {
  const active = await read(metadata, activeKey);
  const installed = await read(metadata, installedKey);
  if (!validVersion(active) || !validVersion(installed)) {
    // Absence alone is not bootstrap proof (quota fencing can remove active).
    if (active !== undefined || installed !== undefined) return;
    const entries = await metadata.keys();
    if (entries.length !== 1) return;
    const request = entries[0];
    const marker = await metadata.match(request);
    const version = await marker?.text();
    if (!validVersion(version) || request.url !== installingKey(version) || marker.headers.get('X-App-Shell-Phase') !== 'initial') return;
    if (!await firstInstallation(metadata, version, true)) return;
    // Keep ownership until deletion settles; a later same-version retry repeats
    // this operation if termination/deletion interrupts marker housekeeping.
    await caches.delete(`${SHELL_PREFIX}${version}`);
    await metadata.delete(request);
    return;
  }
  const used = new Set([active, installed]);
  for (const client of await windows()) {
    const version = await read(metadata, clientKey(client.id));
    if (!validVersion(version)) return; // Includes unknown/uncontrolled/suspended windows.
    used.add(version);
  }
  const entries = await metadata.keys();
  const completed = new Set([active, installed]);
  for (const request of entries) {
    if (request.url.startsWith(absolute(`${metaPath}client/`))) {
      const version = await read(metadata, request);
      if (!validVersion(version)) return;
      used.add(version);
    } else if (request.url.startsWith(absolute(`${metaPath}retired/`))) {
      const version = await read(metadata, request);
      if (!validVersion(version) || request.url !== retiredKey(version)) return;
      // Retirement proves earlier successful publication. A leftover ownership
      // marker is housekeeping, never permission to discard a rollback shell.
      completed.add(version);
    }
  }
  for (const request of entries) {
    if (!request.url.startsWith(absolute(`${metaPath}installing/`))) continue;
    const marker = await metadata.match(request);
    const version = await marker?.text();
    if (!validVersion(version) || request.url !== installingKey(version)) continue;
    try {
      if (completed.has(version)) await metadata.delete(request);
      else if (!used.has(version) && marker.headers.get('X-App-Shell-Phase') !== 'verified') {
        // Delete first. A rejection/termination leaves durable retry evidence;
        // a false result means the cache is already absent (also safe to retry).
        await caches.delete(`${SHELL_PREFIX}${version}`);
        await metadata.delete(request);
      }
    } catch {
      // Keep the marker on failed deletion; another lifecycle event can retry.
    }
  }
}

// Retire both previous active shells and superseded completed candidates.
// The latest successful install stays protected while it waits for consent.
async function cleanup() {
  // Unsupported browsers retain existing caches rather than delete unsafely.
  if (!self.navigator?.locks) return;
  return withShellLock(async () => {
    const metadata = await caches.open(META);
    if (await read(metadata, activeKey) !== CONFIG.version) return;
    await recoverInstallations(metadata);
    const live = await windows();
    const used = new Set([CONFIG.version]);
    used.add(await read(metadata, installedKey));
    for (const client of live) {
      const version = await read(metadata, clientKey(client.id));
      if (!version) return; // An unknown live client makes deletion unsafe.
      used.add(version);
    }
    const liveKeys = new Set(live.map(client => clientKey(client.id)));
    const entries = await metadata.keys();
    // A navigation response can precede its client's appearance in matchAll.
    // Preserve its version and assignment until the document is actually seen.
    // Aborted/unobserved navigations are retained conservatively rather than
    // guessed dead with a timer that could invalidate a suspended slow load.
    for (const request of entries) {
      if (!request.url.startsWith(absolute(`${metaPath}client/`))) continue;
      const assignment = await metadata.match(request);
      if (!assignment) continue;
      const version = await assignment.text();
      if (assignment.headers.has('X-App-Shell-Pending')) {
        used.add(version);
        if (liveKeys.has(request.url)) await metadata.put(request, new Response(version));
      } else if (!liveKeys.has(request.url)) await metadata.delete(request);
    }
    for (const request of entries) {
      if (request.url.startsWith(absolute(`${metaPath}retired/`))) {
        const version = await read(metadata, request);
        if (!used.has(version) && version !== await read(metadata, installedKey)) {
          await caches.delete(`${SHELL_PREFIX}${version}`);
          await metadata.delete(request);
        }
      }
    }
  });
}

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const metadata = await caches.open(META);
    const previous = await read(metadata, activeKey);
    // Assign even idle tabs before replacing the active version. Assignments are
    // durable so a worker restart cannot silently move an old document to B.
    let failed = false;
    for (const client of await windows()) {
      if (!await read(metadata, clientKey(client.id))) {
        volatileClients.set(client.id, previous || CONFIG.version);
        try { await metadata.put(clientKey(client.id), new Response(previous || CONFIG.version)); }
        catch { failed = true; }
      }
    }
    try {
      if (previous && previous !== CONFIG.version) await metadata.put(retiredKey(previous), new Response(previous));
      await metadata.delete(retiredKey(CONFIG.version));
      if (!failed) await metadata.put(activeKey, new Response(CONFIG.version));
    } catch { failed = true; }
    // Native activation is irreversible; optional housekeeping failure must not
    // prevent serving an intact shell or leave a stale active-version inference.
    if (failed) await fenceMetadataFailure(metadata);
    else await cleanup().catch(() => {});
    // No clients.claim(): uncontrolled network documents reload into the shell.
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type !== 'ACTIVATE_WHEN_ALONE') return;
  const port = event.ports?.[0];
  if (!port) return; // No acknowledgement channel, no activation.
  event.waitUntil((async () => {
    let accepted = false;
    try {
      const source = event.source;
      if (source?.type === 'window' && typeof source.id === 'string' && source.id && inScope(source)) {
        let activation;
        await withShellLock(async () => {
          const metadata = await caches.open(META);
          if (await read(metadata, installedKey) !== CONFIG.version) return;
          const live = await windows();
          if (live.length !== 1 || live[0].id !== source.id) return;
          const previous = await read(metadata, activeKey);
          // A missing pointer after quota failure is not an initial install.
          // Do not infer unknown documents from a stale predecessor on restart.
          if (!previous && (await caches.keys()).some(name => name.startsWith(SHELL_PREFIX) && name !== CACHE)) return;
          if (!await read(metadata, clientKey(source.id))) {
            // Essential preparation BEFORE the irreversible native transition.
            // Failure here denies consent and leaves the old worker in place.
            await metadata.put(clientKey(source.id), new Response(previous || CONFIG.version));
          }
          // Invoke synchronously while candidate/peer checks are protected, but
          // release coordination before awaiting native activation: its cleanup
          // must acquire this same lock before skipWaiting can resolve.
          activation = self.skipWaiting();
        });
        if (activation) {
          await activation;
          accepted = true;
        }
      }
    } catch {
      // Invalid/missing source, storage/client enumeration failure or rejected
      // skipWaiting must never silently grant activation consent.
    }
    port.postMessage({ accepted });
  })());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(CONFIG.base)) return;
  const asset = assetDirectories.some(path => url.pathname.startsWith(path)) || CONFIG.files.includes(url.pathname) && url.pathname !== `${CONFIG.base}index.html`;
  const navigation = event.request.mode === 'navigate' && !asset && !/\.[^/]+$/.test(url.pathname.slice(CONFIG.base.length));
  const index = event.request.mode === 'navigate' && url.pathname === `${CONFIG.base}index.html`;
  if (!navigation && !index && !asset) return;
  const response = (async () => {
    const metadata = await caches.open(META);
    let version = CONFIG.version;
    if (navigation || index) {
      if (event.resultingClientId) {
        const assign = async () => {
          volatileClients.set(event.resultingClientId, version);
          try { await metadata.put(clientKey(event.resultingClientId), new Response(version, { headers: { 'X-App-Shell-Pending': '1' } })); }
          catch { await fenceMetadataFailure(metadata); }
        };
        // Serialize the failure fence with cleanup's snapshot/delete decision.
        if (self.navigator?.locks) await withShellLock(assign);
        else await assign(); // Unsupported coordination already disables deletion.
      }
    } else if (event.clientId) {
      const assignment = await metadata.match(clientKey(event.clientId));
      const observe = async current => {
        version = volatileClients.get(event.clientId) || await current?.text();
        if (!version) {
          if (await read(metadata, activeKey) !== CONFIG.version && (await caches.keys()).some(name => name.startsWith(SHELL_PREFIX) && name !== CACHE)) throw new Error('App-shell client version is unavailable');
          version = CONFIG.version;
          volatileClients.set(event.clientId, version);
        }
        // Keep observation and its failure fence atomic with cleanup's snapshot:
        // removing pending protection outside this lock can erase a live client.
        if (!current || current.headers.has('X-App-Shell-Pending')) {
          try { await metadata.put(clientKey(event.clientId), new Response(version)); }
          catch { await fenceMetadataFailure(metadata); }
        }
      };
      if ((!assignment || assignment.headers.has('X-App-Shell-Pending')) && self.navigator?.locks) {
        await withShellLock(async () => observe(await metadata.match(clientKey(event.clientId))));
      } else await observe(assignment); // Known assignments need no mutation; missing locks disable cleanup.
    }
    const cache = await caches.open(`${SHELL_PREFIX}${version}`);
    const cached = await cache.match(absolute(navigation || index ? `${CONFIG.base}index.html` : url.pathname));
    if (cached) return cached;
    if (navigation || index) throw new Error('App shell is unavailable');
    // Storage eviction is a failure, not permission to mix an old document with
    // today's same-path logo/manifest or a replacement bundle from the network.
    if (version !== CONFIG.version || CONFIG.files.includes(url.pathname)) throw new Error('App-shell asset is unavailable');
    const network = await fetch(event.request);
    if (!network.ok) return network;
    if (network.headers.get('Content-Type')?.includes('text/html')) return new Response('Asset response was HTML', { status: 502, headers: { 'Content-Type': 'text/plain' } });
    return network;
  })();
  event.respondWith(response);
  // A navigation's resulting client may not yet appear in matchAll. Cleanup on
  // subsequent asset requests instead, after that document is visible.
  if (!navigation && !index) event.waitUntil(response.then(() => cleanup()).catch(() => {}));
});

// One budget for the serial transfer phase, including response bodies and cache
// writes. Shorter than the controller's 15s feedback timeout, not derived from it:
// only this worker can cancel its installation's network/body work.
const INSTALL_TRANSFER_BUDGET_MS = 12_000;
async function transferShell(cache) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('App-shell transfer budget exceeded')), INSTALL_TRANSFER_BUDGET_MS);
  try {
    for (const path of CONFIG.files) {
      controller.signal.throwIfAborted();
      const request = new Request(absolute(path), { cache: 'reload', integrity: CONFIG.integrity[path], signal: controller.signal });
      const response = await fetch(request);
      controller.signal.throwIfAborted();
      if (!response.ok || response.redirected) throw new Error(`App-shell fetch failed: ${path}`);
      const existing = await cache.match(request);
      controller.signal.throwIfAborted();
      // put consumes the body; retained rollbacks must consume it too, without
      // overwriting verified bytes. Abort errors settle before failure cleanup.
      if (existing) await response.arrayBuffer();
      else await cache.put(request, response);
      controller.signal.throwIfAborted();
    }
  } catch (error) {
    controller.abort(error);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener('install', event => {
  event.waitUntil(withShellLock(async () => {
    const metadata = await caches.open(META);
    await recoverInstallations(metadata).catch(() => {});
    // If recovery cannot prove a marked version disposable or completed, never
    // reuse its possibly partial responses as a retained verified rollback.
    const ownership = await metadata.match(installingKey(CONFIG.version));
    const verified = await ownership?.clone().text() === CONFIG.version && ownership.headers.get('X-App-Shell-Phase') === 'verified';
    if (ownership) {
      const completed = verified || await read(metadata, installedKey) === CONFIG.version ||
        await read(metadata, activeKey) === CONFIG.version ||
        await read(metadata, retiredKey(CONFIG.version)) === CONFIG.version;
      if (!completed) throw new Error('App-shell installation ownership is unresolved');
    }
    // A same-version rollback may reuse a retained shell, but does not own it
    // or its verified responses. Active cleanup cannot detach this handle.
    const retained = (await caches.keys()).includes(CACHE);
    let initial = false;
    let sealed = verified;
    if (!retained) {
      // Completion pointers belong to the previous cache incarnation. If its
      // name disappeared, do not recreate scratch beneath that stale evidence.
      if (verified || await read(metadata, activeKey) === CONFIG.version || await read(metadata, installedKey) === CONFIG.version) {
        throw new Error('App-shell completion is unresolved');
      }
      initial = await firstInstallation(metadata, CONFIG.version);
      // Deletion can terminate before its retirement cleanup. Clear only an
      // absent shell's stale retirement BEFORE recording ownership of a new one.
      // Never remove this evidence for a retained rollback on a failed install.
      await metadata.delete(retiredKey(CONFIG.version));
      await metadata.put(installingKey(CONFIG.version), new Response(CONFIG.version, {
        headers: initial ? { 'X-App-Shell-Phase': 'initial' } : {},
      }));
    }
    try {
      const cache = await caches.open(CACHE);
      await transferShell(cache);
      // Atomically retire bootstrap deletion authority BEFORE publication. A
      // restart here retains a fully verified shell and retries its downloads;
      // lost pointers can never turn a completed cache back into initial scratch.
      if (initial) {
        await metadata.put(installingKey(CONFIG.version), new Response(CONFIG.version, {
          headers: { 'X-App-Shell-Phase': 'verified' },
        }));
        sealed = true;
      }
      const previous = await read(metadata, installedKey);
      // Keep the successful candidate protected until retirement is recorded.
      // Preserve existing retirement markers if publication fails; cleanup
      // protects the installed version and activation removes its own marker.
      // Publishing the new pointer must be the final fallible metadata write.
      if (previous && previous !== CONFIG.version) await metadata.put(retiredKey(previous), new Response(previous));
      await metadata.put(installedKey, new Response(CONFIG.version));
    } catch (error) {
      if (!retained && !sealed) {
        // Never erase ownership until deletion has settled successfully. Sealing
        // already revoked scratch authority, including on publication failure.
        await caches.delete(CACHE);
        await metadata.delete(installingKey(CONFIG.version));
      }
      throw error;
    }
    // Publication is committed. A failure here must not reject installation or
    // run owned-failure cleanup; the installed/retired evidence protects success
    // if this worker terminates before housekeeping finishes.
    if (!retained || verified) await metadata.delete(installingKey(CONFIG.version)).catch(() => {});
  }));
});
