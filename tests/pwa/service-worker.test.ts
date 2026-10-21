import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, test, vi } from 'vitest';

const origin = 'https://journey.test';
const template = readFileSync('src/pwa/service-worker.js', 'utf8');

const key = (value: Request | string) =>
  typeof value === 'string' ? new URL(value, origin).href : value.url;

class MemoryCache {
  entries = new Map<string, Response>();
  async put(request: Request | string, response: Response) {
    // Native Cache.put settles only after consuming the response body.
    const bytes = await response.arrayBuffer();
    this.entries.set(
      key(request),
      new Response(bytes, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }),
    );
  }
  async match(request: Request | string) {
    return this.entries.get(key(request))?.clone();
  }
  async delete(request: Request | string) {
    return this.entries.delete(key(request));
  }
  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
}

function barrier<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Model the origin-wide Web Locks manager shared by distinct worker globals.
class MemoryLocks {
  private tails = new Map<string, Promise<void>>();
  blocked = barrier();
  async request<T>(name: string, callback: () => Promise<T>) {
    const previous = this.tails.get(name);
    const released = barrier();
    this.tails.set(name, released.promise);
    if (previous) {
      this.blocked.resolve();
      await previous;
    }
    try {
      return await callback();
    } finally {
      if (this.tails.get(name) === released.promise) this.tails.delete(name);
      released.resolve();
    }
  }
}
class MemoryCaches {
  entries = new Map<string, MemoryCache>();
  locks = new MemoryLocks();
  async open(name: string) {
    if (!this.entries.has(name)) this.entries.set(name, new MemoryCache());
    return this.entries.get(name)!;
  }
  async keys() {
    return [...this.entries.keys()];
  }
  async delete(name: string) {
    return this.entries.delete(name);
  }
}
type Client = { id: string; url: string };

function worker(
  base = '/',
  version = 'A',
  caches = new MemoryCaches(),
  live: Client[] = [],
  locks: MemoryLocks | null = caches.locks,
) {
  const files = [
    'index.html',
    'assets/app.js',
    'assets/app.css',
    'icons/icon.png',
    'site-v1.webmanifest',
    'branding/logo.png',
  ].map((file) => `${base}${file}`);
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const network = vi.fn(
    async (request: Request | string) =>
      new Response(`${version}:${new URL(key(request)).pathname}`),
  );
  const skipWaiting = vi.fn(async () => {});
  const claim = vi.fn(async () => {});
  const matchAll = vi.fn(async () => live);
  runInNewContext(
    template.replace(
      '__APP_SHELL_CONFIG__',
      JSON.stringify({
        base,
        version,
        files,
        integrity: Object.fromEntries(files.map((path) => [path, 'sha256-dGVzdA=='])),
      }),
    ),
    {
      self: {
        location: { origin },
        navigator: { locks },
        registration: { scope: `${origin}${base}` },
        addEventListener: (type: string, listener: (event: Record<string, unknown>) => void) =>
          listeners.set(type, listener),
        skipWaiting,
        clients: { matchAll, claim },
      },
      caches,
      fetch: network,
      Request,
      Response,
      URL,
      AbortController,
      setTimeout,
      clearTimeout,
      console,
    },
  );

  async function dispatch(type: string, fields: Record<string, unknown> = {}) {
    const waits: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    listeners.get(type)?.({
      ...fields,
      waitUntil: (promise: Promise<unknown>) => waits.push(promise),
      respondWith: (promise: Promise<Response>) => {
        response = promise;
      },
    });
    const result = response ? await response : undefined;
    await Promise.all(waits);
    return result;
  }

  function request(path: string, clientId = '', resultingClientId = '', navigate = false) {
    return dispatch('fetch', {
      request: { url: `${origin}${path}`, method: 'GET', mode: navigate ? 'navigate' : 'cors' },
      clientId,
      resultingClientId,
    });
  }

  return { base, files, caches, live, network, skipWaiting, claim, matchAll, dispatch, request };
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
    expect(await sw.caches.keys()).toEqual(['unrelated-cache']);
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
