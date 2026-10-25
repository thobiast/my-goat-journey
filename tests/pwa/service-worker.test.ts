import { expect, test, vi } from 'vitest';
import {
  barrier,
  key,
  MemoryCaches,
  origin,
  persistedRestart,
  worker,
  type Client,
} from './support/worker-model';

for (const base of ['/', '/my-goat-journey/app/', '/alternate/app/']) {
  test(`${base} interrupted installation ownership recovers after a persisted restart with A live`, async () => {
    const caches = new MemoryCaches();
    const live: Client[] = [];
    const a = worker(base, 'A', caches, live);
    await a.dispatch('install');
    await a.dispatch('activate');
    await a.request(base, '', 'live-A', true);
    live.push({ id: 'live-A', url: `${origin}${base}` });
    await a.request(`${base}assets/app.js`, 'live-A');
    const prefix = `my-goat-journey:${encodeURIComponent(base)}:`;
    const metadata = await caches.open(`${prefix}clients`);
    // Seed the durable boundary after B's first write, before publication.
    await metadata.put(`${base}__app_shell__/installing/B`, new Response('B'));
    const partial = await caches.open(`${prefix}shell:B`);
    await partial.put(`${base}index.html`, new Response('partial B'));
    const restarted = await persistedRestart(caches);
    const c = worker(base, 'C', restarted, live);
    await c.dispatch('install');
    await c.dispatch('activate');
    expect(await restarted.keys()).not.toContain(`${prefix}shell:B`);
    const after = await restarted.open(`${prefix}clients`);
    expect(await after.match(`${base}__app_shell__/installing/B`)).toBeUndefined();
    c.network.mockRejectedValue(new Error('offline'));
    expect(await (await c.request(`${base}assets/app.js`, 'live-A'))!.text()).toBe(
      `A:${base}assets/app.js`,
    );
    const fresh = worker(base, 'C', await persistedRestart(restarted), live);
    fresh.network.mockRejectedValue(new Error('offline'));
    expect(await (await fresh.request(base, '', 'offline-C', true))!.text()).toBe(
      `C:${base}index.html`,
    );
    expect(await (await fresh.request(`${base}assets/app.js`, 'offline-C'))!.text()).toBe(
      `C:${base}assets/app.js`,
    );
  });
}

async function recoveryFixture(base: string) {
  const caches = new MemoryCaches();
  const live: Client[] = [];
  const a = worker(base, 'A', caches, live);
  await a.dispatch('install');
  await a.dispatch('activate');
  await a.request(base, '', 'live-A', true);
  live.push({ id: 'live-A', url: `${origin}${base}` });
  await a.request(`${base}assets/app.js`, 'live-A');
  const prefix = `my-goat-journey:${encodeURIComponent(base)}:`;
  const metadata = await caches.open(`${prefix}clients`);
  const marker = `${base}__app_shell__/installing/B`;
  const shell = `${prefix}shell:B`;
  const seed = async (version = 'B') => {
    await metadata.put(`${base}__app_shell__/installing/${version}`, new Response(version));
    await (
      await caches.open(`${prefix}shell:${version}`)
    ).put(`${base}index.html`, new Response(`partial ${version}`));
  };
  return { caches, live, a, prefix, metadata, marker, shell, seed };
}

