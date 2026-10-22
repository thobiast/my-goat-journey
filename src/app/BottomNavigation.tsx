import type { RefObject } from 'react';
import type { Copy } from '../i18n/copy';

export type PrimaryDestination = 'today' | 'pillars' | 'journey' | 'progress' | 'settings';

function NavigationIcon({ destination }: { destination: PrimaryDestination }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {destination === 'today' ? (
        <>
          <rect x="4" y="5" width="16" height="16" rx="2" />
          <path d="M8 3v4m8-4v4M4 10h16" />
        </>
      ) : destination === 'pillars' ? (
        <>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </>
      ) : destination === 'journey' ? (
        <>
          <path d="M4 5l5-2 6 3 5-2v15l-5 2-6-3-5 2zM9 3v15m6-12v15" />
        </>
      ) : destination === 'progress' ? (
        <>
          <path d="M4 20V10m8 10V4m8 16v-7" />
        </>
      ) : (
        <>
          <path d="M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

export function BottomNavigation({
  copy,
  active,
  busy,
  navigationRef,
  open,
}: {
  copy: Copy;
  active: PrimaryDestination;
  busy: boolean;
  navigationRef: RefObject<HTMLElement | null>;
  open: (destination: PrimaryDestination) => void;
}) {
  return (
    <nav ref={navigationRef} aria-label={copy.primaryNavigation} className="bottom-nav">
      {(['today', 'pillars', 'journey', 'progress', 'settings'] as const).map((destination) => (
        <button
          type="button"
          key={destination}
          disabled={busy}
          aria-current={active === destination ? 'page' : undefined}
          onClick={() => open(destination)}
        >
          <NavigationIcon destination={destination} />
          <span className="nav-label">
            {destination === 'settings' ? copy.settingsNav : copy[destination]}
          </span>
        </button>
      ))}
    </nav>
  );
}
