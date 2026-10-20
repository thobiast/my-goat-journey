/** TEST ONLY: native CacheStorage/Web Locks race with one lagged client snapshot.
 * This models enumeration lag deterministically; it does not claim to reproduce
 * browser-internal window discovery timing. No diary facts or signed files change.
 */
export function instrumentPendingAssignmentRace(source: string, unsafeMutation = false) {
  const snapshot = 'const live = await windows();';
  const observation = 'await metadata.put(clientKey(event.clientId), new Response(version));';
  const coordinated =
    'await withShellLock(async () => observe(await metadata.match(clientKey(event.clientId))));';
  if (!source.includes(snapshot) || !source.includes(observation) || !source.includes(coordinated))
    throw new Error('Pending assignment race instrumentation anchor missing');
  const prefix = `globalThis.__pendingRace = { armed: false, held: false, released: false, promotions: 0 };\n`;
  let emitted = source.replace(
    snapshot,
    `${snapshot}
    if (globalThis.__pendingRace.armed) {
      globalThis.__pendingRace.armed = false;
      const index = live.findIndex(client => client.id === globalThis.__pendingRace.omitId);
      if (index < 0) throw new Error('Synthetic lag requires a real observed client');
      live.splice(index, 1);
      globalThis.__pendingRace.held = true;
      await new Promise(resolve => { globalThis.__pendingRace.release = resolve; });
      globalThis.__pendingRace.held = false;
    }`,
  );
  emitted = emitted.replace(observation, `${observation} ++globalThis.__pendingRace.promotions;`);
  if (unsafeMutation)
    emitted = emitted.replace(
      coordinated,
      'await observe(await metadata.match(clientKey(event.clientId)));',
    );
  return (
    prefix +
    emitted +
    `
// TEST ONLY message routes, appended by the disposable browser proxy.
self.addEventListener('message', event => {
  if (event.data?.type === 'PWA_TEST_ARM_PENDING_RACE') {
    globalThis.__pendingRace.armed = true;
    globalThis.__pendingRace.omitId = event.source.id;
    event.ports[0]?.postMessage({ armed: true, omitId: event.source.id });
  }
  if (event.data?.type === 'PWA_TEST_PENDING_RACE_STATUS') {
    event.ports[0]?.postMessage({ ...globalThis.__pendingRace, release: undefined });
  }
  if (event.data?.type === 'PWA_TEST_RELEASE_PENDING_RACE') {
    globalThis.__pendingRace.released = true;
    globalThis.__pendingRace.release?.();
    event.ports[0]?.postMessage({ released: true });
  }
});\n`
  );
}
