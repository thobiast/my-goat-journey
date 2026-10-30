import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSyncExternalStore } from 'react';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

vi.mock('react', () => ({
  useSyncExternalStore: vi.fn((_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot()),
}));

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const initializer = html.match(/<script>([\s\S]*?)<\/script>/)![1];

interface AppearancePageOptions {
  appBase?: string;
  system?: string;
  stored?: string | null;
  readFailure?: 'access' | 'read';
  writeFailure?: boolean;
}

function createAppearancePage(options: AppearancePageOptions = {}) {
  const appBase = options.appBase ?? import.meta.env.BASE_URL;
  const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
  const meta = {
    content: '#fffaf0',
    setAttribute(_name: string, value: string) {
      meta.content = value;
    },
  };
  const keys: string[] = [];
  const localStorage = {
    getItem(key: string) {
      keys.push(key);
      if (options.readFailure === 'read') throw new Error('Blocked');
      return options.stored ?? null;
    },
    setItem: vi.fn(() => {
      if (options.writeFailure) throw new Error('Full');
    }),
  };
  const storageEvents = new EventTarget();
  const storageListeners = new Set<EventListenerOrEventListenerObject>();
  const mediaEvents = new EventTarget();
  const media = {
    matches: options.system === 'dark',
    addEventListener: vi.fn(mediaEvents.addEventListener.bind(mediaEvents)),
    removeEventListener: vi.fn(mediaEvents.removeEventListener.bind(mediaEvents)),
  };
  const window = {
    get localStorage() {
      if (options.readFailure === 'access') throw new Error('Blocked');
      return localStorage;
    },
    matchMedia: () => media,
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      storageEvents.addEventListener(type, listener);
      if (type === 'storage') storageListeners.add(listener);
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      storageEvents.removeEventListener(type, listener);
      if (type === 'storage') storageListeners.delete(listener);
    },
  };
  const document = { documentElement: root, querySelector: () => meta };
  runInNewContext(initializer.replaceAll('%BASE_URL%', appBase), {
    URL,
    location: { href: 'https://example.test/field-notes/app/' },
    get localStorage() {
      return window.localStorage;
    },
    window,
    document,
    matchMedia: window.matchMedia,
  });
  return {
    root,
    meta,
    keys,
    localStorage,
    window,
    document,
    media,
    storageListeners,
    storageChanged(key: string | null, newValue: string | null) {
      storageEvents.dispatchEvent(Object.assign(new Event('storage'), { key, newValue }));
    },
    systemChanged(dark: boolean) {
      media.matches = dark;
      mediaEvents.dispatchEvent(new Event('change'));
    },
  };
}

async function loadAppearance(page: ReturnType<typeof createAppearancePage>) {
  vi.stubGlobal('window', page.window);
  vi.stubGlobal('document', page.document);
  const appearance = await import('../../src/app/appearance');
  appearance.useAppearance();
  const [subscribe, getSnapshot] = vi.mocked(useSyncExternalStore).mock.calls.at(-1)!;
  return { ...appearance, subscribe, getSnapshot };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
});

describe('signed app HTML appearance initialization', () => {
  for (const appBase of ['/my-goat-journey/app/', '/field-notes/app/', '/app/', './']) {
    for (const system of ['light', 'dark']) {
      for (const stored of [null, 'system', 'light', 'dark', 'Graphite']) {
        it(`resolves ${stored} with ${system} OS at ${appBase} before modules`, () => {
          const { root, meta, keys } = createAppearancePage({ appBase, system, stored });
          const preference = stored === 'dark' || stored === 'light' ? stored : 'system';
          const resolved = preference === 'system' ? system : preference;
          expect(root.dataset).toEqual({ appearance: resolved, appearancePreference: preference });
          expect(root.style.colorScheme).toBe(resolved);
          expect(root.style.backgroundColor).toBe(resolved === 'dark' ? '#090B0E' : '#fffaf0');
          expect(meta.content).toBe(root.style.backgroundColor);
          expect(keys).toEqual([
            `my-goat-journey:appearance:${appBase === './' ? '/field-notes/app/' : appBase}`,
          ]);
        });
      }
    }
  }

  for (const readFailure of ['access', 'read'] as const) {
    it(`keeps System usable when storage ${readFailure} throws`, () => {
      const { root } = createAppearancePage({ readFailure, system: 'dark' });
      expect(root.dataset.appearancePreference).toBe('system');
      expect(root.dataset.appearance).toBe('dark');
    });
  }
});

