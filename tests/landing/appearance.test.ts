import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../../landing/assets/appearance.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../landing/index.html', import.meta.url), 'utf8');
const storageKey = 'my-goat-journey:appearance:/my-goat-journey/app/';

interface PageOptions {
  scriptUrl?: string;
  stored?: Record<string, string>;
  systemDark?: boolean;
  readFailure?: 'access' | 'read';
  writeFailure?: boolean;
}

// Only browser boundaries are modeled; the actual classic script owns all policy.
function createPage(options: PageOptions = {}) {
  const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
  const meta = { content: '#f8f6ef' };
  const values = new Map(Object.entries(options.stored ?? {}));
  const localStorage = {
    getItem: vi.fn((key: string) => {
      if (options.readFailure === 'read') throw new Error('Blocked read');
      return values.get(key) ?? null;
    }),
    setItem: vi.fn((key: string, value: string) => {
      if (options.writeFailure) throw new Error('Blocked write');
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    clear: vi.fn(() => values.clear()),
  };
  const sessionStorage = {};
  const window = new EventTarget();
  const documentEvents = new EventTarget();
  const media = Object.assign(new EventTarget(), { matches: options.systemDark ?? false });
  const matchMedia = vi.fn((query: string) => {
    expect(query).toBe('(prefers-color-scheme: dark)');
    return media;
  });
  const buttons = ['light', 'dark'].map((choice) => {
    const attributes = new Map<string, string>();
    return Object.assign(new EventTarget(), {
      dataset: { appearanceChoice: choice },
      setAttribute(name: string, value: string) {
        attributes.set(name, value);
      },
      getAttribute(name: string) {
        return attributes.get(name) ?? null;
      },
    });
  });
  let parsed = false;
  const document = {
    documentElement: root,
    currentScript: {
      src: options.scriptUrl ?? 'https://example.test/my-goat-journey/assets/appearance.js',
    },
    querySelector(selector: string) {
      expect(selector).toBe('meta[name="theme-color"]');
      return meta;
    },
    querySelectorAll(selector: string) {
      expect(selector).toBe('[data-appearance-choice]');
      return parsed ? buttons : [];
    },
    addEventListener: documentEvents.addEventListener.bind(documentEvents),
  };
  runInNewContext(
    source,
    {
      URL,
      // The key must come from the script URL, not the document's current path.
      location: { href: 'https://example.test/unrelated/nested/index.html' },
      get localStorage() {
        if (options.readFailure === 'access') throw new Error('Blocked access');
        return localStorage;
      },
      window,
      document,
      matchMedia,
    },
    { filename: 'landing/assets/appearance.js', timeout: 1000 },
  );
  return {
    root,
    meta,
    buttons,
    localStorage,
    sessionStorage,
    values,
    ready() {
      parsed = true;
      documentEvents.dispatchEvent(new Event('DOMContentLoaded'));
    },
    click(choice: 'light' | 'dark') {
      buttons
        .find((button) => button.dataset.appearanceChoice === choice)!
        .dispatchEvent(new Event('click'));
    },
    systemChanged(dark: boolean) {
      media.matches = dark;
      media.dispatchEvent(new Event('change'));
    },
    storageChanged(
      key: string | null,
      newValue: string | null,
      storageArea: object = localStorage,
    ) {
      window.dispatchEvent(Object.assign(new Event('storage'), { key, newValue, storageArea }));
    },
  };
}

type Page = ReturnType<typeof createPage>;

function expectNoStorageWrites(page: Page) {
  expect(page.localStorage.setItem).not.toHaveBeenCalled();
  expect(page.localStorage.removeItem).not.toHaveBeenCalled();
  expect(page.localStorage.clear).not.toHaveBeenCalled();
}

function expectAppearance(page: Page, preference: string, resolved: 'light' | 'dark') {
  expect(page.root.dataset).toEqual({ appearancePreference: preference, appearance: resolved });
  expect(page.root.style.colorScheme).toBe(resolved);
  expect(page.root.style.backgroundColor).toBe(resolved === 'dark' ? '#090B0E' : '#f8f6ef');
  expect(page.meta.content).toBe(page.root.style.backgroundColor);
}

function expectButtons(page: Page, resolved: 'light' | 'dark') {
  expect(page.buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual(
    resolved === 'light' ? ['true', 'false'] : ['false', 'true'],
  );
}

describe('landing classic appearance initialization', () => {
  it('loads synchronously in the head before styles and the native module entry', () => {
    const head = html.match(/<head>[\s\S]*?<\/head>/)![0];
    const script = head.match(/<script\b[^>]*\bsrc="assets\/appearance\.js"[^>]*><\/script>/)![0];
    expect(script).not.toMatch(/\b(?:async|defer|type)\s*(?:=|>|\s)/);
    expect(head.indexOf(script)).toBeLessThan(head.indexOf('<link rel="stylesheet"'));
    expect(head.indexOf(script)).toBeLessThan(head.indexOf('<script type="module"'));
    expect(head.match(/<script\b/g)).toHaveLength(2);
  });

  it.each([
    ['https://example.test/my-goat-journey/assets/appearance.js', storageKey],
    ['https://example.test/assets/appearance.js', 'my-goat-journey:appearance:/app/'],
    [
      'https://example.test/field-notes/assets/appearance.js',
      'my-goat-journey:appearance:/field-notes/app/',
    ],
    [
      'https://example.test/team/journey/assets/appearance.js?v=1#head',
      'my-goat-journey:appearance:/team/journey/app/',
    ],
  ])('shares the exact app appearance key from %s', (scriptUrl, key) => {
    const page = createPage({ scriptUrl, stored: { [key]: 'dark' } });
    expectAppearance(page, 'dark', 'dark');
    expect(page.localStorage.getItem.mock.calls).toEqual([[key]]);
    expectNoStorageWrites(page);
    page.ready();
    expectButtons(page, 'dark');
    expect(page.localStorage.getItem.mock.calls).toEqual([[key]]);
    expectNoStorageWrites(page);
    page.click('light');
    expect(page.localStorage.setItem.mock.calls).toEqual([[key, 'light']]);
    expect(page.values.get(key)).toBe('light');
  });

  it.each([false, true])(
    'follows live OS appearance without writing (dark OS: %s)',
    (systemDark) => {
      const page = createPage({ systemDark });
      expectAppearance(page, 'system', systemDark ? 'dark' : 'light');
      // OS changes before parsing finishes must reach both the head and later controls.
      page.systemChanged(!systemDark);
      expectAppearance(page, 'system', systemDark ? 'light' : 'dark');
      page.ready();
      expectButtons(page, systemDark ? 'light' : 'dark');
      page.systemChanged(systemDark);
      expectAppearance(page, 'system', systemDark ? 'dark' : 'light');
      expectButtons(page, systemDark ? 'dark' : 'light');
      expect(page.localStorage.getItem.mock.calls).toEqual([[storageKey]]);
      expectNoStorageWrites(page);
    },
  );

  it.each(['system', 'Graphite', 'Dark', ' light ', ''])(
    'treats stored %j as System without repairing storage',
    (stored) => {
      const page = createPage({ stored: { [storageKey]: stored }, systemDark: true });
      expectAppearance(page, 'system', 'dark');
      page.ready();
      expectButtons(page, 'dark');
      page.systemChanged(false);
      expectAppearance(page, 'system', 'light');
      expectButtons(page, 'light');
      expect(page.values.get(storageKey)).toBe(stored);
      expectNoStorageWrites(page);
    },
  );

  it.each(['light', 'dark'] as const)(
    'keeps saved explicit %s above initial and live OS changes',
    (stored) => {
      const page = createPage({ stored: { [storageKey]: stored }, systemDark: stored !== 'dark' });
      expectAppearance(page, stored, stored);
      page.ready();
      expectButtons(page, stored);
      page.systemChanged(true);
      page.systemChanged(false);
      expectAppearance(page, stored, stored);
      expectButtons(page, stored);
      expectNoStorageWrites(page);
    },
  );

  it.each(['access', 'read'] as const)(
    'keeps live System usable when storage %s throws',
    (readFailure) => {
      const page = createPage({ readFailure, systemDark: true });
      expectAppearance(page, 'system', 'dark');
      page.ready();
      expectButtons(page, 'dark');
      page.systemChanged(false);
      expectAppearance(page, 'system', 'light');
      expectButtons(page, 'light');
      expectNoStorageWrites(page);
    },
  );
});

describe('landing appearance storage synchronization', () => {
  it('adopts peer choices before DOM readiness without writing or rereading', () => {
    const page = createPage();
    page.storageChanged(storageKey, 'dark');
    expectAppearance(page, 'dark', 'dark');
    page.ready();
    expectButtons(page, 'dark');
    page.storageChanged(storageKey, 'light');
    expectAppearance(page, 'light', 'light');
    expectButtons(page, 'light');
    page.systemChanged(true);
    expectAppearance(page, 'light', 'light');
    expect(page.localStorage.getItem.mock.calls).toEqual([[storageKey]]);
    expectNoStorageWrites(page);
  });

  it.each([
    ['remove', storageKey, null],
    ['clear', null, null],
    ['System', storageKey, 'system'],
    ['invalid', storageKey, 'Graphite'],
  ] as const)('resumes live System after a peer %s event', (_name, key, newValue) => {
    const page = createPage({ stored: { [storageKey]: 'light' }, systemDark: true });
    page.ready();
    page.storageChanged(key, newValue);
    expectAppearance(page, 'system', 'dark');
    expectButtons(page, 'dark');
    page.systemChanged(false);
    expectAppearance(page, 'system', 'light');
    expectButtons(page, 'light');
    expect(page.localStorage.getItem.mock.calls).toEqual([[storageKey]]);
    expectNoStorageWrites(page);
  });

  it('ignores other keys, app bases and sessionStorage including its clear event', () => {
    const page = createPage({ stored: { [storageKey]: 'light' }, systemDark: true });
    page.ready();
    for (const key of [
      'my-goat-journey.landing.language',
      'my-goat-journey:appearance:/other/app/',
    ]) {
      page.storageChanged(key, 'dark');
      expectAppearance(page, 'light', 'light');
    }
    page.storageChanged(storageKey, 'dark', page.sessionStorage);
    expectAppearance(page, 'light', 'light');
    page.storageChanged(null, null, page.sessionStorage);
    expectAppearance(page, 'light', 'light');
    expectButtons(page, 'light');
    expectNoStorageWrites(page);
  });
});

describe('landing explicit appearance controls', () => {
  it.each(['light', 'dark'] as const)(
    'stores selecting the already-resolved %s as an explicit override',
    (choice) => {
      const page = createPage({ systemDark: choice === 'dark' });
      page.ready();
      expectAppearance(page, 'system', choice);
      expectButtons(page, choice);
      page.click(choice);
      expectAppearance(page, choice, choice);
      expectButtons(page, choice);
      expect(page.localStorage.setItem.mock.calls).toEqual([[storageKey, choice]]);
      expect(page.values.get(storageKey)).toBe(choice);
      page.systemChanged(choice !== 'dark');
      expectAppearance(page, choice, choice);
    },
  );

  it.each([undefined, 'access', 'read'] as const)(
    'keeps failed-write session choices usable with %s read failure',
    (readFailure) => {
      const page = createPage({
        readFailure,
        writeFailure: true,
        stored: { [storageKey]: 'light' },
      });
      page.ready();
      for (const choice of ['dark', 'light', 'dark'] as const) {
        page.click(choice);
        expectAppearance(page, choice, choice);
        expectButtons(page, choice);
        page.systemChanged(choice !== 'dark');
        expectAppearance(page, choice, choice);
      }
      expect(page.values.get(storageKey)).toBe('light');
      expect(page.localStorage.setItem.mock.calls).toEqual(
        readFailure === 'access'
          ? []
          : [
              [storageKey, 'dark'],
              [storageKey, 'light'],
              [storageKey, 'dark'],
            ],
      );
      // App Settings selecting System can still release the in-memory override.
      if (readFailure !== 'access') {
        page.storageChanged(storageKey, 'system');
        expectAppearance(page, 'system', 'light');
        expectButtons(page, 'light');
        page.systemChanged(true);
        expectAppearance(page, 'system', 'dark');
      }
    },
  );
});
