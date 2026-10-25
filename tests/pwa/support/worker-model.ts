import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { vi } from 'vitest';

export const origin = 'https://journey.test';
const template = readFileSync('src/pwa/service-worker.js', 'utf8');

export const key = (value: Request | string) =>
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

export function barrier<T = void>() {
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
export class MemoryCaches {
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
export type Client = { id: string; url: string };

export function worker(
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
  const registration: { scope: string; active?: object; waiting?: object } = {
    scope: `${origin}${base}`,
  };
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
        registration,
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

  return {
    base,
    files,
    caches,
    live,
    registration,
    network,
    skipWaiting,
    claim,
    matchAll,
    dispatch,
    request,
  };
}

// A termination model: only durable CacheStorage crosses into the new worker
// and lock context. No rejected install, timer, catch or finally runs here.
export async function persistedRestart(source: MemoryCaches) {
  const restored = new MemoryCaches();
  for (const name of await source.keys()) {
    const cache = await source.open(name);
    const destination = await restored.open(name);
    for (const request of await cache.keys()) {
      await destination.put(request, (await cache.match(request))!);
    }
  }
  return restored;
}
