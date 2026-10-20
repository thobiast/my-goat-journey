// Four connected cubics in viewBox="0 0 400 480". The vertical tangents
// match at each marker, rounding the zigzag while keeping it moving upward.
export const TRAIL_SEGMENTS: {
  d: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
}[] = [
  {
    d: 'M 88 436.8 C 88 408 300 379.2 300 350.4',
    from: { x: 88, y: 436.8 },
    to: { x: 300, y: 350.4 },
  },
  {
    d: 'M 300 350.4 C 300 321.6 112 292.8 112 264',
    from: { x: 300, y: 350.4 },
    to: { x: 112, y: 264 },
  },
  {
    d: 'M 112 264 C 112 235.2 292 206.4 292 177.6',
    from: { x: 112, y: 264 },
    to: { x: 292, y: 177.6 },
  },
  {
    d: 'M 292 177.6 C 292 148.8 204 129.6 204 100.8',
    from: { x: 292, y: 177.6 },
    to: { x: 204, y: 100.8 },
  },
];

export function levelState(
  level: number,
  currentLevel: number,
): 'reached' | 'current' | 'upcoming' {
  if (level < currentLevel) return 'reached';
  return level === currentLevel ? 'current' : 'upcoming';
}

export function levelThreshold(level: number): number {
  return (level - 1) * 100;
}

export function trailStretch(level: number): {
  pageIndex: number;
  startLevel: number;
  endLevel: number;
  levels: number[];
} {
  const pageIndex = Math.floor((level - 1) / 4);
  const startLevel = 1 + pageIndex * 4;
  const endLevel = startLevel + 4;
  return {
    pageIndex,
    startLevel,
    endLevel,
    levels: Array.from({ length: 5 }, (_, index) => startLevel + index),
  };
}
