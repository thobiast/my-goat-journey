// Body uses the exact official Lucide geometry; other provisional drawings are original.
import { BicepsFlexed } from './icons/BicepsFlexed';

export function PillarIcon({ kind, size = 24 }: { kind?: string; size?: number }) {
  if (kind === 'body') return <BicepsFlexed size={size} strokeWidth={1.8} />;
  const shapes: Record<string, string> = {
    mind: 'M12 5C10 2 5 3 5 7C1 8 2 13 5 14C3 19 8 22 12 19M12 5C14 2 19 3 19 7C23 8 22 13 19 14C21 19 16 22 12 19M12 5V19M5 7L8 9L7 12M19 7L16 9L17 12M5 14L9 15M19 14L15 15',
    nutrition:
      'M17 12A5 5 0 1 1 7 12A5 5 0 1 1 17 12M2 3V10L4 12L6 10V3M4 3V21M21 3C18 5 18 9 21 11V21M21 3V11',
    hygiene: 'M12 2C10 6 4 11 4 15A8 8 0 0 0 20 15C20 11 14 6 12 2ZM8 15C8 17 9 18 11 18',
    custom: 'M12 3L21 12L12 21L3 12ZM8 12H16M12 8V16',
  };
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={shapes[kind ?? 'custom'] ?? shapes.custom} />
    </svg>
  );
}