for (const state of [
  'empty',
  'foreign',
  'metadata',
  'namespace',
  'client',
  'scope',
  'active',
  'waiting',
]) {
  test(`decision readability characterization W1 fresh admission ${state}`, async () => {
    const base = '/my-goat-journey/app/';
    const prefix = `my-goat-journey:${encodeURIComponent(base)}:`;
    const caches = new MemoryCaches();
    const metadata = await caches.open(`${prefix}clients`);
    if (state === 'metadata')
      await metadata.put(`${base}__app_shell__/unknown`, new Response('unknown'));
    if (state === 'namespace') await caches.open(`${prefix}shell:other`);
    if (state === 'foreign') await caches.open('foreign-shell');
    const b = worker(base, 'B', caches);
    if (state === 'scope') b.registration.scope = `${origin}/other/`;
    if (state === 'active') b.registration.active = {};
    if (state === 'waiting') b.registration.waiting = {};
    if (state === 'client') b.live.push({ id: '', url: `${origin}${base}` });
    const operations: string[] = [];
    let admission = false;
    const names = caches.keys.bind(caches);
    vi.spyOn(caches, 'keys').mockImplementation(async () => {
      if (admission) operations.push('caches');
      // The first enumeration is retained-name detection, after recovery/W2.
      admission = true;
      return names();
    });
    const entries = metadata.keys.bind(metadata);
    vi.spyOn(metadata, 'keys').mockImplementation(async () => {
      if (admission) operations.push('metadata');
      return entries();
    });
    b.matchAll.mockImplementation(async () => {
      if (admission) operations.push('clients');
      return b.live;
    });
    const phases: (string | null)[] = [];
    const put = metadata.put.bind(metadata);
    vi.spyOn(metadata, 'put').mockImplementation(async (request, response) => {
      if (key(request) === key(`${base}__app_shell__/installing/B`)) {
        phases.push(response.headers.get('X-App-Shell-Phase'));
        admission = false;
      }
      return put(request, response);
    });
    await b.dispatch('install');
    expect(operations).toEqual(
      ['scope', 'active', 'waiting'].includes(state)
        ? []
        : state === 'metadata'
          ? ['metadata']
          : state === 'namespace'
            ? ['metadata', 'caches']
            : ['metadata', 'caches', 'clients'],
    );
    expect(phases).toEqual(['empty', 'foreign'].includes(state) ? ['initial', 'verified'] : [null]);
    if (b.matchAll.mock.calls.length) {
      expect(b.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
    }
  });
}

for (const shape of ['one', 'zero', 'wrong', 'multiple']) {
  test(`decision readability characterization W1 owned metadata ${shape}`, async () => {
    const base = '/my-goat-journey/app/';
    const prefix = `my-goat-journey:${encodeURIComponent(base)}:`;
    const marker = `${base}__app_shell__/installing/B`;
    const shell = `${prefix}shell:B`;
    const caches = new MemoryCaches();
    const metadata = await caches.open(`${prefix}clients`);
    await metadata.put(marker, new Response('B', { headers: { 'X-App-Shell-Phase': 'initial' } }));
    const partial = await caches.open(shell);
    await partial.put(`${base}index.html`, new Response('partial B'));
    const b = worker(base, 'B', caches);
    const operations: string[] = [];
    const entries = metadata.keys.bind(metadata);
    let snapshots = 0;
    let recovery = false;
    vi.spyOn(metadata, 'keys').mockImplementation(async () => {
      if (++snapshots !== 2) return entries();
      // Recovery's first snapshot found the exact initial marker. Observe the
      // separate owned revalidation, including inconsistent later snapshots.
      recovery = true;
      operations.push('metadata');
      if (shape === 'zero') return [];
      if (shape === 'wrong') return [new Request(`${origin}${base}__app_shell__/unknown`)];
      if (shape === 'multiple')
        return [...(await entries()), new Request(`${origin}${base}__app_shell__/unknown`)];
      return entries();
    });
    const names = caches.keys.bind(caches);
    vi.spyOn(caches, 'keys').mockImplementation(async () => {
      if (recovery) operations.push('caches');
      return names();
    });
    b.matchAll.mockImplementation(async () => {
      if (recovery) operations.push('clients');
      return [];
    });
    const remove = caches.delete.bind(caches);
    const deletion = vi.spyOn(caches, 'delete').mockImplementation(async (name) => {
      recovery = false;
      return remove(name);
    });
    if (shape === 'one') {
      await b.dispatch('install');
      expect(operations).toEqual(['metadata', 'caches', 'clients']);
      expect(deletion).toHaveBeenCalledExactlyOnceWith(shell);
      expect(await (await caches.entries.get(shell)!.match(`${base}index.html`))!.text()).toBe(
        `B:${base}index.html`,
      );
    } else {
      await expect(b.dispatch('install')).rejects.toThrow(
        'App-shell installation ownership is unresolved',
      );
      expect(operations).toEqual(['metadata']);
      expect(deletion).not.toHaveBeenCalled();
      expect(caches.entries.get(shell)).toBe(partial);
      expect(await (await partial.match(`${base}index.html`))!.text()).toBe('partial B');
      expect(await metadata.match(marker)).toBeDefined();
      expect(b.network).not.toHaveBeenCalled();
    }
  });
}

for (const owned of [false, true]) {
  for (const failure of ['metadata', 'caches', 'clients']) {
    test(`decision readability characterization W1 ${owned ? 'recovery' : 'admission'} reached ${failure} rejection`, async () => {
      const base = '/my-goat-journey/app/';
      const prefix = `my-goat-journey:${encodeURIComponent(base)}:`;
      const caches = new MemoryCaches();
      const metadata = await caches.open(`${prefix}clients`);
      const marker = `${base}__app_shell__/installing/B`;
      const shell = `${prefix}shell:B`;
      if (owned) {
        await metadata.put(
          marker,
          new Response('B', { headers: { 'X-App-Shell-Phase': 'initial' } }),
        );
        await caches.open(shell);
      }
      const b = worker(base, 'B', caches);
      const sentinel = new Error(`reached ${failure}`);
      const operations: string[] = [];
      let decision = false;
      let snapshots = 0;
      const entries = metadata.keys.bind(metadata);
      vi.spyOn(metadata, 'keys').mockImplementation(async () => {
        if (owned && ++snapshots === 2) decision = true;
        if (decision) {
          operations.push('metadata');
          if (failure === 'metadata') throw sentinel;
        }
        return entries();
      });
      const names = caches.keys.bind(caches);
      vi.spyOn(caches, 'keys').mockImplementation(async () => {
        if (!owned && !decision) {
          decision = true;
          return names();
        }
        operations.push('caches');
        if (failure === 'caches') throw sentinel;
        return names();
      });
      b.matchAll.mockImplementation(async () => {
        operations.push('clients');
        if (failure === 'clients') throw sentinel;
        return [];
      });
      const deletion = vi.spyOn(caches, 'delete');
      const installation = b.dispatch('install');
      if (owned)
        await expect(installation).rejects.toThrow(
          'App-shell installation ownership is unresolved',
        );
      else await expect(installation).rejects.toBe(sentinel);
      expect(operations).toEqual(
        ['metadata', 'caches', 'clients'].slice(
          0,
          ['metadata', 'caches', 'clients'].indexOf(failure) + 1,
        ),
      );
      expect(deletion).not.toHaveBeenCalled();
      expect(b.network).not.toHaveBeenCalled();
      expect(caches.entries.has(shell)).toBe(owned);
      expect(metadata.entries.has(key(marker))).toBe(owned);
    });
  }
}

const ownershipScenarios: {
  name: string;
  body?: string;
  phase?: string;
  active?: string;
  installed?: string;
  retired?: string;
  failure?: string;
  expected: string;
}[] = [
  { name: 'absent', body: undefined, expected: 'ownership' },
  { name: 'verified', phase: 'verified', expected: 'ownership clone body phase' },
  {
    name: 'installed',
    installed: 'B',
    expected: 'ownership clone body phase installed installed-body',
  },
  {
    name: 'active',
    active: 'B',
    expected: 'ownership clone body phase installed installed-body active active-body',
  },
  {
    name: 'retired',
    retired: 'B',
    expected:
      'ownership clone body phase installed installed-body active active-body retired retired-body',
  },
  {
    name: 'unresolved',
    expected: 'ownership clone body phase installed installed-body active active-body retired',
  },
  {
    name: 'wrong-body',
    body: 'wrong',
    installed: 'B',
    expected: 'ownership clone body installed installed-body',
  },
  {
    name: 'wrong-phase',
    phase: 'initial',
    installed: 'B',
    expected: 'ownership clone body phase installed installed-body',
  },
  {
    name: 'missing-phase',
    installed: 'B',
    expected: 'ownership clone body phase installed installed-body',
  },
  {
    name: 'missing-pointers',
    active: undefined,
    installed: undefined,
    retired: 'B',
    expected: 'ownership clone body phase installed active retired retired-body',
  },
  {
    name: 'delayed-installed',
    active: 'B',
    expected: 'ownership clone body phase installed installed-body active active-body',
  },
  ...[
    'ownership',
    'clone',
    'body',
    'phase',
    'installed',
    'installed-body',
    'active',
    'active-body',
    'retired',
    'retired-body',
  ].map((failure) => ({
    name: `reached-${failure}`,
    failure,
    retired: 'A',
    expected:
      'ownership clone body phase installed installed-body active active-body retired retired-body'
        .split(' ')
        .slice(
          0,
          [
            'ownership',
            'clone',
            'body',
            'phase',
            'installed',
            'installed-body',
            'active',
            'active-body',
            'retired',
            'retired-body',
          ].indexOf(failure) + 1,
        )
        .join(' '),
  })),
];
for (const scenario of ownershipScenarios) {
  test(`decision readability characterization W2 ${scenario.name}`, async () => {
    const base = '/my-goat-journey/app/';
    const prefix = `my-goat-journey:${encodeURIComponent(base)}:`;
    const caches = new MemoryCaches();
    const metadata = await caches.open(`${prefix}clients`);
    const marker = `${base}__app_shell__/installing/B`;
    const shell = `${prefix}shell:B`;
    const pointer = (name: string) =>
      `${base}__app_shell__/${name === 'retired' ? 'retired/B' : name}`;
    // An unknown live window conservatively blocks recovery before ownership
    // housekeeping. The protocol still runs; only the later decision is logged.
    for (const name of ['active', 'installed'] as const) {
      const value = name in scenario ? scenario[name] : 'A';
      if (value !== undefined) await metadata.put(pointer(name), new Response(value));
    }
    if ('retired' in scenario)
      await metadata.put(pointer('retired'), new Response(scenario.retired));
    if (scenario.name !== 'absent') {
      await metadata.put(
        marker,
        new Response('body' in scenario ? scenario.body : 'B', {
          headers:
            'phase' in scenario && scenario.phase ? { 'X-App-Shell-Phase': scenario.phase } : {},
        }),
      );
    }
    await caches.open(shell);
    const b = worker(base, 'B', caches, [{ id: 'unknown', url: `${origin}${base}` }]);
    const operations: string[] = [];
    const sentinel = new Error(`W2 ${scenario.name}`);
    const destination = new Error('destination boundary');
    const held = barrier();
    const release = barrier();
    const record = (operation: string) => {
      operations.push(operation);
      if ('failure' in scenario && scenario.failure === operation) throw sentinel;
    };
    let decision = false;
    let original: Response | undefined;
    const match = metadata.match.bind(metadata);
    vi.spyOn(metadata, 'match').mockImplementation(async (request) => {
      if (key(request) === key(marker)) {
        decision = true;
        record('ownership');
        original = await match(request);
        if (original) {
          const clone = original.clone.bind(original);
          vi.spyOn(original, 'clone').mockImplementation(() => {
            record('clone');
            const response = clone();
            const text = response.text.bind(response);
            vi.spyOn(response, 'text').mockImplementation(async () => {
              record('body');
              return text();
            });
            return response;
          });
          const get = original.headers.get.bind(original.headers);
          vi.spyOn(original.headers, 'get').mockImplementation((name) => {
            record('phase');
            return get(name);
          });
        }
        return original;
      }
      const name = ['installed', 'active', 'retired'].find(
        (name) => key(request) === key(pointer(name)),
      );
      if (decision && name) {
        // A later rejecting read must not be reached after earlier recognition.
        if (
          ['verified', 'installed', 'wrong-body', 'wrong-phase', 'missing-phase'].includes(
            scenario.name,
          )
        ) {
          const forbidden =
            scenario.name === 'verified'
              ? ['installed', 'active', 'retired']
              : ['active', 'retired'];
          if (forbidden.includes(name)) throw new Error(`unexpected later ${name}`);
        }
        if (scenario.name === 'active' && name === 'retired') throw new Error('unexpected retired');
        record(name);
        const response = await match(request);
        if (response) {
          const text = response.text.bind(response);
          vi.spyOn(response, 'text').mockImplementation(async () => {
            record(`${name}-body`);
            if (scenario.name === 'delayed-installed' && name === 'installed') {
              held.resolve();
              await release.promise;
            }
            return text();
          });
        }
        return response;
      }
      return match(request);
    });
    const names = caches.keys.bind(caches);
    const enumeration = vi.spyOn(caches, 'keys').mockImplementation(async () => {
      decision = false; // End W2 before retained-name detection/W3/publication.
      return names();
    });
    const open = caches.open.bind(caches);
    vi.spyOn(caches, 'open').mockImplementation(async (name) => {
      if (name === shell) throw destination;
      return open(name);
    });
    const deletion = vi.spyOn(caches, 'delete');
    const writes = vi.spyOn(metadata, 'put');
    const installation = b.dispatch('install').catch((error: unknown) => error);
    try {
      if (scenario.name === 'delayed-installed') {
        await held.promise;
        expect(operations).toEqual(
          'ownership clone body phase installed installed-body'.split(' '),
        );
        expect(enumeration).not.toHaveBeenCalled();
      }
    } finally {
      release.resolve();
    }
    const error = await installation;
    if ('failure' in scenario) expect(error).toBe(sentinel);
    else if (scenario.name === 'unresolved')
      expect(error).toEqual(new Error('App-shell installation ownership is unresolved'));
    else expect(error).toBe(destination);
    expect(operations).toEqual(scenario.expected.split(' '));
    expect(enumeration).toHaveBeenCalledTimes(
      'failure' in scenario || scenario.name === 'unresolved' ? 0 : 1,
    );
    expect(deletion).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
    expect(b.network).not.toHaveBeenCalled();
    expect(caches.entries.has(shell)).toBe(true);
    if (original) {
      expect(original.bodyUsed).toBe(false);
      expect(await original.text()).toBe('body' in scenario ? scenario.body : 'B');
    }
  });
}

const absentCacheScenarios: {
  name: string;
  phase?: string;
  active?: string;
  installed?: string;
  owned?: boolean;
  retained?: boolean;
  success?: boolean;
  failure?: string;
  expected: string;
}[] = [
  { name: 'verified', phase: 'verified', expected: '' },
  { name: 'active', active: 'B', expected: 'active active-body' },
  { name: 'installed', installed: 'B', expected: 'active active-body installed installed-body' },
  {
    name: 'owned-installed',
    installed: 'B',
    owned: true,
    expected: 'active active-body installed installed-body',
  },
  { name: 'no-completion', expected: 'active active-body installed installed-body', success: true },
  { name: 'retained', retained: true, owned: true, installed: 'B', expected: '', success: true },
  ...['active', 'active-body', 'installed', 'installed-body'].map((failure) => ({
    name: `reached-${failure}`,
    failure,
    expected: 'active active-body installed installed-body'
      .split(' ')
      .slice(0, ['active', 'active-body', 'installed', 'installed-body'].indexOf(failure) + 1)
      .join(' '),
  })),
];
for (const scenario of absentCacheScenarios) {
  test(`decision readability characterization W3 ${scenario.name}`, async () => {
    const base = '/my-goat-journey/app/';
    const prefix = `my-goat-journey:${encodeURIComponent(base)}:`;
    const shell = `${prefix}shell:B`;
    const marker = `${base}__app_shell__/installing/B`;
    const retired = `${base}__app_shell__/retired/B`;
    const caches = new MemoryCaches();
    const metadata = await caches.open(`${prefix}clients`);
    for (const name of ['active', 'installed'] as const) {
      await metadata.put(
        `${base}__app_shell__/${name}`,
        new Response(name in scenario ? scenario[name] : 'A'),
      );
    }
    await metadata.put(retired, new Response('B'));
    if ('owned' in scenario || 'phase' in scenario) {
      await metadata.put(
        marker,
        new Response('B', {
          headers: scenario.phase ? { 'X-App-Shell-Phase': scenario.phase } : {},
        }),
      );
    }
    if ('retained' in scenario) await caches.open(shell);
    const before = new Map(metadata.entries);
    const b = worker(base, 'B', caches, [{ id: 'unknown', url: `${origin}${base}` }]);
    const sentinel = new Error(`W3 ${scenario.name}`);
    const operations: string[] = [];
    const allReads: string[] = [];
    let interval = 'recovery';
    const match = metadata.match.bind(metadata);
    vi.spyOn(metadata, 'match').mockImplementation(async (request) => {
      const path = new URL(key(request)).pathname.slice(`${base}__app_shell__/`.length);
      if (path === 'installing/B') interval = 'ownership';
      allReads.push(`${interval}:${path}`);
      if (interval !== 'guard') return match(request);
      operations.push(path);
      if ('failure' in scenario && scenario.failure === path) throw sentinel;
      if (scenario.name === 'verified' || (scenario.name === 'active' && path === 'installed')) {
        throw new Error(`unexpected later ${path}`);
      }
      const response = await match(request);
      if (response) {
        const text = response.text.bind(response);
        vi.spyOn(response, 'text').mockImplementation(async () => {
          operations.push(`${path}-body`);
          if ('failure' in scenario && scenario.failure === `${path}-body`) throw sentinel;
          return text();
        });
      }
      return response;
    });
    const names = caches.keys.bind(caches);
    vi.spyOn(caches, 'keys').mockImplementation(async () => {
      interval = 'guard';
      return names();
    });
    const entries = metadata.keys.bind(metadata);
    const admission = vi.spyOn(metadata, 'keys').mockImplementation(async () => {
      if (interval === 'guard') interval = 'admission';
      return entries();
    });
    const open = caches.open.bind(caches);
    const opening = vi.spyOn(caches, 'open').mockImplementation(async (name) => {
      if (name === shell) interval = 'publication';
      return open(name);
    });
    const writes = vi.spyOn(metadata, 'put');
    const removal = vi.spyOn(metadata, 'delete');
    const deletion = vi.spyOn(caches, 'delete');
    if ('success' in scenario) {
      await b.dispatch('install');
      expect(b.network).toHaveBeenCalledTimes(b.files.length);
      expect(await (await match(`${base}__app_shell__/installed`))!.text()).toBe('B');
      expect(allReads.filter((entry) => entry === 'publication:installed')).toHaveLength(1);
      if ('retained' in scenario) {
        expect(admission).not.toHaveBeenCalled();
        expect(writes.mock.calls.map(([request]) => key(request))).not.toContain(key(marker));
        expect(removal.mock.calls.map(([request]) => key(request))).not.toContain(key(retired));
      } else {
        expect(removal.mock.calls.map(([request]) => key(request))).toContain(key(retired));
        expect(writes.mock.calls.map(([request]) => key(request))).toContain(key(marker));
      }
    } else {
      const installation = b.dispatch('install');
      if ('failure' in scenario) await expect(installation).rejects.toBe(sentinel);
      else await expect(installation).rejects.toThrow('App-shell completion is unresolved');
      expect(admission).not.toHaveBeenCalled();
      expect(opening.mock.calls.map(([name]) => name)).not.toContain(shell);
      expect(metadata.entries).toEqual(before);
      expect(writes).not.toHaveBeenCalled();
      expect(removal).not.toHaveBeenCalled();
      expect(b.network).not.toHaveBeenCalled();
      expect(caches.entries.has(shell)).toBe(false);
    }
    expect(operations).toEqual(scenario.expected ? scenario.expected.split(' ') : []);
    if (scenario.name === 'owned-installed') {
      expect(allReads.filter((entry) => entry === 'ownership:installed')).toHaveLength(1);
      expect(allReads.filter((entry) => entry === 'guard:installed')).toHaveLength(1);
    }
    expect(deletion).not.toHaveBeenCalled();
  });
}

for (const base of ['/', '/my-goat-journey/app/', '/alternate/app/']) {
  for (const phase of ['intent', 'open', 'write', 'transferred', 'published']) {
    test(`${base} persisted termination boundary ${phase} preserves publication ordering`, async () => {
      vi.useFakeTimers();
      try {
        const { caches, live, prefix, metadata, marker, shell } = await recoveryFixture(base);
        const reached = barrier();
        const never = new Promise<never>(() => {});
        const open = caches.open.bind(caches);
        const put = metadata.put.bind(metadata);
        vi.spyOn(caches, 'open').mockImplementation(async (name) => {
          if (name !== shell) return open(name);
          expect(await (await metadata.match(marker))!.text()).toBe('B');
          if (phase === 'intent') {
            reached.resolve();
            return never;
          }
          const cache = await open(name);
          if (phase === 'open') {
            reached.resolve();
            return never;
          }
          if (phase === 'write') {
            const write = cache.put.bind(cache);
            vi.spyOn(cache, 'put').mockImplementationOnce(async (request, response) => {
              await write(request, response);
              reached.resolve();
              return never;
            });
          }
          return cache;
        });
        vi.spyOn(metadata, 'put').mockImplementation(async (request, response) => {
          if (
            key(request) === key(`${base}__app_shell__/installed`) &&
            (phase === 'transferred' || phase === 'published')
          ) {
            if (phase === 'published') await put(request, response);
            reached.resolve();
            return never;
          }
          return put(request, response);
        });
        const b = worker(base, 'B', caches, live);
        // Deliberately never reject/resolve this worker: copy only persistent
        // state to a fresh context, with none of its promises/locks/timers.
        void b.dispatch('install');
        await reached.promise;
        vi.restoreAllMocks();
        const persisted = await persistedRestart(caches);
        const oldShell = persisted.entries.get(shell);
        expect(oldShell?.entries.size ?? 0).toBe(
          phase === 'intent' ? 0 : phase === 'open' ? 0 : phase === 'write' ? 1 : b.files.length,
        );
        expect(await (await persisted.open(`${prefix}clients`)).match(marker)).toBeDefined();
        const c = worker(base, 'C', persisted, live);
        await c.dispatch('install');
        expect((await persisted.keys()).includes(shell)).toBe(phase === 'published');
        expect(await (await persisted.open(`${prefix}clients`)).match(marker)).toBeUndefined();
        c.network.mockRejectedValue(new Error('offline'));
        expect(await (await c.request(`${base}assets/app.js`, 'live-A'))!.text()).toBe(
          `A:${base}assets/app.js`,
        );
      } finally {
        vi.restoreAllMocks();
        vi.useRealTimers();
      }
    });
  }

  test(`${base} stale retirement cannot certify a newly owned cache incarnation`, async () => {
    vi.useFakeTimers();
    try {
      const { caches, live, metadata, shell, marker } = await recoveryFixture(base);
      // The previous incarnation was deleted, but termination prevented removal
      // of its retirement entry. No target cache exists now.
      await metadata.put(`${base}__app_shell__/retired/B`, new Response('B'));
      const reached = barrier();
      const open = caches.open.bind(caches);
      vi.spyOn(caches, 'open').mockImplementation(async (name) => {
        const cache = await open(name);
        if (name === shell) {
          const put = cache.put.bind(cache);
          vi.spyOn(cache, 'put').mockImplementationOnce(async (request, response) => {
            await put(request, response);
            reached.resolve();
            return new Promise<never>(() => {});
          });
        }
        return cache;
      });
      void worker(base, 'B', caches, live).dispatch('install');
      await reached.promise;
      vi.restoreAllMocks();
      const restarted = await persistedRestart(caches);
      await worker(base, 'C', restarted, live).dispatch('install');
      expect(await restarted.keys()).not.toContain(shell);
      expect(
        await (
          await restarted.open(`my-goat-journey:${encodeURIComponent(base)}:clients`)
        ).match(marker),
      ).toBeUndefined();
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });

  test(`${base} stale retirement cleanup failure denies untracked incarnation creation`, async () => {
    const { caches, live, metadata, marker, shell } = await recoveryFixture(base);
    const retired = `${base}__app_shell__/retired/B`;
    await metadata.put(retired, new Response('B'));
    const remove = metadata.delete.bind(metadata);
    vi.spyOn(metadata, 'delete').mockImplementation(async (request) => {
      if (key(request) === key(retired)) throw new Error('retirement cleanup failed');
      return remove(request);
    });
    const b = worker(base, 'B', caches, live);
    await expect(b.dispatch('install')).rejects.toThrow('retirement cleanup failed');
    expect(await metadata.match(marker)).toBeUndefined();
    expect(await metadata.match(retired)).toBeDefined();
    expect(await caches.keys()).not.toContain(shell);
    expect(b.network).not.toHaveBeenCalled();
  });

  for (const pointer of ['active', 'installed']) {
    test(`${base} absent shell with stale ${pointer} evidence rejects new incarnation`, async () => {
      const { caches, live, metadata, shell, marker } = await recoveryFixture(base);
      await metadata.put(`${base}__app_shell__/${pointer}`, new Response('B'));
      const b = worker(base, 'B', caches, live);
      await expect(b.dispatch('install')).rejects.toThrow('completion is unresolved');
      expect(await caches.keys()).not.toContain(shell);
      expect(await metadata.match(marker)).toBeUndefined();
      expect(b.network).not.toHaveBeenCalled();
    });
  }

  test(`${base} interrupted first install retries the same version with complete fresh bytes`, async () => {
    const caches = new MemoryCaches();
    const prefix = `my-goat-journey:${encodeURIComponent(base)}:`;
    const metadata = await caches.open(`${prefix}clients`);
    await metadata.put(
      `${base}__app_shell__/installing/B`,
      new Response('B', {
        headers: { 'X-App-Shell-Phase': 'initial' },
      }),
    );
    await (
      await caches.open(`${prefix}shell:B`)
    ).put(`${base}index.html`, new Response('partial B'));
    const restarted = await persistedRestart(caches);
    const b = worker(base, 'B', restarted);
    await b.dispatch('install');
    expect(b.network).toHaveBeenCalledTimes(b.files.length);
    for (const path of b.files)
      expect(await (await (await restarted.open(`${prefix}shell:B`)).match(path))!.text()).toBe(
        `B:${path}`,
      );
    await b.dispatch('activate');
    const fresh = worker(base, 'B', await persistedRestart(restarted));
    fresh.network.mockRejectedValue(new Error('offline'));
    expect(await (await fresh.request(base, '', 'fresh-offline', true))!.text()).toBe(
      `B:${base}index.html`,
    );
    expect(await (await fresh.request(`${base}assets/app.js`, 'fresh-offline'))!.text()).toBe(
      `B:${base}assets/app.js`,
    );
  });

  for (const phase of ['intent', 'partial', 'complete', 'sealed', 'published']) {
    test(`${base} first-install persisted ${phase} interruption retries without partial reuse`, async () => {
      vi.useFakeTimers();
      try {
        const caches = new MemoryCaches();
        const prefix = `my-goat-journey:${encodeURIComponent(base)}:`;
        const marker = `${base}__app_shell__/installing/B`;
        const shell = `${prefix}shell:B`;
        const metadata = await caches.open(`${prefix}clients`);
        const live = [{ id: 'network-only', url: `${origin}${base}` }];
        const reached = barrier();
        const never = new Promise<never>(() => {});
        const put = metadata.put.bind(metadata);
        const open = caches.open.bind(caches);
        vi.spyOn(caches, 'open').mockImplementation(async (name) => {
          if (name !== shell) return open(name);
          expect((await metadata.match(marker))!.headers.get('X-App-Shell-Phase')).toBe('initial');
          if (phase === 'intent') {
            reached.resolve();
            return never;
          }
          const cache = await open(name);
          if (phase === 'partial') {
            const write = cache.put.bind(cache);
            vi.spyOn(cache, 'put').mockImplementationOnce(async (request, response) => {
              await write(request, response);
              reached.resolve();
              return never;
            });
          }
          return cache;
        });
        vi.spyOn(metadata, 'put').mockImplementation(async (request, response) => {
          if (phase === 'complete' && response.headers.get('X-App-Shell-Phase') === 'verified') {
            reached.resolve();
            return never;
          }
          if (
            key(request) === key(`${base}__app_shell__/installed`) &&
            ['sealed', 'published'].includes(phase)
          ) {
            if (phase === 'published') await put(request, response);
            reached.resolve();
            return never;
          }
          return put(request, response);
        });
        void worker(base, 'B', caches, live).dispatch('install');
        await reached.promise;
        vi.restoreAllMocks();
        const restored = await persistedRestart(caches);
        const previous = restored.entries.get(shell);
        const beforeMarker = await (await restored.open(`${prefix}clients`)).match(marker);
        expect(beforeMarker!.headers.get('X-App-Shell-Phase')).toBe(
          ['sealed', 'published'].includes(phase) ? 'verified' : 'initial',
        );
        expect(previous?.entries.size ?? 0).toBe(
          phase === 'intent' ? 0 : phase === 'partial' ? 1 : worker(base).files.length,
        );
        const deletion = vi.spyOn(restored, 'delete');
        const retry = worker(base, 'B', restored, live);
        await retry.dispatch('install');
        expect(retry.network).toHaveBeenCalledTimes(retry.files.length);
        if (['sealed', 'published'].includes(phase)) {
          expect(deletion).not.toHaveBeenCalled();
          expect(restored.entries.get(shell)).toBe(previous);
        } else expect(deletion).toHaveBeenCalledWith(shell);
        for (const path of retry.files)
          expect(await (await (await restored.open(shell)).match(path))!.text()).toBe(`B:${path}`);
        expect(await (await restored.open(`${prefix}clients`)).match(marker)).toBeUndefined();
        await retry.dispatch('activate');
        retry.network.mockRejectedValue(new Error('offline'));
        expect(await (await retry.request(base, '', 'offline-entry', true))!.text()).toBe(
          `B:${base}index.html`,
        );
      } finally {
        vi.restoreAllMocks();
        vi.useRealTimers();
      }
    });
  }

  for (const failure of ['delete', 'marker', 'repeat-interruption']) {
    test(`${base} first-install recovery ${failure} retains evidence for another same-version retry`, async () => {
      const prefix = `my-goat-journey:${encodeURIComponent(base)}:`;
      const marker = `${base}__app_shell__/installing/B`;
      const shell = `${prefix}shell:B`;
      let caches = new MemoryCaches();
      const metadata = await caches.open(`${prefix}clients`);
      await metadata.put(
        marker,
        new Response('B', { headers: { 'X-App-Shell-Phase': 'initial' } }),
      );
      await (await caches.open(shell)).put(`${base}index.html`, new Response('partial'));
      if (failure === 'delete')
        vi.spyOn(caches, 'delete').mockRejectedValueOnce(new Error('delete interrupted'));
      else vi.spyOn(metadata, 'delete').mockRejectedValueOnce(new Error('marker interrupted'));
      await expect(worker(base, 'B', caches).dispatch('install')).rejects.toThrow(
        'ownership is unresolved',
      );
      expect(await metadata.match(marker)).toBeDefined();
      expect((await caches.keys()).includes(shell)).toBe(failure === 'delete');
      caches = await persistedRestart(caches);
      if (failure === 'repeat-interruption') {
        const retry = worker(base, 'B', caches);
        retry.network.mockRejectedValueOnce(new Error('another interruption'));
        const remove = caches.delete.bind(caches);
        vi.spyOn(caches, 'delete')
          .mockImplementationOnce(remove)
          .mockRejectedValueOnce(new Error('failed cleanup'));
        await expect(retry.dispatch('install')).rejects.toThrow('failed cleanup');
        caches = await persistedRestart(caches);
      }
      const retry = worker(base, 'B', caches);
      await retry.dispatch('install');
      for (const path of retry.files)
        expect(await (await (await caches.open(shell)).match(path))!.text()).toBe(`B:${path}`);
    });
  }

  for (const ambiguity of [
    'active-worker',
    'waiting-worker',
    'scope',
    'assignment',
    'pending',
    'retired',
    'active-pointer',
    'installed-pointer',
    'malformed-pointer',
    'unmarked-shell',
    'unknown-entry',
    'second-marker',
    'missing-tag',
    'unknown-tag',
    'clients-failure',
    'unknown-client',
  ]) {
    test(`${base} bootstrap recovery retains ambiguous ${ambiguity}`, async () => {
      const caches = new MemoryCaches();
      const prefix = `my-goat-journey:${encodeURIComponent(base)}:`;
      const marker = `${base}__app_shell__/installing/B`;
      const metadata = await caches.open(`${prefix}clients`);
      await metadata.put(
        marker,
        new Response('B', { headers: { 'X-App-Shell-Phase': 'initial' } }),
      );
      const shell = await caches.open(`${prefix}shell:B`);
      await shell.put(`${base}index.html`, new Response('partial B'));
      const b = worker(base, 'B', caches);
      if (ambiguity === 'active-worker') b.registration.active = {};
      if (ambiguity === 'waiting-worker') b.registration.waiting = {};
      if (ambiguity === 'scope') b.registration.scope = `${origin}/different-scope/`;
      if (ambiguity === 'assignment' || ambiguity === 'pending')
        await metadata.put(
          `${base}__app_shell__/client/old`,
          new Response('B', {
            headers: ambiguity === 'pending' ? { 'X-App-Shell-Pending': '1' } : {},
          }),
        );
      if (ambiguity === 'retired')
        await metadata.put(`${base}__app_shell__/retired/A`, new Response('A'));
      if (ambiguity === 'active-pointer')
        await metadata.put(`${base}__app_shell__/active`, new Response('A'));
      if (ambiguity === 'installed-pointer')
        await metadata.put(`${base}__app_shell__/installed`, new Response('A'));
      if (ambiguity === 'malformed-pointer')
        await metadata.put(`${base}__app_shell__/active`, new Response(''));
      if (ambiguity === 'unmarked-shell') await caches.open(`${prefix}shell:unmarked`);
      if (ambiguity === 'unknown-entry')
        await metadata.put(`${base}__app_shell__/unknown`, new Response('unknown'));
      if (ambiguity === 'second-marker')
        await metadata.put(`${base}__app_shell__/installing/C`, new Response('C'));
      if (ambiguity === 'missing-tag' || ambiguity === 'unknown-tag')
        await metadata.put(
          marker,
          new Response('B', {
            headers: ambiguity === 'unknown-tag' ? { 'X-App-Shell-Phase': 'unknown' } : {},
          }),
        );
      if (ambiguity === 'clients-failure')
        b.matchAll.mockRejectedValue(new Error('clients unavailable'));
      if (ambiguity === 'unknown-client') b.live.push({ id: '', url: `${origin}${base}` });
      const deletion = vi.spyOn(caches, 'delete');
      await expect(b.dispatch('install')).rejects.toThrow('ownership is unresolved');
      expect(deletion).not.toHaveBeenCalled();
      expect(b.network).not.toHaveBeenCalled();
      expect(await (await shell.match(`${base}index.html`))!.text()).toBe('partial B');
      expect(await metadata.match(marker)).toBeDefined();
    });
  }

  test(`${base} failed bootstrap seal cannot publish, and completed metadata loss cannot restore scratch authority`, async () => {
    const caches = new MemoryCaches();
    const prefix = `my-goat-journey:${encodeURIComponent(base)}:`;
    const metadata = await caches.open(`${prefix}clients`);
    const marker = `${base}__app_shell__/installing/B`;
    const put = metadata.put.bind(metadata);
    const sealFailure = vi.spyOn(metadata, 'put').mockImplementation(async (request, response) => {
      if (response.headers.get('X-App-Shell-Phase') === 'verified')
        throw new DOMException('seal quota', 'QuotaExceededError');
      return put(request, response);
    });
    await expect(worker(base, 'B', caches).dispatch('install')).rejects.toThrow('seal quota');
    expect(await metadata.match(`${base}__app_shell__/installed`)).toBeUndefined();
    expect(await caches.keys()).not.toContain(`${prefix}shell:B`);
    sealFailure.mockRestore();
    const remove = metadata.delete.bind(metadata);
    const cleanupFailure = vi.spyOn(metadata, 'delete').mockImplementation(async (request) => {
      if (key(request) === key(marker)) throw new Error('marker unavailable');
      return remove(request);
    });
    await worker(base, 'B', caches).dispatch('install');
    cleanupFailure.mockRestore();
    expect((await metadata.match(marker))!.headers.get('X-App-Shell-Phase')).toBe('verified');
    await metadata.delete(`${base}__app_shell__/installed`); // partial metadata loss
    const restored = await persistedRestart(caches);
    const original = restored.entries.get(`${prefix}shell:B`);
    const deletion = vi.spyOn(restored, 'delete');
    const retry = worker(base, 'B', restored);
    await retry.dispatch('install');
    expect(deletion).not.toHaveBeenCalled();
    expect(restored.entries.get(`${prefix}shell:B`)).toBe(original);
    expect(retry.network).toHaveBeenCalledTimes(retry.files.length);
  });

  test(`${base} publication quota after bootstrap sealing preserves the verified incarnation`, async () => {
    const caches = new MemoryCaches();
    const prefix = `my-goat-journey:${encodeURIComponent(base)}:`;
    const metadata = await caches.open(`${prefix}clients`);
    const marker = `${base}__app_shell__/installing/B`;
    const put = metadata.put.bind(metadata);
    const publicationFailure = vi
      .spyOn(metadata, 'put')
      .mockImplementation(async (request, response) => {
        if (key(request) === key(`${base}__app_shell__/installed`))
          throw new DOMException('publication quota', 'QuotaExceededError');
        return put(request, response);
      });
    const b = worker(base, 'B', caches);
    await expect(b.dispatch('install')).rejects.toThrow('publication quota');
    publicationFailure.mockRestore();
    expect(await caches.keys()).toContain(`${prefix}shell:B`);
    expect((await metadata.match(marker))!.headers.get('X-App-Shell-Phase')).toBe('verified');
    for (const path of b.files)
      expect(await (await (await caches.open(`${prefix}shell:B`)).match(path))!.text()).toBe(
        `B:${path}`,
      );
    const restarted = await persistedRestart(caches);
    const failedRetry = worker(base, 'B', restarted);
    failedRetry.network.mockRejectedValueOnce(new Error('retry offline'));
    await expect(failedRetry.dispatch('install')).rejects.toThrow('retry offline');
    expect(await restarted.keys()).toContain(`${prefix}shell:B`);
    expect(
      (await (await restarted.open(`${prefix}clients`)).match(marker))!.headers.get(
        'X-App-Shell-Phase',
      ),
    ).toBe('verified');
    await worker(base, 'B', restarted).dispatch('install');
  });

  test(`${base} stale verified bootstrap marker cannot certify a missing cache incarnation`, async () => {
    const caches = new MemoryCaches();
    const prefix = `my-goat-journey:${encodeURIComponent(base)}:`;
    const metadata = await caches.open(`${prefix}clients`);
    const marker = `${base}__app_shell__/installing/B`;
    await metadata.put(marker, new Response('B', { headers: { 'X-App-Shell-Phase': 'verified' } }));
    const b = worker(base, 'B', caches);
    await expect(b.dispatch('install')).rejects.toThrow('completion is unresolved');
    expect(await caches.keys()).not.toContain(`${prefix}shell:B`);
    expect(await metadata.match(marker)).toBeDefined();
    expect(b.network).not.toHaveBeenCalled();
  });

  test(`${base} untagged first-install ownership remains conservative on same-version retry`, async () => {
    const caches = new MemoryCaches();
    const prefix = `my-goat-journey:${encodeURIComponent(base)}:`;
    const metadata = await caches.open(`${prefix}clients`);
    await metadata.put(`${base}__app_shell__/installing/B`, new Response('B'));
    await (
      await caches.open(`${prefix}shell:B`)
    ).put(`${base}index.html`, new Response('partial B'));
    const restarted = await persistedRestart(caches);
    const b = worker(base, 'B', restarted);
    await expect(b.dispatch('install')).rejects.toThrow('ownership is unresolved');
    expect(await restarted.keys()).toContain(`${prefix}shell:B`);
    expect(b.network).not.toHaveBeenCalled();
  });

  test(`${base} same-version retry recovers owned partial bytes rather than reusing them`, async () => {
    const { caches, live, prefix, metadata, marker, shell, seed } = await recoveryFixture(base);
    await seed();
    const restarted = await persistedRestart(caches);
    const b = worker(base, 'B', restarted, live);
    await b.dispatch('install');
    for (const path of b.files)
      expect(await (await (await restarted.open(shell)).match(path))!.text()).toBe(`B:${path}`);
    expect(await (await restarted.open(`${prefix}clients`)).match(marker)).toBeUndefined();
    expect(await (await metadata.match(`${base}__app_shell__/installed`))!.text()).toBe('A');
  });

  test(`${base} active recovery cannot detach a cache owned by a live installer`, async () => {
    const { caches, live, a, metadata, marker, shell } = await recoveryFixture(base);
    const held = barrier();
    const release = barrier<Response>();
    const b = worker(base, 'B', caches, live);
    b.network.mockImplementationOnce(async () => new Response(`B:${base}index.html`));
    b.network.mockImplementationOnce(() => {
      held.resolve();
      return release.promise;
    });
    const installing = b.dispatch('install');
    await held.promise;
    const handle = caches.entries.get(shell)!;
    expect((await handle.keys()).length).toBe(1);
    expect(await (await metadata.match(marker))!.text()).toBe('B');
    const deletion = vi.spyOn(caches, 'delete');
    const cleaning = a.request(`${base}icons/icon.png`, 'live-A');
    await caches.locks.blocked.promise;
    expect(deletion).not.toHaveBeenCalled();
    expect(caches.entries.get(shell)).toBe(handle);
    release.resolve(new Response(`B:${base}assets/app.js`));
    await Promise.all([installing, cleaning]);
    expect(caches.entries.get(shell)).toBe(handle);
    for (const path of b.files) expect(await (await handle.match(path))!.text()).toBe(`B:${path}`);
    expect(await metadata.match(marker)).toBeUndefined();
    expect(await (await metadata.match(`${base}__app_shell__/installed`))!.text()).toBe('B');
  });

  test(`${base} retained rollback interruption transfers no scratch ownership across restart`, async () => {
    vi.useFakeTimers();
    try {
      const { caches, live, prefix, metadata } = await recoveryFixture(base);
      await worker(base, 'B', caches, live).dispatch('install');
      await worker(base, 'B', caches, live).dispatch('activate');
      const held = barrier();
      const rollback = worker(base, 'A', caches, live);
      rollback.network.mockImplementationOnce(() => {
        held.resolve();
        return new Promise<never>(() => {});
      });
      void rollback.dispatch('install');
      await held.promise;
      expect(await metadata.match(`${base}__app_shell__/installing/A`)).toBeUndefined();
      expect(await (await metadata.match(`${base}__app_shell__/retired/A`))!.text()).toBe('A');
      const restarted = await persistedRestart(caches);
      const c = worker(base, 'C', restarted, live);
      await c.dispatch('install');
      await c.dispatch('activate');
      for (const path of rollback.files)
        expect(await (await (await restarted.open(`${prefix}shell:A`)).match(path))!.text()).toBe(
          `A:${path}`,
        );
      expect(await (await c.request(`${base}assets/app.js`, 'live-A'))!.text()).toBe(
        `A:${base}assets/app.js`,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test(`${base} retained rollback never acquires scratch ownership during failed reuse`, async () => {
    const { caches, live, prefix, metadata } = await recoveryFixture(base);
    await worker(base, 'B', caches, live).dispatch('install');
    await worker(base, 'B', caches, live).dispatch('activate');
    const rollback = worker(base, 'A', caches, live);
    rollback.network.mockImplementationOnce(async () => {
      expect(await metadata.match(`${base}__app_shell__/installing/A`)).toBeUndefined();
      throw new Error('rollback interrupted');
    });
    await expect(rollback.dispatch('install')).rejects.toThrow('rollback interrupted');
    const restarted = worker(base, 'C', await persistedRestart(caches), live);
    await restarted.dispatch('install');
    for (const path of rollback.files)
      expect(
        await (await (await restarted.caches.open(`${prefix}shell:A`)).match(path))!.text(),
      ).toBe(`A:${path}`);
  });

  for (const evidence of [
    'active',
    'installed',
    'assigned',
    'pending',
    'retired',
    'unknown',
    'missing-active',
    'missing-installed',
    'malformed-client',
  ]) {
    test(`${base} interrupted recovery protects ${evidence} evidence`, async () => {
      const { caches, live, metadata, marker, shell, seed } = await recoveryFixture(base);
      await seed();
      if (evidence === 'active' || evidence === 'installed')
        await metadata.put(`${base}__app_shell__/${evidence}`, new Response('B'));
      if (evidence === 'assigned' || evidence === 'pending')
        await metadata.put(
          `${base}__app_shell__/client/absent-B`,
          new Response('B', {
            headers: evidence === 'pending' ? { 'X-App-Shell-Pending': '1' } : {},
          }),
        );
      if (evidence === 'retired')
        await metadata.put(`${base}__app_shell__/retired/B`, new Response('B'));
      if (evidence === 'unknown') live.push({ id: 'unknown-suspended', url: `${origin}${base}` });
      if (evidence === 'missing-active') await metadata.delete(`${base}__app_shell__/active`);
      if (evidence === 'missing-installed') await metadata.delete(`${base}__app_shell__/installed`);
      if (evidence === 'malformed-client')
        await metadata.put(`${base}__app_shell__/client/broken`, new Response(''));
      const restarted = await persistedRestart(caches);
      await worker(base, 'C', restarted, live).dispatch('install');
      expect(await restarted.keys()).toContain(shell);
      // Completion evidence may remove only stale marker housekeeping.
      if (!['active', 'installed', 'retired'].includes(evidence))
        expect(
          await (
            await restarted.open(`my-goat-journey:${encodeURIComponent(base)}:clients`)
          ).match(marker),
        ).toBeDefined();
    });
  }

  test(`${base} ambiguous same-version ownership rejects retry before opening or fetching`, async () => {
    const { caches, live, metadata, shell, seed } = await recoveryFixture(base);
    await seed();
    await metadata.put(
      `${base}__app_shell__/client/unobserved`,
      new Response('B', { headers: { 'X-App-Shell-Pending': '1' } }),
    );
    const b = worker(base, 'B', caches, live);
    const open = vi.spyOn(caches, 'open');
    await expect(b.dispatch('install')).rejects.toThrow('ownership is unresolved');
    expect(open.mock.calls.map(([name]) => name)).not.toContain(shell);
    expect(b.network).not.toHaveBeenCalled();
  });

  test(`${base} ownership quota fails before an untracked shell mutation`, async () => {
    const { caches, live, metadata, marker, shell } = await recoveryFixture(base);
    const put = metadata.put.bind(metadata);
    vi.spyOn(metadata, 'put').mockImplementation(async (request, response) => {
      if (key(request) === key(marker))
        throw new DOMException('intent quota', 'QuotaExceededError');
      return put(request, response);
    });
    const b = worker(base, 'B', caches, live);
    await expect(b.dispatch('install')).rejects.toThrow('intent quota');
    expect(await caches.keys()).not.toContain(shell);
    expect(b.network).not.toHaveBeenCalled();
    expect(await (await metadata.match(`${base}__app_shell__/installed`))!.text()).toBe('A');
  });

  test(`${base} post-publication marker cleanup failure cannot reject or delete completed B`, async () => {
    const { caches, live, metadata, marker, shell } = await recoveryFixture(base);
    const remove = metadata.delete.bind(metadata);
    const injection = vi.spyOn(metadata, 'delete').mockImplementation(async (request) => {
      if (key(request) === key(marker)) throw new Error('marker delete failed');
      return remove(request);
    });
    await worker(base, 'B', caches, live).dispatch('install');
    expect(await (await metadata.match(`${base}__app_shell__/installed`))!.text()).toBe('B');
    expect(await caches.keys()).toContain(shell);
    expect(await metadata.match(marker)).toBeDefined();
    // A later C can supersede B even if marker cleanup keeps failing. Durable
    // retirement evidence must prevent mistaking successfully published B for scratch.
    await worker(base, 'C', caches, live).dispatch('install');
    expect(await metadata.match(`${base}__app_shell__/retired/B`)).toBeDefined();
    injection.mockRestore();
    const restarted = worker(base, 'D', await persistedRestart(caches), live);
    await restarted.dispatch('install');
    expect(await restarted.caches.keys()).toContain(shell);
    expect(
      await (
        await restarted.caches.open(`my-goat-journey:${encodeURIComponent(base)}:clients`)
      ).match(marker),
    ).toBeUndefined();
  });

  for (const failure of ['cache-delete', 'marker-delete', 'snapshot', 'caught-cleanup']) {
    test(`${base} interrupted recovery ${failure} retains retry evidence and is idempotent`, async () => {
      const { caches, live, a, metadata, marker, shell, seed } = await recoveryFixture(base);
      if (failure === 'caught-cleanup') {
        const b = worker(base, 'B', caches, live);
        b.network.mockRejectedValueOnce(new Error('transfer failed'));
        vi.spyOn(caches, 'delete').mockRejectedValueOnce(new Error('deletion failed'));
        await expect(b.dispatch('install')).rejects.toThrow('deletion failed');
      } else {
        await seed();
        if (failure === 'cache-delete')
          vi.spyOn(caches, 'delete').mockRejectedValueOnce(new Error('deletion failed'));
        if (failure === 'marker-delete')
          vi.spyOn(metadata, 'delete').mockRejectedValueOnce(new Error('cleanup interrupted'));
        if (failure === 'snapshot')
          vi.spyOn(metadata, 'keys').mockRejectedValueOnce(new Error('metadata unavailable'));
        await a.request(`${base}icons/icon.png`, 'live-A');
      }
      expect(await metadata.match(marker)).toBeDefined();
      expect((await caches.keys()).includes(shell)).toBe(failure !== 'marker-delete');
      const restored = await persistedRestart(caches);
      const freshA = worker(base, 'A', restored, live);
      await freshA.request(`${base}icons/icon.png`, 'live-A');
      await freshA.request(`${base}icons/icon.png`, 'live-A');
      expect(await restored.keys()).not.toContain(shell);
      expect(
        await (
          await restored.open(`my-goat-journey:${encodeURIComponent(base)}:clients`)
        ).match(marker),
      ).toBeUndefined();
    });
  }

  test(`${base} recovery never sweeps unmarked, malformed, foreign or unrelated caches`, async () => {
    const { caches, live, prefix, metadata, seed } = await recoveryFixture(base);
    await seed();
    const names = [
      `${prefix}shell:unmarked`,
      `${prefix}shell:mismatch`,
      `${prefix}shell:bad`,
      'unrelated-cache',
      `my-goat-journey:${encodeURIComponent(base === '/' ? '/foreign/' : '/')}:shell:B`,
    ];
    for (const name of names) await (await caches.open(name)).put('/untouched', new Response(name));
    await metadata.put(`${base}__app_shell__/installing/mismatch`, new Response('other'));
    await metadata.put(`${base}__app_shell__/installing/bad`, new Response('../bad'));
    await metadata.put(`/foreign/__app_shell__/installing/B`, new Response('B'));
    const restarted = worker(base, 'C', await persistedRestart(caches), live);
    await restarted.dispatch('install');
    for (const name of names) {
      expect(await restarted.caches.keys()).toContain(name);
      expect(await (await (await restarted.caches.open(name)).match('/untouched'))!.text()).toBe(
        name,
      );
    }
    expect(await restarted.caches.keys()).not.toContain(`${prefix}shell:B`);
  });
}

for (const base of [
  '/',
  '/my-goat-journey/',
  '/app/',
  '/my-goat-journey/app/',
  '/alternate/app/',
]) {
  test(`${base} stalled update headers are cancelled before old navigation resumes`, async () => {
    vi.useFakeTimers();
    const late = barrier<Response>();
    let installing: Promise<unknown> | undefined;
    try {
      const caches = new MemoryCaches();
      const live: Client[] = [];
      const a = worker(base, 'A', caches, live);
      await a.dispatch('install');
      await a.dispatch('activate');
      await a.request(base, '', 'existing-A', true);
      live.push({ id: 'existing-A', url: `${origin}${base}` });
      await a.request(`${base}assets/app.js`, 'existing-A');
      const prefix = `my-goat-journey:${encodeURIComponent(base)}:`;
      const metadata = await caches.open(`${prefix}clients`);
      const assignment = await (await metadata.match(
        `${base}__app_shell__/client/existing-A`,
      ))!.text();
      const b = worker(base, 'B', caches, live);
      const stalled = barrier();
      let signal!: AbortSignal;
      b.network.mockImplementationOnce(async () => new Response(`B:${base}index.html`));
      b.network.mockImplementationOnce(async (request) => {
        signal = (request as Request).signal;
        stalled.resolve();
        return new Promise<Response>((resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          void late.promise.then(resolve);
        });
      });
      installing = b.dispatch('install');
      const outcome = installing.then(
        () => 'published',
        () => 'cancelled',
      );
      await stalled.promise;
      const partial = await caches.open(`${prefix}shell:B`);
      expect((await partial.keys()).length).toBe(1);
      const latePut = vi.spyOn(partial, 'put');
      let navigated = false;
      const navigation = a.request(base, '', 'fresh-A', true).then((response) => {
        navigated = true;
        return response;
      });
      await caches.locks.blocked.promise;
      expect(navigated).toBe(false);
      expect(
        await (await (await caches.open(`${prefix}shell:A`)).match(`${base}index.html`))!.text(),
      ).toBe(`A:${base}index.html`);
      await vi.advanceTimersByTimeAsync(11_999);
      expect(signal.aborted).toBe(false);
      expect(navigated).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(signal.aborted).toBe(true);
      expect(await outcome).toBe('cancelled');
      expect(await (await navigation)!.text()).toBe(`A:${base}index.html`);
      expect(await caches.keys()).not.toContain(`${prefix}shell:B`);
      expect(await (await metadata.match(`${base}__app_shell__/installed`))!.text()).toBe('A');
      expect(await (await metadata.match(`${base}__app_shell__/active`))!.text()).toBe('A');
      expect(await (await metadata.match(`${base}__app_shell__/client/existing-A`))!.text()).toBe(
        assignment,
      );
      late.resolve(new Response('late B response'));
      await vi.advanceTimersByTimeAsync(0);
      expect(latePut).not.toHaveBeenCalled();
      // Also inspect the detached handle: absence of the name alone would hide
      // a writer still mutating the deleted candidate after lock release.
      expect((await partial.keys()).length).toBe(1);
      expect(await caches.keys()).not.toContain(`${prefix}shell:B`);
      expect(await (await metadata.match(`${base}__app_shell__/installed`))!.text()).toBe('A');
      const c = worker(base, 'C', caches, live);
      await c.dispatch('install');
      expect(await (await metadata.match(`${base}__app_shell__/installed`))!.text()).toBe('C');
      for (const path of a.files)
        expect(await (await (await caches.open(`${prefix}shell:A`)).match(path))!.text()).toBe(
          `A:${path}`,
        );
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      late.resolve(new Response('released diagnostic stall'));
      await installing?.catch(() => {});
      vi.useRealTimers();
    }
  });
  for (const retained of [false, true]) {
    test(`${base} stalled body uses the remaining total budget (${retained ? 'retained rollback' : 'new candidate'})`, async () => {
      vi.useFakeTimers();
      try {
        const caches = new MemoryCaches();
        const live: Client[] = [];
        const prefix = `my-goat-journey:${encodeURIComponent(base)}:`;
        const a = worker(base, 'A', caches, live);
        await a.dispatch('install');
        await a.dispatch('activate');
        await a.request(base, '', 'live-A', true);
        live.push({ id: 'live-A', url: `${origin}${base}` });
        await a.request(`${base}assets/app.js`, 'live-A');
        if (retained) {
          const b = worker(base, 'B', caches, live);
          await b.dispatch('install');
          await b.dispatch('activate');
        }
        const metadata = await caches.open(`${prefix}clients`);
        const version = retained ? 'A' : 'B';
        const previous = retained ? 'B' : 'A';
        const candidate = worker(base, version, caches, live);
        const firstHeaders = barrier();
        const firstResponse = barrier<Response>();
        const reading = barrier();
        let signal!: AbortSignal;
        let body!: ReadableStreamDefaultController<Uint8Array>;
        candidate.network.mockImplementationOnce(() => {
          firstHeaders.resolve();
          return firstResponse.promise;
        });
        candidate.network.mockImplementationOnce(async (request) => {
          signal = (request as Request).signal;
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                body = controller;
                controller.enqueue(new TextEncoder().encode('incomplete body'));
                signal.addEventListener('abort', () => controller.error(signal.reason), {
                  once: true,
                });
              },
              pull() {
                reading.resolve();
              },
            }),
          );
        });
        const installing = candidate.dispatch('install');
        const rejected = expect(installing).rejects.toThrow('App-shell transfer budget exceeded');
        await firstHeaders.promise;
        await vi.advanceTimersByTimeAsync(4_000);
        firstResponse.resolve(new Response(`${version}:${base}index.html`));
        await reading.promise;
        let navigated = false;
        const navigation = a.request(base, '', 'fresh-A', true).then((response) => {
          navigated = true;
          return response;
        });
        await caches.locks.blocked.promise;
        await vi.advanceTimersByTimeAsync(7_999);
        expect(signal.aborted).toBe(false);
        expect(navigated).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(signal.aborted).toBe(true);
        await rejected;
        expect(await (await navigation)!.text()).toBe(`A:${base}index.html`);
        expect(() => body.enqueue(new Uint8Array([1]))).toThrow();
        expect(await (await metadata.match(`${base}__app_shell__/installed`))!.text()).toBe(
          previous,
        );
        expect(await (await metadata.match(`${base}__app_shell__/active`))!.text()).toBe(previous);
        expect(await (await metadata.match(`${base}__app_shell__/client/live-A`))!.text()).toBe(
          'A',
        );
        if (!retained) expect(await caches.keys()).not.toContain(`${prefix}shell:B`);
        for (const path of a.files)
          expect(await (await (await caches.open(`${prefix}shell:A`)).match(path))!.text()).toBe(
            `A:${path}`,
          );
        const c = worker(base, 'C', caches, live);
        await c.dispatch('install');
        expect(await (await metadata.match(`${base}__app_shell__/installed`))!.text()).toBe('C');
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  }
  test(`${base} cancellation awaits an in-flight cache write and owned cleanup before lock release`, async () => {
    vi.useFakeTimers();
    const finishWrite = barrier();
    const finishDelete = barrier();
    try {
      const caches = new MemoryCaches();
      const a = worker(base, 'A', caches);
      await a.dispatch('install');
      await a.dispatch('activate');
      const b = worker(base, 'B', caches);
      const prefix = `my-goat-journey:${encodeURIComponent(base)}:`;
      const cache = await caches.open(`${prefix}shell:B`);
      // Simulate an uncancellable native storage commit already consuming bytes.
      // It must settle before deletion; a race that releases the lock is unsafe.
      const putting = barrier();
      const put = cache.put.bind(cache);
      vi.spyOn(cache, 'put').mockImplementationOnce(async (request, response) => {
        await put(request, response);
        putting.resolve();
        await finishWrite.promise;
      });
      // The destination was created for this test hook, not a retained rollback.
      const keys = caches.keys.bind(caches);
      vi.spyOn(caches, 'keys').mockImplementationOnce(async () =>
        (await keys()).filter((name) => name !== `${prefix}shell:B`),
      );
      const deleting = barrier();
      const remove = caches.delete.bind(caches);
      vi.spyOn(caches, 'delete').mockImplementation(async (name) => {
        if (name === `${prefix}shell:B`) {
          deleting.resolve();
          await finishDelete.promise;
        }
        return remove(name);
      });
      const installing = b.dispatch('install');
      const rejected = expect(installing).rejects.toThrow('App-shell transfer budget exceeded');
      await putting.promise;
      let navigated = false;
      const navigation = a.request(base, '', 'fresh-A', true).then((response) => {
        navigated = true;
        return response;
      });
      await caches.locks.blocked.promise;
      await vi.advanceTimersByTimeAsync(12_000);
      expect(navigated).toBe(false);
      expect(caches.delete).not.toHaveBeenCalled();
      finishWrite.resolve();
      await deleting.promise;
      expect(navigated).toBe(false);
      finishDelete.resolve();
      await rejected;
      expect(await (await navigation)!.text()).toBe(`A:${base}index.html`);
      expect(await caches.keys()).not.toContain(`${prefix}shell:B`);
      expect(b.network).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      finishWrite.resolve();
      finishDelete.resolve();
      vi.useRealTimers();
    }
  });
  test(`${base} complete transfers within the total budget publish and clear the deadline`, async () => {
    vi.useFakeTimers();
    try {
      const a = worker(base);
      const fetching = barrier();
      const finish = barrier<Response>();
      a.network.mockImplementationOnce(() => {
        fetching.resolve();
        return finish.promise;
      });
      const installing = a.dispatch('install');
      await fetching.promise;
      await vi.advanceTimersByTimeAsync(11_999);
      finish.resolve(new Response(`A:${base}index.html`));
      await installing;
      expect(vi.getTimerCount()).toBe(0);
      const metadata = await a.caches.open(`my-goat-journey:${encodeURIComponent(base)}:clients`);
      expect(await (await metadata.match(`${base}__app_shell__/installed`))!.text()).toBe('A');
      const signal = (a.network.mock.calls[0][0] as Request).signal;
      await vi.advanceTimersByTimeAsync(12_000);
      expect(signal.aborted).toBe(false);
      await a.dispatch('activate');
      a.network.mockRejectedValue(new Error('offline'));
      expect(await (await a.request(base, '', 'offline', true))!.text()).toBe(
        `A:${base}index.html`,
      );
      for (const path of a.files)
        expect(
          await (await a.request(path, 'offline', '', path.endsWith('index.html')))!.text(),
        ).toBe(`A:${path}`);
    } finally {
      vi.useRealTimers();
    }
  });
  test(`${base} retained rollback survives last A closing and B cleanup before publication`, async () => {
    const caches = new MemoryCaches();
    const live: Client[] = [];
    const a = worker(base, 'A', caches, live);
    await a.dispatch('install');
    await a.dispatch('activate');
    await a.request(base, '', 'last-A', true);
    live.push({ id: 'last-A', url: `${origin}${base}` });
    await a.request(`${base}assets/app.js`, 'last-A'); // Observed, not pending.
    const b = worker(base, 'B', caches, live);
    await b.dispatch('install');
    await b.dispatch('activate');
    await b.request(base, '', 'live-B', true);
    live.push({ id: 'live-B', url: `${origin}${base}` });
    await b.request(`${base}assets/app.js`, 'live-B');
    const opened = barrier();
    const finish = barrier<Response>();
    const rollback = worker(base, 'A', caches, live);
    rollback.network.mockImplementationOnce(() => {
      opened.resolve();
      return finish.promise;
    });
    const installing = rollback.dispatch('install');
    await opened.promise; // Installer already holds the retained A cache handle.
    live.splice(0, 1); // Last A closes, leaving only assigned B.
    const cleaning = b.request(`${base}assets/app.js`, 'live-B');
    // Old code completes deletion; coordinated code waits behind the installer.
    // Both outcomes are explicit signals, never a sleep or timing estimate.
    await Promise.race([cleaning, caches.locks.blocked.promise]);
    finish.resolve(new Response(`A:${base}index.html`));
    await Promise.all([installing, cleaning]);
    const metadata = await caches.open(`my-goat-journey:${encodeURIComponent(base)}:clients`);
    expect(await (await metadata.match(`${base}__app_shell__/installed`))!.text()).toBe('A');
    await rollback.dispatch('activate');
    rollback.network.mockRejectedValue(new Error('offline'));
    expect(await (await rollback.request(base, '', 'reopened-A', true))!.text()).toBe(
      `A:${base}index.html`,
    );
    for (const path of a.files.filter((path) => !path.endsWith('index.html'))) {
      expect(await (await rollback.request(path, 'reopened-A'))!.text()).toBe(`A:${path}`);
    }
  });
  test(`${base} cleanup already committed to deleting A finishes before rollback opens its destination`, async () => {
    const caches = new MemoryCaches();
    const live: Client[] = [];
    const prefix = `my-goat-journey:${encodeURIComponent(base)}:`;
    const a = worker(base, 'A', caches, live);
    await a.dispatch('install');
    await a.dispatch('activate');
    await a.request(base, '', 'last-A', true);
    live.push({ id: 'last-A', url: `${origin}${base}` });
    await a.request(`${base}assets/app.js`, 'last-A');
    const b = worker(base, 'B', caches, live);
    await b.dispatch('install');
    await b.dispatch('activate');
    await b.request(base, '', 'live-B', true);
    live.push({ id: 'live-B', url: `${origin}${base}` });
    await b.request(`${base}assets/app.js`, 'live-B');
    live.splice(0, 1);
    const deleting = barrier();
    const finishDelete = barrier();
    const remove = caches.delete.bind(caches);
    vi.spyOn(caches, 'delete').mockImplementation(async (name) => {
      if (name === `${prefix}shell:A`) {
        deleting.resolve();
        await finishDelete.promise;
      }
      return remove(name);
    });
    const cleaning = b.request(`${base}assets/app.js`, 'live-B');
    await deleting.promise; // Snapshot and last installed-pointer check passed.
    const rollback = worker(base, 'A', caches, live);
    const fetching = barrier();
    rollback.network.mockImplementation(async (request) => {
      fetching.resolve();
      return new Response(`A:${new URL(key(request)).pathname}`);
    });
    const installing = rollback.dispatch('install');
    await Promise.race([fetching.promise, caches.locks.blocked.promise]);
    // An installer must not open/use A until the already-authorized delete ends.
    expect(rollback.network).not.toHaveBeenCalled();
    finishDelete.resolve();
    await Promise.all([cleaning, installing]);
    await rollback.dispatch('activate');
    rollback.network.mockRejectedValue(new Error('offline'));
    expect(await (await rollback.request(base, '', 'reopened-A', true))!.text()).toBe(
      `A:${base}index.html`,
    );
    const shell = await caches.open(`${prefix}shell:A`);
    for (const path of a.files) expect(await (await shell.match(path))!.text()).toBe(`A:${path}`);
  });
  test(`${base} failed rollback releases coordination and allows cleanup and later installation`, async () => {
    const caches = new MemoryCaches();
    const live: Client[] = [];
    const a = worker(base, 'A', caches, live);
    await a.dispatch('install');
    await a.dispatch('activate');
    await a.request(base, '', 'last-A', true);
    live.push({ id: 'last-A', url: `${origin}${base}` });
    await a.request(`${base}assets/app.js`, 'last-A');
    const b = worker(base, 'B', caches, live);
    await b.dispatch('install');
    await b.dispatch('activate');
    const fetching = barrier();
    const failure = barrier<Response>();
    const rollback = worker(base, 'A', caches, live);
    rollback.network.mockImplementationOnce(() => {
      fetching.resolve();
      return failure.promise;
    });
    const installing = rollback.dispatch('install');
    const rejected = expect(installing).rejects.toThrow('App-shell fetch failed');
    await fetching.promise;
    live.splice(0);
    const cleaning = b.request(`${base}assets/app.js`);
    await caches.locks.blocked.promise;
    failure.resolve(new Response('unavailable', { status: 503 }));
    await Promise.all([rejected, cleaning]);
    const prefix = `my-goat-journey:${encodeURIComponent(base)}:`;
    const metadata = await caches.open(`${prefix}clients`);
    expect(await (await metadata.match(`${base}__app_shell__/installed`))!.text()).toBe('B');
    expect(await caches.keys()).not.toContain(`${prefix}shell:A`);
    await worker(base, 'C', caches, live).dispatch('install');
    expect(await (await metadata.match(`${base}__app_shell__/installed`))!.text()).toBe('C');
  });
  test(`${base} missing Web Locks rejects installation before mutation but leaves existing offline shell usable`, async () => {
    const caches = new MemoryCaches();
    const a = worker(base, 'A', caches);
    await a.dispatch('install');
    await a.dispatch('activate');
    const before = await caches.keys();
    const candidate = worker(base, 'B', caches, [], null);
    await expect(candidate.dispatch('install')).rejects.toThrow(
      'App-shell coordination is unavailable',
    );
    expect(candidate.network).not.toHaveBeenCalled();
    expect(await caches.keys()).toEqual(before);
    const restarted = worker(base, 'A', caches, [], null);
    await restarted.dispatch('activate');
    restarted.network.mockRejectedValue(new Error('offline'));
    expect(await (await restarted.request(base, '', 'offline-A', true))!.text()).toBe(
      `A:${base}index.html`,
    );
    expect(await (await restarted.request(`${base}assets/app.js`, 'offline-A'))!.text()).toBe(
      `A:${base}assets/app.js`,
    );
    expect(await caches.keys()).toEqual(before);
  });
  test(`${base} activation preserves old clients until their next navigation, even across worker restarts`, async () => {
    const caches = new MemoryCaches();
    const live: Client[] = [];
    const a = worker(base, 'A', caches, live);
    await a.dispatch('install');
    await a.dispatch('activate');
    await a.request(base, '', 'dirty-tab', true);
    live.push({ id: 'dirty-tab', url: `${origin}${base}` });
    await caches.open('unrelated-cache');
    const otherBase = base === '/' ? '/other/' : '/';
    const other = `my-goat-journey:${encodeURIComponent(otherBase)}:shell:unrelated`;
    await caches.open(other);
    const b = worker(base, 'B', caches, live);
    await b.dispatch('install');
    await b.dispatch('activate');
    b.network.mockRejectedValue(new Error('offline'));
    expect(await (await b.request(`${base}icons/icon.png`, 'dirty-tab'))!.text()).toBe(
      `A:${base}icons/icon.png`,
    );
    expect(await (await b.request(`${base}assets/app.js`, 'dirty-tab'))!.text()).toBe(
      `A:${base}assets/app.js`,
    );
    expect(await caches.keys()).toContain(`my-goat-journey:${encodeURIComponent(base)}:shell:A`);
    const restarted = worker(base, 'B', caches, live);
    restarted.network.mockRejectedValue(new Error('offline'));
    expect(await (await restarted.request(`${base}site-v1.webmanifest`, 'dirty-tab'))!.text()).toBe(
      `A:${base}site-v1.webmanifest`,
    );
    expect(
      await (await restarted.request(`${base}progress`, 'dirty-tab', 'reloaded-tab', true))!.text(),
    ).toBe(`B:${base}index.html`);
    live.splice(0, 1, { id: 'reloaded-tab', url: `${origin}${base}progress` });
    expect(await (await restarted.request(`${base}assets/app.js`, 'reloaded-tab'))!.text()).toBe(
      `B:${base}assets/app.js`,
    );
    expect(await caches.keys()).not.toContain(
      `my-goat-journey:${encodeURIComponent(base)}:shell:A`,
    );
    expect(await caches.keys()).toContain(other);
    expect(await caches.keys()).toContain('unrelated-cache');
    expect(b.claim).not.toHaveBeenCalled();
  });
  test(`${base} idle tabs and multiple updates retain every live shell, not waiting or unrelated caches`, async () => {
    const caches = new MemoryCaches();
    const live: Client[] = [];
    const a = worker(base, 'A', caches, live);
    await a.dispatch('install');
    await a.dispatch('activate');
    live.push({ id: 'idle-A', url: `${origin}${base}` });
    const b = worker(base, 'B', caches, live);
    await b.dispatch('install');
    // Cleanup by A must not remove B's waiting cache.
    await a.request(`${base}assets/app.js`, 'idle-A');
    expect(await caches.keys()).toContain(`my-goat-journey:${encodeURIComponent(base)}:shell:B`);
    await b.dispatch('activate');
    expect(await (await b.request(`${base}icons/icon.png`, 'idle-A'))!.text()).toBe(
      `A:${base}icons/icon.png`,
    );
    await b.request(base, '', 'idle-B', true);
    live.push({ id: 'idle-B', url: `${origin}${base}` });
    const c = worker(base, 'C', caches, live);
    await c.dispatch('install');
    await c.dispatch('activate');
    expect(await (await c.request(`${base}assets/app.js`, 'idle-A'))!.text()).toBe(
      `A:${base}assets/app.js`,
    );
    expect(await (await c.request(`${base}assets/app.js`, 'idle-B'))!.text()).toBe(
      `B:${base}assets/app.js`,
    );
    live.splice(0, 2);
    await c.request(`${base}icons/icon.png`);
    expect((await caches.keys()).filter((name) => name.includes(':shell:'))).toEqual([
      `my-goat-journey:${encodeURIComponent(base)}:shell:C`,
    ]);
  });
  test(`${base} cleanup retires a superseded waiting shell without removing the current candidate`, async () => {
    const caches = new MemoryCaches();
    const live: Client[] = [];

    const shell = (version: string) =>
      `my-goat-journey:${encodeURIComponent(base)}:shell:${version}`;

    const a = worker(base, 'A', caches, live);
    await a.dispatch('install');
    await a.dispatch('activate');
    await a.request(base, '', 'live-A', true);
    live.push({ id: 'live-A', url: `${origin}${base}` });
    await a.request(`${base}assets/app.js`, 'live-A');
    await a.request(base, '', 'pending-A', true);
    await caches.open('unrelated-cache');
    const other = `my-goat-journey:${encodeURIComponent(base === '/' ? '/other/' : '/')}:shell:other`;
    await caches.open(other);
    const b = worker(base, 'B', caches, live);
    await b.dispatch('install'); // User chooses Later, so B never activates.
    const c = worker(base, 'C', caches, live);
    const fetching = barrier();
    const finishFetch = barrier<Response>();
    c.network.mockImplementationOnce(() => {
      fetching.resolve();
      return finishFetch.promise;
    });
    const installing = c.dispatch('install');
    await fetching.promise;
    const cleaning = a.request(`${base}icons/icon.png`, 'live-A');
    await caches.locks.blocked.promise;
    expect(await caches.keys()).toContain(shell('B'));
    finishFetch.resolve(new Response(`C:${base}index.html`));
    await Promise.all([installing, cleaning]);
    // Durable candidate bookkeeping also survives restart of the active A.
    const restartedA = worker(base, 'A', caches, live);
    await restartedA.request(`${base}icons/icon.png`, 'live-A');
    expect(await caches.keys()).not.toContain(shell('B'));
    expect(await caches.keys()).toContain(shell('C'));
    await c.dispatch('activate');
    const d = worker(base, 'D', caches, live);
    await d.dispatch('install');
    expect(await (await c.request(`${base}icons/icon.png`, 'live-A'))!.text()).toBe(
      `A:${base}icons/icon.png`,
    );
    expect(await caches.keys()).toEqual(
      expect.arrayContaining([shell('A'), shell('C'), shell('D'), other, 'unrelated-cache']),
    );
    live.splice(0);
    await c.request(`${base}assets/app.js`);
    // Pending A's navigation still protects A even after its source closes.
    expect(await caches.keys()).toContain(shell('A'));
  });
  test(`${base} retirement quota failure keeps the successful waiting candidate until a later install supersedes it`, async () => {
    const caches = new MemoryCaches();
    const live: Client[] = [];
    const prefix = `my-goat-journey:${encodeURIComponent(base)}:`;

    const shell = (version: string) => `${prefix}shell:${version}`;

    const installed = `${base}__app_shell__/installed`;
    const a = worker(base, 'A', caches, live);
    await a.dispatch('install');
    await a.dispatch('activate');
    await a.request(base, '', 'live-A', true);
    live.push({ id: 'live-A', url: `${origin}${base}` });
    await a.request(`${base}assets/app.js`, 'live-A');
    await a.request(base, '', 'pending-A', true);
    const other = `my-goat-journey:${encodeURIComponent(base === '/' ? '/other/' : '/')}:shell:other`;
    await caches.open(other);
    await caches.open('unrelated-cache');
    await worker(base, 'B', caches, live).dispatch('install');
    const metadata = await caches.open(`${prefix}clients`);
    const put = metadata.put.bind(metadata);
    let failures = 0;
    const injection = vi.spyOn(metadata, 'put').mockImplementation(async (request, response) => {
      if (key(request) === key(`${base}__app_shell__/retired/B`)) {
        failures++;
        throw new DOMException('metadata quota', 'QuotaExceededError');
      }
      await put(request, response);
    });
    await expect(worker(base, 'C', caches, live).dispatch('install')).rejects.toThrow(
      'metadata quota',
    );
    injection.mockRestore();
    expect(failures).toBe(1);
    expect(await (await metadata.match(installed))!.text()).toBe('B');
    expect(await (await metadata.match(`${base}__app_shell__/active`))!.text()).toBe('A');
    expect(await caches.keys()).not.toContain(shell('C'));
    const restartedA = worker(base, 'A', caches, live);
    await restartedA.request(`${base}icons/icon.png`, 'live-A');
    expect(await caches.keys()).toEqual(
      expect.arrayContaining([shell('A'), shell('B'), other, 'unrelated-cache']),
    );
    await worker(base, 'D', caches, live).dispatch('install');
    expect(await (await metadata.match(installed))!.text()).toBe('D');
    expect(await (await restartedA.request(`${base}icons/icon.png`, 'live-A'))!.text()).toBe(
      `A:${base}icons/icon.png`,
    );
    expect(await caches.keys()).not.toContain(shell('B'));
    expect(await caches.keys()).toEqual(
      expect.arrayContaining([shell('A'), shell('D'), other, 'unrelated-cache']),
    );
    expect(await (await metadata.match(`${base}__app_shell__/client/pending-A`))!.text()).toBe('A');
  });
  for (const retained of [false, true]) {
    test(`${base} publication quota failure (${retained ? 'retained rollback' : 'new candidate'}) preserves candidate and retirement bookkeeping`, async () => {
      const caches = new MemoryCaches();
      const live: Client[] = [];
      const prefix = `my-goat-journey:${encodeURIComponent(base)}:`;

      const shell = (version: string) => `${prefix}shell:${version}`;

      const installed = `${base}__app_shell__/installed`;
      const retiredC = `${base}__app_shell__/retired/C`;
      if (retained) {
        const oldC = worker(base, 'C', caches, live);
        await oldC.dispatch('install');
        await oldC.dispatch('activate');
        await oldC.request(base, '', 'live-C', true);
        live.push({ id: 'live-C', url: `${origin}${base}` });
        await oldC.request(`${base}assets/app.js`, 'live-C');
      }
      const a = worker(base, 'A', caches, live);
      await a.dispatch('install');
      await a.dispatch('activate');
      await a.request(base, '', 'live-A', true);
      live.push({ id: 'live-A', url: `${origin}${base}` });
      await a.request(`${base}assets/app.js`, 'live-A');
      const other = `my-goat-journey:${encodeURIComponent(base === '/' ? '/other/' : '/')}:shell:other`;
      await caches.open(other);
      await caches.open('unrelated-cache');
      await worker(base, 'B', caches, live).dispatch('install');
      const metadata = await caches.open(`${prefix}clients`);
      if (retained) expect(await (await metadata.match(retiredC))!.text()).toBe('C');
      const put = metadata.put.bind(metadata);
      let failures = 0;
      const injection = vi.spyOn(metadata, 'put').mockImplementation(async (request, response) => {
        if (key(request) === key(installed)) {
          failures++;
          throw new DOMException('metadata quota', 'QuotaExceededError');
        }
        await put(request, response);
      });
      await expect(worker(base, 'C', caches, live).dispatch('install')).rejects.toThrow(
        'metadata quota',
      );
      injection.mockRestore();
      expect(failures).toBe(1);
      expect(await (await metadata.match(installed))!.text()).toBe('B');
      expect(await (await metadata.match(`${base}__app_shell__/active`))!.text()).toBe('A');
      if (retained) expect(await (await metadata.match(retiredC))?.text()).toBe('C');
      else expect(await caches.keys()).not.toContain(shell('C'));
      const restartedA = worker(base, 'A', caches, live);
      await restartedA.request(`${base}icons/icon.png`, 'live-A');
      expect(await caches.keys()).toEqual(
        expect.arrayContaining([shell('A'), shell('B'), other, 'unrelated-cache']),
      );
      if (retained)
        expect(await (await restartedA.request(`${base}icons/icon.png`, 'live-C'))!.text()).toBe(
          `C:${base}icons/icon.png`,
        );
      await worker(base, 'D', caches, live).dispatch('install');
      expect(await (await metadata.match(installed))!.text()).toBe('D');
      expect(await (await restartedA.request(`${base}icons/icon.png`, 'live-A'))!.text()).toBe(
        `A:${base}icons/icon.png`,
      );
      expect(await caches.keys()).not.toContain(shell('B'));
      if (retained) {
        expect(await (await restartedA.request(`${base}assets/app.js`, 'live-C'))!.text()).toBe(
          `C:${base}assets/app.js`,
        );
        live.splice(
          live.findIndex((client) => client.id === 'live-C'),
          1,
        );
        await restartedA.request(`${base}icons/icon.png`, 'live-A');
        expect(await metadata.match(retiredC)).toBeUndefined();
      }
      expect(await caches.keys()).not.toContain(shell('C'));
      expect(await caches.keys()).toEqual(
        expect.arrayContaining([shell('A'), shell('D'), other, 'unrelated-cache']),
      );
    });
  }
  test(`${base} cleanup preserves a shell whose navigation has not committed yet`, async () => {
    const caches = new MemoryCaches();
    const live: Client[] = [];
    const a = worker(base, 'A', caches, live);
    await a.dispatch('install');
    await a.dispatch('activate');
    await a.request(base, '', 'old-source', true);
    live.push({ id: 'old-source', url: `${origin}${base}` });
    await a.request(`${base}assets/app.js`, 'old-source');
    const b = worker(base, 'B', caches, live);
    await b.dispatch('install');
    await b.dispatch('activate');
    // An A navigation started before activation can finish after B activates.
    expect(await (await a.request(base, 'old-source', 'pending-A', true))!.text()).toBe(
      `A:${base}index.html`,
    );
    live.splice(0, 1, { id: 'new-B', url: `${origin}${base}` });
    await b.request(`${base}assets/app.js`, 'new-B');
    expect(await caches.keys()).toContain(`my-goat-journey:${encodeURIComponent(base)}:shell:A`);
    live.push({ id: 'pending-A', url: `${origin}${base}` });
    expect(await (await b.request(`${base}assets/app.js`, 'pending-A'))!.text()).toBe(
      `A:${base}assets/app.js`,
    );
  });
  test(`${base} pending assignment promotion after cleanup snapshot preserves A for the same document`, async () => {
    const caches = new MemoryCaches();
    const live: Client[] = [];
    const prefix = `my-goat-journey:${encodeURIComponent(base)}:`;
    const a = worker(base, 'A', caches, live);
    await a.dispatch('install');
    await a.dispatch('activate');
    await a.request(base, '', 'old-source', true);
    live.push({ id: 'old-source', url: `${origin}${base}` });
    await a.request(`${base}assets/app.js`, 'old-source');
    const b = worker(base, 'B', caches, live);
    await b.dispatch('install');
    await b.dispatch('activate');
    await a.request(base, 'old-source', 'pending-A', true);
    live.splice(0, 1, { id: 'new-B', url: `${origin}${base}` });
    await b.request(`${base}assets/app.js`, 'new-B');
    const unrelated = await caches.open('unrelated-promotion-test');
    await unrelated.put('/untouched', new Response('unrelated bytes'));
    b.network.mockClear(); // Installation downloads are not runtime fallback.
    b.network.mockRejectedValue(new Error('offline'));
    const metadata = await caches.open(`${prefix}clients`);
    const snapshot = barrier();
    const release = barrier();
    const promoted = barrier();
    const keys = metadata.keys.bind(metadata);
    const put = metadata.put.bind(metadata);
    vi.spyOn(metadata, 'keys').mockImplementationOnce(async () => {
      snapshot.resolve(); // cleanup already captured live windows, without pending-A
      await release.promise;
      return keys();
    });
    vi.spyOn(metadata, 'put').mockImplementation(async (request, response) => {
      await put(request, response);
      if (
        key(request) === key(`${base}__app_shell__/client/pending-A`) &&
        !response.headers.has('X-App-Shell-Pending')
      )
        promoted.resolve();
    });
    const cleaning = b.request(`${base}icons/icon.png`, 'new-B');
    await snapshot.promise;
    live.push({ id: 'pending-A', url: `${origin}${base}` });
    const asset = b.request(`${base}assets/app.js`, 'pending-A');
    // Broken code promotes outside cleanup's lock; fixed code queues behind it.
    // Never wait for promotion while holding cleanup's barrier.
    await Promise.race([promoted.promise, caches.locks.blocked.promise]);
    release.resolve();
    const [, first] = await Promise.all([cleaning, asset]);
    expect(await first!.text()).toBe(`A:${base}assets/app.js`);
    expect(await caches.keys()).toContain(`${prefix}shell:A`);
    expect(await (await metadata.match(`${base}__app_shell__/client/pending-A`))?.text()).toBe('A');
    expect(await (await b.request(`${base}assets/app.js`, 'pending-A'))!.text()).toBe(
      `A:${base}assets/app.js`,
    );
    expect(await (await b.request(`${base}icons/icon.png`, 'pending-A'))!.text()).toBe(
      `A:${base}icons/icon.png`,
    );
    const restarted = worker(base, 'B', caches, live);
    restarted.network.mockRejectedValue(new Error('offline'));
    expect(await (await restarted.request(`${base}assets/app.js`, 'pending-A'))!.text()).toBe(
      `A:${base}assets/app.js`,
    );
    expect(await (await restarted.request(base, '', 'fresh-B', true))!.text()).toBe(
      `B:${base}index.html`,
    );
    expect(await (await restarted.request(`${base}assets/app.js`, 'fresh-B'))!.text()).toBe(
      `B:${base}assets/app.js`,
    );
    expect(await (await unrelated.match('/untouched'))!.text()).toBe('unrelated bytes');
    expect(b.network).not.toHaveBeenCalled();
    expect(restarted.network).not.toHaveBeenCalled();
  });
  for (const quota of [false, true])
    test(`${base} pending promotion first serializes cleanup through ${quota ? 'metadata failure fencing' : 'publication'}`, async () => {
      const caches = new MemoryCaches();
      const live: Client[] = [];
      const prefix = `my-goat-journey:${encodeURIComponent(base)}:`;
      const a = worker(base, 'A', caches, live);
      await a.dispatch('install');
      await a.dispatch('activate');
      await a.request(base, '', 'pending-A', true);
      const b = worker(base, 'B', caches, live);
      await b.dispatch('install');
      await b.dispatch('activate');
      const metadata = await caches.open(`${prefix}clients`);
      const promoting = barrier();
      const release = barrier();
      const snapshot = barrier();
      const put = metadata.put.bind(metadata);
      let cleanupSnapshotted = false;
      vi.spyOn(metadata, 'put').mockImplementation(async (request, response) => {
        if (
          key(request) === key(`${base}__app_shell__/client/pending-A`) &&
          !response.headers.has('X-App-Shell-Pending')
        ) {
          promoting.resolve();
          await release.promise;
          if (quota) throw new DOMException('promotion quota', 'QuotaExceededError');
        }
        await put(request, response);
      });
      b.matchAll.mockImplementation(async () => {
        cleanupSnapshotted = true;
        snapshot.resolve();
        return [...live];
      });
      const asset = b.request(`${base}assets/app.js`, 'pending-A');
      await promoting.promise;
      live.push({ id: 'pending-A', url: `${origin}${base}` });
      // No clientId: trigger cleanup directly, not another observation first.
      const cleaning = b.request(`${base}icons/icon.png`);
      await Promise.race([snapshot.promise, caches.locks.blocked.promise]);
      const snapshottedDuringPromotion = cleanupSnapshotted;
      release.resolve();
      const [first] = await Promise.all([asset, cleaning]);
      expect(snapshottedDuringPromotion).toBe(false);
      expect(await first!.text()).toBe(`A:${base}assets/app.js`);
      expect(await caches.keys()).toContain(`${prefix}shell:A`);
      const assignment = await metadata.match(`${base}__app_shell__/client/pending-A`);
      expect(await assignment!.text()).toBe('A');
      expect(assignment!.headers.has('X-App-Shell-Pending')).toBe(quota);
      expect(await (await metadata.match(`${base}__app_shell__/active`))?.text()).toBe(
        quota ? undefined : 'B',
      );
      const restarted = worker(base, 'B', caches, live);
      restarted.network.mockRejectedValue(new Error('offline'));
      expect(await (await restarted.request(`${base}assets/app.js`, 'pending-A'))!.text()).toBe(
        `A:${base}assets/app.js`,
      );
      expect(await (await restarted.request(`${base}icons/icon.png`, 'pending-A'))!.text()).toBe(
        `A:${base}icons/icon.png`,
      );
      expect(await (await restarted.request(base, '', 'fresh-B', true))!.text()).toBe(
        `B:${base}index.html`,
      );
    });
  test(`${base} a missing old-shell asset fails instead of mixing new network bytes`, async () => {
    const caches = new MemoryCaches();
    const live: Client[] = [];
    const a = worker(base, 'A', caches, live);
    await a.dispatch('install');
    await a.dispatch('activate');
    await a.request(base, '', 'old', true);
    live.push({ id: 'old', url: `${origin}${base}` });
    const b = worker(base, 'B', caches, live);
    await b.dispatch('install');
    await b.dispatch('activate');
    await (
      await caches.open(`my-goat-journey:${encodeURIComponent(base)}:shell:A`)
    ).delete(`${origin}${base}icons/icon.png`);
    await expect(b.request(`${base}icons/icon.png`, 'old')).rejects.toThrow(
      'App-shell asset is unavailable',
    );
  });
  test(`${base} uncached assets never receive a successful HTML shell response`, async () => {
    const sw = worker(base);
    await sw.dispatch('install');
    sw.network.mockResolvedValue(
      new Response('<html>fallback</html>', { headers: { 'Content-Type': 'text/html' } }),
    );
    const response = await sw.request(`${base}assets/missing.js`);
    expect(response!.status).toBe(502);
    expect(response!.headers.get('Content-Type')).not.toContain('text/html');
  });
  test(`${base} missing asset HTTP failures stay failures without runtime caching`, async () => {
    const sw = worker(base);
    await sw.dispatch('install');
    const before = [
      ...(
        await sw.caches.open(`my-goat-journey:${encodeURIComponent(base)}:shell:A`)
      ).entries.keys(),
    ];
    sw.network.mockResolvedValue(
      new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/html' } }),
    );
    expect((await sw.request(`${base}assets/missing.js`))!.status).toBe(404);
    expect([
      ...(
        await sw.caches.open(`my-goat-journey:${encodeURIComponent(base)}:shell:A`)
      ).entries.keys(),
    ]).toEqual(before);
  });
  test(`${base} installation requests verify the expected output bytes`, async () => {
    const sw = worker(base);
    await sw.dispatch('install');
    expect(
      sw.network.mock.calls.every(
        ([request]) =>
          request instanceof Request &&
          request.integrity.startsWith('sha256-') &&
          request.cache === 'reload',
      ),
    ).toBe(true);
  });
  test(`${base} guarded activation refuses quota failure in essential predecessor assignment`, async () => {
    const caches = new MemoryCaches();
    const live: Client[] = [];
    const a = worker(base, 'A', caches, live);
    await a.dispatch('install');
    await a.dispatch('activate');
    const source = { id: 'unassigned-A', url: `${origin}${base}`, type: 'window' };
    live.push(source);
    const b = worker(base, 'B', caches, live);
    await b.dispatch('install');
    const metadata = await caches.open(`my-goat-journey:${encodeURIComponent(base)}:clients`);
    vi.spyOn(metadata, 'put').mockRejectedValue(
      new DOMException('assignment quota', 'QuotaExceededError'),
    );
    const postMessage = vi.fn();
    await b.dispatch('message', {
      data: { type: 'ACTIVATE_WHEN_ALONE' },
      source,
      ports: [{ postMessage }],
    });
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ accepted: false });
    expect(b.skipWaiting).not.toHaveBeenCalled();
    expect(await (await metadata.match(`${base}__app_shell__/active`))!.text()).toBe('A');
    expect(await (await metadata.match(`${base}__app_shell__/installed`))!.text()).toBe('B');
    a.network.mockRejectedValue(new Error('offline'));
    expect(await (await a.request(base, '', 'fallback-A', true))!.text()).toBe(
      `A:${base}index.html`,
    );
    expect(await (await a.request(`${base}assets/app.js`, 'fallback-A'))!.text()).toBe(
      `A:${base}assets/app.js`,
    );
  });
  test(`${base} sustained activation metadata quota still serves verified navigation and coherent assets`, async () => {
    const source = { id: 'old-A', url: `${origin}${base}`, type: 'window' };
    const live = [source];
    const caches = new MemoryCaches();
    const a = worker(base, 'A', caches, live);
    await a.dispatch('install');
    await a.dispatch('activate');
    await a.request(`${base}assets/app.js`, source.id);
    const b = worker(base, 'B', caches, live);
    await b.dispatch('install');
    const metadata = await caches.open(`my-goat-journey:${encodeURIComponent(base)}:clients`);
    const quota = vi
      .spyOn(metadata, 'put')
      .mockRejectedValue(new DOMException('sustained metadata quota', 'QuotaExceededError'));
    // Native activation does not roll back or reject skipWaiting merely because
    // an activate-event extension rejects; continue into the cached reload.
    b.skipWaiting.mockImplementation(async () => {
      await b.dispatch('activate').catch(() => {});
    });
    const postMessage = vi.fn();
    await b.dispatch('message', {
      data: { type: 'ACTIVATE_WHEN_ALONE' },
      source,
      ports: [{ postMessage }],
    });
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ accepted: true });
    b.network.mockRejectedValue(new Error('offline'));
    expect(await (await b.request(base, '', 'new-B', true))!.text()).toBe(`B:${base}index.html`);
    live.push({ id: 'new-B', url: `${origin}${base}`, type: 'window' });
    for (const path of b.files.filter((path) => !path.endsWith('index.html'))) {
      expect(await (await b.request(path, source.id))!.text()).toBe(`A:${path}`);
      expect(await (await b.request(path, 'new-B'))!.text()).toBe(`B:${path}`);
    }
    // Restart must retain durable old assignments; a fresh navigation can still
    // establish the new shell, but a lost volatile assignment must fail closed.
    const restarted = worker(base, 'B', caches, live);
    restarted.network.mockRejectedValue(new Error('offline'));
    expect(await (await restarted.request(`${base}assets/app.js`, source.id))!.text()).toBe(
      `A:${base}assets/app.js`,
    );
    await expect(restarted.request(`${base}assets/app.js`, 'new-B')).rejects.toThrow(
      'App-shell client version is unavailable',
    );
    expect(await (await restarted.request(base, '', 'reopened-B', true))!.text()).toBe(
      `B:${base}index.html`,
    );
    expect(await (await restarted.request(`${base}assets/app.js`, 'reopened-B'))!.text()).toBe(
      `B:${base}assets/app.js`,
    );
    expect(await (await metadata.match(`${base}__app_shell__/installed`))!.text()).toBe('B');
    expect(await caches.keys()).toEqual(
      expect.arrayContaining([
        `my-goat-journey:${encodeURIComponent(base)}:shell:A`,
        `my-goat-journey:${encodeURIComponent(base)}:shell:B`,
      ]),
    );
    quota.mockRestore();
    // The missing active pointer is a durable safety fence, not permission to
    // infer an unknown old document's version from a superseded pointer.
    const c = worker(base, 'C', caches, live);
    await c.dispatch('install');
    live.splice(0, live.length, { id: 'reopened-B', url: `${origin}${base}`, type: 'window' });
    const denied = vi.fn();
    await c.dispatch('message', {
      data: { type: 'ACTIVATE_WHEN_ALONE' },
      source: live[0],
      ports: [{ postMessage: denied }],
    });
    expect(denied).toHaveBeenCalledExactlyOnceWith({ accepted: false });
    expect(c.skipWaiting).not.toHaveBeenCalled();
    expect(b.claim).not.toHaveBeenCalled();
  });
  test(`${base} ACTIVATE_WHEN_ALONE releases coordination while native skipWaiting waits for activation`, async () => {
    const source = { id: 'accepting-tab', url: `${origin}${base}`, type: 'window' };
    const live = [source];
    const caches = new MemoryCaches();
    const a = worker(base, 'A', caches, live);
    await a.dispatch('install');
    await a.dispatch('activate');
    await a.request(`${base}assets/app.js`, source.id);
    const b = worker(base, 'B', caches, live);
    await b.dispatch('install');
    const c = worker(base, 'C', caches, live);
    c.network.mockRejectedValueOnce(new Error('interrupted C'));
    await expect(c.dispatch('install')).rejects.toThrow('interrupted C');
    const started = barrier();
    const completed = barrier();
    const finishSkip = barrier();
    let activationComplete = false;
    b.skipWaiting.mockImplementation(async () => {
      // Chromium's native promise remains pending until activation's waitUntil
      // work completes, including cleanup acquiring the same lifecycle lock.
      const activation = b.dispatch('activate');
      started.resolve();
      await activation;
      activationComplete = true;
      completed.resolve();
      await finishSkip.promise;
    });
    const postMessage = vi.fn();
    const accepting = b.dispatch('message', {
      data: { type: 'ACTIVATE_WHEN_ALONE' },
      source,
      ports: [{ postMessage }],
    });
    await started.promise;
    // Old code deterministically queues cleanup behind its own held lock;
    // fixed code lets activation complete. No sleep or timeout is the oracle.
    await Promise.race([completed.promise, caches.locks.blocked.promise]);
    expect(activationComplete).toBe(true);
    expect(postMessage).not.toHaveBeenCalled(); // Native resolution gates consent.
    finishSkip.resolve();
    await accepting;
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ accepted: true });
    expect(b.skipWaiting).toHaveBeenCalledTimes(1);
    expect(b.claim).not.toHaveBeenCalled();
    expect(await (await b.request(`${base}assets/app.js`, source.id))!.text()).toBe(
      `A:${base}assets/app.js`,
    );
    expect(await (await b.request(base, '', 'reloaded-B', true))!.text()).toBe(
      `B:${base}index.html`,
    );
  });
  test(`${base} ACTIVATE_WHEN_ALONE acknowledges the sole in-scope window for the successful candidate`, async () => {
    const live = [{ id: 'accepting-tab', url: `${origin}${base}`, type: 'window' }];
    const sw = worker(base, 'B', new MemoryCaches(), live);
    await sw.dispatch('install');
    const postMessage = vi.fn();
    await sw.dispatch('message', {
      data: { type: 'ACTIVATE_WHEN_ALONE' },
      source: live[0],
      ports: [{ postMessage }],
    });
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ accepted: true });
    expect(sw.skipWaiting).toHaveBeenCalledTimes(1);
    expect(sw.claim).not.toHaveBeenCalled();
  });
  test.each([
    'peer',
    'no-windows',
    'missing-source',
    'non-window',
    'missing-id',
    'invalid-url',
    'external-source',
    'outside-scope-source',
    'wrong-source',
    'no-candidate',
    'superseded-candidate',
    'metadata-error',
    'clients-error',
    'skip-error',
  ])(`${base} ACTIVATE_WHEN_ALONE refuses unsafe request (%s)`, async (reason) => {
    const source = { id: 'accepting-tab', url: `${origin}${base}`, type: 'window' };
    const live = [source];
    const caches = new MemoryCaches();
    const sw = worker(base, 'B', caches, live);
    await sw.dispatch('install');
    let messageSource: Record<string, string> | undefined = source;
    if (reason === 'peer') live.push({ id: 'other-tab', url: `${origin}${base}`, type: 'window' });
    if (reason === 'no-windows') live.splice(0);
    if (reason === 'missing-source') messageSource = undefined;
    if (reason === 'non-window') messageSource = { ...source, type: 'worker' };
    if (reason === 'missing-id') messageSource = { ...source, id: '' };
    if (reason === 'invalid-url') messageSource = { ...source, url: 'not a URL' };
    if (reason === 'external-source') messageSource = { ...source, url: 'https://external.test/' };
    if (reason === 'outside-scope-source')
      messageSource = {
        ...source,
        url: base === '/' ? 'https://external.test/outside/' : `${origin}/outside/`,
      };
    if (reason === 'wrong-source') messageSource = { ...source, id: 'unlisted-tab' };
    const metadata = await caches.open(`my-goat-journey:${encodeURIComponent(base)}:clients`);
    if (reason === 'no-candidate') await metadata.delete(`${base}__app_shell__/installed`);
    if (reason === 'superseded-candidate')
      await worker(base, 'C', caches, live).dispatch('install');
    if (reason === 'metadata-error')
      vi.spyOn(metadata, 'match').mockRejectedValue(new Error('storage failure'));
    if (reason === 'clients-error') sw.matchAll.mockRejectedValue(new Error('enumeration failure'));
    if (reason === 'skip-error') sw.skipWaiting.mockRejectedValue(new Error('activation failure'));
    const postMessage = vi.fn();
    await sw.dispatch('message', {
      data: { type: 'ACTIVATE_WHEN_ALONE' },
      source: messageSource,
      ports: [{ postMessage }],
    });
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ accepted: false });
    expect(sw.skipWaiting).toHaveBeenCalledTimes(reason === 'skip-error' ? 1 : 0);
    expect(sw.claim).not.toHaveBeenCalled();
  });
  test(`${base} ACTIVATE_WHEN_ALONE requires an acknowledgement port`, async () => {
    const source = { id: 'accepting-tab', url: `${origin}${base}`, type: 'window' };
    const sw = worker(base, 'B', new MemoryCaches(), [source]);
    await sw.dispatch('install');
    await sw.dispatch('message', { data: { type: 'ACTIVATE_WHEN_ALONE' }, source });
    expect(sw.skipWaiting).not.toHaveBeenCalled();
  });
  test(`${base} ACTIVATE_WHEN_ALONE ignores windows outside deployment scope`, async () => {
    const source = { id: 'accepting-tab', url: `${origin}${base}`, type: 'window' };
    const live = [source, { id: 'external', url: 'https://external.test/', type: 'window' }];
    if (base !== '/') live.push({ id: 'other-base', url: `${origin}/outside/`, type: 'window' });
    const sw = worker(base, 'B', new MemoryCaches(), live);
    await sw.dispatch('install');
    const postMessage = vi.fn();
    await sw.dispatch('message', {
      data: { type: 'ACTIVATE_WHEN_ALONE' },
      source,
      ports: [{ postMessage }],
    });
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ accepted: true });
    expect(sw.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
    expect(sw.skipWaiting).toHaveBeenCalledTimes(1);
  });
  test(`${base} ACTIVATE_WHEN_ALONE rechecks peers after obtaining coordination`, async () => {
    const source = { id: 'accepting-tab', url: `${origin}${base}`, type: 'window' };
    const live = [source];
    const caches = new MemoryCaches();
    const sw = worker(base, 'B', caches, live);
    await sw.dispatch('install');
    const acquired = barrier();
    const finish = barrier();
    const held = caches.locks.request(
      `my-goat-journey:${encodeURIComponent(base)}:shell-lifecycle`,
      async () => {
        acquired.resolve();
        await finish.promise;
      },
    );
    await acquired.promise;
    const postMessage = vi.fn();
    const activating = sw.dispatch('message', {
      data: { type: 'ACTIVATE_WHEN_ALONE' },
      source,
      ports: [{ postMessage }],
    });
    await caches.locks.blocked.promise;
    live.push({ id: 'new-peer', url: `${origin}${base}`, type: 'window' });
    finish.resolve();
    await Promise.all([held, activating]);
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ accepted: false });
    expect(sw.skipWaiting).not.toHaveBeenCalled();
  });
  test.each([
    'sole-window',
    'peer',
    'missing-source',
    'invalid-source',
    'missing-port',
    'no-candidate',
    'superseded-candidate',
  ])(`${base} legacy SKIP_WAITING never bypasses guarded activation (%s)`, async (reason) => {
    const source = { id: 'requesting-tab', url: `${origin}${base}`, type: 'window' };
    const live = [source];
    const caches = new MemoryCaches();
    const sw = worker(base, 'B', caches, live);
    await sw.dispatch('install');
    if (reason === 'peer')
      live.push({ id: 'unknown-peer', url: `${origin}${base}unknown.html`, type: 'window' });
    if (reason === 'no-candidate')
      await (
        await caches.open(`my-goat-journey:${encodeURIComponent(base)}:clients`)
      ).delete(`${base}__app_shell__/installed`);
    if (reason === 'superseded-candidate')
      await worker(base, 'C', caches, live).dispatch('install');
    const postMessage = vi.fn();
    const messageSource =
      reason === 'missing-source'
        ? undefined
        : reason === 'invalid-source'
          ? { ...source, url: 'not a URL' }
          : source;
    await sw.dispatch('message', { data: { type: 'OTHER' } });
    await sw.dispatch('message', { data: 'SKIP_WAITING' });
    await sw.dispatch('message', {
      data: { type: 'SKIP_WAITING' },
      source: messageSource,
      ports: reason === 'missing-port' ? [] : [{ postMessage }],
    });
    expect(sw.skipWaiting).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled(); // Obsolete messages grant no consent.
    expect(sw.claim).not.toHaveBeenCalled();
  });
  test(`${base} serves offline routes and shell assets without caching data requests`, async () => {
    const sw = worker(base);
    await sw.dispatch('install');
    sw.network.mockRejectedValue(new Error('offline'));
    expect(await (await sw.request(`${base}progress?window=7d`, '', 'new-tab', true))!.text()).toBe(
      `A:${base}index.html`,
    );
    expect(await (await sw.request(`${base}assets/app.js`, 'new-tab'))!.text()).toBe(
      `A:${base}assets/app.js`,
    );
    await expect(sw.request(`${base}assets/missing.js`, 'new-tab')).rejects.toThrow('offline');
    expect(await sw.request(`${base}api/diary`, 'new-tab')).toBeUndefined();
    // Synthetic peer endpoints must reach the proxy, not the app navigation shell.
    expect(
      await sw.request(`${base}__pwa_test_unknown_peer__.html`, '', 'unknown-peer', true),
    ).toBeUndefined();
    expect(
      await sw.dispatch('fetch', {
        request: { url: 'https://external.test/x.js', method: 'GET', mode: 'cors' },
      }),
    ).toBeUndefined();
    expect(
      await sw.dispatch('fetch', {
        request: { url: `${origin}${base}assets/app.js`, method: 'POST', mode: 'cors' },
      }),
    ).toBeUndefined();
    if (base !== '/') expect(await sw.request('/unrelated/', '', '', true)).toBeUndefined();
  });
  for (const failure of ['network', 'integrity', 'http', 'redirect']) {
    test(`${base} failed retained-shell rollback (${failure}) preserves every live old-shell file`, async () => {
      const caches = new MemoryCaches();
      const live: Client[] = [];
      const a = worker(base, 'A', caches, live);
      await a.dispatch('install');
      await a.dispatch('activate');
      await a.request(base, '', 'live-A', true);
      live.push({ id: 'live-A', url: `${origin}${base}` });
      const b = worker(base, 'B', caches, live);
      await b.dispatch('install');
      await b.dispatch('activate');
      await b.request(`${base}assets/app.js`, 'live-A');
      await caches.open('unrelated-cache');
      const before = await caches.keys();
      const rollback = worker(base, 'A', caches, live);
      const fetchingFailure = barrier();
      let failFetch!: () => void;
      rollback.network.mockImplementation(async (request) => {
        if (!key(request).endsWith('app.js'))
          return new Response('replacement bytes must not overwrite retained bytes');
        return new Promise((resolve, reject) => {
          failFetch = () => {
            if (failure === 'http') resolve(new Response('not found', { status: 404 }));
            else if (failure === 'redirect') {
              const response = new Response('redirected');
              Object.defineProperty(response, 'redirected', { value: true });
              resolve(response);
            } else reject(new Error(failure === 'integrity' ? 'integrity mismatch' : 'offline'));
          };
          fetchingFailure.resolve();
        });
      });
      const installing = rollback.dispatch('install');
      const rejected = expect(installing).rejects.toThrow();
      await fetchingFailure.promise;
      // A remains coherent while the rollback download is still in progress.
      const retained = await caches.open(`my-goat-journey:${encodeURIComponent(base)}:shell:A`);
      const duringInstall = await (await retained.match(`${base}index.html`))!.text();
      failFetch();
      await rejected;
      expect(await caches.keys()).toEqual(before);
      expect(duringInstall).toBe(`A:${base}index.html`);
      for (const path of a.files) {
        expect(await (await retained.match(path))!.text()).toBe(`A:${path}`);
        if (!path.endsWith('index.html'))
          expect(await (await b.request(path, 'live-A'))!.text()).toBe(`A:${path}`);
      }
      expect(rollback.skipWaiting).not.toHaveBeenCalled();
    });
  }
  test(`${base} failed install removes partial shell but preserves unrelated caches`, async () => {
    const sw = worker(base);
    await sw.caches.open('unrelated-cache');
    sw.network.mockImplementation(
      async (request) =>
        new Response('missing', { status: key(request).endsWith('app.js') ? 404 : 200 }),
    );
    await expect(sw.dispatch('install')).rejects.toThrow();
    // Ownership now requires a metadata cache before the first shell mutation.
    // Failed transfer removes the owned shell/marker, not the metadata namespace.
    const metadataName = `my-goat-journey:${encodeURIComponent(base)}:clients`;
    expect(await sw.caches.keys()).toEqual(['unrelated-cache', metadataName]);
    expect(await (await sw.caches.open(metadataName)).keys()).toEqual([]);
    expect(sw.skipWaiting).not.toHaveBeenCalled();
  });
  test(`${base} installs all shell files without automatic activation`, async () => {
    const sw = worker(base);
    await sw.dispatch('install');
    expect(sw.network.mock.calls.map(([request]) => new URL(key(request)).pathname).sort()).toEqual(
      sw.files.slice().sort(),
    );
    expect(sw.skipWaiting).not.toHaveBeenCalled();
    const shell = sw.caches.entries.get(`my-goat-journey:${encodeURIComponent(base)}:shell:A`)!;
    expect(await (await shell.match(`${origin}${base}index.html`))!.text()).toBe(
      `A:${base}index.html`,
    );
  });
}
