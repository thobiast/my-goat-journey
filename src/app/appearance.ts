import { useSyncExternalStore } from 'react';

export type AppearancePreference = 'system' | 'light' | 'dark';

// A presentation preference for this app base, never a Repository setting.
const storageKey = `my-goat-journey:appearance:${import.meta.env.BASE_URL}`;
const subscribers = new Set<() => void>();
let preference = normalizeAppearance(
  typeof document === 'undefined'
    ? undefined
    : document.documentElement.dataset.appearancePreference,
);
let media: MediaQueryList | undefined;

function normalizeAppearance(value: string | null | undefined): AppearancePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

function applyAppearance() {
  const dark = preference === 'dark' || (preference === 'system' && media?.matches);
  const resolved = dark ? 'dark' : 'light';
  const root = document.documentElement;
  root.dataset.appearancePreference = preference;
  root.dataset.appearance = resolved;
  root.style.colorScheme = resolved;
  root.style.backgroundColor = dark ? '#090B0E' : '#fffaf0';
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#090B0E' : '#fffaf0');
}

function publish() {
  applyAppearance();
  subscribers.forEach((notify) => notify());
}

function systemChanged() {
  if (preference === 'system') applyAppearance();
}

function storageChanged(event: StorageEvent) {
  if (event.key === storageKey || event.key === null) {
    preference = normalizeAppearance(event.newValue);
    publish();
  }
}

function subscribe(notify: () => void) {
  if (!subscribers.size) {
    media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', systemChanged);
    window.addEventListener('storage', storageChanged);
    // Adopt after the runtime listener exists, including events since module evaluation.
    const bootstrap = window as Window & { __goatAppearanceBootstrap?: () => string | undefined };
    if (bootstrap.__goatAppearanceBootstrap) {
      preference = normalizeAppearance(bootstrap.__goatAppearanceBootstrap());
    }
    applyAppearance();
  }
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
    if (!subscribers.size) {
      media?.removeEventListener('change', systemChanged);
      window.removeEventListener('storage', storageChanged);
      media = undefined;
    }
  };
}

export function setAppearance(value: AppearancePreference) {
  preference = value;
  try {
    window.localStorage.setItem(storageKey, value);
  } catch {
    // Keep the session choice when browser storage is blocked or full.
  }
  publish();
}

export function useAppearance() {
  return useSyncExternalStore(
    subscribe,
    () => preference,
    () => 'system' as const,
  );
}