describe('appearance bootstrap storage handoff', () => {
  const storageKey = `my-goat-journey:appearance:${import.meta.env.BASE_URL}`;

  for (const timing of ['before module evaluation', 'before first subscription']) {
    it(`adopts the latest peer choice ${timing} without another storage read`, async () => {
      const page = createAppearancePage();
      const evaluated = timing === 'before first subscription' ? await loadAppearance(page) : null;
      expect(page.root.dataset.appearancePreference).toBe('system');
      page.storageChanged(storageKey, 'dark');
      expect(page.root.dataset).toEqual({ appearancePreference: 'dark', appearance: 'dark' });
      expect(page.root.style.colorScheme).toBe('dark');
      expect(page.root.style.backgroundColor).toBe('#090B0E');
      expect(page.meta.content).toBe('#090B0E');
      const runtime = evaluated ?? (await loadAppearance(page));
      const notify = vi.fn();
      const unsubscribe = runtime.subscribe(notify);
      expect(runtime.getSnapshot()).toBe('dark');
      expect(page.root.dataset.appearance).toBe('dark');
      expect(page.storageListeners.size).toBe(1);
      page.storageChanged(storageKey, 'light');
      expect(runtime.getSnapshot()).toBe('light');
      expect(page.root.dataset.appearance).toBe('light');
      expect(notify).toHaveBeenCalledTimes(1);
      expect(page.keys).toEqual([storageKey]);
      expect(page.localStorage.setItem).not.toHaveBeenCalled();
      unsubscribe();
      expect(page.storageListeners.size).toBe(0);
    });
  }

  it('filters other app bases and normalizes deletion, clear and invalid startup events', async () => {
    const page = createAppearancePage({ system: 'dark', stored: 'light' });
    const runtime = await loadAppearance(page);
    page.storageChanged(`${storageKey}other/`, 'dark');
    expect(page.root.dataset.appearancePreference).toBe('light');
    for (const [key, value] of [
      [storageKey, null],
      [storageKey, 'Graphite'],
      [null, null],
    ] as const) {
      page.storageChanged(storageKey, 'light');
      page.storageChanged(key, value);
      expect(page.root.dataset).toEqual({ appearancePreference: 'system', appearance: 'dark' });
      expect(page.root.style.colorScheme).toBe('dark');
      expect(page.meta.content).toBe('#090B0E');
    }
    const unsubscribe = runtime.subscribe(vi.fn());
    expect(runtime.getSnapshot()).toBe('system');
    expect(page.keys).toEqual([storageKey]);
    expect(page.localStorage.setItem).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('releases the bootstrap and runtime listeners through shared and StrictMode subscriptions', async () => {
    const page = createAppearancePage();
    const runtime = await loadAppearance(page);
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = runtime.subscribe(first);
    const unsubscribeSecond = runtime.subscribe(second);
    expect(page.storageListeners.size).toBe(1);
    expect(page.media.addEventListener).toHaveBeenCalledTimes(1);
    page.storageChanged(storageKey, 'dark');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    unsubscribeFirst();
    expect(page.storageListeners.size).toBe(1);
    unsubscribeSecond();
    expect(page.storageListeners.size).toBe(0);
    expect(page.media.removeEventListener).toHaveBeenCalledTimes(1);
    page.storageChanged(storageKey, 'light');
    expect(runtime.getSnapshot()).toBe('dark');
    const unsubscribeRemount = runtime.subscribe(first);
    expect(page.storageListeners.size).toBe(1);
    expect(runtime.getSnapshot()).toBe('dark');
    runtime.setAppearance('system');
    page.systemChanged(true);
    expect(page.root.dataset.appearance).toBe('dark');
    page.systemChanged(false);
    expect(page.root.dataset.appearance).toBe('light');
    unsubscribeRemount();
    expect(page.storageListeners.size).toBe(0);
    expect(page.media.removeEventListener).toHaveBeenCalledTimes(2);
    page.systemChanged(true);
    expect(page.root.dataset.appearance).toBe('light');
    expect(page.keys).toEqual([storageKey]);
  });

  for (const readFailure of [undefined, 'access', 'read'] as const) {
    it(`keeps a failed-write session choice across adoption/remount with ${readFailure ?? 'working'} reads`, async () => {
      const page = createAppearancePage({ readFailure, writeFailure: true });
      const runtime = await loadAppearance(page);
      runtime.setAppearance('dark');
      const unsubscribe = runtime.subscribe(vi.fn());
      expect(runtime.getSnapshot()).toBe('dark');
      expect(page.root.dataset.appearance).toBe('dark');
      unsubscribe();
      const unsubscribeRemount = runtime.subscribe(vi.fn());
      expect(runtime.getSnapshot()).toBe('dark');
      expect(page.root.dataset.appearance).toBe('dark');
      expect(page.keys).toEqual(readFailure === 'access' ? [] : [storageKey]);
      unsubscribeRemount();
      expect(page.storageListeners.size).toBe(0);
    });
  }
});
